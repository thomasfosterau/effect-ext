#!/usr/bin/env bash
# npm-bootstrap.sh: one-off npm trusted-publishing bootstrap for the thomasfosterau package family.
#
# This is a one-off for the first publish of the @thomasfosterau/* names that are not on npm yet,
# and for binding (or checking) the trusted publisher of every published name, across all the
# library repositories (components, effect-auth, effect-bib, effect-connect, effect-document,
# effect-drizzle-ext, effect-ext, effect-forms, effect-ical, effect-jsonapi, effect-parse,
# effect-rdf, effect-richtext, effect-svelte, effect-wikimedia, effect-xml, legation,
# prosekit-utilities, pulpit, rust-wasm-packages), not only this one. It lives in effect-ext
# because the owner runs it once from an effect-ext Codespace:
#   npm install -g npm@latest          # then open a new terminal
#   npm login --auth-type=web          # then check that `npm whoami` prints the owner
#   bash scripts/npm-bootstrap.sh --dry-run
#   bash scripts/npm-bootstrap.sh
# Once it has run, this file can be deleted. A package added later is bootstrapped by hand, as
# PUBLISHING.md's "First publish of a new package" section explains. The list below is every
# non-private package on those repositories' trunks; a package renamed before the run means
# editing its row and running the script again.
#
# What it does
#   1. For every package name below marked "new" that does not exist on npm yet, it publishes a
#      placeholder at 0.0.0 (description, license, repository + directory, a one-line README, nothing
#      else). npm trusted publishing (OIDC) can only be configured for a name that already exists.
#      Changesets' first real release from CI is then 0.1.0.
#   2. For every "new" package and every "keep" package (already published from the repository that
#      holds it now), it makes sure there is exactly one trusted publisher on npm:
#      GitHub Actions, repository thomasfosterau/<repo>, workflow file release.yml, environment
#      release, permission "publish". An existing matching entry is left alone; a "keep" package
#      missing from npm fails, since it is expected to be published already.
#   3. For the four packages marked "move" (the effect-ai providers), whose trust
#      still names the deleted thomasfosterau/effect-ai-ext repository, it checks that the old entry
#      exists, revokes it, and creates the entry for thomasfosterau/effect-ext.
#   4. For the six packages marked "revoke", published names that no longer exist on any trunk
#      (@thomasfosterau/effect-ai-ext and -evals, merged into @thomasfosterau/effect-ext;
#      @thomasfosterau/effect-ai-gateway, renamed @thomasfosterau/effect-ai-cloudflare, which is
#      "new" above; @thomasfosterau/effect-web, -robots and -sitemap, folded into
#      @thomasfosterau/effect-ext), it revokes the trust entry that still names their old repository
#      (thomasfosterau/effect-ai-ext or thomasfosterau/effect-web) and creates none, so nothing can
#      publish them again. A package with no such entry left is skipped; an entry for any other
#      repository fails it, to fix by hand.
#   5. It deprecates those six superseded packages across all their versions,
#      pointing at the matching @thomasfosterau/effect-ext subpaths (its README: "Moving from
#      effect-web", "AI service abstractions", "Evals") or, for the gateway, at
#      @thomasfosterau/effect-ai-cloudflare. A package whose `npm view <name> deprecated` already
#      equals the message is skipped.
#   It is idempotent: re-running it skips every name that already exists and every trust entry that
#   already matches. It continues past failures, prints one line per package and a summary, and
#   exits non-zero if anything failed.
#
# It never publishes with provenance: a local publish has no OIDC identity, so a provenance request
# would fail. It never touches a repository; the package list is embedded below, so the script is
# self-contained and can be fetched on its own with curl.
#
# Prerequisites (written for a GitHub Codespace on the Debian-based Vite+ devcontainer image; any
# Linux or macOS shell with node and npm works the same way)
#   - node, and npm >= 11.15 whose `npm trust github` supports --allow-publish. If yours is older the
#     preflight stops and prints the upgrade command:  npm install -g npm@latest
#   - an npm login with 2FA on the account that owns the @thomasfosterau scope. In a Codespace use the
#     browser flow:  npm login --auth-type=web
#     then check that  npm whoami  prints the owner's npm user name.
#   - Each publish and each trust change asks for 2FA in the browser. On the npm 2FA page, tick
#     "skip two-factor authentication for the next 5 minutes" so the batch can run; re-run the script
#     if the window closes mid-way (it picks up where it stopped).
#
# Environment hygiene: a Codespace sets GITHUB_TOKEN and may set NPM_CONFIG_* variables. Every npm
# command here runs with NODE_AUTH_TOKEN, NPM_TOKEN, GITHUB_TOKEN, the GitHub Actions OIDC variables
# and every NPM_CONFIG_* / npm_config_* variable removed (except userconfig, where the login lives,
# and cache / proxy / cafile, which are network plumbing),
# and with --registry https://registry.npmjs.org/. The preflight also refuses to run unless
# `npm config get registry` (and the @thomasfosterau scope registry, if set) is the public registry.
#
# How to run (from the effect-ext checkout; the file is self-contained, so a curl'd copy works too)
#   bash scripts/npm-bootstrap.sh --dry-run    # prints every command, changes nothing
#   bash scripts/npm-bootstrap.sh --dry-run --only @thomasfosterau/effect-ical
#   bash scripts/npm-bootstrap.sh --only @thomasfosterau/effect-ical   # one package for real, to try it
#   bash scripts/npm-bootstrap.sh              # everything
#
# Options
#   --dry-run       print every mutating command instead of running it. Registry reads (npm view)
#                   still run, since they need no login; `npm trust list` needs a login, so it is
#                   printed, not run.
#   --only <name>   limit the run to one package (exact npm name).
#   --skip-placeholders  skip the 0.0.0 placeholder publishes (a missing name is then reported as
#                   skipped, since it cannot take a trust entry yet).
#   --skip-trust    skip every trust check, creation, move and revoke (so the "keep", "move" and
#                   "revoke" packages are skipped entirely).
#   --skip-deprecate  skip the deprecations (effect-web, -robots, -sitemap, effect-ai-ext, -evals,
#                   effect-ai-gateway).
#                   Combine them to rerun one phase on its own, e.g. --skip-placeholders
#                   --skip-deprecate reruns only the trust phase.
#   -h, --help      show this header.

set -u
set -o pipefail

REGISTRY="https://registry.npmjs.org/"
MIN_NPM="11.15.0"

# action|name|repo|directory ("." = repo root)|workflow|environment|license|from
#   new    = placeholder (if missing) + trust for repo
#   keep   = already published from repo: trust for repo (checked, created if absent)
#   move   = trust move from thomasfosterau/<from> to repo
#   revoke = a published package that no longer exists, merged into or renamed to another and
#            deprecated below: its trust entry for thomasfosterau/<from> is revoked and none is
#            created (repo/directory name where it went, for the log only)
PACKAGES='
new|@thomasfosterau/charts|components|packages/charts|release.yml|release|MIT|
keep|@thomasfosterau/components|components|packages/components|release.yml|release|MIT|
keep|@thomasfosterau/components-mapbox|components|packages/mapbox|release.yml|release|MIT|
new|@thomasfosterau/effect-auth|effect-auth|packages/effect-auth|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-alchemy-cloudflare|effect-auth|packages/alchemy-cloudflare|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-alchemy-postgres|effect-auth|packages/alchemy-postgres|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-argon2|effect-auth|packages/argon2|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-drizzle|effect-auth|packages/drizzle|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-resend|effect-auth|packages/resend|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-svelte|effect-auth|packages/svelte|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-sveltekit|effect-auth|packages/sveltekit|release.yml|release|MIT|
new|@thomasfosterau/effect-auth-twilio|effect-auth|packages/twilio|release.yml|release|MIT|
new|@thomasfosterau/effect-bib|effect-bib|packages/effect-bib|release.yml|release|MIT|
new|@thomasfosterau/effect-connect|effect-connect|packages/core|release.yml|release|MIT|
new|@thomasfosterau/effect-connect-alchemy-cloudflare|effect-connect|packages/alchemy-cloudflare|release.yml|release|MIT|
new|@thomasfosterau/effect-connect-resend|effect-connect|packages/resend|release.yml|release|MIT|
new|@thomasfosterau/effect-document|effect-document|packages/core|release.yml|release|MIT|
new|@thomasfosterau/effect-drizzle-ext|effect-drizzle-ext|packages/core|release.yml|release|MIT|
new|@thomasfosterau/effect-drizzle-ext-pg|effect-drizzle-ext|packages/pg|release.yml|release|MIT|
new|@thomasfosterau/effect-ext|effect-ext|packages/effect-ext|release.yml|release|MIT|
new|@thomasfosterau/effect-ai-cloudflare|effect-ext|packages/effect-ai-cloudflare|release.yml|release|MIT|
move|@thomasfosterau/effect-ai-mistral|effect-ext|packages/effect-ai-mistral|release.yml|release|MIT|effect-ai-ext
move|@thomasfosterau/effect-ai-cohere|effect-ext|packages/effect-ai-cohere|release.yml|release|MIT|effect-ai-ext
move|@thomasfosterau/effect-ai-voyage|effect-ext|packages/effect-ai-voyage|release.yml|release|MIT|effect-ai-ext
move|@thomasfosterau/effect-ai-elevenlabs|effect-ext|packages/effect-ai-elevenlabs|release.yml|release|MIT|effect-ai-ext
revoke|@thomasfosterau/effect-ai-ext|effect-ext|packages/effect-ext|release.yml|release|MIT|effect-ai-ext
revoke|@thomasfosterau/effect-evals|effect-ext|packages/effect-ext|release.yml|release|MIT|effect-ai-ext
revoke|@thomasfosterau/effect-ai-gateway|effect-ext|packages/effect-ai-cloudflare|release.yml|release|MIT|effect-ai-ext
revoke|@thomasfosterau/effect-web|effect-ext|packages/effect-ext|release.yml|release|MIT|effect-web
revoke|@thomasfosterau/effect-robots|effect-ext|packages/effect-ext|release.yml|release|MIT|effect-web
revoke|@thomasfosterau/effect-sitemap|effect-ext|packages/effect-ext|release.yml|release|MIT|effect-web
keep|@thomasfosterau/effect-forms|effect-forms|packages/forms|release.yml|release|MIT|
keep|@thomasfosterau/effect-forms-svelte|effect-forms|packages/svelte|release.yml|release|MIT|
new|@thomasfosterau/effect-ical|effect-ical|.|release.yml|release|MIT|
keep|@thomasfosterau/effect-jsonapi|effect-jsonapi|.|release.yml|release|MIT|
keep|@thomasfosterau/effect-parse|effect-parse|.|release.yml|release|MIT|
new|@thomasfosterau/effect-rdf|effect-rdf|packages/core|release.yml|release|MIT|
new|@thomasfosterau/effect-sparql-node|effect-rdf|packages/sparql-node|release.yml|release|MIT|
new|@thomasfosterau/effect-richtext|effect-richtext|.|release.yml|release|MIT|
keep|@thomasfosterau/effect-svelte|effect-svelte|packages/svelte|release.yml|release|MIT|
keep|@thomasfosterau/effect-sveltekit|effect-svelte|packages/sveltekit|release.yml|release|MIT|
keep|@thomasfosterau/effect-wikimedia|effect-wikimedia|.|release.yml|release|MIT|
new|@thomasfosterau/effect-xml|effect-xml|.|release.yml|release|MIT|
new|@thomasfosterau/legation|legation|packages/effect|release.yml|release|MIT|
new|@thomasfosterau/legation-alchemy-cloudflare|legation|packages/alchemy-cloudflare|release.yml|release|MIT|
new|@thomasfosterau/legation-browser|legation|packages/browser|release.yml|release|MIT|
new|@thomasfosterau/legation-devtools|legation|packages/devtools|release.yml|release|MIT|
new|@thomasfosterau/legation-jsonapi|legation|packages/jsonapi|release.yml|release|MIT|
new|@thomasfosterau/legation-svelte|legation|packages/svelte|release.yml|release|MIT|
new|@thomasfosterau/prosekit-utilities|prosekit-utilities|packages/prosekit-utilities|release.yml|release|MIT|
new|@thomasfosterau/prosekit-svelte|prosekit-utilities|packages/prosekit-svelte|release.yml|release|MIT|
new|@thomasfosterau/prosekit-flowchart|prosekit-utilities|packages/prosekit-flowchart|release.yml|release|MIT|
new|@thomasfosterau/pulpit|pulpit|packages/pulpit|release.yml|release|MIT|
keep|@thomasfosterau/argon2|rust-wasm-packages|packages/argon2|release.yml|release|MIT|
'

# name|deprecation message (all versions)
SITE="see https://github.com/thomasfosterau/effect-ext"
DEPRECATIONS="
@thomasfosterau/effect-web|Moved to @thomasfosterau/effect-ext (subpaths /Web, /Net, /Observability, /Negotiate, /ServiceWorker, /Browser, /BrowserTesting); $SITE
@thomasfosterau/effect-robots|Moved to @thomasfosterau/effect-ext (subpath /Robots); $SITE
@thomasfosterau/effect-sitemap|Moved to @thomasfosterau/effect-ext (subpath /Sitemap); $SITE
@thomasfosterau/effect-ai-ext|Merged into @thomasfosterau/effect-ext (subpaths /RerankerModel, /ClassifierModel, /SpeechModel, /TranscriptionModel, /ImageModel, /ModerationModel, /VoiceConversionModel; upstream modules from effect/ai); $SITE
@thomasfosterau/effect-evals|Merged into @thomasfosterau/effect-ext (subpath /evals and /evals/<Module>; the effect-evals bin ships with it); $SITE
@thomasfosterau/effect-ai-gateway|Renamed to @thomasfosterau/effect-ai-cloudflare
"

DRY_RUN=0
SKIP_PLACEHOLDERS=0
SKIP_TRUST=0
SKIP_DEPRECATE=0
ONLY=""

usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-placeholders) SKIP_PLACEHOLDERS=1 ;;
    --skip-trust) SKIP_TRUST=1 ;;
    --skip-deprecate) SKIP_DEPRECATE=1 ;;
    --only)
      [ $# -ge 2 ] || { echo "--only needs a package name" >&2; exit 2; }
      ONLY="$2"; shift ;;
    --only=*) ONLY="${1#--only=}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

# --- environment hygiene -----------------------------------------------------------------------
# Build the list of variables every npm call runs without.
SCRUB=(NODE_AUTH_TOKEN NPM_TOKEN GITHUB_TOKEN GH_TOKEN GITHUB_ACTIONS
  ACTIONS_ID_TOKEN_REQUEST_URL ACTIONS_ID_TOKEN_REQUEST_TOKEN)
NPM_ENV_VARS=""
while IFS='=' read -r var _; do
  case "$var" in
    # Kept: where the login lives, the cache, and network settings (proxy, CA), none of which
    # changes what is published or who publishes it.
    NPM_CONFIG_USERCONFIG|npm_config_userconfig|NPM_CONFIG_CACHE|npm_config_cache) ;;
    NPM_CONFIG_*PROXY|npm_config_*proxy|NPM_CONFIG_CAFILE|npm_config_cafile) ;;
    NPM_CONFIG_*|npm_config_*) SCRUB+=("$var"); NPM_ENV_VARS="$NPM_ENV_VARS $var" ;;
  esac
done < <(env)

ENV_ARGS=()
for v in "${SCRUB[@]}"; do ENV_ARGS+=(-u "$v"); done

# npm with the scrubbed environment and the public registry pinned. Runs from a neutral directory
# so no project .npmrc or package.json is picked up.
NEUTRAL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/npm-bootstrap.XXXXXX")" || exit 1
trap 'rm -rf "$NEUTRAL_DIR"' EXIT
npmc() { (cd "$NEUTRAL_DIR" && env "${ENV_ARGS[@]}" npm --registry="$REGISTRY" "$@"); }
npmc_in() { local dir="$1"; shift; (cd "$dir" && env "${ENV_ARGS[@]}" npm --registry="$REGISTRY" "$@"); }

# Print a command the way the owner would type it.
show() { printf '    $'; printf ' %q' "$@"; printf '\n'; }

# Run a mutating npm command, or print it under --dry-run. Usage: mutate <dir|-> npm-args...
mutate() {
  local dir="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then
    if [ "$dir" != - ]; then
      echo "    # in a temp dir holding package.json: $(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1])))' "$dir/package.json")"
    fi
    show npm "$@"
    return 0
  fi
  if [ "$dir" = - ]; then npmc "$@"; else npmc_in "$dir" "$@"; fi
}

# --- preflight ---------------------------------------------------------------------------------
die() { echo "preflight: $*" >&2; exit 2; }

command -v node >/dev/null 2>&1 || die "node is not on PATH"
command -v npm >/dev/null 2>&1 || die "npm is not on PATH"

NPM_VERSION="$(npmc --version 2>/dev/null)" || die "npm --version failed"
if ! node -e '
  const [a, b] = process.argv.slice(1).map(v => v.split("-")[0].split(".").map(Number));
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) process.exit(a[i] > b[i] ? 0 : 1) }
' "$NPM_VERSION" "$MIN_NPM"; then
  die "npm $NPM_VERSION is too old (need >= $MIN_NPM for npm trust). Upgrade with:
    npm install -g npm@latest
then open a new shell and re-run."
fi
if ! npmc trust github --help 2>/dev/null | grep -q -- '--allow-publish'; then
  die "npm $NPM_VERSION's 'npm trust github' has no --allow-publish flag. Upgrade with:
    npm install -g npm@latest"
fi

CONF_REGISTRY="$(cd "$NEUTRAL_DIR" && env "${ENV_ARGS[@]}" npm config get registry 2>/dev/null)"
[ "$CONF_REGISTRY" = "$REGISTRY" ] ||
  die "npm config get registry is '$CONF_REGISTRY', expected $REGISTRY (check ~/.npmrc)"
SCOPE_REGISTRY="$(cd "$NEUTRAL_DIR" && env "${ENV_ARGS[@]}" npm config get @thomasfosterau:registry 2>/dev/null)"
case "$SCOPE_REGISTRY" in
  ""|undefined|null|"$REGISTRY") ;;
  *) die "@thomasfosterau:registry is '$SCOPE_REGISTRY', expected unset or $REGISTRY (check ~/.npmrc)" ;;
esac

if WHOAMI="$(npmc whoami 2>/dev/null)" && [ -n "$WHOAMI" ]; then
  :
elif [ "$DRY_RUN" = 1 ]; then
  WHOAMI="(not logged in)"
  echo "preflight: npm whoami failed; continuing only because this is --dry-run." >&2
else
  die "npm whoami failed. Log in first:  npm login --auth-type=web"
fi

echo "npm $NPM_VERSION · registry $CONF_REGISTRY · logged in as $WHOAMI$([ "$DRY_RUN" = 1 ] && echo ' · DRY RUN')"
[ -n "$NPM_ENV_VARS" ] && echo "ignoring environment variables for npm:$NPM_ENV_VARS"

# --- helpers -----------------------------------------------------------------------------------
# exists_on_npm <name>: 0 = exists, 1 = E404, 2 = could not tell.
exists_on_npm() {
  local out
  if out="$(npmc view "$1" name 2>&1)"; then return 0; fi
  case "$out" in *E404*) return 1 ;; *) echo "$out" | tail -3 >&2; return 2 ;; esac
}

# shellcheck disable=SC2016 # the single-quoted program is JavaScript; its ${} are template literals
build_placeholder() { # <dir> <name> <repo> <directory> <license>
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, name, repo, directory, license] = process.argv.slice(1);
    const repository = { type: "git", url: `git+https://github.com/thomasfosterau/${repo}.git` };
    if (directory !== ".") repository.directory = directory;
    const pkg = {
      name, version: "0.0.0",
      description: `Placeholder reserved for npm trusted publishing; the first real release of ${name} is 0.1.0.`,
      license, repository, publishConfig: { access: "public" },
    };
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "README.md"),
      `# ${name}\n\nPlaceholder reserved for npm trusted publishing; the first real release is 0.1.0, from https://github.com/thomasfosterau/${repo}.\n`);
  ' "$@"
}

# trust_entries <name>: prints "id<TAB>repository<TAB>file<TAB>environment" per entry.
trust_entries() {
  local json
  json="$(npmc trust list "$1" --json 2>/dev/null)" || return 1
  printf '%s' "$json" | node -e '
    let s = ""; process.stdin.on("data", c => s += c).on("end", () => {
      s = s.trim(); if (!s) return;
      // npm prints one JSON object per configuration, one after another.
      const items = JSON.parse("[" + s.replace(/\}\s*\{/g, "},{") + "]").flat();
      for (const i of items) console.log([i.id, i.repository, i.file, i.environment].map(v => v ?? "").join("\t"));
    })'
}

trust_create() { # <name> <repo> <workflow> <env>
  mutate - trust github "$1" --file "$3" --repository "thomasfosterau/$2" --environment "$4" --allow-publish --yes
}

# ensure_trust <name> <repo> <workflow> <env> <old repo, "" unless a move> <fresh:0|1>; sets MSG.
# For a move, an entry for the old repository is revoked before the new one is created.
ensure_trust() {
  local name="$1" repo="$2" wf="$3" envname="$4" old="$5" fresh="$6" move=0
  local target="thomasfosterau/$repo" entries="" tries=0 id r f e
  [ -n "$old" ] && move=1
  if [ "$DRY_RUN" = 1 ]; then
    show npm trust list "$name" --json
    if [ "$move" = 1 ]; then
      echo "    # if an entry for $old exists:"
      echo "    \$ npm trust revoke $name --id <id from the list>"
    fi
    trust_create "$name" "$repo" "$wf" "$envname"
    MSG="trust: would ensure github $target $wf env=$envname"; return 0
  fi
  until entries="$(trust_entries "$name")"; do
    tries=$((tries + 1))
    if [ "$fresh" = 0 ] || [ "$tries" -ge 6 ]; then MSG="trust list failed"; return 1; fi
    sleep 5 # a just-published name can take a moment to appear
  done
  if [ -n "$entries" ]; then
    while IFS=$'\t' read -r id r f e; do
      if [ "$r" = "$target" ] && [ "$f" = "$wf" ] && [ "$e" = "$envname" ]; then
        MSG="trust: already github $target $wf env=$envname"; return 0
      fi
    done <<< "$entries"
    while IFS=$'\t' read -r id r f e; do
      if [ "$move" = 1 ] && [ "$r" = "$old" ]; then
        npmc trust revoke "$name" --id "$id" || { MSG="revoke of old $old entry $id failed"; return 1; }
        sleep 2
      else
        MSG="existing trust entry $id ($r $f env=$e) is not the expected one; fix by hand"; return 1
      fi
    done <<< "$entries"
  elif [ "$move" = 1 ]; then
    echo "    note: no $old entry found for $name; creating the new one" >&2
  fi
  trust_create "$name" "$repo" "$wf" "$envname" >/dev/null || { MSG="npm trust github failed"; return 1; }
  sleep 2
  MSG="trust: set github $target $wf env=$envname"
  if [ "$move" = 1 ]; then MSG="$MSG (moved from $old)"; fi
  return 0
}

# revoke_old_trust <name> <old repo>: revokes every trust entry naming the old repository and
# creates none; sets MSG.
# Returns 0 when it revoked (or would, under --dry-run), 3 when no such entry is left (idempotent
# skip), 1 on a failure or when an entry for another repository remains.
revoke_old_trust() {
  local name="$1" old="$2" entries="" id r f e revoked=0 other=""
  if [ "$DRY_RUN" = 1 ]; then
    show npm trust list "$name" --json
    echo "    # for each entry for $old:"
    echo "    \$ npm trust revoke $name --id <id from the list>"
    MSG="trust: would revoke its $old entry and create none"; return 0
  fi
  entries="$(trust_entries "$name")" || { MSG="trust list failed"; return 1; }
  if [ -n "$entries" ]; then
    while IFS=$'\t' read -r id r f e; do
      if [ "$r" = "$old" ]; then
        npmc trust revoke "$name" --id "$id" || { MSG="revoke of $old entry $id failed"; return 1; }
        revoked=$((revoked + 1))
        sleep 2
      else
        other="$other $id ($r $f env=$e)"
      fi
    done <<< "$entries"
  fi
  if [ -n "$other" ]; then
    MSG="unexpected trust entries remain:$other; fix by hand"; return 1
  fi
  if [ "$revoked" = 0 ]; then MSG="trust: no $old entry left, nothing to revoke"; return 3; fi
  MSG="trust: revoked $revoked $old entr$([ "$revoked" = 1 ] && echo y || echo ies), created none"
  return 0
}

# --- main --------------------------------------------------------------------------------------
OK=0; SKIPPED=0; FAILED=0; FAILED_NAMES=""; MATCHED=0

record() { # <status> <name> <message>
  printf '%-5s %-44s %s\n' "$1" "$2" "$3"
  case "$1" in
    FAIL) FAILED=$((FAILED + 1)); FAILED_NAMES="$FAILED_NAMES $2" ;;
    skip) SKIPPED=$((SKIPPED + 1)) ;;
    *) OK=$((OK + 1)) ;;
  esac
}

while IFS='|' read -r action name repo dir wf envname license from; do
  [ -n "$action" ] || continue
  if [ -n "$ONLY" ] && [ "$name" != "$ONLY" ]; then continue; fi
  MATCHED=$((MATCHED + 1))
  # A keep, a move and a revoke are trust-only.
  [ "$SKIP_TRUST" = 1 ] && [ "$action" != new ] && continue
  old=""; [ -n "$from" ] && old="thomasfosterau/$from"
  echo "--- $name ($repo/${dir})"
  fresh=0; pub_msg=""; changed=0
  exists_on_npm "$name"; state=$?
  if [ "$state" -ge 2 ]; then record FAIL "$name" "could not query the registry"; continue; fi
  if [ "$action" = new ]; then
    if [ "$state" = 0 ]; then
      pub_msg="exists, placeholder skipped"
    elif [ "$SKIP_PLACEHOLDERS" = 1 ]; then
      record skip "$name" "not on npm; placeholder phase skipped (--skip-placeholders), so no trust either"; continue
    else
      pkgdir="$(mktemp -d "$NEUTRAL_DIR/pkg.XXXXXX")"
      build_placeholder "$pkgdir" "$name" "$repo" "$dir" "$license"
      if mutate "$pkgdir" publish --access public --provenance=false; then
        fresh=1; changed=1
        if [ "$DRY_RUN" = 1 ]; then pub_msg="would publish 0.0.0 placeholder"; else pub_msg="published 0.0.0 placeholder"; sleep 2; fi
      else
        record FAIL "$name" "placeholder publish failed"; continue
      fi
    fi
  elif [ "$state" != 0 ]; then
    record FAIL "$name" "expected to exist on npm"; continue
  fi
  if [ "$action" = revoke ]; then
    revoke_old_trust "$name" "$old"; rc=$?
    case "$rc" in
      0) status=ok; [ "$DRY_RUN" = 1 ] && status=dry; record "$status" "$name" "superseded by $repo/$dir; $MSG" ;;
      3) record skip "$name" "superseded by $repo/$dir; $MSG" ;;
      *) record FAIL "$name" "$MSG" ;;
    esac
    continue
  fi
  if [ "$SKIP_TRUST" = 1 ]; then
    status=skip; [ "$changed" = 1 ] && status=ok; [ "$changed" = 1 ] && [ "$DRY_RUN" = 1 ] && status=dry
    record "$status" "$name" "$pub_msg; trust phase skipped (--skip-trust)"; continue
  fi
  if ensure_trust "$name" "$repo" "$wf" "$envname" "$([ "$action" = move ] && echo "$old")" "$fresh"; then
    status=ok; [ "$DRY_RUN" = 1 ] && status=dry
    case "$MSG" in "trust: already"*) [ "$changed" = 0 ] && status=skip ;; esac
    record "$status" "$name" "${pub_msg:+$pub_msg; }$MSG"
  else
    record FAIL "$name" "${pub_msg:+$pub_msg; }$MSG"
  fi
done <<< "$PACKAGES"

while IFS='|' read -r name message; do
  [ -n "$name" ] || continue
  if [ -n "$ONLY" ] && [ "$name" != "$ONLY" ]; then continue; fi
  MATCHED=$((MATCHED + 1))
  [ "$SKIP_DEPRECATE" = 1 ] && continue
  echo "--- $name (deprecate)"
  if ! current="$(npmc view "$name" deprecated 2>/dev/null)"; then
    record FAIL "$name" "could not query the registry"; continue
  fi
  if [ "$current" = "$message" ]; then
    record skip "$name" "already deprecated with this message"; continue
  fi
  [ -n "$current" ] && echo "    replacing current deprecation: $current"
  if mutate - deprecate "$name@*" "$message"; then
    if [ "$DRY_RUN" = 1 ]; then record dry "$name" "would deprecate all versions"; else record ok "$name" "deprecated all versions"; sleep 2; fi
  else
    record FAIL "$name" "npm deprecate failed"
  fi
done <<< "$DEPRECATIONS"

if [ -n "$ONLY" ] && [ "$MATCHED" = 0 ]; then echo "--only: no package named $ONLY" >&2; exit 2; fi

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "summary (dry run, nothing was changed): $OK planned, $FAILED failed"
else
  echo "summary: $OK done, $SKIPPED skipped or already in place, $FAILED failed"
fi
if [ "$FAILED" -gt 0 ]; then echo "failed:$FAILED_NAMES"; exit 1; fi
exit 0
