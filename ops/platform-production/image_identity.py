"""Compare canonical manifest/config identities without conflating their digests."""
import json
import re


def same_tested_backend(expected_ref,expected_config,expected_source,expected_tree,runtime_id,local,registry):
    try:
        if not re.fullmatch(r'ghcr\.io/silviomasuccio6/fleetum-backend@sha256:[0-9a-f]{64}',expected_ref):return False
        if not re.fullmatch(r'sha256:[0-9a-f]{64}',expected_config):return False
        if not all(re.fullmatch('[0-9a-f]{40}',s) for s in [expected_source,expected_tree]):return False
        manifest=expected_ref.split('@')[1]
        return (registry['Descriptor']['digest']==manifest
            and registry['SchemaV2Manifest']['config']['digest']==expected_config
            and expected_ref in local['repoDigests']
            and runtime_id==local['id'] and local['id'] in {manifest,expected_config}
            and local['source']==expected_source and local['tree']==expected_tree
            and local['os']=='linux' and local['arch']=='amd64')
    except (KeyError,TypeError,AttributeError):return False


def metadata(docker,prepared):
    # Inspect only non-secret image metadata, never container Env.
    fmt='{"id":{{json .Id}},"repoDigests":{{json .RepoDigests}},"source":{{json (index .Config.Labels "it.fleetum.platform.source")}},"tree":{{json (index .Config.Labels "it.fleetum.platform.tree")}},"os":{{json .Os}},"arch":{{json .Architecture}}}'
    local=json.loads(docker('image','inspect','--format',fmt,prepared['backendImage']))
    return local

def verify_published_backend(docker,prepared,tree):
    local=metadata(docker,prepared)
    registry=json.loads(docker('manifest','inspect','--verbose',prepared['backendImage']))
    if not same_tested_backend(prepared['backendImage'],prepared['backendImageId'],prepared['backendSourceSha'],tree,local['id'],local,registry):
        raise ValueError('Published backend manifest/config differs from the tested immutable image')
    return registry

def verify_backend(docker,prepared,tree,registry=None):
    local=metadata(docker,prepared)
    registry=registry or json.loads(docker('manifest','inspect','--verbose',prepared['backendImage']))
    actual=docker('inspect','--format','{{.Image}}','fleetum_backend').strip()
    if not same_tested_backend(prepared['backendImage'],prepared['backendImageId'],prepared['backendSourceSha'],tree,actual,local,registry):
        raise ValueError('Installed backend manifest/config differs from the tested immutable image')
    return registry
