"""Disposable Stripe startup proof: provider GETs and locally signed synthetic events only."""
import argparse
import datetime
import hashlib
import hmac
import http.cookiejar
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor


def require(value, code):
    if not value:
        raise RuntimeError(code)


def run_node(args, cwd, env, timeout, text=False):
    process = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=text, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=3)
        raise RuntimeError('LOCAL_NODE_STAGE_TIMEOUT') from None
    return subprocess.CompletedProcess(['local-node-stage-output-withheld'], process.returncode, stdout, stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-dir', required=True)
    arguments = parser.parse_args()
    require(sys.platform == 'darwin', 'THIS_PROBE_IS_LOCAL_MAC_ONLY')
    repository = Path(__file__).resolve().parents[2]
    # Prisma's own dotenv discovery is separate from DOTENV_CONFIG_PATH.
    require(not any((repository / name).exists() for name in
                    ['.env', 'backend/.env', 'backend/prisma/.env']), 'REAL_ENV_DISCOVERY_REFUSED')
    key_path = Path('/private/tmp/fleetum-stripe-qa-key-20261017-58rnppyd/stripe-test-key')
    directory = key_path.parent.lstat()
    require(stat.S_ISDIR(directory.st_mode) and not key_path.parent.is_symlink() and
            directory.st_uid == os.getuid() and directory.st_mode & 0o777 == 0o700, 'PRIVATE_KEY_DIRECTORY_REFUSED')
    descriptor = os.open(key_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid() and
                metadata.st_mode & 0o777 == 0o600 and metadata.st_size <= 512, 'PRIVATE_KEY_FILE_REFUSED')
        test_key = os.read(descriptor, 512).decode().strip()
    finally:
        os.close(descriptor)
    require(re.fullmatch(r'sk_test_[A-Za-z0-9]{16,}', test_key), 'TEST_KEY_REQUIRED')
    # This secret signs synthetic local events; it is not a Stripe delivery secret.
    local_signing_secret = 'whsec_' + secrets.token_hex(32)
    catalog_path = repository.parent / 'Fleetum-audit-20260909/evidence/20261017-stripe-qa-catalog-completion/prices-after.json'
    prices = json.loads(catalog_path.read_text())['data']
    stripe_config = {'STRIPE_SECRET_KEY': test_key, 'STRIPE_WEBHOOK_SECRET': local_signing_secret,
                     'FLEETUM_PROVIDER_QA_STRIPE_ACCOUNT_ID': 'acct_1URTYgHGHafT77L0',
                     'STRIPE_BILLING_PORTAL_CONFIGURATION_ID': 'bpc_1URUMTHGHafT77L02AiUe6Hk'}
    for plan in ['STARTER', 'PRO', 'ENTERPRISE']:
        for cycle in ['monthly', 'yearly']:
            matching = [p for p in prices if p['lookup_key'] == 'fleetum_qa_' + plan.lower() + '_' + cycle]
            require(len(matching) == 1, 'STORED_PRICE_BINDING_REQUIRED')
            stripe_config['STRIPE_PRICE_' + plan + '_' + cycle.upper()] = matching[0]['id']
    evidence = Path(arguments.evidence_dir)
    require(evidence.is_absolute() and not evidence.exists(), 'NEW_EVIDENCE_DIRECTORY_REQUIRED')
    evidence.mkdir(mode=0o700)
    node = '/opt/homebrew/opt/node@22/bin/node'
    docker = '/usr/local/bin/docker'
    require(subprocess.check_output([node, '--version'], text=True).strip() == 'v22.23.1', 'NODE_VERSION')
    endpoint = json.loads(subprocess.check_output([docker, 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], text=True))
    require(endpoint.startswith('unix:///') and Path(endpoint[7:]).exists(), 'LOCAL_DOCKER_UNIX_SOCKET_REQUIRED')
    command = [docker, '--host', endpoint]
    def dock(args, timeout=30, check=True, extra_env=None):
        cli_environment = {'PATH': '/usr/local/bin:/usr/bin:/bin', **extra_env} if extra_env else None
        result = subprocess.run(command + args, capture_output=True, text=True, timeout=timeout, env=cli_environment)
        if check:
            require(result.returncode == 0, 'DOCKER_OPERATION_FAILED:' + args[0])
        return result
    image = dock(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']).stdout.strip()
    require(image.startswith('sha256:'), 'CACHED_IMAGE_REQUIRED')
    with socket.socket() as probe:
        require(probe.connect_ex(('127.0.0.1', 4200)) != 0, 'QA_PORT_ALREADY_OCCUPIED')
    run = secrets.token_hex(8)
    name = 'fleetum-provider-qa-' + run
    root = Path('/private/tmp') / name
    root.mkdir(mode=0o700)
    (root / 'uploads').mkdir(mode=0o700)
    database_password = secrets.token_hex(24)
    password = secrets.token_urlsafe(24)
    server = None
    container_id = network_id = None
    result = {'status': 'IN_PROGRESS', 'startedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'mode': 'stripe-startup', 'externalProviderRequests': 0, 'providerWrites': 0,
              'realEnvFilesRead': False, 'realStripeWebhookDeliveryTested': False,
              'localSyntheticWebhookSignature': True, 'paidBillingFlowsTested': False,
              'productionOrStagingResourcesAccessed': False, 'cachedPostgresImage': image,
              'ownedResourceName': name}
    def progress(stage):
        result['stage'] = stage
        path = evidence / 'progress.json'
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(result, output, indent=2)
            output.write('\n')
    def interrupt(_number, _frame):
        raise RuntimeError('LOCAL_PROBE_INTERRUPTED')
    def capture_preflight():
        path = root / 'stripe-preflight.json'
        if not path.exists():
            return
        try:
            receipt = json.loads(path.read_text())
            if (receipt.get('account') == 'acct_1URTYgHGHafT77L0' and receipt.get('livemode') is False and
                    receipt.get('requests') == 7 and receipt.get('methods') == ['GET']):
                result['providerPreflight'] = {key: receipt[key] for key in
                    ['account', 'livemode', 'prices', 'products', 'portal', 'requests', 'methods', 'completedAt']}
                result['externalProviderRequests'] = 7
        except (OSError, ValueError, KeyError, TypeError):
            result['preflightReceiptConfirmed'] = False
    previous_handler = signal.signal(signal.SIGTERM, interrupt)
    failed = None
    try:
        progress('create-disposable-postgres')
        network_id = dock(['network', 'create', '--label', 'com.fleetum.operation=' + name, name]).stdout.strip()
        result['ownedNetworkId'] = network_id
        container_id = dock(['run', '--pull=never', '--rm', '-d', '--name', name, '--network', name,
                             '--label', 'com.fleetum.operation=' + name, '--memory', '256m', '--cpus', '0.5',
                             '--pids-limit', '128', '--publish', '127.0.0.1::5432',
                             '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
                             '--env', 'POSTGRES_USER=fleetum_provider_qa',
                             '--env', 'POSTGRES_DB=fleetum_provider_qa',
                             '--env', 'POSTGRES_PASSWORD', image], extra_env={'POSTGRES_PASSWORD': database_password}).stdout.strip()
        require(len(container_id) == 64, 'OWNED_CONTAINER_ID_REQUIRED')
        result['ownedContainerId'] = container_id
        progress('wait-for-disposable-postgres')
        deadline = time.monotonic() + 40
        while dock(['exec', name, 'pg_isready', '-U', 'fleetum_provider_qa', '-d', 'fleetum_provider_qa'], check=False).returncode:
            require(time.monotonic() < deadline, 'POSTGRES_START_TIMEOUT')
            time.sleep(0.5)
        ports = json.loads(dock(['container', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', name]).stdout)
        require(set(ports) == {'5432/tcp'} and len(ports['5432/tcp']) == 1 and
                ports['5432/tcp'][0]['HostIp'] == '127.0.0.1', 'LOOPBACK_DATABASE_REQUIRED')
        port = ports['5432/tcp'][0]['HostPort']
        environment = {
            'PATH': '/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
            'NODE_ENV': 'test', 'DOTENV_CONFIG_PATH': '/dev/null', 'FLEETUM_ENVIRONMENT': 'provider-qa',
            'FLEETUM_PROVIDER_QA_MODE': 'stripe', 'FLEETUM_PROVIDER_QA_RUN_ID': run,
            'FLEETUM_PROVIDER_QA_MAX_SECONDS': '120',
            'APP_URL': 'http://localhost:5273', 'CORS_ORIGIN': 'http://localhost:5273',
            'BACKEND_PUBLIC_URL': 'http://localhost:4200', 'PLATFORM_CORS_ORIGIN': 'http://localhost:5274',
            'PORT': '4200', 'PLATFORM_PORT': '4300', 'PLATFORM_BIND_HOST': '127.0.0.1', 'TRUST_PROXY': 'false',
            'DATABASE_URL': f'postgresql://fleetum_provider_qa:{database_password}@127.0.0.1:{port}/fleetum_provider_qa?schema=public',
            'UPLOAD_DIR': str(root / 'uploads'), 'EMAIL_PROVIDER': 'disabled', 'STORAGE_PROVIDER': 'local',
            'PRIVACY_RETENTION_CRON_ENABLED': 'false', 'PRIVACY_RETENTION_GLOBAL_ENABLED': 'false',
            'BILLING_DUNNING_CRON_ENABLED': 'false', 'JWT_SECRET': secrets.token_hex(32),
            'PLATFORM_JWT_SECRET': secrets.token_hex(64), 'PLATFORM_ADMIN_EMAIL': 'platform@fleetum-provider-qa.invalid',
            'QA_FIXTURE_PASSWORD': password, 'QA_FIXTURE_RUN_ID': run, **stripe_config}
        database_environment = {key: value for key, value in environment.items() if not key.startswith('STRIPE_')}
        database_environment['FLEETUM_PROVIDER_QA_MODE'] = 'offline'
        progress('apply-real-migrations-to-empty-temporary-database')
        migration = run_node([node, 'node_modules/prisma/build/index.js', 'migrate', 'deploy',
                                    '--schema', 'backend/prisma/schema.prisma'], cwd=repository,
                                   env=database_environment, timeout=60)
        require(migration.returncode == 0, 'MIGRATIONS_FAILED_OUTPUT_WITHHELD')
        result['migrationsExitCode'] = migration.returncode
        progress('create-two-synthetic-tenants')
        seed_code = '''import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';
const db=new PrismaClient();try {await db.$transaction(async tx=>{
if(await tx.tenant.count()!==0||await tx.user.count()!==0)throw Error('EMPTY_QA_DATABASE_REQUIRED');
const role=await tx.role.upsert({where:{key:'ADMIN'},update:{},create:{key:'ADMIN',name:'Synthetic provider QA admin'}});
for(const key of ['billing:read','billing:manage','rental-payments:read','rental-payments:write','rental-payments:charge','rental-payments:refund']){
const permission=await tx.permission.upsert({where:{key},update:{},create:{key,description:'Synthetic provider QA fixture'}});
await tx.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},update:{},create:{roleId:role.id,permissionId:permission.id}});}
const passwordHash=await bcrypt.hash(process.env.QA_FIXTURE_PASSWORD,12);
for(const suffix of ['a','b'])await tx.tenant.create({data:{id:'provider-qa-'+process.env.QA_FIXTURE_RUN_ID+'-'+suffix,name:'Synthetic provider QA '+suffix,
tenantSubscription:{create:{provider:'local',plan:'ENTERPRISE',status:'ACTIVE',seats:10,currentPeriodEnd:new Date(Date.now()+86400000)}},
users:{create:{email:'qa-'+suffix+'@fleetum-provider-qa.invalid',passwordHash,firstName:'Synthetic',lastName:suffix,isEmailVerified:true,roles:{create:{roleId:role.id}}}}}});
});console.log(JSON.stringify({tenants:await db.tenant.count(),users:await db.user.count()}));}
catch(error){console.log(JSON.stringify({status:'FAIL',errorType:error.constructor.name,code:typeof error.code==='string'?error.code:null}));process.exitCode=1;}
finally{await db.$disconnect();}'''
        seed = run_node([node, '--input-type=module', '-e', seed_code], cwd=repository,
                        env=database_environment, text=True, timeout=30)
        if seed.returncode:
            try:
                diagnostic = json.loads(seed.stdout)
                result['syntheticSeedDiagnostic'] = {key: diagnostic.get(key) for key in ['status', 'errorType', 'code']}
            except (ValueError, TypeError):
                pass
        require(seed.returncode == 0, 'SYNTHETIC_SEED_FAILED_OUTPUT_WITHHELD')
        result['syntheticCounts'] = json.loads(seed.stdout)
        require(result['syntheticCounts'] == {'tenants': 2, 'users': 2}, 'SYNTHETIC_SEED_COUNT_DRIFT')
        # The request count is unknown until a complete preflight receipt is observed.
        result['externalProviderRequests'] = None
        progress('start-loopback-api-with-readonly-stripe-preflight')
        server = subprocess.Popen([node, '--import', 'tsx', 'ops/provider-qa/serve-stripe.mts'], cwd=repository,
                                  env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, start_new_session=True)
        deadline = time.monotonic() + 45
        while not (root / 'ready.json').exists():
            capture_preflight()
            require(server.poll() is None and time.monotonic() < deadline, 'LOCAL_API_START_FAILED_OUTPUT_WITHHELD')
            time.sleep(0.2)
        ready = json.loads((root / 'ready.json').read_text())
        require(ready['address'] == '127.0.0.1' and ready['mode'] == 'stripe' and
                ready['account'] == 'acct_1URTYgHGHafT77L0' and ready['livemode'] is False, 'LOCAL_BINDING_DRIFT')
        result['runtime'] = ready
        preflight = json.loads((root / 'stripe-preflight.json').read_text())
        require(preflight['requests'] == 7 and preflight['methods'] == ['GET'], 'PREFLIGHT_REQUEST_DRIFT')
        result['providerPreflight'] = preflight
        result['externalProviderRequests'] = preflight['requests']
        progress('local-readiness-and-synthetic-login')
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
        with opener.open('http://127.0.0.1:4200/api/ready', timeout=10) as response:
            require(response.status == 200 and json.load(response) == {'ok': True, 'db': 'up'}, 'READINESS_FAILED')
        request = urllib.request.Request('http://127.0.0.1:4200/api/auth/login',
            data=json.dumps({'email': 'qa-a@fleetum-provider-qa.invalid', 'password': password}).encode(),
            headers={'Content-Type': 'application/json'})
        with opener.open(request, timeout=10) as response:
            require(response.status == 200 and json.load(response)['user']['email'] == 'qa-a@fleetum-provider-qa.invalid', 'LOGIN_FAILED')
        require({'fermi_access', 'fermi_refresh', 'fermi_csrf'} <= {c.name for c in jar}, 'AUTH_COOKIES_MISSING')
        with opener.open('http://127.0.0.1:4200/api/auth/me', timeout=10) as response:
            require(response.status == 200, 'AUTHENTICATED_PROFILE_FAILED')
            response.read(65536)
        event = {'id': 'evt_qa' + run, 'object': 'event', 'created': int(time.time()),
                 'livemode': False, 'type': 'checkout.session.expired',
                 'data': {'object': {'id': 'cs_test_synthetic' + run, 'object': 'checkout.session',
                                    'metadata': {'tenantId': 'provider-qa-' + run + '-a'}}}}
        payload = json.dumps(event).encode()
        timestamp = str(int(time.time()))
        digest = hmac.new(local_signing_secret.encode(), timestamp.encode() + b'.' + payload, hashlib.sha256).hexdigest()
        signature = 't=' + timestamp + ',v1=' + digest
        progress('local-synthetic-signatures-and-ignored-event-replays')
        def webhook(value):
            request = urllib.request.Request('http://127.0.0.1:4200/api/billing/webhook', data=payload,
                                            headers={'Content-Type': 'application/json', **({'stripe-signature': value} if value else {})})
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with client.open(request, timeout=10) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                error.read(65536)
                return error.code, {}
        require(webhook(None)[0] == 400, 'MISSING_SIGNATURE_NOT_REFUSED')
        require(webhook('t=' + timestamp + ',v1=' + '0' * 64)[0] == 400, 'INVALID_SIGNATURE_NOT_REFUSED')
        for _ in range(2):
            code, body = webhook(signature)
            require(code == 200 and body.get('received') is True and body.get('ignored') is True, 'LOCAL_SYNTHETIC_EVENT_FAILED')
        with ThreadPoolExecutor(max_workers=2) as pool:
            concurrent = list(pool.map(webhook, [signature, signature]))
        require(all(code == 200 and body.get('ignored') is True for code, body in concurrent), 'IGNORED_EVENT_RACE_FAILED')
        inspect_code = '''import {PrismaClient} from '@prisma/client';const db=new PrismaClient();try{
const run=process.env.QA_FIXTURE_RUN_ID;
const event=await db.billingEvent.findUnique({where:{eventId:'evt_qa'+run},select:{tenantId:true,status:true}});
const rows=await db.tenantSubscription.findMany({select:{tenantId:true,provider:true,plan:true,status:true,seats:true}});
const expected=['provider-qa-'+run+'-a','provider-qa-'+run+'-b'];
console.log(JSON.stringify({eventRows:await db.billingEvent.count(),boundToTenantA:event?.tenantId===expected[0],ignored:event?.status==='IGNORED',
licensesUnchanged:rows.length===2&&rows.every(r=>expected.includes(r.tenantId)&&r.provider==='local'&&r.plan==='ENTERPRISE'&&r.status==='ACTIVE'&&r.seats===10)}));
}finally{await db.$disconnect();}'''
        inspected = run_node([node, '--input-type=module', '-e', inspect_code], cwd=repository,
                             env=database_environment, text=True, timeout=15)
        require(inspected.returncode == 0, 'LOCAL_DATABASE_INSPECTION_FAILED_OUTPUT_WITHHELD')
        observed = json.loads(inspected.stdout)
        require(observed == {'eventRows': 1, 'boundToTenantA': True, 'ignored': True, 'licensesUnchanged': True}, 'LOCAL_EVENT_OR_TENANT_DRIFT')
        result['webhookLocalChecks'] = {'missingSignatureStatus': 400, 'invalidSignatureStatus': 400,
            'sequentialDeliveries': 2, 'concurrentDeliveries': 2, **observed,
            'scope': 'locally signed ignored event; not paid-event replay or actual Stripe forwarding'}
        result.update({'readinessStatus': 200, 'loginStatus': 200, 'authenticatedProfileStatus': 200,
                       'cookieValuesRetained': False, 'providerCredentialsPresent': True,
                       'realEmailsSent': 0, 'status': 'PASS'})
    except BaseException as error:
        failed = error
        result.update({'status': 'FAIL', 'errorType': type(error).__name__,
                       'safeError': str(error) if isinstance(error, RuntimeError) else 'withheld'})
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        capture_preflight()
        result['lastTestStage'] = result.get('stage')
        progress('cleanup-owned-local-resources')
        cleanup = []
        if server is not None:
            if server.poll() is None:
                server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait(timeout=5)
            cleanup.append(server.poll() is not None)
            result['serverExitCode'] = server.returncode
            result['serverShutdownGraceful'] = server.returncode == 0
            if server.returncode != 0:
                result['status'] = 'FAIL'
        # A timed-out Docker CLI may have created a resource before returning its ID.
        if container_id is None:
            found = dock(['container', 'inspect', '--format', '{{.Id}}|{{index .Config.Labels "com.fleetum.operation"}}', name], check=False)
            if found.returncode == 0:
                identifier, _, owner = found.stdout.strip().partition('|')
                if owner == name and re.fullmatch('[a-f0-9]{64}', identifier):
                    container_id = identifier
        if network_id is None:
            found = dock(['network', 'inspect', '--format', '{{.Id}}|{{index .Labels "com.fleetum.operation"}}', name], check=False)
            if found.returncode == 0:
                identifier, _, owner = found.stdout.strip().partition('|')
                if owner == name and re.fullmatch('[a-f0-9]{64}', identifier):
                    network_id = identifier
        if container_id is not None:
            identity = dock(['container', 'inspect', '--format', '{{.Id}}|{{index .Config.Labels "com.fleetum.operation"}}', name], check=False)
            if identity.returncode == 0 and identity.stdout.strip() == container_id + '|' + name:
                cleanup.append(dock(['rm', '-f', name], check=False).returncode == 0)
            else:
                cleanup.append(False)
            result['ownedPostgresAbsent'] = dock(['container', 'inspect', name], check=False).returncode != 0
            cleanup.append(result['ownedPostgresAbsent'])
        if network_id is not None:
            identity = dock(['network', 'inspect', '--format', '{{.Id}}|{{index .Labels "com.fleetum.operation"}}', name], check=False)
            if identity.returncode == 0 and identity.stdout.strip() == network_id + '|' + name:
                cleanup.append(dock(['network', 'rm', name], check=False).returncode == 0)
            else:
                cleanup.append(False)
            result['ownedNetworkAbsent'] = dock(['network', 'inspect', name], check=False).returncode != 0
            cleanup.append(result['ownedNetworkAbsent'])
        attributes = root.lstat()
        require(root.parent == Path('/private/tmp') and root.name == name and
                stat.S_ISDIR(attributes.st_mode) and not root.is_symlink() and attributes.st_uid == os.getuid(), 'OWNED_ROOT_DRIFT')
        shutil.rmtree(root)
        result['ownedTemporaryRootAbsent'] = not root.exists()
        cleanup.append(result['ownedTemporaryRootAbsent'])
        result['cleanupPassed'] = all(cleanup)
        if not result['cleanupPassed']:
            result['status'] = 'FAIL'
        result['finishedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with (evidence / 'result.json').open('x') as output:
            json.dump(result, output, indent=2)
            output.write('\n')
        os.chmod(evidence / 'result.json', 0o600)
        signal.signal(signal.SIGTERM, previous_handler)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' and failed is None else 1


if __name__ == '__main__':
    sys.exit(main())
