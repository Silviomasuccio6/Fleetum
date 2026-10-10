#!/usr/bin/env python3
"""Create or verify the deterministic, source-reviewed local braces archive."""
import argparse
import gzip
import io
import pathlib
import tarfile

root = pathlib.Path(__file__).resolve().parent.parent
source = root / "vendor" / "braces"
output = root / "vendor" / "fleetum-braces-3.0.3-fleetum.2.tgz"
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
tar = io.BytesIO()
with tarfile.open(fileobj=tar, mode="w", format=tarfile.USTAR_FORMAT) as archive:
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        if path.is_symlink():
            raise RuntimeError("No symlinks in the reviewed package")
        relative = path.relative_to(source).as_posix()
        if not (relative in ["index.js", "package.json", "SOURCE.json", "LICENSE"] or
                (relative.startswith("lib/") and relative.endswith(".js"))):
            raise RuntimeError("Unexpected package file: " + relative)
        content = path.read_bytes()
        info = tarfile.TarInfo("package/" + relative)
        info.size = len(content)
        info.mode = 0o644
        info.mtime = 0
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        archive.addfile(info, io.BytesIO(content))
packed = io.BytesIO()
with gzip.GzipFile(filename="", mode="wb", fileobj=packed, mtime=0) as gz:
    gz.write(tar.getvalue())
data = packed.getvalue()
if args.check:
    # Compare canonical tar bytes: gzip output can differ between zlib
    # versions, while npm separately verifies the committed compressed bytes.
    if not output.is_file() or gzip.decompress(output.read_bytes()) != tar.getvalue():
        raise RuntimeError("Archive differs from reviewed sources; regenerate explicitly")
    print("Local braces archive matches reviewed sources")
else:
    output.write_bytes(data)
    print("Wrote deterministic local braces archive")
