#!/usr/bin/env python3
"""Local, read-only integrity check. It never runs jobs, providers or deploys."""
import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_file(root, relative):
    require(isinstance(relative, str) and relative, 'Percorso artefatto mancante')
    name = Path(relative)
    require(not name.is_absolute() and '..' not in name.parts, 'Percorso esterno al pacchetto')
    require(not any(part.startswith('.env') or part in {'.git', 'secrets', 'credentials'} for part in name.parts), 'File riservato non ammesso')
    result = (root / name).resolve()
    require(result.is_relative_to(root.resolve()), 'Symlink esterno al pacchetto')
    require(result.is_file(), 'Artefatto assente: ' + relative)
    return result


def timestamp(value):
    require(isinstance(value, str), 'Data esecuzione mancante')
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(date.tzinfo is not None and date.utcoffset() == timedelta(0), 'Data non UTC')
    return date


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def positive_run_id(value):
    return type(value) in (int, str) and str(value).isdigit() and int(value) > 0


def validate(package, record_path, source_root=None, audit_root=None):
    register = load(package / 'gate-register.json')
    evidence = load(package / 'evidence-index.json')
    migrations = load(package / 'migration-inventory.json')
    inspected = load(package / 'inspected-source.json')
    manifest = load(package / 'package-hashes.json')
    record = load(record_path)
    candidate = register['candidateSha']
    require(bool(re.fullmatch(r'[a-f0-9]{40}', candidate)), 'SHA candidato non completo')
    for item in (evidence, migrations, inspected, record):
        require(item['candidateSha'] == candidate, 'SHA incoerente fra registro, record o prove')
    require(register['mode'] == 'PREPARATION_ONLY' and register['productionAuthorized'] is False
            and register['stagingDispatchAuthorized'] is False, 'Pacchetto non è una preparazione')
    require(evidence['newApplicationTestRuns'] == 0 and migrations['newMigrationsInThisPackage'] == 0,
            'Preparazione documentale dichiara test o migrazioni nuovi')
    require(len(migrations['allCandidateMigrationHashes']) == migrations['candidateCount'] == 48,
            'Inventario migrazioni candidato incoerente')
    require(migrations['baseCount'] == 42 and migrations['addedCount'] == len(migrations['addedSinceComparisonMain']) == 6,
            'Delta migrazioni storico incoerente')
    require(migrations['changedBaseMigrations'] == [], 'Migrazioni base modificate')
    actual_files = {str(p.relative_to(package)) for p in package.rglob('*') if p.is_file()
                    and p.name != 'package-hashes.json' and '__pycache__' not in p.parts}
    require(actual_files == set(manifest), 'Elenco file del pacchetto diverso dal freeze')
    for path, expected in manifest.items():
        require(digest(safe_file(package, path)) == expected, 'Hash pacchetto diverso: ' + path)

    gates = {g['id']: g for g in register['gates']}
    rows = {g['id']: g for g in record['gates']}
    require(len(gates) == len(register['gates']) == 19 and set(gates) == set(rows)
            and len(rows) == len(record['gates']), 'Gate duplicato, assente o inatteso')
    require(record['environment'] == 'STAGING_SYNTHETIC', 'Ambiente diverso da staging sintetico')
    for id, gate in gates.items():
        require(gate['status'] != 'PASS', 'Registro di preparazione dichiara gate esterno PASS')
        require(all(dep in gates and gates[dep]['order'] < gate['order'] for dep in gate['dependsOn']),
                'Dipendenza assente/ciclica: ' + id)
        row = rows[id]
        require(row['status'] in register['allowedStatuses'], 'Stato non valido: ' + id)
        if row['status'] == 'PASS':
            require(all(rows[dep]['status'] == 'PASS' for dep in gate['dependsOn']), 'Prerequisito non PASS: ' + id)
            require(nonempty(row['owner']) and nonempty(row['decision']), 'Owner o decisione mancanti: ' + id)
            require(timestamp(row['startedAt']) <= timestamp(row['completedAt']), 'Timeline invertita: ' + id)
            require(isinstance(row['evidence'], list) and row['evidence'], 'PASS senza artefatti: ' + id)
            for artifact in row['evidence']:
                require(nonempty(artifact.get('redactionReviewedBy')), 'Redazione non revisionata: ' + id)
                expected = artifact.get('sha256', '')
                require(bool(re.fullmatch(r'[a-f0-9]{64}', expected)), 'SHA artefatto non valido: ' + id)
                require(digest(safe_file(record_path.parent, artifact['path'])) == expected, 'Artefatto mutato: ' + id)
    if rows['G05']['status'] == 'PASS':
        require(record['ciCheckoutSha'] == candidate and positive_run_id(record['ciRunId']), 'Identità CI non provata')
        required = {'secret-scan', 'sast', 'verify', 'tenant-isolation', 'migration-compatibility', 'lighthouse'}
        require(all(record.get('ciChecks', {}).get(check) == 'success' for check in required), 'Check CI non PASS')
    if rows['G06']['status'] == 'PASS':
        require(record['observedReleaseSha'] == candidate, 'Release osservata diversa dal candidato')
        for key in ('backendDigest', 'frontendDigest'):
            require(isinstance(record[key], str) and bool(re.fullmatch(r'sha256:[a-f0-9]{64}', record[key])), 'Digest immagine mancante')
        require(nonempty(record['stagingDispatchAuthorization']) and positive_run_id(record.get('deployRunId')), 'Dispatch o run deploy mancanti')
    if rows['G08']['status'] == 'PASS':
        require(record['e2eSourceSha'] == record['observedReleaseSha'] == record.get('e2eObservedReleaseSha') == candidate,
                'E2E senza binding release/source')
        require(positive_run_id(record.get('e2eRunId')), 'Run E2E mancante')
        require(record.get('e2eBackendDigest') == record['backendDigest']
                and record.get('e2eFrontendDigest') == record['frontendDigest'], 'Digest release durante E2E diverso dal deploy')
        require(type(record['e2eExpected']) is int and record['e2eExpected'] >= register['minimumCriticalE2e']
                and record['e2ePassed'] == record['e2eExpected'], 'E2E incompleti')
        require(record['e2eSkipped'] == record['e2eFlaky'] == record.get('e2eRunnerErrors') == 0, 'E2E con skip/flaky/errori')
    for gate_id in ('G13', 'G14'):
        if rows[gate_id]['status'] != 'PASS':
            continue
        budgets = record['acceptanceBudgets']
        require(nonempty(budgets['approver']) and timestamp(budgets['approvedBeforeExecutionAt']) <= timestamp(rows[gate_id]['startedAt']),
                'Soglie non approvate prima esecuzione')
        for key in ('p95Ms', 'maxErrorRate', 'maxLockWaitMs', 'maxQueueLagSeconds', 'rtoSeconds', 'rpoSeconds'):
            value = budgets[key]
            require(type(value) in (int, float) and math.isfinite(value) and value >= 0, 'Soglia non definita: ' + key)
        require(budgets['p95Ms'] > 0 and budgets['rtoSeconds'] > 0 and budgets['maxErrorRate'] <= 1, 'Soglie incoerenti')
    if rows['G18']['status'] == 'PASS':
        require(nonempty(record['productionAuthorization']), 'Autorizzazione production non attestata')
    verified_sources = 0
    if source_root:
        for path, expected in {**inspected['sha256'], **migrations['allCandidateMigrationHashes']}.items():
            # The explicit .example is public; real runtime env files never enter this list.
            require(not (Path(path).name.startswith('.env') and not path.endswith('.example')), 'Env reale non ammesso')
            p = (source_root / path).resolve()
            require(p.is_relative_to(source_root.resolve()) and p.is_file(), 'Sorgente assente')
            require(digest(p) == expected, 'Sorgente ispezionata mutata: ' + path)
            verified_sources += 1
    verified_artifacts = 0
    if audit_root:
        for bundle in evidence['bundles']:
            p = (audit_root / bundle['auditRelativeDirectory']).resolve()
            require(p.is_relative_to(audit_root.resolve()), 'Bundle fuori audit')
            require(digest(safe_file(p, bundle['manifest'])) == bundle['manifestSHA256'], 'Manifest storico mutato')
            require(load(p / bundle['manifest']) == bundle['artifacts'], 'Manifest storico diverso dal pacchetto')
            require(len(bundle['artifacts']) == bundle['verifiedArtifactCount'], 'Conteggio bundle incoerente')
            for path, expected in bundle['artifacts'].items():
                require(digest(safe_file(p, path)) == expected, 'Evidenza storica mutata: ' + path)
                verified_artifacts += 1
    passed = [id for id, row in rows.items() if row['status'] == 'PASS']
    return {'packageIntegrity': 'PASS', 'candidateSha': candidate, 'gateCount': len(gates),
            'passedExecutionGates': len(passed), 'pendingOrFailedGates': [id for id in gates if id not in passed],
            'verifiedSourceFiles': verified_sources, 'verifiedHistoricalArtifacts': verified_artifacts,
            'productionAction': 'NONE', 'meaning': 'Verifica coerenza/hash delle dichiarazioni, non autenticità o sufficienza della prova e non autorizza deploy.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--audit-root', type=Path)
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    try:
        result = validate(package, args.record or package / 'execution-record.template.json', args.source_root, args.audit_root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, KeyError, TypeError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({'packageIntegrity': 'FAIL', 'reason': str(error), 'productionAction': 'NONE'}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
