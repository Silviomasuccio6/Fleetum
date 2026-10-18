"""Safety boundaries of the real Stripe QA forwarding fixture; no network or credentials."""
import hashlib
import hmac
import importlib.util
from pathlib import Path
import unittest
import base64
import io
import json
import urllib.error
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('qa_stripe_events',
    Path(__file__).resolve().parents[1] / 'provider-qa/stripe_flow_support.py')
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


class ForwardingSafety(unittest.TestCase):
    def setUp(self):
        self.payload = b'{"livemode":false}'
        self.secret = 'whsec_synthetic_unit_test_only'
        self.signature = 't=1000,v1=' + hmac.new(self.secret.encode(), b'1000.' + self.payload, hashlib.sha256).hexdigest()

    def event(self, obj, live=False):
        return {'livemode': live, 'type': 'customer.subscription.updated', 'data': {'object': obj}}

    def owned(self, event):
        return support.belongs_to_fixture(event, 'tenant-qa-a', {'cus_ours'}, {'sub_ours'})

    def test_signature_accepts_unchanged_provider_envelope(self):
        self.assertTrue(support.verify_signature(self.payload, self.signature, self.secret, 1100))

    def test_signature_rejects_modified_body_or_missing_header(self):
        self.assertFalse(support.verify_signature(self.payload + b' ', self.signature, self.secret, 1100))
        self.assertFalse(support.verify_signature(self.payload, '', self.secret, 1100))

    def test_signature_rejects_expired_future_or_ambiguous_timestamp(self):
        for now, header in [(1400, self.signature), (900, self.signature), (1000, 't=999,' + self.signature)]:
            self.assertFalse(support.verify_signature(self.payload, header, self.secret, now))

    def test_foreign_metadata_and_unrelated_customer_do_not_forward(self):
        self.assertFalse(self.owned(self.event({'metadata': {'tenantId': 'tenant-qa-b'}, 'customer': 'cus_foreign'})))

    def test_live_events_do_not_forward_even_with_fixture_metadata(self):
        self.assertFalse(self.owned(self.event({'metadata': {'tenantId': 'tenant-qa-a'}}, live=True)))

    def test_conflicting_tenant_declaration_is_rejected_despite_known_customer(self):
        self.assertFalse(self.owned(self.event({'metadata': {'tenantId': 'tenant-qa-b'}, 'customer': 'cus_ours'})))

    def test_malformed_binding_ids_do_not_forward_or_raise(self):
        self.assertFalse(self.owned(self.event({'customer': {'id': []}, 'subscription': {'id': {}}})))

    def test_metadata_or_known_binding_selects_only_owned_test_events(self):
        for obj in [{'metadata': {'tenantId': 'tenant-qa-a'}}, {'customer': 'cus_ours'},
                    {'subscription': 'sub_ours'}, {'object': 'subscription', 'id': 'sub_ours'}]:
            self.assertTrue(self.owned(self.event(obj)))

    def test_current_invoice_parent_metadata_is_recognized(self):
        obj = {'parent': {'subscription_details': {'metadata': {'tenantId': 'tenant-qa-a'}}}}
        self.assertTrue(self.owned(self.event(obj)))

    def test_malformed_envelopes_and_unselected_types_do_not_forward(self):
        for event in [{}, {'livemode': False, 'data': None}, self.event(None),
                      {'livemode': False, 'type': 'customer.created', 'data': {'object': {'customer': 'cus_ours'}}}]:
            self.assertFalse(self.owned(event))

    def test_request_budget_is_atomic_and_separates_reads_from_writes(self):
        budget = support.RequestBudget(reads=15, writes=2)
        def attempt(_):
            try:
                budget.take('GET')
                return True
            except RuntimeError:
                return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(attempt, range(30))), 15)
        budget.take('POST')
        budget.take('DELETE')
        with self.assertRaises(RuntimeError):
            budget.take('POST')
        self.assertEqual(budget.snapshot(), {'reads': 15, 'writes': 2})

    def fixture(self, event_tenant, event_status):
        baseline = {'tenantId': 'tenant-qa-b', 'status': 'PENDING', 'stripeCustomerId': None}
        observed = {'rows': [{'tenantId': 'tenant-qa-a', 'status': 'TRIAL'}, dict(baseline)],
                    'events': [{'tenantId': event_tenant, 'status': event_status}]}
        return observed, baseline

    def test_early_ignored_invoice_without_binding_is_not_a_foreign_tenant_mutation(self):
        observed, baseline = self.fixture(None, 'IGNORED')
        support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)

    def test_processed_event_must_be_bound_to_own_tenant(self):
        observed, baseline = self.fixture(None, 'PROCESSED')
        with self.assertRaisesRegex(RuntimeError, 'QA_EVENT_TENANT_LEAK'):
            support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)

    def test_foreign_event_remains_rejected_even_if_ignored(self):
        for tenant in ['tenant-qa-b', 'unrelated']:
            observed, baseline = self.fixture(tenant, 'IGNORED')
            with self.assertRaisesRegex(RuntimeError, 'QA_EVENT_TENANT_LEAK'):
                support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)

    def test_control_tenant_mutation_remains_rejected_with_unbound_ignored_event(self):
        observed, baseline = self.fixture(None, 'IGNORED')
        observed['rows'][1]['status'] = 'ACTIVE'
        with self.assertRaisesRegex(RuntimeError, 'QA_CONTROL_TENANT_MUTATED'):
            support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)

    def test_owned_processed_event_passes_and_duplicate_tenant_rows_fail(self):
        observed, baseline = self.fixture('tenant-qa-a', 'PROCESSED')
        support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)
        observed['rows'][1]['tenantId'] = 'tenant-qa-a'
        with self.assertRaisesRegex(RuntimeError, 'QA_FIXTURE_TENANT_COUNT_CHANGED'):
            support.validate_fixture_snapshot(observed, 'tenant-qa-a', 'tenant-qa-b', baseline)


class SessionRenewal(unittest.TestCase):
    def cookies(self, expiry=1000, suffix='a'):
        payload = base64.urlsafe_b64encode(json.dumps({'exp': expiry}).encode()).decode().rstrip('=')
        return [SimpleNamespace(name='fermi_access', value='synthetic.' + payload + '.not-a-real-signature'),
                SimpleNamespace(name='fermi_refresh', value='synthetic-refresh-' + suffix),
                SimpleNamespace(name='fermi_csrf', value='synthetic-csrf-' + suffix)]

    def client(self, jar, status=200, rotate=True):
        class Reply(io.BytesIO):
            status = 200
        class Client:
            def __init__(self): self.requests = []
            def open(self, request, timeout):
                self.requests.append((request.full_url, request.get_method(), request.data,
                                      request.get_header('X-csrf-token')))
                if status != 200:
                    raise urllib.error.HTTPError(request.full_url, status, 'synthetic', {}, io.BytesIO(b'{}'))
                if rotate:
                    for cookie in jar:
                        cookie.value += '-rotated'
                return Reply(b'{}')
        return Client()

    def test_current_token_does_not_refresh(self):
        jar = self.cookies(2000); client = self.client(jar)
        self.assertFalse(support.refresh_fixture_session(client, jar, 1000))
        self.assertEqual(client.requests, [])

    def test_expired_access_uses_normal_csrf_refresh_once(self):
        jar = self.cookies(); client = self.client(jar)
        self.assertTrue(support.refresh_fixture_session(client, jar, 1001))
        self.assertEqual(client.requests, [('http://127.0.0.1:4200/api/auth/refresh', 'POST', b'{}', 'synthetic-csrf-a')])

    def test_renewal_is_scheduled_near_expiry(self):
        jar = self.cookies(1020); client = self.client(jar)
        self.assertTrue(support.refresh_fixture_session(client, jar, 1000))
        self.assertEqual(len(client.requests), 1)

    def test_missing_refresh_or_csrf_cannot_be_invented(self):
        for missing in ['fermi_refresh', 'fermi_csrf']:
            jar = [c for c in self.cookies() if c.name != missing]; client = self.client(jar)
            self.assertFalse(support.refresh_fixture_session(client, jar, 1001))
            self.assertEqual(client.requests, [])

    def test_revoked_refresh_fails_closed_without_retry(self):
        jar = self.cookies(); client = self.client(jar, status=401)
        with self.assertRaisesRegex(RuntimeError, 'QA_SESSION_REFRESH_HTTP_401'):
            support.refresh_fixture_session(client, jar, 1001)
        self.assertEqual(len(client.requests), 1)

    def test_success_without_rotated_cookies_is_refused(self):
        jar = self.cookies(); client = self.client(jar, rotate=False)
        with self.assertRaisesRegex(RuntimeError, 'QA_SESSION_REFRESH_COOKIES_NOT_ROTATED'):
            support.refresh_fixture_session(client, jar, 1001)

    def test_cookie_jars_stay_separate_and_malformed_access_is_not_authority(self):
        jar_a = self.cookies(suffix='a'); jar_b = self.cookies(suffix='b')
        client = self.client(jar_a)
        self.assertTrue(support.refresh_fixture_session(client, jar_a, 1001))
        self.assertEqual(jar_b[2].value, 'synthetic-csrf-b')
        jar_b[0].value = 'malformed'
        client_b = self.client(jar_b)
        self.assertFalse(support.refresh_fixture_session(client_b, jar_b, 1001))
        self.assertEqual(client_b.requests, [])


if __name__ == '__main__':
    unittest.main()
