"""Boundaries of the local Stripe integration fixture, not application middleware."""
import hashlib
import hmac
import threading
import base64
import json
import urllib.request
import urllib.error

EVENT_TYPES = frozenset({'checkout.session.completed', 'customer.subscription.created',
    'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid',
    'invoice.payment_succeeded', 'invoice.payment_failed'})


def verify_signature(payload, header, secret, now):
    if not isinstance(payload, bytes) or not isinstance(header, str) or len(header) > 4096:
        return False
    fields = [part.partition('=') for part in header.split(',')]
    timestamps = [value for key, delimiter, value in fields if key == 't' and delimiter]
    signatures = [value for key, delimiter, value in fields if key == 'v1' and delimiter]
    if len(timestamps) != 1 or not timestamps[0].isdigit() or not 1 <= len(signatures) <= 4:
        return False
    timestamp = int(timestamps[0])
    if not now - 300 <= timestamp <= now + 5:
        return False
    digest = hmac.new(secret.encode(), timestamps[0].encode() + b'.' + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(digest, value) for value in signatures)


def nested(source, *path):
    for key in path:
        if not isinstance(source, dict):
            return None
        source = source.get(key)
    return source


def stripe_id(value):
    candidate = value.get('id') if isinstance(value, dict) else value
    return candidate if isinstance(candidate, str) else None


def belongs_to_fixture(event, tenant_id, customers, subscriptions):
    if not isinstance(event, dict) or event.get('livemode') is not False or event.get('type') not in EVENT_TYPES:
        return False
    source = nested(event, 'data', 'object')
    if not isinstance(source, dict):
        return False
    declarations = [nested(source, 'metadata', 'tenantId'), source.get('client_reference_id'),
                    nested(source, 'parent', 'subscription_details', 'metadata', 'tenantId')]
    declarations = [value for value in declarations if value is not None and value != '']
    if declarations and any(value != tenant_id for value in declarations):
        return False
    if tenant_id in declarations:
        return True
    subscription = stripe_id(source.get('subscription')) or stripe_id(nested(source, 'parent', 'subscription_details', 'subscription'))
    if source.get('object') == 'subscription':
        subscription = stripe_id(source.get('id'))
    return stripe_id(source.get('customer')) in customers or subscription in subscriptions


def is_period_end_cancellation(subscription):
    items = nested(subscription, 'items', 'data')
    if items is not None and (not isinstance(items, list) or len(items) != 1):
        return False
    period_end = subscription.get('current_period_end')
    if period_end is None and items:
        period_end = items[0].get('current_period_end')
    if type(period_end) is not int or period_end <= 0:
        return False
    flag, cancel_at = subscription.get('cancel_at_period_end'), subscription.get('cancel_at')
    if type(flag) is not bool:
        return False
    if cancel_at is None:
        return flag is True
    # Flexible-billing portal cancellation can set an explicit cancel_at while
    # leaving cancel_at_period_end false. Require exact equality to the period.
    return type(cancel_at) is int and cancel_at == period_end


def refresh_fixture_session(client, jar, now):
    cookies = {cookie.name: cookie.value for cookie in jar}
    token = cookies.get('fermi_access', '')
    try:
        payload = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
        expires_at = payload['exp']
        if type(expires_at) not in {int, float} or expires_at > now + 30:
            return False
    except (ValueError, IndexError, KeyError, TypeError):
        return False
    if not cookies.get('fermi_refresh') or not cookies.get('fermi_csrf'):
        return False
    # This unverified expiry is a client scheduling hint, never authorization.
    # The normal auth endpoint validates and rotates the actual refresh cookie.
    request = urllib.request.Request('http://127.0.0.1:4200/api/auth/refresh',
        data=b'{}', method='POST', headers={'Content-Type': 'application/json',
        'Origin': 'http://localhost:5273', 'X-CSRF-Token': cookies['fermi_csrf']})
    try:
        with client.open(request, timeout=10) as response:
            if response.status != 200:
                raise RuntimeError('QA_SESSION_REFRESH_UNEXPECTED_STATUS')
            response.read(65536)  # Do not retain the body or any tokens.
    except urllib.error.HTTPError as error:
        error.read(65536)
        raise RuntimeError('QA_SESSION_REFRESH_HTTP_' + str(error.code)) from None
    updated = {cookie.name: cookie.value for cookie in jar}
    if (updated.get('fermi_access') in {None, token} or
            updated.get('fermi_csrf') in {None, cookies['fermi_csrf']}):
        raise RuntimeError('QA_SESSION_REFRESH_COOKIES_NOT_ROTATED')
    return True


def validate_fixture_snapshot(observed, tenant_a, tenant_b, baseline_b=None):
    rows = observed['rows']
    if len(rows) != 2 or {row['tenantId'] for row in rows} != {tenant_a, tenant_b}:
        raise RuntimeError('QA_FIXTURE_TENANT_COUNT_CHANGED')
    if baseline_b is not None:
        if next(row for row in rows if row['tenantId'] == tenant_b) != baseline_b:
            raise RuntimeError('QA_CONTROL_TENANT_MUTATED')
        # A zero-value invoice may arrive before Checkout establishes any binding.
        # An ignored, unbound event is not a mutation of another tenant. Processed
        # or explicitly foreign events must still fail, including foreign IGNORED.
        if any(event['tenantId'] != tenant_a and not
               (event['tenantId'] is None and event['status'] == 'IGNORED')
               for event in observed['events']):
            raise RuntimeError('QA_EVENT_TENANT_LEAK')


class RequestBudget:
    def __init__(self, reads, writes):
        self.limits = {'reads': reads, 'writes': writes}
        self.counts = {'reads': 0, 'writes': 0}
        self.lock = threading.Lock()

    def take(self, method):
        if method not in {'GET', 'POST', 'DELETE'}:
            raise RuntimeError('QA_PROVIDER_METHOD_REFUSED')
        category = 'reads' if method == 'GET' else 'writes'
        with self.lock:
            if self.counts[category] >= self.limits[category]:
                raise RuntimeError('QA_PROVIDER_REQUEST_CAP')
            self.counts[category] += 1

    def snapshot(self):
        with self.lock:
            return dict(self.counts)
