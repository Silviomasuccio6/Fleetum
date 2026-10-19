"""Mac-only disposable PostgreSQL and loopback API probe; no provider credentials."""
import argparse
import datetime
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import time
import urllib.request


def require(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-dir', required=True)
    arguments = parser.parse_args()
    require(sys.platform == 'darwin', 'THIS_PROBE_IS_LOCAL_MAC_ONLY')
    repository = Path(__file__).resolve().parents[2]
    # Prisma discovers dotenv separately from the application's DOTENV_CONFIG_PATH.
    require(not any((repository / name).exists() for name in
                    ['.env', 'backend/.env', 'backend/prisma/.env']), 'REAL_ENV_DISCOVERY_REFUSED')
    evidence = Path(arguments.evidence_dir)
    require(evidence.is_absolute() and not evidence.exists(), 'NEW_EVIDENCE_DIRECTORY_REQUIRED')
    evidence.mkdir(mode=0o700)
    node = '/opt/homebrew/opt/node@22/bin/node'
    docker = '/usr/local/bin/docker'
    require(subprocess.check_output([node, '--version'], text=True).strip() == 'v22.23.1', 'NODE_VERSION')
    endpoint = json.loads(subprocess.check_output([docker, 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], text=True))
    require(endpoint.startswith('unix:///') and Path(endpoint[7:]).exists(), 'LOCAL_DOCKER_UNIX_SOCKET_REQUIRED')
    command = [docker, '--host', endpoint]
    def dock(args, timeout=30, check=True):
        result = subprocess.run(command + args, capture_output=True, text=True, timeout=timeout)
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
              'mode': 'offline', 'externalProviderRequests': 0, 'realEnvFilesRead': False,
              'productionOrStagingResourcesAccessed': False, 'cachedPostgresImage': image,
              'ownedResourceName': name}
    failed = None
    try:
        network_id = dock(['network', 'create', '--label', 'com.fleetum.operation=' + name, name]).stdout.strip()
        container_id = dock(['run', '--pull=never', '--rm', '-d', '--name', name, '--network', name,
                             '--label', 'com.fleetum.operation=' + name, '--memory', '256m', '--cpus', '0.5',
                             '--pids-limit', '128', '--publish', '127.0.0.1::5432',
                             '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
                             '--env', 'POSTGRES_USER=fleetum_provider_qa',
                             '--env', 'POSTGRES_DB=fleetum_provider_qa',
                             '--env', 'POSTGRES_PASSWORD=' + database_password, image]).stdout.strip()
        require(len(container_id) == 64, 'OWNED_CONTAINER_ID_REQUIRED')
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
            'FLEETUM_PROVIDER_QA_MODE': 'offline', 'FLEETUM_PROVIDER_QA_RUN_ID': run,
            'FLEETUM_PROVIDER_QA_MAX_SECONDS': '60',
            'APP_URL': 'http://localhost:5273', 'CORS_ORIGIN': 'http://localhost:5273',
            'BACKEND_PUBLIC_URL': 'http://localhost:4200', 'PLATFORM_CORS_ORIGIN': 'http://localhost:5274',
            'PORT': '4200', 'PLATFORM_PORT': '4300', 'PLATFORM_BIND_HOST': '127.0.0.1', 'TRUST_PROXY': 'false',
            'DATABASE_URL': f'postgresql://fleetum_provider_qa:{database_password}@127.0.0.1:{port}/fleetum_provider_qa?schema=public',
            'UPLOAD_DIR': str(root / 'uploads'), 'EMAIL_PROVIDER': 'disabled', 'STORAGE_PROVIDER': 'local',
            'PRIVACY_RETENTION_CRON_ENABLED': 'false', 'PRIVACY_RETENTION_GLOBAL_ENABLED': 'false',
            'BILLING_DUNNING_CRON_ENABLED': 'false', 'JWT_SECRET': secrets.token_hex(32),
            'PLATFORM_JWT_SECRET': secrets.token_hex(64), 'PLATFORM_ADMIN_EMAIL': 'platform@fleetum-provider-qa.invalid',
            'QA_FIXTURE_PASSWORD': password, 'QA_FIXTURE_RUN_ID': run}
        migration = subprocess.run([node, 'node_modules/prisma/build/index.js', 'migrate', 'deploy',
                                    '--schema', 'backend/prisma/schema.prisma'], cwd=repository,
                                   env=environment, capture_output=True, timeout=60)
        require(migration.returncode == 0, 'MIGRATIONS_FAILED_OUTPUT_WITHHELD')
        result['migrationsExitCode'] = migration.returncode
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
        seed = subprocess.run([node, '--input-type=module', '-e', seed_code], cwd=repository,
                              env=environment, capture_output=True, text=True, timeout=30)
        if seed.returncode:
            try:
                diagnostic = json.loads(seed.stdout)
                result['syntheticSeedDiagnostic'] = {key: diagnostic.get(key) for key in ['status', 'errorType', 'code']}
            except (ValueError, TypeError):
                pass
        require(seed.returncode == 0, 'SYNTHETIC_SEED_FAILED_OUTPUT_WITHHELD')
        result['syntheticCounts'] = json.loads(seed.stdout)
        require(result['syntheticCounts'] == {'tenants': 2, 'users': 2}, 'SYNTHETIC_SEED_COUNT_DRIFT')
        server = subprocess.Popen([node, '--import', 'tsx', 'ops/provider-qa/serve.mts'], cwd=repository,
                                  env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 30
        while not (root / 'ready.json').exists():
            require(server.poll() is None and time.monotonic() < deadline, 'LOCAL_API_START_FAILED_OUTPUT_WITHHELD')
            time.sleep(0.2)
        ready = json.loads((root / 'ready.json').read_text())
        require(ready['address'] == '127.0.0.1' and ready['mode'] == 'offline', 'LOCAL_BINDING_DRIFT')
        result['runtime'] = ready
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
        result.update({'readinessStatus': 200, 'loginStatus': 200, 'authenticatedProfileStatus': 200,
                       'cookieValuesRetained': False, 'providerCredentialsPresent': False,
                       'realEmailsSent': 0, 'status': 'PASS'})
    except BaseException as error:
        failed = error
        result.update({'status': 'FAIL', 'errorType': type(error).__name__,
                       'safeError': str(error) if isinstance(error, RuntimeError) else 'withheld'})
    finally:
        cleanup = []
        if server is not None:
            if server.poll() is None:
                server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
            cleanup.append(server.returncode == 0)
            result['serverExitCode'] = server.returncode
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
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' and failed is None else 1


if __name__ == '__main__':
    sys.exit(main())
