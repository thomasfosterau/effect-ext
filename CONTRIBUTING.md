# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions are in [AGENTS.md](AGENTS.md).

## Setup

Open in a Codespace or Dev Container: `.devcontainer/` provisions it with the same hook as agent sessions. The `Dev Container` workflow (`.github/workflows/devcontainer.yml`) builds it in CI whenever its inputs change; to try a change locally, `pnpm dlx @devcontainers/cli@0.89.0 up --workspace-folder .` (needs Docker).

Node `^22.18.0 || ^24.11.0 || >=26.0.0`, pnpm 11 (the `packageManager` pin; `corepack enable` provides it) and [Vite+](https://viteplus.dev/) (`vp`).

```sh
pnpm install   # dependencies, the Vite+ git hooks, and the @effect/tsgo patch of tsc / oxlint
vp check       # format + lint
vp run check   # type gates
```

## Adding a module or a package

A new `effect-ext` module follows the checklist under Conventions in [AGENTS.md](AGENTS.md#conventions); a new AI provider or abstraction follows the patterns under [The AI packages](AGENTS.md#the-ai-packages).

## Branches and pull requests

The default branch is `trunk`.

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Every change to the published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` take a `patch` changeset; other docs-only changes (README, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. Publishing is npm trusted publishing (OIDC); there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).

Agents follow the further rules in [AGENTS.md § Branches and pull requests](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+; the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook.

## CI expectations

CI ([ci.yml](.github/workflows/ci.yml)) runs on Node 22 and 24 (each a pinned major, never `latest`, which can resolve to a pre-release), set up with [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) (Vite+ at the catalog's `vite-plus` pin, Node, the `packageManager` pnpm, the store cache and `vp install`), and runs the same gates as [AGENTS.md § Verification](AGENTS.md#verification), plus `pnpm audit --audit-level high`; `uvx zizmor --offline .github` should stay clean (its configuration is [.github/zizmor.yml](.github/zizmor.yml)). [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk` (see [PUBLISHING.md](PUBLISHING.md)). Both workflows are hardened: `permissions: {}` at the top with per-job scopes, every action pinned to a full commit SHA, `persist-credentials: false` wherever nothing pushes, no secrets or OIDC in anything a Dependabot PR can trigger (Release skips `dependabot[bot]`), and no `GITHUB_PATH` writes of their own (setup-vp puts `vp` on PATH).

## Pre-PR checklist

1. The gates in [AGENTS.md § Verification](AGENTS.md#verification), in order.
2. `git fetch origin trunk && git rebase origin/trunk`
3. Docs: the package `README.md` for any exported change; the package `AGENTS.md` for a new term or invariant.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`. No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint, type-aware through oxlint-tsgolint; `typeCheck` off, see `vite.config.ts`). `vp run check` — the type gate: the package's `src` under `tsconfig.json`, its tests under `tsconfig.test.json`, and the dist-consumer declaration check (which builds `dist/` first). They are different commands. The gates are Vite Task tasks (root `vite.config.ts` and `vite.package.ts`), cached except `test:coverage`; `package.json` keeps only the release and helper scripts.
- `vp run -r test:unit` — unit tests (pure code; nothing here needs a database, a network or a credential).
- `vp run -r build` — `vp pack` → `dist/`.
- `vp run docgen` — compiles and runs each `@example` against `dist/`, writes the (git-ignored) API reference under `packages/*/docs/`.
- `vp run check:dist` — builds every package, then imports every built entry and subpath under Node ESM and fails if a value export the bundled `.d.ts` declares is missing at runtime, type-checks every bundled `dist/**/*.d.ts` with `skipLibCheck: false`, fails if a subpath's built module graph reaches an optional peer it is not listed for (or a listed one no longer does), compiles a Worker-shaped probe against effect-ai-cloudflare's built `.d.ts` with workers-types loaded, and launches the `effect-evals` bin from a packed tarball under `node_modules`. It replays the cached `build`, which overwrites a hand edit to `dist/`, so a dist-level mutation proof runs `node scripts/check-dist.mjs` directly after the build.
- `vp run -r test:coverage` — the coverage ratchet: each package's suite measured with only its own tests against the `coverageFloor` its `vite.config.ts` exports (the shared target is `vite.package.ts`'s 90 / 85 / 90 / 90). When a change raises a package's coverage, raise its floor in the same PR; never lower a floor or exclude files to get a change through. A new package adds its floor to `coverageFloors` in the root `vite.config.ts`.
- `vp run test:coverage` — every package's unit suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores.
- `pnpm changeset` — add a changeset (see [Branches and pull requests](#branches-and-pull-requests)).

Node and pnpm only: no bun, deno, npm, yarn or npx. Invoke everything through `vp` (`vp exec <bin>` for a package binary; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, `pnpm changeset`, and `scripts/release.sh`'s `pnpm pack` + `npm publish` on the release path. Everything else goes through Vite+ too: `vp exec fallow …` for fallow, `vpx <file>.ts` for scripts. `tsx` is installed only because `@effect/docgen` requires it as a peer and runs it itself; never invoke it directly. Narrower variants are under [Running individual checks](#running-individual-checks).

## Running individual checks

The gates themselves, in order, are in [AGENTS.md § Verification](AGENTS.md#verification). Narrower commands for iterating:

```sh
vp lint                                              # oxlint only
vp fmt                                               # oxfmt, writing fixes
vp run --filter ./packages/effect-ext check    # one package's own type gate
vp test run tests/Str.test.ts                        # single file (from inside the package)
vp run -r test:coverage                              # the per-package coverage floors
vp run check:dist                                    # built entries load and type-check; optional peers stay behind their subpaths; the effect-evals bin runs
```
