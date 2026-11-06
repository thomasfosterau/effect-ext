#!/usr/bin/env bash
#
# Provision a checkout for NON-INTERACTIVE use.
#
# One file, two callers — the Claude Code SessionStart hook and a container's
# `postCreateCommand` (which can invoke this file directly) — so a container
# shell and an agent session are provisioned identically. Copied from the
# effect-drizzle-ext library (itself from the gardeneria application).
#
# ## The problem it solves
#
# `~/.bashrc` opens with Debian's standard guard:
#
#     case $- in
#         *i*) ;;
#           *) return;;
#     esac
#
# and the line that puts the toolchain on PATH — `. "$HOME/.vite-plus/env"` —
# sits *below* it. So the environment is correct for a human at a prompt and
# broken for every non-interactive shell, which is what an agent's tool calls
# and a git hook both are. `fallow` (which AGENTS.md requires before every
# commit) is in `node_modules/.bin`, which is on nobody's PATH.
#
# Rather than fight PATH — which this script cannot export into its caller —
# it links the tools into `~/.local/bin`, a directory already on PATH in the
# session container and writable by the session user. A symlink survives
# where an `export` cannot.
#
# ## Node, and why this repairs rather than clobbers
#
# `~/.vite-plus/bin/node` is a shim pointing at the `vp` launcher, which
# resolves a Node version and installs it under `~/.vite-plus/js_runtime`. That
# directory is `root:root` from image build while the session user is `vp`, so
# when the resolved version drifts past the cached one the shim fails:
#
#     vp: Failed to install Node 24.19.0: Permission denied (os error 13)
#
# Anything routed through `vp` still works; bare `node` does not — which breaks
# the pre-commit hook repo-wide, because `vp staged` shells out to it
# (gardeneria #1462). There is no root in a session, so the directory cannot
# be chowned here.
#
# This script therefore *tests* `node --version` and only replaces the shim
# when it is already broken, pointing it at a real cached binary. A working
# shim is left alone, so `vp env use` keeps functioning wherever it functions
# today. The repair is deliberately conditional: unconditionally replacing a
# working shim would trade one breakage for another.
#
# ## Secrets
#
# This hook hydrates NO secrets; nothing in this repository needs one.
#
# ## Contract
#
# Idempotent, and never fatal. Every failure path logs and continues, because
# the SessionStart hook must not block a session and a half-provisioned
# container is more useful than a container that refused to start. Callers
# that want hard failure should check the tools themselves afterwards.
#
# Untrusted-content note: this script reads only fixed, hardcoded paths. It
# takes no input from repo content, issue or PR bodies, or anything an agent
# could have been persuaded to write earlier in a session. Do not add such
# input without revisiting this note — it runs on every session start and
# container create.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOCAL_BIN="${HOME:-/home/vp}/.local/bin"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# Link a binary into ~/.local/bin, replacing a stale link but never a real file.
link_tool() {
  src="$1"
  name="$(basename "$src")"
  dest="$LOCAL_BIN/$name"
  [ -x "$src" ] || return 0
  # Leave a real (non-symlink) binary alone: something deliberately installed it.
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    return 0
  fi
  ln -sfn "$src" "$dest" 2>/dev/null || log "could not link $name"
}

# The repo's tools get re-exec shims rather than plain symlinks, for two
# reasons.
#
# `node_modules/.bin/<tool>` is pnpm's sh shim, which derives its `basedir`
# from `$0`. Run through a symlink, `$0` is `~/.local/bin/<tool>`, so the shim
# looks under `~/.local/`, node exits with MODULE_NOT_FOUND, and
# `.claude/hooks/fallow-gate.sh` reads that as an audit runtime error and lets
# every commit through ungated (thomasfosterau/effect-wikimedia#219). A script
# that `exec`s the shim by its real path keeps `$0` right.
#
# `vp` has a second reason. A symlink always resolves to $PROJECT_DIR's
# node_modules/vite-plus, even when invoked with cwd inside a
# `.claude/worktrees/*` checkout — so the CLI process loads the primary tree's
# vitest while the worktree's test modules resolve the worktree's own copy.
# Two physical instances of the same vitest version corrupt its module-level
# suite-collector state, and every describe() in the worktree throws
# `Cannot read properties of undefined (reading 'config')` (gardeneria #1663).
#
# So the `vp` shim walks up from $PWD for the nearest project-local copy and
# re-execs that, falling back to the primary checkout's when none is found.
# It only accepts a checkout that is $PROJECT_DIR itself or one of its
# `.claude/worktrees/*`: a walk that trusted any directory above cwd would run
# whatever `node_modules/.bin` a cloned third-party tree carries. `fallow` and
# `tsx` need no walk at all, so their shims exec $PROJECT_DIR's copy directly.
# The marker is a prefix of the one the earlier vp-only shim carried, so a
# shim from either version is recognised and regenerated.
SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh"
# write_shim <name> <path of the tool relative to a checkout root> [walk]
write_shim() {
  name="$1"
  rel="$2"
  walk="${3:-}"
  dest="$LOCAL_BIN/$name"
  [ -x "$PROJECT_DIR/$rel" ] || return 0
  # Leave a real, non-generated file alone: something deliberately installed
  # it. A symlink (what earlier versions of this hook made) or a shim we
  # generated earlier is fair game to replace — the embedded fallback path
  # can change across containers.
  if [ -e "$dest" ] && [ ! -L "$dest" ] \
    && ! grep -qF "$SHIM_MARKER" "$dest" 2>/dev/null; then
    return 0
  fi
  if [ "$walk" = walk ]; then
    cat >"$dest.tmp" <<SHIM
#!/usr/bin/env bash
$SHIM_MARKER ($name re-exec shim)
dir="\$PWD"
while [ -n "\$dir" ]; do
  case "\$dir" in
    "$PROJECT_DIR" | "$PROJECT_DIR"/.claude/worktrees/*)
      if [ -x "\$dir/$rel" ]; then
        exec "\$dir/$rel" "\$@"
      fi
      ;;
  esac
  [ "\$dir" = "/" ] && break
  dir="\$(dirname "\$dir")"
done
exec "$PROJECT_DIR/$rel" "\$@"
SHIM
  else
    cat >"$dest.tmp" <<SHIM
#!/usr/bin/env bash
$SHIM_MARKER ($name re-exec shim)
exec "$PROJECT_DIR/$rel" "\$@"
SHIM
  fi
  # `mv -f` replaces a symlink at $dest itself rather than writing through it.
  chmod +x "$dest.tmp" 2>/dev/null && mv -f "$dest.tmp" "$dest" 2>/dev/null \
    || { rm -f "$dest.tmp" 2>/dev/null; log "could not write $name shim"; }
}

write_tool_shims() {
  write_shim fallow node_modules/.bin/fallow
  write_shim tsx node_modules/.bin/tsx
  write_shim vp node_modules/vite-plus/bin/vp walk
}

# ── 1. Repo binaries the documented workflows invoke directly ─────────────────
# AGENTS.md's fallow gate runs `fallow audit …` before every commit; it resolves
# only from node_modules/.bin; `tsx` runs docgen's examples and ad-hoc
# scripts. `vp` is included for the remote/web runner,
# where the global launcher does not exist.
write_tool_shims

# ── 2. Bare `node` (gardeneria #1462) ─────────────────────────────────────────
# Only repair a shim that is already failing — see the header for why this is
# conditional. `command -v node` is not enough: the shim exists and resolves,
# then dies on use, so the version call is the real test.
if ! node --version >/dev/null 2>&1; then
  VP_BIN_DIR="${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/bin"
  # Newest cached runtime wins; `sort -V` so 24.9 does not beat 24.18.
  REAL_NODE="$(
    find "${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/js_runtime/node" \
      -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1
  )"
  if [ -n "$REAL_NODE" ]; then
    log "bare \`node\` is broken; pointing it at $REAL_NODE"
    # The shim lives in a vp-owned directory even though the runtime cache
    # beneath it is root-owned, so this needs no privileges.
    ln -sfn "$REAL_NODE" "$VP_BIN_DIR/node" 2>/dev/null \
      || link_tool "$REAL_NODE"
  else
    log "bare \`node\` is broken and no cached runtime was found; \`vp\`-routed commands still work"
  fi
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
# Unconditional, not only when node_modules is absent: a prebaked container can
# carry a tree built from an OLDER lockfile, and stale dependencies masquerade
# as breakage on `trunk`. `--frozen-lockfile` is a sub-second no-op when in sync.
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile…"
  # pnpm only, at the `packageManager` pin: through corepack when it exists,
  # else whatever pnpm is on PATH.
  if command -v corepack >/dev/null 2>&1; then
    PNPM=(corepack pnpm)
  else
    PNPM=(pnpm)
  fi
  (cd "$PROJECT_DIR" && "${PNPM[@]}" install --frozen-lockfile >/dev/null 2>&1) \
    || log "dependency install failed; continuing"
  # node_modules/.bin only exists after the install, so rewrite the shims for what it provides.
  write_tool_shims
fi

exit 0
