#!/usr/bin/env bash
#
# Publish every workspace package whose version is not yet on npm, then tag.
# Run by release.yml. `pnpm pack` rewrites `catalog:` / `workspace:`
# specifiers and applies `publishConfig`; `npm publish` does the OIDC trusted
# publishing. Idempotent: a version already on npm is skipped.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/.release"
rm -rf "$out"
mkdir -p "$out"

for dir in "$root"/packages/*/; do
  name="$(node -p "require('$dir/package.json').name")"
  version="$(node -p "require('$dir/package.json').version")"
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip: $name@$version is already published"
    continue
  fi
  echo "pack: $name@$version"
  # `--config.ignore-scripts=true`: no `prepack` / `prepare` / `postpack` runs
  # in the id-token job (none is defined today). `pnpm pack` has no
  # `--ignore-scripts` flag (pnpm 11 rejects it as an unknown option), so the
  # setting is passed as config; the tarball is byte-identical either way.
  (cd "$dir" && pnpm pack --config.ignore-scripts=true --pack-destination "$out" >/dev/null)
  tarball="$(ls -t "$out"/*.tgz | head -1)"
  echo "publish: $tarball"
  npm publish "$tarball" --access public
  rm -f "$tarball"
done

# Emits the `New tag:` lines the Changesets action parses to push the tags
# and create the GitHub releases.
pnpm exec changeset tag
