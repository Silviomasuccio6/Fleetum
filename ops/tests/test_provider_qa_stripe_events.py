"""Safety boundaries of the real Stripe QA forwarding fixture; no network or credentials."""
import hashlib
import hmac
import importlib.util
from pathlib import Path
import unittest
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


if __name__ == '__main__':
    unittest.main()
