# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions are in [AGENTS.md](AGENTS.md).

## Setup

You need Node.js 22 or later and pnpm 11 (the exact version is pinned by `packageManager` in `package.json`; `corepack enable` picks it up). Then:

```sh
pnpm install
```

This installs dependencies and the Vite+ git hooks. Everything after that runs through `vp`.

## Adding a module

A new module follows the checklist at the top of [AGENTS.md](AGENTS.md#agentsmd).

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+; the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs the `ci` job on Node 22 and 24, whose steps are the gate list in [AGENTS.md](AGENTS.md#verification). The workflows are hardened: `permissions: {}` at the top with read-only jobs, SHA-pinned actions (Dependabot keeps them current), `persist-credentials: false` wherever nothing pushes, no secrets in anything a Dependabot PR triggers, the release job skipped for `dependabot[bot]`, and Node set up from a pinned major with `check-latest: true` (never `node-version: latest`, which resolves to pre-releases); `uvx zizmor --offline .github` audits them. [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the version PR while unreleased changesets exist and publishes once it merges, via npm OIDC trusted publishing (see [PUBLISHING.md](PUBLISHING.md)).

## Pre-PR checklist

1. The gates in [AGENTS.md](AGENTS.md#verification), each with its final pass/fail.
2. A changeset (`pnpm changeset`) where [AGENTS.md](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk`
4. Docs: `README.md` for any exported change; `AGENTS.md` for a new convention.

## Running individual checks

```sh
vp lint                         # oxlint
vp fmt                          # oxfmt
vp run check                    # the type gate
vp run -r test:unit             # unit tests
vp test run test/Str.test.ts    # a single file
vp test                         # watch mode
vp run -r build                 # emit dist/
vp run test:coverage            # Istanbul map for fallow
vp run fallow:audit             # change-set review (not a CI gate)
```
