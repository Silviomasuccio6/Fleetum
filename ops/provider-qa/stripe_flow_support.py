"""Boundaries of the local Stripe integration fixture, not application middleware."""
import hashlib
import hmac
import threading

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
