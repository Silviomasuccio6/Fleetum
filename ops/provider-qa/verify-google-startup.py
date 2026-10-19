"""Disposable local Google QA. Default: synthetic secret, no provider requests or real identity."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SPEC = importlib.util.spec_from_file_location('google_qa_local_process', Path(__file__).with_name('verify-stripe-startup.py'))
PROCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROCESS)


def require(value, code):
    if not value:
        raise RuntimeError(code)


def load_credential(binding):
    path = Path('/private/tmp/fleetum-google-qa-key-20261018-43d0fe268723/client.json')
    parent = path.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and not path.parent.is_symlink() and
            parent.st_uid == os.getuid() and stat.S_IMODE(parent.st_mode) == 0o700, 'GOOGLE_QA_PRIVATE_DIRECTORY_REFUSED')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
                stat.S_IMODE(info.st_mode) == 0o600 and info.st_size < 8192, 'GOOGLE_QA_PRIVATE_FILE_REFUSED')
        data = json.loads(os.read(descriptor, 8192))['web']
    finally:
        os.close(descriptor)
    require(data['project_id'] == binding['projectId'] and data['client_id'] == binding['clientId'] and
            data['redirect_uris'] == [binding['redirectUri']] and
            re.fullmatch(r'GOCSPX-[A-Za-z0-9_-]{20,128}', data['client_secret']), 'GOOGLE_QA_CREDENTIAL_BINDING_REFUSED')
    return data['client_secret']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        return None


def request(opener, path, *, body=None, cookie=None):
    require(path.startswith('/') and not path.startswith('//'), 'GOOGLE_QA_LOCAL_REQUEST_REFUSED')
    headers = {'Content-Type': 'application/json'}
    if cookie is not None:
        headers['Cookie'] = cookie
    req = urllib.request.Request('http://localhost:4200' + path,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        response = opener.open(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read(131072)


def client(jar=None):
    handlers = [urllib.request.ProxyHandler({}), NoRedirect()]
    if jar is not None:
        handlers.append(urllib.request.HTTPCookieProcessor(jar))
    return urllib.request.build_opener(*handlers)


def oauth_error(headers):
    target = urllib.parse.urlsplit(headers.get('Location', ''))
    require(target.scheme == 'http' and target.netloc == 'localhost:5273' and
            target.path == '/auth/social-callback', 'GOOGLE_QA_CALLBACK_TARGET_DRIFT')
    return urllib.parse.parse_qs(target.fragment).get('error', [''])[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-dir', required=True)
    parser.add_argument('--interactive', action='store_true', help='Requires separate consent to the actual Google profile login; the flag is not consent.')
    args = parser.parse_args()
    require(sys.platform == 'darwin', 'THIS_PROBE_IS_LOCAL_MAC_ONLY')
    repo = Path(__file__).resolve().parents[2]
    require(not any((repo / name).exists() for name in ['.env', 'backend/.env', 'backend/prisma/.env']), 'GOOGLE_QA_REAL_ENV_REFUSED')
    binding = json.loads(Path(__file__).with_name('google-qa-bindings.json').read_text())
    secret = load_credential(binding) if args.interactive else 'synthetic-google-qa-offline-only'
    evidence = Path(args.evidence_dir)
    require(evidence.is_absolute() and not evidence.exists(), 'NEW_EVIDENCE_DIRECTORY_REQUIRED')
    evidence.mkdir(mode=0o700)
    node = '/opt/homebrew/opt/node@22/bin/node'
    require(subprocess.check_output([node, '--version'], text=True).strip() == 'v22.23.1', 'NODE_VERSION')
    docker = '/usr/local/bin/docker'
    endpoint = json.loads(subprocess.check_output([docker, 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], text=True))
    require(endpoint.startswith('unix:///') and Path(endpoint[7:]).exists(), 'LOCAL_DOCKER_UNIX_SOCKET_REQUIRED')

    def dock(parts, check=True, extra=None):
        command_env = {'PATH': '/usr/local/bin:/usr/bin:/bin', **(extra or {})}
        result = subprocess.run([docker, '--host', endpoint, *parts], env=command_env, capture_output=True, text=True, timeout=30)
        require(not check or result.returncode == 0, 'GOOGLE_QA_DOCKER_OPERATION_FAILED')
        return result

    image = dock(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']).stdout.strip()
    require(image.startswith('sha256:'), 'CACHED_POSTGRES_IMAGE_REQUIRED')
    for port in ([4200, 5273] if args.interactive else [4200]):
        with socket.socket() as probe:
            require(probe.connect_ex(('127.0.0.1', port)) != 0, 'GOOGLE_QA_PORT_OCCUPIED')
    run = secrets.token_hex(8)
    name = 'fleetum-provider-qa-' + run
    root = Path('/private/tmp') / name
    root.mkdir(mode=0o700)
    (root / 'uploads').mkdir(mode=0o700)
    started = time.monotonic()
    result = {'status': 'IN_PROGRESS', 'startedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'mode': 'google-interactive' if args.interactive else 'google-offline-proof', 'projectId': binding['projectId'],
        'ownedResourceName': name, 'cachedPostgresImage': image, 'realEnvRead': False,
        'providerRequests': None if args.interactive else 0, 'realGoogleLoginVerified': False,
        'realCredentialRead': args.interactive, 'productionOrStagingAccessed': False, 'emailSent': 0}
    server = return_server = None
    container_id = network_id = None
    failed = None

    def progress(stage):
        result['stage'] = stage
        (evidence / 'progress.json').write_text(json.dumps(result, indent=2) + '\n')

    def interrupt(_number, _frame):
        raise RuntimeError('GOOGLE_QA_INTERRUPTED')

    previous = signal.signal(signal.SIGTERM, interrupt)
    try:
        progress('create-owned-temporary-postgres')
        network_id = dock(['network', 'create', '--label', 'com.fleetum.operation=' + name, name]).stdout.strip()
        result['ownedNetworkId'] = network_id
        db_password = secrets.token_hex(24)
        container_id = dock(['run', '--pull=never', '--rm', '-d', '--name', name, '--network', name,
            '--label', 'com.fleetum.operation=' + name, '--memory', '256m', '--cpus', '0.5', '--pids-limit', '128',
            '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
            '--env', 'POSTGRES_USER=fleetum_provider_qa', '--env', 'POSTGRES_DB=fleetum_provider_qa',
            '--env', 'POSTGRES_PASSWORD', image], extra={'POSTGRES_PASSWORD': db_password}).stdout.strip()
        require(len(container_id) == 64, 'GOOGLE_QA_CONTAINER_ID_REQUIRED')
        result['ownedContainerId'] = container_id
        deadline = time.monotonic() + 40
        while dock(['exec', name, 'pg_isready', '-U', 'fleetum_provider_qa', '-d', 'fleetum_provider_qa'], check=False).returncode:
            require(time.monotonic() < deadline, 'GOOGLE_QA_POSTGRES_START_TIMEOUT')
            time.sleep(0.25)
        ports = json.loads(dock(['container', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', name]).stdout)
        require(set(ports) == {'5432/tcp'} and len(ports['5432/tcp']) == 1 and ports['5432/tcp'][0]['HostIp'] == '127.0.0.1', 'GOOGLE_QA_DATABASE_LOOPBACK_REQUIRED')
        db_port = ports['5432/tcp'][0]['HostPort']
        password = secrets.token_urlsafe(24)
        environment = {'PATH': '/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
            'NODE_ENV': 'test', 'DOTENV_CONFIG_PATH': '/dev/null', 'CHECKPOINT_DISABLE': '1', 'PRISMA_HIDE_UPDATE_MESSAGE': '1', 'FLEETUM_ENVIRONMENT': 'provider-qa',
            'FLEETUM_PROVIDER_QA_MODE': 'google', 'FLEETUM_PROVIDER_QA_GOOGLE_STAGE': 'interactive' if args.interactive else 'offline-proof',
            'FLEETUM_PROVIDER_QA_GOOGLE_PROJECT_ID': binding['projectId'], 'FLEETUM_PROVIDER_QA_GOOGLE_CLIENT_ID': binding['clientId'],
            'GOOGLE_CLIENT_ID': binding['clientId'], 'GOOGLE_CLIENT_SECRET': secret, 'GOOGLE_REDIRECT_URI': binding['redirectUri'],
            'OAUTH_CALLBACK_URL': binding['appCallback'], 'FLEETUM_PROVIDER_QA_RUN_ID': run,
            'FLEETUM_PROVIDER_QA_MAX_SECONDS': '1500' if args.interactive else '120',
            'APP_URL': 'http://localhost:5273', 'CORS_ORIGIN': 'http://localhost:5273', 'BACKEND_PUBLIC_URL': 'http://localhost:4200',
            'PLATFORM_CORS_ORIGIN': 'http://localhost:5274', 'PORT': '4200', 'PLATFORM_PORT': '4300',
            'PLATFORM_BIND_HOST': '127.0.0.1', 'TRUST_PROXY': 'false',
            'DATABASE_URL': f'postgresql://fleetum_provider_qa:{db_password}@127.0.0.1:{db_port}/fleetum_provider_qa?schema=public',
            'XDG_CACHE_HOME': str(root / 'engine-cache'), 'PRISMA_QUERY_ENGINE_LIBRARY': str(repo / 'node_modules/@prisma/engines/libquery_engine-darwin-arm64.dylib.node'), 'PRISMA_SCHEMA_ENGINE_BINARY': str(repo / 'node_modules/@prisma/engines/schema-engine-darwin-arm64'), 'UPLOAD_DIR': str(root / 'uploads'), 'EMAIL_PROVIDER': 'disabled', 'STORAGE_PROVIDER': 'local',
            'PRIVACY_RETENTION_CRON_ENABLED': 'false', 'PRIVACY_RETENTION_GLOBAL_ENABLED': 'false', 'BILLING_DUNNING_CRON_ENABLED': 'false',
            'JWT_SECRET': secrets.token_hex(32), 'PLATFORM_JWT_SECRET': secrets.token_hex(64),
            'PLATFORM_ADMIN_EMAIL': 'platform@fleetum-provider-qa.invalid', 'QA_FIXTURE_PASSWORD': password,
            'QA_FIXTURE_RUN_ID': run, 'QA_FIXTURE_EMAIL_A': binding['testEmail'] if args.interactive else 'qa-a@fleetum-provider-qa.invalid'}
        database_env = {key: value for key, value in environment.items() if not key.startswith('GOOGLE_')}
        database_env['FLEETUM_PROVIDER_QA_MODE'] = 'offline'
        progress('migrate-and-seed-only-empty-synthetic-database')
        migration = PROCESS.run_node([node, 'node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'], cwd=repo, env=database_env, timeout=60)
        require(migration.returncode == 0, 'GOOGLE_QA_MIGRATIONS_FAILED')

        def db(expression, extra=None):
            evaluated = '(' + expression + ')()' if expression.startswith('async()=>') else expression
            code = "import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';import {createHash} from 'node:crypto';const db=new PrismaClient();try{console.log(JSON.stringify(await (" + evaluated + ")));}finally{await db.$disconnect();}"
            output = PROCESS.run_node([node, '--input-type=module', '-e', code], cwd=repo, env={**database_env, **(extra or {})}, timeout=20, text=True)
            require(output.returncode == 0, 'GOOGLE_QA_DATABASE_PROBE_FAILED')
            return json.loads(output.stdout)

        counts = db("async()=>{if(await db.tenant.count()!==0||await db.user.count()!==0)throw Error('EMPTY_DATABASE_REQUIRED');const role=await db.role.create({data:{key:'ADMIN',name:'Synthetic QA admin'}});const passwordHash=await bcrypt.hash(process.env.QA_FIXTURE_PASSWORD,12);for(const suffix of ['a','b'])await db.tenant.create({data:{id:'provider-qa-'+process.env.QA_FIXTURE_RUN_ID+'-'+suffix,name:'Synthetic Google QA '+suffix,tenantSubscription:{create:{provider:'local',plan:'STARTER',status:'PENDING',seats:3}},users:{create:{email:suffix==='a'?process.env.QA_FIXTURE_EMAIL_A:'qa-b@fleetum-provider-qa.invalid',passwordHash,firstName:'Synthetic',lastName:suffix,isEmailVerified:true,roles:{create:{roleId:role.id}}}}}});return {tenants:await db.tenant.count(),users:await db.user.count()};}")
        require(counts == {'tenants': 2, 'users': 2}, 'GOOGLE_QA_SEED_COUNT_DRIFT')
        result['syntheticCounts'] = counts
        progress('start-loopback-google-entrypoint')
        server = subprocess.Popen([node, '--import', 'tsx', 'ops/provider-qa/serve-google.mts'], cwd=repo, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        result['ownedApiPid'] = server.pid
        deadline = time.monotonic() + 30
        while not (root / 'ready.json').exists():
            require(server.poll() is None and time.monotonic() < deadline, 'GOOGLE_QA_API_START_FAILED')
            time.sleep(0.2)
        ready = json.loads((root / 'ready.json').read_text())
        require(ready['address'] == '127.0.0.1' and ready['projectId'] == binding['projectId'] and ready['networkMode'] == ('google' if args.interactive else 'offline'), 'GOOGLE_QA_READY_DRIFT')
        result['runtime'] = ready
        require(request(client(), '/api/ready')[0] == 200, 'GOOGLE_QA_NOT_READY')
        jar_b = http.cookiejar.CookieJar()
        browser_b = client(jar_b)
        require(request(browser_b, '/api/auth/login', body={'email': 'qa-b@fleetum-provider-qa.invalid', 'password': password})[0] == 200, 'GOOGLE_QA_CONTROL_LOGIN_FAILED')
        require(request(browser_b, '/api/auth/me')[0] == 200, 'GOOGLE_QA_CONTROL_PROFILE_FAILED')

        def licenses():
            return db("db.tenantSubscription.findMany({orderBy:{tenantId:'asc'},select:{tenantId:true,provider:true,plan:true,status:true,currentPeriodEnd:true,stripeCustomerId:true,stripeSubscriptionId:true,updatedAt:true}})")

        baseline = licenses()
        require(len(baseline) == 2 and all(row['status'] == 'PENDING' for row in baseline), 'GOOGLE_QA_PENDING_REQUIRED')

        def start(jar):
            opener = client(jar)
            status, headers, _ = request(opener, '/api/auth/google?intent=login&returnTo=%2Fqa-negative')
            target = urllib.parse.urlsplit(headers.get('Location', ''))
            query = urllib.parse.parse_qs(target.query)
            require(status == 302 and target.scheme == 'https' and target.netloc == 'accounts.google.com' and target.path == '/o/oauth2/v2/auth', 'GOOGLE_QA_AUTHORIZATION_URL_INVALID')
            require(query.get('client_id') == [binding['clientId']] and query.get('redirect_uri') == [binding['redirectUri']] and
                    query.get('scope') == ['openid email profile'] and query.get('code_challenge_method') == ['S256'], 'GOOGLE_QA_AUTHORIZATION_BINDING_DRIFT')
            state = query['state'][0]
            info = db("db.oauthFlow.findUnique({where:{stateHash:process.env.QA_FLOW_HASH}}).then(f=>f?({provider:f.provider,intent:f.intent,unconsumed:f.consumedAt===null,pkceMatches:createHash('sha256').update(f.codeVerifier).digest('base64url')===process.env.QA_EXPECTED_CHALLENGE,nonceMatches:f.oidcNonce===process.env.QA_EXPECTED_NONCE}):null)",
                {'QA_FLOW_HASH': hashlib.sha256(state.encode()).hexdigest(), 'QA_EXPECTED_CHALLENGE': query['code_challenge'][0], 'QA_EXPECTED_NONCE': query['nonce'][0]})
            require(info == {'provider': 'google', 'intent': 'login', 'unconsumed': True, 'pkceMatches': True, 'nonceMatches': True}, 'GOOGLE_QA_STORED_SECURITY_MISMATCH')
            cookie_request = urllib.request.Request(binding['redirectUri'])
            jar.add_cookie_header(cookie_request)
            return opener, state, cookie_request.get_header('Cookie', '')

        progress('synthetic-callback-correlation-denial-replay-and-race')
        browser_a, state, cookie = start(http.cookiejar.CookieJar())
        callback = '/api/auth/google/callback?' + urllib.parse.urlencode({'state': state, 'error': 'access_denied'})
        status, headers, _ = request(browser_b, callback)
        require(status == 302 and oauth_error(headers) == 'Callback OAuth non associato a questo browser', 'GOOGLE_QA_FOREIGN_COOKIE_NOT_REFUSED')
        status, headers, _ = request(browser_a, callback)
        require(status == 302 and oauth_error(headers) == 'Accesso google annullato: access_denied', 'GOOGLE_QA_VALID_BINDING_DENIAL_FAILED')
        status, headers, _ = request(client(), callback, cookie=cookie)
        require(status == 302 and oauth_error(headers) == 'State OAuth già utilizzato', 'GOOGLE_QA_REPLAY_NOT_REFUSED')
        _, concurrent_state, concurrent_cookie = start(http.cookiejar.CookieJar())
        concurrent_callback = '/api/auth/google/callback?' + urllib.parse.urlencode({'state': concurrent_state, 'error': 'access_denied'})
        with ThreadPoolExecutor(max_workers=2) as pool:
            deliveries = list(pool.map(lambda _: request(client(), concurrent_callback, cookie=concurrent_cookie), range(2)))
        errors = [oauth_error(headers) for status, headers, _ in deliveries if status == 302]
        require(sorted(errors) == sorted(['State OAuth già utilizzato', 'Accesso google annullato: access_denied']), 'GOOGLE_QA_CONCURRENT_CONSUMPTION_FAILED')
        expiry_client, expiry_state, _ = start(http.cookiejar.CookieJar())
        changed = db("db.oauthFlow.updateMany({where:{stateHash:process.env.QA_FLOW_HASH},data:{expiresAt:new Date(0)}})", {'QA_FLOW_HASH': hashlib.sha256(expiry_state.encode()).hexdigest()})
        require(changed['count'] == 1, 'GOOGLE_QA_EXPIRY_FIXTURE_FAILED')
        _, headers, _ = request(expiry_client, '/api/auth/google/callback?' + urllib.parse.urlencode({'state': expiry_state, 'error': 'access_denied'}))
        require(oauth_error(headers) == 'State OAuth scaduto', 'GOOGLE_QA_EXPIRED_STATE_NOT_REFUSED')
        require(licenses() == baseline, 'GOOGLE_QA_LICENSE_MUTATION')
        result.update({'offlineChecks': {'ready': True, 'passwordLoginAndProfile': True, 'pendingLicensesUnchanged': True,
            'foreignCookieContextRefused': True, 'pkceAndNonceMatchStoredFlow': True, 'denialConsumesState': True,
            'replayRefused': True, 'oneConcurrentConsumption': True, 'expiredStateRefused': True},
            'controlTenantUnchanged': True, 'rawStateCodeVerifierNonceCookiesRetained': False})
        database_test = PROCESS.run_node([node, '--import', 'tsx', '--test', 'backend/tests/security/oauth-flow-database.test.ts'],
            cwd=repo, env=database_env, timeout=30, text=True)
        require(database_test.returncode == 0 and '# fail 0' in database_test.stdout and '# skipped 0' in database_test.stdout,
                'GOOGLE_QA_PERSISTENCE_TEST_FAILED_OUTPUT_WITHHELD')
        (evidence / 'oauth-flow-database.tap').write_text(database_test.stdout)
        result['existingRealDatabaseCorrelationTest'] = 'PASS'
        require(licenses() == baseline, 'GOOGLE_QA_PERSISTENCE_TEST_LICENSE_MUTATION')

        if args.interactive:
            class ReturnPage(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass

                def do_GET(self):
                    if urllib.parse.urlsplit(self.path).path != '/auth/social-callback':
                        self.send_error(404)
                        return
                    script = "history.replaceState(null,'','/auth/social-callback');fetch('http://localhost:4200/api/auth/me',{credentials:'include'}).then(r=>document.getElementById('status').textContent=r.ok?'Sessione locale verificata.':'Sessione non verificata.').catch(()=>document.getElementById('status').textContent='Verifica non disponibile.');"
                    body = ('<!doctype html><html lang="it"><meta charset="utf-8"><title>Fleetum Google QA</title><h1>Ritorno dal login di prova</h1><p id="status">Verifica della sessione locale…</p><script>' + script + '</script></html>').encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Referrer-Policy', 'no-referrer')
                    self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'sha256-" + __import__('base64').b64encode(hashlib.sha256(script.encode()).digest()).decode() + "'; connect-src http://localhost:4200")
                    self.end_headers()
                    self.wfile.write(body)

            return_server = ThreadingHTTPServer(('127.0.0.1', 5273), ReturnPage)
            threading.Thread(target=return_server.serve_forever, daemon=True).start()
            (root / 'commands').mkdir(mode=0o700)
            (root / 'browser-target.json').write_text(json.dumps({'url': 'http://localhost:4200/api/auth/google?intent=login&returnTo=%2Factivate'}) + '\n')
            (root / 'browser-target.json').chmod(0o600)
            result['privateControlRoot'] = str(root)
            progress('waiting-for-authorized-human-google-login')
            completed = False
            while time.monotonic() - started < 1410:
                require(server.poll() is None, 'GOOGLE_QA_API_LEASE_ENDED')
                control = root / 'commands/001.json'
                if control.exists():
                    metadata = control.lstat()
                    require(stat.S_ISREG(metadata.st_mode) and not control.is_symlink() and metadata.st_uid == os.getuid() and stat.S_IMODE(metadata.st_mode) == 0o600, 'GOOGLE_QA_COMMAND_REFUSED')
                    require(json.loads(control.read_text()) == {'action': 'verify_login'}, 'GOOGLE_QA_COMMAND_REFUSED')
                    verified = db("async()=>{const a=await db.user.findFirstOrThrow({where:{tenantId:'provider-qa-'+process.env.QA_FIXTURE_RUN_ID+'-a'}});const sessionCount=await db.refreshSession.count({where:{userId:a.id,revokedAt:null}});const flows=await db.oauthFlow.findMany({where:{provider:'google',intent:'login',returnTo:'/activate'},select:{consumedAt:true,codeVerifier:true,oidcNonce:true}});return {expectedIdentity:a.email===process.env.QA_FIXTURE_EMAIL_A,sessionCount,flowCount:flows.length,oneConsumed:flows.length===1&&!!flows[0].consumedAt&&flows[0].codeVerifier===null&&flows[0].oidcNonce===null};}")
                    require(verified == {'expectedIdentity': True, 'sessionCount': 1, 'flowCount': 1, 'oneConsumed': True} and licenses() == baseline, 'GOOGLE_QA_LOGIN_NOT_VERIFIED')
                    result['realGoogleLoginVerified'] = True
                    completed = True
                    break
                time.sleep(0.5)
            require(completed, 'GOOGLE_QA_HUMAN_WINDOW_EXPIRED')
        result['status'] = 'PASS'
    except BaseException as error:
        failed = error
        result.update(status='FAIL', errorType=type(error).__name__, safeError=str(error) if isinstance(error, RuntimeError) else 'withheld')
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        cleanup = []
        if return_server is not None:
            return_server.shutdown()
            return_server.server_close()
        if server is not None:
            if server.poll() is None:
                server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait(timeout=5)
            cleanup.append(server.poll() is not None)
            result['apiExitCode'] = server.returncode
            result['ownedApiStopped'] = server.poll() is not None
        for kind, identity in [('container', container_id), ('network', network_id)]:
            try:
                check = dock([kind, 'inspect', '--format', '{{.Id}}|{{index ' + ('.Config.Labels' if kind == 'container' else '.Labels') + ' "com.fleetum.operation"}}', name], check=False)
                if check.returncode == 0:
                    observed_id, label = check.stdout.strip().split('|', 1)
                    require(label == name and (identity is None or observed_id == identity), 'GOOGLE_QA_CLEANUP_OWNERSHIP_DRIFT')
                    cleanup.append(dock(['rm', '-f', name] if kind == 'container' else ['network', 'rm', name], check=False).returncode == 0)
                absent = dock([kind, 'inspect', name], check=False)
                confirmed = absent.returncode != 0 and ('no such' in absent.stderr.lower() or 'not found' in absent.stderr.lower())
                result['owned' + kind.title() + 'Absent'] = confirmed
                cleanup.append(confirmed)
            except Exception as error:
                cleanup.append(False)
                result[kind + 'CleanupErrorType'] = type(error).__name__
        meta = root.lstat()
        require(root.parent == Path('/private/tmp') and root.name == name and stat.S_ISDIR(meta.st_mode) and not root.is_symlink() and meta.st_uid == os.getuid(), 'GOOGLE_QA_ROOT_OWNERSHIP_DRIFT')
        shutil.rmtree(root)
        cleanup.append(not root.exists())
        result['ownedTemporaryRootAbsent'] = not root.exists()
        result['cleanupPassed'] = all(cleanup)
        if not result['cleanupPassed']:
            result['status'] = 'FAIL'
        result['finishedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (evidence / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        signal.signal(signal.SIGTERM, previous)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' and failed is None else 1


if __name__ == '__main__':
    sys.exit(main())
