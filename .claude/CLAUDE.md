# CLAUDE.md

Claude Code-specific guidance for this repository. Everything else is in the three files imported at the end: [AGENTS.md](../AGENTS.md) (conventions, verification gates, agent rules), [CONTRIBUTING.md](../CONTRIBUTING.md) (setup, branch model, commands) and [README.md](../README.md) (the project overview and packages). Each package's own `CLAUDE.md` only imports its `AGENTS.md`.

## Hooks

`.claude/settings.json` registers three hooks:

- **SessionStart** (`.claude/hooks/session-start.sh`, also the devcontainer's `postCreateCommand`) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked; it needs `vite.plus` and `viteplus.dev` on the environment's allowlist), links `vp` and `vpx` into `~/.local/bin` (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), and runs `vp install --frozen-lockfile`. Nothing else is put on PATH. If the installer can't run, `vp` falls back to this checkout's `node_modules` copy. The hook hydrates no secrets; nothing here needs one, and nothing here can publish.
- **PostToolUse** on Write/Edit/MultiEdit: every edit of a `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.css`/`.json`/`.md` file is followed by `vp fmt --write` on that file.
- **PreToolUse** on Bash: a `git commit` / `git push` first runs `fallow audit` through `vp exec fallow` (`.claude/hooks/fallow-gate.sh`), which blocks on a `fail` verdict. It audits against `origin/trunk` (`FALLOW_AUDIT_BASE` overrides) and regenerates a stale coverage map first. The gate runs only in this checkout and its `.claude/worktrees/*`: for a commit to any other tree it runs none of that tree's tooling and skips the audit with a notice.

Never let fallow (`fallow init`, `fallow setup-hooks`) append an `@AGENTS.md` import or its generated block to a `CLAUDE.md`: its block lives in the root `AGENTS.md`, which this file already imports.

## Plugins

`.claude/settings.json` should also enable the `@enfect/claude` plugin (Effect guidance, skills and post-write pattern checks; marketplace `mpsuesser/enfect`). There is no `.claude/rules/` directory.

## Worktrees

Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. The global `vp` delegates to the checkout's own `vite-plus`, so a worktree needs its own `vp install` first.

## What runs in a session

Every gate in [AGENTS.md § Verification](../AGENTS.md#verification) runs in an agent session; `pnpm audit` needs the network. Running the type gate's packages in parallel can exhaust a small container's memory: if `vp run check` is killed, run it again with fewer packages at once (`vp run --filter ./packages/<name> check`) and say so in the PR body.

@../AGENTS.md @../CONTRIBUTING.md @../README.md
