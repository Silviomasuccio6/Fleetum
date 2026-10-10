# Locally maintained braces security patch

This directory contains an explicitly identified local fork of
`braces3.0.3`, licensed under MIT, with bounded parser/AST traversal for
GHSA-vfj7-8cjw-p6xm. It is not an upstream release or an npm publication.

Read [security policy and rollback](../docs/security/local-braces-patch-20261010.md)
before changing it. `braces/SOURCE.json` pins the official upstream tarball
integrity and original source hashes. All source code is readable in `braces/`.

Generate the archive with `python3 ops/pack-braces.py`; verify its canonical
payload with `python3 ops/pack-braces.py --check`. npm verifies the committed
compressed bytes against package-lock integrity. Installed files and all real
consumers are tested by `npm run verify:vendor`, which is a required release gate.

Never repack over a released revision. A new patch needs a new namespace
version/archive filename, metadata and lock. Upstream has no verified patched
release as of2026-10-10; maintainers own the patch and must assess new advisories
directly. npm audit does not independently analyze this local namespace.
