# Contributing

## Workflow

The main branch is `trunk`. Branch off `trunk`, open a pull request into `trunk`, and squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).

- **Open a draft PR early**, so others can see the work is taken.
- **One PR per change**, even a large one. Rebase onto `origin/trunk`; never merge `trunk` into your branch.
- **You own your PR**: CI green, reviews addressed, no conflicts, marked ready for review.
- **File issues** for bugs or improvements outside your change instead of fixing them in passing or leaving a TODO. Keep issue bodies evergreen: edit the context, findings and chosen solution in place.
- **Dependabot** keeps dependencies current; update one by hand only when your work needs it or Dependabot can't (see [Dependencies](#dependencies)).

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm; use it rather than calling them directly (`vp exec <bin>`, not `npx`; `vpx <file>.ts` for scripts). `vp install` installs dependencies, the git hooks, and the Effect-patched `tsc` / oxlint (`prepare`). The pre-commit hook runs `vp staged` (format, then lint) and `vp run fallow:audit`.

| Command | What it does |
| --- | --- |
| `vp check` | Format and lint, type-aware |
| `vp run check` | The type gate: every package's `tsc`, plus the dist-consumer check against the emitted declarations |
| `vp run -r test:unit` | Unit tests; `vp test run tests/X.test.ts` from inside a package for one file |
| `vp run -r test:coverage` | Each package's suite against its coverage floor |
| `vp run -r build` | `vp pack` → each package's `dist/` |
| `vp run check:dist` | Imports and type-checks the built entries as a consumer would, and launches the `effect-evals` bin from a packed tarball |
| `vp run docgen` | Compiles and runs every JSDoc `@example` against `dist/` |
| `vp run ci` | Everything CI runs, in order (`pnpm audit` needs the network) |

[Fallow](https://docs.fallow.tools) checks dead code, module boundaries (`.fallowrc.json`), complexity and duplication: `vp run fallow` for a summary. Treat its findings as guidance, not dogma. `vp run fallow:audit` (the pre-commit gate) fails only on findings your change introduces against `origin/trunk`; it reads the coverage map `test:coverage` writes. Before deleting "unused" code, trace it: `vp exec fallow dead-code --trace <file>:<export>`.

## Coding guidelines

- **Effect.** Use Effect (v4) idioms throughout, and prefer Effect's own modules (`Option`, `Array`, `Match`, `Schema`, `Config`, `effect/http`, …) to hand-rolled equivalents; convert existing code when you touch it, where practical. Exceptions: non-Effect APIs at the boundary (adapt them at the edge) and hot paths where measurement shows plain code is needed. Read the installed package rather than guessing an API (`node_modules/effect/` ships `AGENTS.md`, `ai-docs/`, typings and source).
- **Absence is `Option`**, never `T | null` / `T | undefined`, except where a platform or wire shape fixes the spelling (the scoped `prefer-option-over-null` overrides in `vite.config.ts`). Options-object members are `readonly x?: T`; optional parameters `x?: T`.
- **Imports**: Effect modules as namespaces by subpath, with the lint's aliases (`Arr`, `P`, `R`, `Str`, `Eq`, `Bool`). Relative imports carry `.ts` in effect-ext; the AI providers' are extensionless.
- **Exports** follow Effect's layout: `src/index.ts` re-exports each module as a PascalCase namespace (`export * as Vec from "./Vec.ts"`), and each module is also its own PascalCase subpath (`./Vec`).
- **Lint** findings are fixed in code. A rule is relaxed only in `vite.config.ts`, scoped to the files that need it, with its reason.
- **Comments.** A file-level comment only when it gives real context, in under 50 words. JSDoc where it helps a consumer's IntelliSense (docgen requires `@since` on effect-ext exports and an `@example` on exported functions, schemas and errors). Inline comments only for what the code can't say. Don't reference issues, PRs or CI runs in comments.
- **Tests** check logic: edge cases, regressions, laws. Don't test what the type system or a lint enforces. Use `@effect/vitest` (`it.effect`, `layer(...)`) for effectful tests and `vite-plus/test` otherwise, never `vitest` directly. No live network: stub `FetchHttpClient.Fetch`. Never lower a coverage floor to get a change through.
- **Packages.** `dist/` is the product and `"sideEffects": false` is a claim about it: no effectful top-level statements. `effect` is always a peer. A new effect-ext module is `src/<Module>.ts`, re-exported from `src/index.ts`, and listed in its `vite.config.ts` entries, `package.json` `exports`, `.fallowrc.json` `entry` and the package README. Each package's `AGENTS.md` states its boundary and invariants. A new AI provider mirrors `effect-ai-mistral`: every failure leaves as an `AiError`, and the client takes an `apiUrl` override (how a routing layer repoints it), tested against a stub server. Write no provider the Effect org already ships.

## Before pushing

Run `vp run ci`, or the gates one at a time: `vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r test:coverage`, `vp run -r build`, `vp run check:dist`, `vp run docgen`, `pnpm audit --audit-level high`. Say in the PR body which gates couldn't run.

CI ([ci.yml](../.github/workflows/ci.yml)) runs `vp run ci` on Node `lts` and `latest` with no secrets. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`. `uvx zizmor --offline .github` audits the workflows.

## Changesets

Every change to a published package's behaviour or its emitted `.d.ts` (doc comments included, as a `patch`) carries a changeset: `vp exec changeset`. Other docs-, CI- and tooling-only changes need none. Never version or publish by hand: the Release workflow publishes with `vp run release` (`check:dist`, then `vp pm publish -r` and `changeset git-tag`; there is no publish script), and `vp run release:dry-run` shows what it would publish. See [PUBLISHING.md](PUBLISHING.md).

## Dependencies

Every external version is in the `pnpm-workspace.yaml` catalog; package.json files use `catalog:`, a named peers catalog or `workspace:*`. After editing the catalog, run `vp install` and commit `pnpm-lock.yaml`. Peer floors (`catalogs.*`) are tested claims: raise one only when a dependency requires it, and that is a breaking change.

Dependabot groups the sets that must move together. On those PRs, by hand:

- **Toolchain** (`vite-plus`): `vp dlx --package=vite-plus@<v> vp migrate --no-interactive` re-pins `vite` and `vitest`; drop the `minimumReleaseAgeExclude` entries it adds, and bump the devcontainer image if Dependabot hasn't. `typescript` / `@typescript/native` move only with an `@effect/tsgo` whose `components` table supports them.
- **Effect**: move `@effect/platform-node-shared` (referenced only from `overrides`) to the new version.
- **Security overrides** are raised or dropped as their advisories move.
