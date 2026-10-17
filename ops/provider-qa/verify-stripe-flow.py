"""Interactive, bounded local Stripe sandbox proof. No real dotenv, cards, email or deployment."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import datetime
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from stripe_flow_support import EVENT_TYPES, RequestBudget, belongs_to_fixture, nested, stripe_id, verify_signature

spec = importlib.util.spec_from_file_location('stripe_startup_fixture', Path(__file__).with_name('verify-stripe-startup.py'))
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


class StripeFlow:
    lease_seconds = 1500
    required_cases = frozenset({'pendingBeforeCheckout', 'redirectDoesNotActivate', 'trialViaProviderWebhook',
        'paidViaProviderWebhook', 'capturedEventReplay', 'cardUpdatedInPortal', 'upgradeFromAuthoritativePrice',
        'tenantIsolation', 'cancellationScheduledInPortal'})

    def __init__(self):
        self.cli = None
        self.http_servers = []
        self.secret = None
        self.secret_ready = threading.Event()
        self.lock = threading.RLock()
        self.hold = True
        self.held = []
        self.captured = {}
        self.deliveries = []
        self.customers = set()
        self.subscriptions = set()
        self.invoices = set()
        self.checkout_id = None
        self.portal_sessions = 0
        self.return_seen = False
        self.ignored_other_events = 0
        self.budget = RequestBudget(reads=80, writes=12)
        self.cases = set()
        self.finished = False
        self.cli_lines = 0
        self.fatal = None
        self.started = time.monotonic()

    def prepare(self, context):
        self.ctx = context
        self.root = context['root']
        self.tenant_a = 'provider-qa-' + context['run'] + '-a'
        self.tenant_b = 'provider-qa-' + context['run'] + '-b'
        self.email = 'qa-' + context['run'] + '@fleetum-provider-qa.invalid'
        self.commands = self.root / 'commands'
        self.commands.mkdir(mode=0o700)
        cli_config = self.root / 'stripe-cli-config'
        cli_config.mkdir(mode=0o700)
        for port in [4210, 5273]:
            with socket.socket() as probe:
                require(probe.connect_ex(('127.0.0.1', port)) != 0, 'QA_FLOW_PORT_ALREADY_USED')
        context['result'].update({'mode': 'stripe-flow', 'providerWrites': None,
            'localSyntheticWebhookSignature': False, 'exactTotalProviderHttpRequestsMetered': False,
            'scope': 'backend APIs and Stripe hosted UI; not a full Fleetum frontend test',
            'caps': {'durationSeconds': self.lease_seconds, 'checkoutSessions': 1, 'customers': 1,
                'subscriptions': 1, 'portalSessions': 4, 'testCardsEntered': 2,
                'fixtureDirectApiReads': 80, 'fixtureDirectApiWrites': 12,
                'ownedWebhookEnvelopesInMemory': 64},
            'permanentWebhookEndpointCreated': False, 'catalogOrPortalConfigurationChanged': False})
        flow = self

        class Proxy(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                if self.path != '/stripe-qa' or not flow.secret:
                    self.send_error(503)
                    return
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    require(0 < size <= 1048576, 'QA_ENVELOPE_SIZE_REFUSED')
                    payload = self.rfile.read(size)
                    header = self.headers.get('Stripe-Signature', '')
                    require(verify_signature(payload, header, flow.secret, time.time()), 'QA_PROVIDER_SIGNATURE_REFUSED')
                    event = json.loads(payload)
                    with flow.lock:
                        owned = belongs_to_fixture(event, flow.tenant_a, flow.customers, flow.subscriptions)
                        if not owned:
                            flow.ignored_other_events += 1
                            self.send_response(200)
                            self.end_headers()
                            return
                        flow.adopt_ids(event['data']['object'])
                        event_id = event.get('id', '')
                        require(re.fullmatch(r'evt_[A-Za-z0-9]+', event_id), 'QA_EVENT_ID_REFUSED')
                        require(event_id in flow.captured or len(flow.captured) < 64, 'QA_EVENT_MEMORY_CAP')
                        require(sum(len(v[0]) for v in flow.captured.values()) + len(payload) <= 8388608,
                                'QA_EVENT_BYTE_CAP')
                        flow.captured[event_id] = (payload, header, event)
                        if flow.hold:
                            flow.held.append(event_id)
                            code = 200
                        else:
                            code = None
                    if code is None:
                        code = flow.forward(event_id, 'stripe-cli')['httpStatus']
                    self.send_response(code if 100 <= code <= 599 else 503)
                    self.end_headers()
                except Exception as error:
                    with flow.lock:
                        flow.fatal = type(error).__name__
                    self.send_error(400)

        class ReturnPage(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                url = urllib.parse.urlsplit(self.path)
                if url.path not in {'/activate', '/upgrade', '/'}:
                    self.send_error(404)
                    return
                if url.path == '/activate' and urllib.parse.parse_qs(url.query).get('checkout') == ['success']:
                    flow.return_seen = True
                body = ('<!doctype html><html lang="it"><meta charset="utf-8">'
                        '<title>Fleetum QA — ritorno dal sandbox</title><body>'
                        '<h1>Ritorno dal sandbox ricevuto</h1><p>Laboratorio di prova Fleetum.</p>'
                        '<p>La verifica dello stato avviene separatamente tramite gli eventi Stripe.</p>'
                        '</body></html>').encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)

        for port, handler in [(4210, Proxy), (5273, ReturnPage)]:
            server = ThreadingHTTPServer(('127.0.0.1', port), handler)
            server.daemon_threads = True
            self.http_servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        cli_environment = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'XDG_CONFIG_HOME': str(cli_config),
                           'STRIPE_API_KEY': context['environment']['STRIPE_SECRET_KEY']}
        self.cli = subprocess.Popen(['/opt/homebrew/bin/stripe', '--color', 'off', 'listen', '--skip-update',
            '--events', ','.join(sorted(EVENT_TYPES)), '--forward-to', 'http://127.0.0.1:4210/stripe-qa'],
            env=cli_environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True)

        def consume(pipe):
            for line in iter(pipe.readline, b''):
                # Never retain or print the CLI's raw output or webhook signing secret.
                match = re.search(rb'whsec_[A-Za-z0-9]{16,200}', line)
                if match:
                    self.secret = match.group().decode()
                    self.secret_ready.set()
                self.cli_lines += 1
        for pipe in [self.cli.stdout, self.cli.stderr]:
            threading.Thread(target=consume, args=(pipe,), daemon=True).start()
        require(self.secret_ready.wait(25) and self.cli.poll() is None, 'QA_STRIPE_LISTENER_NOT_READY')
        require(not any(context['environment']['STRIPE_SECRET_KEY'].encode() in path.read_bytes()
                        for path in cli_config.rglob('*') if path.is_file()), 'QA_CLI_PERSISTED_API_KEY')
        context['environment']['STRIPE_WEBHOOK_SECRET'] = self.secret
        self.status('provider-listener-ready')

    def adopt_ids(self, source):
        customer = stripe_id(source.get('customer'))
        subscription = stripe_id(source.get('subscription')) or stripe_id(nested(source, 'parent', 'subscription_details', 'subscription'))
        if source.get('object') == 'subscription':
            subscription = stripe_id(source.get('id'))
        if customer:
            require(re.fullmatch(r'cus_[A-Za-z0-9]+', customer), 'QA_CUSTOMER_ID_REFUSED')
            self.customers.add(customer)
        if subscription:
            require(re.fullmatch(r'sub_[A-Za-z0-9]+', subscription), 'QA_SUBSCRIPTION_ID_REFUSED')
            self.subscriptions.add(subscription)
        require(len(self.customers) <= 1 and len(self.subscriptions) <= 1, 'QA_RESOURCE_CAP')

    def status(self, stage):
        with self.lock:
            safe = {'stage': stage, 'root': str(self.root), 'syntheticEmail': self.email,
                'elapsedSeconds': int(time.monotonic() - self.started), 'casesPassed': sorted(self.cases),
                'checkoutId': self.checkout_id, 'customerIds': sorted(self.customers),
                'subscriptionIds': sorted(self.subscriptions), 'portalSessions': self.portal_sessions,
                'heldEvents': len(self.held), 'capturedEvents': len(self.captured),
                'ignoredUnrelatedEvents': self.ignored_other_events, 'deliveries': list(self.deliveries),
                'fixtureDirectProviderRequests': self.budget.snapshot(), 'returnPageSeen': self.return_seen,
                'providerSigningSecretRetained': False, 'fatalErrorType': self.fatal}
            safe['ownedCliPid'] = self.cli.pid if self.cli is not None else None
            self.ctx['result']['flow'] = safe
            self.ctx['progress'](stage)
            path = self.root / 'control.json'
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                json.dump(safe, output)
        return safe

    def forward(self, event_id, origin):
        payload, header, event = self.captured[event_id]
        require(verify_signature(payload, header, self.secret, time.time()), 'QA_CAPTURED_SIGNATURE_EXPIRED')
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request('http://127.0.0.1:4200/api/billing/webhook', data=payload,
            headers={'Content-Type': 'application/json', 'Stripe-Signature': header})
        try:
            with client.open(request, timeout=15) as response:
                code, body = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            error.read(65536)
            code, body = error.code, {}
        receipt = {'eventId': event_id, 'eventType': event['type'], 'httpStatus': code,
            'received': body.get('received') is True, 'duplicate': body.get('duplicate') is True,
            'ignored': body.get('ignored') is True, 'bodySha256': hashlib.sha256(payload).hexdigest(),
            'providerSignatureVerified': True, 'origin': origin}
        with self.lock:
            require(len(self.deliveries) < 120, 'QA_DELIVERY_CAP')
            self.deliveries.append(receipt)
        return receipt

    def provider(self, method, path, parameters=None):
        url = urllib.parse.urlsplit(path)
        permitted = False
        if self.checkout_id and url.path in {'/v1/checkout/sessions/' + self.checkout_id,
                                            '/v1/checkout/sessions/' + self.checkout_id + '/expire'}:
            permitted = method == 'GET' or (method == 'POST' and url.path.endswith('/expire'))
        if any(url.path == '/v1/customers/' + customer for customer in self.customers):
            permitted = method in {'GET', 'POST', 'DELETE'}
        if any(url.path == '/v1/subscriptions/' + subscription for subscription in self.subscriptions):
            permitted = method in {'GET', 'DELETE'}
        if url.path in {'/v1/invoices', '/v1/payment_methods'}:
            query = urllib.parse.parse_qs(url.query)
            permitted = method == 'GET' and query.get('customer', [None])[0] in self.customers and query.get('limit') == ['10']
        require(permitted and not url.scheme and not url.netloc and not url.fragment, 'QA_PROVIDER_RESOURCE_REFUSED')
        self.budget.take(method)
        headers = {'Authorization': 'Bearer ' + self.ctx['environment']['STRIPE_SECRET_KEY'], 'Accept': 'application/json'}
        data = urllib.parse.urlencode(parameters or {}).encode() if method == 'POST' else None
        if method == 'POST':
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            headers['Idempotency-Key'] = 'fleetum-qa-' + self.ctx['run'] + '-' + str(self.budget.snapshot()['writes'])
        request = urllib.request.Request('https://api.stripe.com' + path, data=data, headers=headers, method=method)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args, **_kwargs):
                return None
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with client.open(request, timeout=20) as response:
                raw = response.read(1048577)
                require(len(raw) <= 1048576, 'QA_PROVIDER_RESPONSE_TOO_LARGE')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            error.read(65536)
            raise RuntimeError('QA_PROVIDER_HTTP_' + str(error.code)) from None
        except (OSError, ValueError):
            raise RuntimeError('QA_PROVIDER_READ_FAILED') from None

    def api(self, path, method='GET', data=None, tenant='a', csrf=True):
        client, jar = (self.client_a, self.jar_a) if tenant == 'a' else (self.client_b, self.jar_b)
        headers = {'Content-Type': 'application/json', 'Origin': 'http://localhost:5273'}
        if csrf:
            headers['X-CSRF-Token'] = next(cookie.value for cookie in jar if cookie.name == 'fermi_csrf')
        request = urllib.request.Request('http://127.0.0.1:4200' + path,
            data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        try:
            with client.open(request, timeout=25) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            raw = error.read(65536)
            try:
                body = json.loads(raw)
            except ValueError:
                body = {}
            return error.code, {'code': body.get('code'), 'ownedResourceIdLeaked': any(
                identifier.encode() in raw for identifier in self.customers | self.subscriptions)}

    def snapshot(self):
        code = '''import {PrismaClient} from '@prisma/client';const db=new PrismaClient();try{
const rows=await db.tenantSubscription.findMany({orderBy:{tenantId:'asc'},select:{tenantId:true,provider:true,plan:true,status:true,seats:true,billingCycle:true,stripeCustomerId:true,stripeSubscriptionId:true,currentPeriodEnd:true,updatedAt:true}});
const events=await db.billingEvent.findMany({orderBy:{eventId:'asc'},select:{eventId:true,type:true,tenantId:true,status:true}});
console.log(JSON.stringify({rows,events}));}finally{await db.$disconnect();}'''
        result = self.ctx['run_node']([self.ctx['node'], '--input-type=module', '-e', code],
            cwd=self.ctx['repository'], env=self.ctx['database_environment'], text=True, timeout=15)
        require(result.returncode == 0, 'QA_FLOW_DATABASE_INSPECTION_FAILED')
        observed = json.loads(result.stdout)
        require(len(observed['rows']) == 2, 'QA_FIXTURE_TENANT_COUNT_CHANGED')
        if hasattr(self, 'baseline_b'):
            require(next(row for row in observed['rows'] if row['tenantId'] == self.tenant_b) == self.baseline_b,
                    'QA_CONTROL_TENANT_MUTATED')
            require(all(event['tenantId'] == self.tenant_a for event in observed['events']), 'QA_EVENT_TENANT_LEAK')
        return observed

    def target(self, purpose, url):
        parsed = urllib.parse.urlsplit(url)
        expected = 'checkout.stripe.com' if purpose == 'checkout' else 'billing.stripe.com'
        require(parsed.scheme == 'https' and parsed.hostname == expected and not parsed.username and not parsed.password,
                'QA_BROWSER_TARGET_REFUSED')
        descriptor = os.open(self.root / 'browser-target.json', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump({'purpose': purpose, 'url': url}, output)

    def run(self, context, client, jar):
        self.client_a, self.jar_a = client, jar
        self.jar_b = http.cookiejar.CookieJar()
        self.client_b = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar_b))
        request = urllib.request.Request('http://127.0.0.1:4200/api/auth/login',
            data=json.dumps({'email': 'qa-b@fleetum-provider-qa.invalid', 'password': context['password']}).encode(),
            headers={'Content-Type': 'application/json'})
        with self.client_b.open(request, timeout=10) as response:
            require(response.status == 200, 'QA_CONTROL_TENANT_LOGIN_FAILED')
            response.read(65536)
        baseline = self.snapshot()
        self.baseline_b = next(row for row in baseline['rows'] if row['tenantId'] == self.tenant_b)
        require(all(row['status'] == 'PENDING' and row['provider'] == 'local' and row['stripeCustomerId'] is None
                    for row in baseline['rows']) and not baseline['events'], 'QA_PENDING_BASELINE_FAILED')
        self.cases.add('pendingBeforeCheckout')
        self.status('awaiting-checkout-command')
        handled = set()
        deadline = self.started + self.lease_seconds - 90
        while not self.finished:
            require(time.monotonic() < deadline, 'QA_FLOW_LEASE_EXPIRED')
            require(self.cli.poll() is None and self.fatal is None, 'QA_FLOW_LISTENER_OR_FORWARDER_FAILED')
            for command_path in sorted(self.commands.glob('*.json')):
                if command_path.name in handled or not re.fullmatch(r'[0-9]{3}\.json', command_path.name):
                    continue
                require(command_path.stat().st_size <= 1024 and not command_path.is_symlink(), 'QA_COMMAND_FILE_REFUSED')
                command = json.loads(command_path.read_text())
                require(set(command) == {'action'} and isinstance(command['action'], str), 'QA_COMMAND_FORMAT_REFUSED')
                action = command['action']
                try:
                    answer = self.action(action)
                except Exception as error:
                    diagnostic = {'status': 'FAIL', 'action': action, 'errorType': type(error).__name__,
                                  'safeError': str(error) if isinstance(error, RuntimeError) else 'withheld'}
                    try:
                        diagnostic['database'] = self.snapshot()
                    except Exception:
                        diagnostic['databaseDiagnosticUnavailable'] = True
                    (context['evidence'] / ('command-' + command_path.stem + '-' + action + '-failed.json')).write_text(
                        json.dumps(diagnostic, indent=2) + '\n')
                    raise
                observed = self.snapshot()
                answer.update({'action': action, 'database': observed})
                (context['evidence'] / ('command-' + command_path.stem + '-' + action + '.json')).write_text(json.dumps(answer, indent=2) + '\n')
                handled.add(command_path.name)
                self.status('command-' + action + '-completed')
            time.sleep(0.2)
        return {'status': 'PASS', 'readinessStatus': 200, 'loginStatus': 200, 'authenticatedProfileStatus': 200,
            'realStripeWebhookDeliveryTested': True, 'paidBillingFlowsTested': True,
            'fullFleetumFrontendTested': False, 'realEmailsSent': 0, 'cookieValuesRetained': False,
            'providerWrites': None, 'casesPassed': sorted(self.cases)}

    def subscription(self):
        require(len(self.subscriptions) == 1, 'QA_OWNED_SUBSCRIPTION_REQUIRED')
        subscription = self.provider('GET', '/v1/subscriptions/' + next(iter(self.subscriptions)))
        require(subscription.get('livemode') is False and stripe_id(subscription.get('customer')) in self.customers
                and nested(subscription, 'metadata', 'tenantId') == self.tenant_a, 'QA_SUBSCRIPTION_OWNERSHIP_REFUSED')
        return subscription

    def verify_period(self, row, subscription, code):
        items = subscription['items']['data']
        require(len(items) == 1, 'QA_SINGLE_PLAN_ITEM_REQUIRED')
        period_end = subscription.get('current_period_end') or items[0].get('current_period_end')
        self.ctx['result']['authoritativePeriodObserved'] = {'topLevelPeriodEnd': subscription.get('current_period_end'),
            'itemPeriodEnd': items[0].get('current_period_end'), 'licensePeriodEnd': row['currentPeriodEnd'],
            'subscriptionStatus': subscription['status']}
        actual = row['currentPeriodEnd']
        require(period_end is not None and actual is not None and
                int(datetime.datetime.fromisoformat(actual.replace('Z', '+00:00')).timestamp()) == period_end, code)

    def own_invoices(self):
        require(len(self.customers) == 1, 'QA_OWNED_CUSTOMER_REQUIRED')
        result = self.provider('GET', '/v1/invoices?' + urllib.parse.urlencode(
            {'customer': next(iter(self.customers)), 'limit': 10}))
        require(result.get('object') == 'list' and result.get('has_more') is False, 'QA_INVOICE_LIST_CAP')
        require(len(result['data']) <= 4, 'QA_INVOICE_RESOURCE_CAP')
        for invoice in result['data']:
            require(invoice.get('livemode') is False and stripe_id(invoice.get('customer')) in self.customers
                    and re.fullmatch(r'in_[A-Za-z0-9]+', invoice.get('id', '')), 'QA_INVOICE_OWNERSHIP_REFUSED')
            self.invoices.add(invoice['id'])
        return result['data']

    def create_portal(self, purpose, parameters):
        require(self.portal_sessions < 4, 'QA_PORTAL_SESSION_CAP')
        self.portal_sessions += 1
        code, body = self.api('/api/billing/customer-portal-session', 'POST', parameters)
        require(code == 200 and isinstance(body.get('portalUrl'), str), 'QA_PORTAL_CREATION_FAILED')
        self.target(purpose, body['portalUrl'])
        return {'status': 'READY', 'portalSessionIntents': self.portal_sessions, 'browserTargetPurpose': purpose}

    def action(self, action):
        if action == 'snapshot':
            return {'status': 'OBSERVED', 'flow': self.status('snapshot')}
        if action == 'checkout':
            require(self.checkout_id is None, 'QA_SINGLE_CHECKOUT_CAP')
            code, _ = self.api('/api/billing/checkout-session', 'POST', {'plan': 'STARTER', 'billingCycle': 'monthly'}, csrf=False)
            require(code == 403, 'QA_MISSING_CSRF_NOT_REFUSED')
            code, _ = self.api('/api/billing/customer-portal-session', 'POST', {}, tenant='b')
            require(code == 409, 'QA_CONTROL_TENANT_PORTAL_NOT_REFUSED')
            code, body = self.api('/api/billing/checkout-session', 'POST', {'plan': 'STARTER', 'billingCycle': 'monthly'})
            require(code == 200 and body.get('mode') == 'stripe', 'QA_CHECKOUT_CREATION_FAILED')
            self.target('checkout', body['checkoutUrl'])
            match = re.search(r'cs_test_[A-Za-z0-9]+', body['checkoutUrl'])
            require(match is not None, 'QA_TEST_CHECKOUT_ID_REQUIRED')
            self.checkout_id = match.group()
            session = self.provider('GET', '/v1/checkout/sessions/' + self.checkout_id)
            require(session.get('livemode') is False and session.get('mode') == 'subscription' and
                    session.get('status') == 'open' and session.get('client_reference_id') == self.tenant_a and
                    nested(session, 'metadata', 'tenantId') == self.tenant_a, 'QA_CHECKOUT_BINDING_REFUSED')
            return {'status': 'READY', 'checkoutId': self.checkout_id, 'csrfMissingStatus': 403, 'controlTenantPortalStatus': 409}
        if action == 'release':
            session = self.provider('GET', '/v1/checkout/sessions/' + self.checkout_id)
            require(session.get('livemode') is False and session.get('status') == 'complete' and
                    session.get('client_reference_id') == self.tenant_a, 'QA_COMPLETED_CHECKOUT_REQUIRED')
            self.adopt_ids(session)
            observed = self.snapshot()
            require(self.return_seen and all(row['status'] == 'PENDING' and row['provider'] == 'local'
                    for row in observed['rows']), 'QA_REDIRECT_OR_PENDING_INVARIANT_FAILED')
            self.cases.add('redirectDoesNotActivate')
            with self.lock:
                require(self.held, 'QA_ACTUAL_PROVIDER_EVENTS_REQUIRED')
                pending, self.held = list(self.held), []
                self.hold = False
            with ThreadPoolExecutor(max_workers=2) as pool:
                deliveries = list(pool.map(lambda oid: self.forward(oid, 'stripe-cli-held-then-released'), pending))
            require(all(row['httpStatus'] == 200 and row['received'] for row in deliveries), 'QA_PROVIDER_WEBHOOK_DELIVERY_FAILED')
            subscription = self.subscription()
            observed = self.snapshot()
            row_a = next(row for row in observed['rows'] if row['tenantId'] == self.tenant_a)
            require(subscription['status'] == 'trialing' and row_a['status'] == 'TRIAL' and row_a['provider'] == 'stripe'
                    and row_a['plan'] == 'STARTER', 'QA_TRIAL_SYNC_FAILED')
            self.verify_period(row_a, subscription, 'QA_TRIAL_PERIOD_NOT_SYNCED')
            require(subscription['trial_end'] - subscription['trial_start'] == 14 * 86400, 'QA_TRIAL_DURATION_CHANGED')
            customer = self.provider('GET', '/v1/customers/' + next(iter(self.customers)))
            require(customer.get('livemode') is False and customer.get('email') == self.email, 'QA_SYNTHETIC_CUSTOMER_EMAIL_REQUIRED')
            self.provider('POST', '/v1/customers/' + customer['id'], {'metadata[fleetum_qa_run]': self.ctx['run']})
            self.cases.add('trialViaProviderWebhook')
            return {'status': 'PASS', 'redirectDidNotActivate': True, 'providerWebhookActivatedTrial': True,
                    'trialDays': 14, 'releasedEnvelopes': len(deliveries)}
        if action == 'replay':
            candidates = [key for key, value in self.captured.items() if value[2]['type'] == 'checkout.session.completed']
            require(len(candidates) == 1, 'QA_SINGLE_CAPTURED_CHECKOUT_EVENT_REQUIRED')
            before = self.snapshot()
            with ThreadPoolExecutor(max_workers=2) as pool:
                receipts = list(pool.map(lambda oid: self.forward(oid, 'captured-provider-replay'), candidates * 2))
            require(all(row['httpStatus'] == 200 and row['duplicate'] for row in receipts), 'QA_ACTUAL_EVENT_REPLAY_FAILED')
            after = self.snapshot()
            require(before == after and sum(e['eventId'] == candidates[0] for e in after['events']) == 1,
                    'QA_ACTUAL_EVENT_REPLAY_MUTATED_STATE')
            self.cases.add('capturedEventReplay')
            return {'status': 'PASS', 'concurrentCapturedReplays': 2, 'eventRows': 1, 'stateUnchanged': True}
        if action == 'end_trial':
            # The browser approval gate requires human final financial actions even in this sandbox.
            # Do not replace the blocked UI submission with a trial-ending or payment API call.
            return {'status': 'USER_ACTION_REQUIRED', 'action': 'end-trial-in-sandbox-dashboard',
                    'providerWritePerformed': False}
        if action == 'verify_paid':
            subscription = self.subscription()
            invoices = self.own_invoices()
            paid = [invoice for invoice in invoices if invoice['status'] == 'paid' and invoice['amount_paid'] == 14900
                    and invoice['currency'] == 'eur']
            observed = self.snapshot()
            row_a = next(row for row in observed['rows'] if row['tenantId'] == self.tenant_a)
            require(subscription['status'] == 'active' and row_a['status'] == 'ACTIVE' and row_a['plan'] == 'STARTER'
                    and len(paid) == 1, 'QA_PAID_ACTIVATION_NOT_READY')
            self.verify_period(row_a, subscription, 'QA_PAID_PERIOD_NOT_SYNCED')
            require(any(row['eventType'] in {'invoice.paid', 'invoice.payment_succeeded'} and row['httpStatus'] == 200
                        and not row['ignored'] for row in self.deliveries), 'QA_PAID_EVENT_NOT_DELIVERED')
            code, _ = self.api('/api/billing/checkout-session', 'POST', {'plan': 'STARTER', 'billingCycle': 'monthly'})
            require(code == 409, 'QA_SECOND_SUBSCRIPTION_NOT_REFUSED')
            code, denied = self.api('/api/billing/customer-portal-session', 'POST',
                {'customer': next(iter(self.customers)), 'subscription': subscription['id']}, tenant='b')
            require(code == 409 and denied.get('ownedResourceIdLeaked') is False, 'QA_CONTROL_TENANT_PORTAL_LEAK')
            self.cases.update({'paidViaProviderWebhook', 'tenantIsolation'})
            return {'status': 'PASS', 'stripeStatus': 'active', 'licenseStatus': 'ACTIVE',
                    'paidInvoiceAmountCents': 14900, 'invoiceCurrency': 'eur', 'secondCheckoutStatus': 409,
                    'controlTenantPortalStatus': code, 'ownedResourceIdLeaked': False, 'realMoneyMoved': False}
        if action == 'portal_card':
            return self.create_portal('portal-card', {})
        if action == 'verify_card':
            customer = self.provider('GET', '/v1/customers/' + next(iter(self.customers)))
            subscription = self.subscription()
            methods = self.provider('GET', '/v1/payment_methods?' + urllib.parse.urlencode(
                {'customer': customer['id'], 'type': 'card', 'limit': 10}))
            require(methods.get('has_more') is False and len(methods['data']) <= 2, 'QA_TEST_CARD_RESOURCE_CAP')
            selected = stripe_id(subscription.get('default_payment_method')) or stripe_id(nested(customer, 'invoice_settings', 'default_payment_method'))
            chosen = [method for method in methods['data'] if method['id'] == selected]
            require(len(chosen) == 1 and chosen[0].get('livemode') is False and
                    nested(chosen[0], 'card', 'brand') == 'mastercard' and nested(chosen[0], 'card', 'last4') == '4444',
                    'QA_PORTAL_DEFAULT_CARD_NOT_UPDATED')
            self.cases.add('cardUpdatedInPortal')
            return {'status': 'PASS', 'defaultCardBrand': 'mastercard', 'defaultCardLast4': '4444'}
        if action == 'portal_upgrade':
            return self.create_portal('portal-upgrade', {'plan': 'PRO', 'billingCycle': 'monthly'})
        if action == 'verify_upgrade':
            subscription = self.subscription()
            observed = self.snapshot()
            row_a = next(row for row in observed['rows'] if row['tenantId'] == self.tenant_a)
            prices = [stripe_id(item.get('price')) for item in subscription['items']['data']]
            require(prices == [self.ctx['environment']['STRIPE_PRICE_PRO_MONTHLY']] and row_a['plan'] == 'PRO' and
                    row_a['status'] == 'ACTIVE' and row_a['billingCycle'] == 'monthly', 'QA_PORTAL_UPGRADE_NOT_SYNCED')
            self.verify_period(row_a, subscription, 'QA_UPGRADE_PERIOD_NOT_SYNCED')
            require(nested(subscription, 'metadata', 'plan') == 'STARTER', 'QA_HISTORICAL_METADATA_EXPECTATION_CHANGED')
            self.cases.add('upgradeFromAuthoritativePrice')
            return {'status': 'PASS', 'stripePriceMapsTo': 'PRO', 'licensePlan': 'PRO',
                    'historicalMetadataPlan': 'STARTER', 'authoritativePriceUsed': True}
        if action == 'portal_cancel':
            return self.create_portal('portal-cancel', {})
        if action == 'verify_cancel_scheduled':
            subscription = self.subscription()
            observed = self.snapshot()
            row_a = next(row for row in observed['rows'] if row['tenantId'] == self.tenant_a)
            require(subscription.get('cancel_at_period_end') is True and subscription['status'] == 'active' and
                    row_a['status'] == 'ACTIVE' and row_a['plan'] == 'PRO', 'QA_PERIOD_END_CANCELLATION_NOT_READY')
            self.cases.add('cancellationScheduledInPortal')
            return {'status': 'PASS', 'cancelAtPeriodEnd': True, 'licenseRemainsActiveUntilPeriodEnd': True}
        if action == 'finish':
            missing = sorted(self.required_cases - self.cases)
            if missing:
                return {'status': 'INCOMPLETE', 'missing': missing}
            self.finished = True
            return {'status': 'PASS', 'allRequiredCasesPassed': True}
        if action == 'abort':
            raise RuntimeError('QA_FLOW_ABORTED')
        raise RuntimeError('QA_UNKNOWN_COMMAND_REFUSED')

    def cleanup(self, context):
        cleanup = {'status': 'IN_PROGRESS', 'catalogOrPortalChanged': False, 'realMoneyMoved': False,
                   'testInvoiceAndEventHistoryRetained': True}
        try:
            if self.checkout_id:
                session = self.provider('GET', '/v1/checkout/sessions/' + self.checkout_id)
                require(session.get('livemode') is False and session.get('client_reference_id') == self.tenant_a,
                        'QA_CLEANUP_CHECKOUT_OWNERSHIP_REFUSED')
                self.adopt_ids(session)
                if session.get('status') == 'open':
                    session = self.provider('POST', '/v1/checkout/sessions/' + self.checkout_id + '/expire')
                cleanup['checkoutNoLongerOpen'] = session.get('status') in {'complete', 'expired'}
                require(cleanup['checkoutNoLongerOpen'], 'QA_CLEANUP_CHECKOUT_STILL_OPEN')
            for subscription_id in list(self.subscriptions):
                subscription = self.subscription()
                if subscription['status'] != 'canceled':
                    subscription = self.provider('DELETE', '/v1/subscriptions/' + subscription_id)
                require(subscription['status'] == 'canceled' and subscription.get('livemode') is False,
                        'QA_CLEANUP_CANCELLATION_FAILED')
                cleanup['subscriptionCanceled'] = True
            for customer_id in list(self.customers):
                customer = self.provider('GET', '/v1/customers/' + customer_id)
                require(customer.get('livemode') is False and customer.get('email') == self.email,
                        'QA_CLEANUP_CUSTOMER_OWNERSHIP_REFUSED')
                deleted = self.provider('DELETE', '/v1/customers/' + customer_id)
                require(deleted.get('deleted') is True and deleted.get('id') == customer_id,
                        'QA_CLEANUP_CUSTOMER_DELETION_FAILED')
                cleanup['customerDeleted'] = True
            cleanup['status'] = 'PASS'
        except Exception as error:
            cleanup.update({'status': 'FAIL', 'errorType': type(error).__name__,
                            'safeError': str(error) if isinstance(error, RuntimeError) else 'withheld'})
            raise
        finally:
            for server in self.http_servers:
                server.shutdown()
                server.server_close()
            cleanup['localProxyAndReturnPageStopped'] = True
            if self.cli is not None:
                if self.cli.poll() is None:
                    self.cli.terminate()
                try:
                    self.cli.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    os.killpg(self.cli.pid, signal.SIGKILL)
                    self.cli.wait(timeout=5)
                cleanup['stripeCliStopped'] = self.cli.poll() is not None
            context['result']['stripeFixtureCleanup'] = cleanup
            context['result']['fixtureDirectProviderRequests'] = self.budget.snapshot()
            context['result']['providerEventDeliveries'] = list(self.deliveries)
            if cleanup['status'] != 'PASS':
                context['result']['status'] = 'FAIL'


if __name__ == '__main__':
    raise SystemExit(startup.main(integration=StripeFlow()))
