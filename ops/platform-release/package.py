"""Local Platform-only packaging rehearsal. Does not build images, contact servers or deploy."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import hashlib, json, posixpath, re, shutil, argparse

LOGOS = {'brand/fleetum-logo-full-light.svg', 'brand/fleetum-logo-full-dark.svg'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def clean_tree(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Input must be a real directory')
    for path in root.rglob('*'):
        if path.is_symlink() or (not path.is_dir() and not path.is_file()):
            raise ValueError('Symlink or special file rejected')

def local_reference(value, source):
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or value.startswith('#'):
        return None
    value = unquote(parsed.path)
    result = posixpath.normpath(value.lstrip('/') if value.startswith('/') else posixpath.join(posixpath.dirname(source), value))
    if result.startswith('../') or result in {'.','..'} or '\\' in result:
        raise ValueError('Reference escapes static root')
    return result

def plan(build, baseline):
    clean_tree(build); clean_tree(baseline)
    assets = {path.name: path.relative_to(build).as_posix() for path in (build/'assets').rglob('*') if path.is_file()}
    if len(assets) != len([p for p in (build/'assets').rglob('*') if p.is_file()]):
        raise ValueError('Ambiguous asset basenames')
    pending = ['platform.html', *sorted(LOGOS)]
    closure, retained = set(), set()
    while pending:
        rel = pending.pop()
        if rel in closure:
            continue
        if rel != 'platform.html' and rel not in LOGOS and not rel.startswith('assets/'):
            raise ValueError('Non-Platform output path rejected')
        file = build/rel
        if not file.is_file() or file.suffix == '.map':
            raise ValueError('Missing asset or source map rejected: '+rel)
        closure.add(rel)
        if file.suffix not in {'.html','.css','.js'}:
            continue
        text = file.read_text()
        # Supplement explicit references with emitted asset names (Vite dependency maps).
        pending.extend(path for name,path in assets.items() if name in text)
        refs = []
        if file.suffix == '.html':
            refs += re.findall(r'(?:src|href)=["\']([^"\']+)', text)
        elif file.suffix == '.js':
            refs += re.findall(r'["\']((?:\./|\.\./|/assets/)[^"\'\s]+\.(?:js|css|woff2?|ttf|png|svg|webp|jpe?g|ico))["\']',text)
        else:
            refs += [x.strip('"\' ') for x in re.findall(r'url\(([^)]+)\)', text)]
        for ref in refs:
            target = local_reference(ref,rel)
            if target is None:
                continue
            if target.startswith('assets/') or target in LOGOS:
                pending.append(target)
            else:
                retained.add(target)
    for rel in retained:
        if not (build/rel).is_file() or not (baseline/rel).is_file() or digest(build/rel) != digest(baseline/rel):
            raise ValueError('Shared static reference must already exist unchanged: '+rel)
    for rel in closure:
        target = baseline/rel
        if rel != 'platform.html' and target.exists() and digest(target) != digest(build/rel):
            raise ValueError('Existing asset collision: '+rel)
        if rel in LOGOS and not target.is_file():
            raise ValueError('Original logo missing from baseline')
    return closure, retained

def prepare(build, baseline, output, source=None):
    if not isinstance(source,str) or not re.fullmatch(r"[0-9a-f]{40}",source):raise ValueError("Full UI source SHA required")
    if Path(build).is_symlink() or Path(baseline).is_symlink():
        raise ValueError("Symlink input root rejected")
    build,baseline,output = map(lambda p:Path(p).resolve(),(build,baseline,output))
    if output.exists() or any(root == output or root in output.parents or output in root.parents for root in (build,baseline)):
        raise ValueError('Output must be new and separate from inputs')
    closure, retained = plan(build,baseline)
    original = {p.relative_to(baseline).as_posix():digest(p) for p in baseline.rglob('*') if p.is_file()}
    output.mkdir(parents=True)
    package, merged = output/'platform-closure',output/'rehearsal-static-root'
    shutil.copytree(baseline,merged)
    for rel in sorted(closure):
        for root in [package,merged]:
            (root/rel).parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(build/rel,root/rel)
    changed = sorted(rel for rel,sha in original.items() if digest(merged/rel) != sha)
    if any(rel != 'platform.html' for rel in changed):
        raise ValueError('Non-Platform file changed')
    report={'candidateSource':source,'ciRun':43469744746,'buildProvenance':'Compiled UI closure; source/CI/parent proofs required separately','baseline':str(baseline),'changedExistingFiles':changed,'preservedExistingFiles':len(original)-len(changed),'collisions':[], 'retainedSharedReferences':sorted(retained),'closure':[{'path':rel,'sha256':digest(build/rel),'bytes':(build/rel).stat().st_size} for rel in sorted(closure)],'backendChanged':False,'websiteRootChanged':False,'deployExecuted':False}
    (output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['build','baseline','output']: parser.add_argument('--'+name,required=True)
    parser.add_argument('--source',required=True)
    args=parser.parse_args()
    try:
        result=prepare(args.build,args.baseline,args.output,args.source)
        print(json.dumps({k:result[k] for k in ['candidateSource','changedExistingFiles','preservedExistingFiles','collisions']}));print('Closure files:',len(result['closure']))
    except ValueError as error:
        parser.exit(1,str(error)+'\n')
