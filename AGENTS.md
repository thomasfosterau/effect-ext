# AGENTS.md

`CLAUDE.md` is a symlink to this file. Project conventions live here; personal style preferences live in user memory. This repository publishes `@thomasfosterau/effect-utilities`: experimental extensions to the Effect (v4) standard library, in two families — Allocator-backed binary data (`Allocator`, `Layout`, `BufferStruct`, `Vec`, `StructOfArrays`, `String`, `Str`) and pure Schema helpers (`TriState`, `Issues`, `Bounded`, `Ids`, `LiteralExact`, `Ast`, `Url`). The default branch is meant to be `trunk` (see #8: on GitHub it is still `main` until the owner renames it).

The Schema modules came from `thomasfosterau/effect-schema-ext`, merged here before either package was published. They serve the website, gardeneria and preferenceflow apps (whose copies are their behavioural spec and test corpus) and back effect-jsonapi and effect-drizzle-ext, so they carry no JSON:API, Drizzle or application vocabulary. In ported comments, `effect-schema-ext#NN` is that repository's tracker and a bare `#NNN` next to an app name is an app issue (website unless stated).

| Path | Package | Published |
| --- | --- | --- |
| `packages/effect-utilities` | `@thomasfosterau/effect-utilities` | npm |
| `tests/dist-consumer` | `@effect-utilities/dist-consumer` | no — type-checks a fixture against the emitted `dist/` declarations |

The package's modules, terms, invariants and import boundary are in [`packages/effect-utilities/CLAUDE.md`](packages/effect-utilities/CLAUDE.md); read it before touching `src/`.

## Common pitfalls

- **Versions live only in the `pnpm-workspace.yaml` catalog** (`catalogMode: strict` rejects anything else); never edit one in a `package.json`. After editing the catalog, run `pnpm install` and commit `pnpm-lock.yaml` — a stale lockfile fails CI with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `@effect/tsgo`, `@typescript/native` and `vite-plus` move together; read their catalog comments first. Dependabot's `toolchain` group proposes them (with vitest, the oxc tools and the Effect lint plugin `@enfect/oxlint`) as one PR; when the new oxlint outruns `@effect/tsgo`'s `components` table that PR is red until fixed by hand. Dependabot cannot move the npm-alias entries (`vite`, `typescript`, `@typescript/native`), the `overrides` literals or the Release job's pinned npm: set those by hand on the matching PR (the list heads `.github/dependabot.yml`). `minimumReleaseAge` holds a new version for 8 hours; Dependabot's `cooldown` (1 day, its smallest unit) is longer, so it never proposes one pnpm would refuse.
- **The `effect` peer floor is a tested claim.** `catalogs.peers.effect` is the oldest `effect` the package has been type-checked, tested and had its examples run against: rc.118, the line the whole programme moved to in website#2015 (re-verified for the merged package, binary-data modules included). Two known gaps at the floor: `tests/Ids.types.ts`'s union / plain-string brand assertions rely on effect 4.0.0's `Schema.brand` typing, so on rc.118 those calls compile and the type gate reports unused `@ts-expect-error`s; and `@effect/docgen` 4.0.6 itself needs a newer `effect`, so at the floor the examples are run without docgen (type-checked under its `examplesCompilerOptions`, executed with `tsx`). Raising the dev pin does not raise the floor, and Dependabot's `effect` group moves only the dev pin, never `catalogs.peers`; lowering the floor, or using an API the floor lacks, means re-running the gates with the catalog pin set to the floor first. Raising the floor is a breaking change.
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consumer owns the singleton. The `effect` override in `pnpm-workspace.yaml` keeps the lint plugin's own `effect` (`@enfect/oxlint` pins 4.1.0) from adding a second copy here.
- **`dist/` is the product.** The package is a `vp pack` (tsdown) library with one bundle per entry point (`.` plus one subpath per module); `exports` points at `dist/`, so `tests/dist-consumer` and docgen consume it the way a consumer does. `tests/dist-consumer` type-checks a fixture against the emitted declarations with `Equals<…>` assertions — a brand that emits as `string` or a signature that emits as `any` fails there, not in an application.
- **`"sideEffects": false` is a claim about `dist/`, and it is load-bearing.** Every emitted `.js` must be pure declarations: no top-level statements with effects, no top-level `await`, no bare imports. That is what lets a consumer's bundler drop what it does not use.
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` as a program and runs it, importing the package by name through `dist/`. An example must be complete, must not use `declare const`, and must not throw. docgen does not compare output: when a change alters what an example prints, update its `// →` comments by hand.
- **Lengths and offsets in `String` / `Str` are bytes**, as in Rust, not UTF-16 code units. A test or example that passes on ASCII alone proves nothing: include multi-byte characters.

## Conventions

- **Effect's style.** Data types are interfaces with a `TypeId`, operations are module-level functions, and multi-argument operations use `dual` so they work both data-first and in `pipe`. Schemas are Effect `Schema`. Pure total functions stay plain functions.
- **Fallible operations return `Effect`** (or `Result` for synchronous allocator primitives); `*Unsafe` variants throw. Index lookups return `Option`. Errors are `Schema.TaggedError<Self, { readonly brand: unique symbol }>()(tag, fields)` classes; no `try`/`catch` (use `Result.try` / `Effect.try`).
- **`Option`, never `T | undefined` / `T | null`** in types — also for internal state — except where the plain nullable is the contract (the tri-state's nullable encoding). That contract is asserted without writing a `| null` union (`NonNullable` / `Extract` in `tests/dist-consumer`), so it needs no `oxlint-disable`.
- **Option objects.** The Schema modules' optional option members are `x?: Option.Option<T>` (owner decision on effect-schema-ext#79): omit the key for the default, pass `Option.some(v)` for a value, and a caller forwarding an optional of its own passes `Option.fromUndefinedOr(x)`; a three-state option is two constructors, not a sentinel (`pagination` / `requiredPagination`). The binary-data modules still take plain optional members (`capacity?: number`); unifying the two is #17.
- **One module per subpath**, Effect's own layout: `src/<Module>.ts` is `@thomasfosterau/effect-utilities/<Module>`. A new module is `src/<Module>.ts`, re-exported as a namespace from `src/index.ts`, and listed in `entries` (package `vite.config.ts`), `exports` (package `package.json`), `.fallowrc.json` `entry`, the module tables in the package `CLAUDE.md` and `README.md` (with a README section), a `tests/<Module>.test.ts`, and a changeset. Before adding one, check that Effect itself does not already provide it; an extension here fills a gap, it does not duplicate `effect`.
- **Every export has a JSDoc block with a one-line summary, `@since` and `@category`; every exported function, schema and error class also has a runnable `@example`** (docgen executes it). Types and plain constants need no example.
- **Exported generics carry explicit return annotations**, so the emitted declarations are the ones written, not the ones inferred.
- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`). `erasableSyntaxOnly` is on, because the apps load TypeScript under Node's strip-only loader: no enums, namespaces or constructor parameter properties.
- **Tests import the package by name** (`tsconfig.test.json` and the vitest alias resolve it to `src/`). `tests/<Module>.test.ts` mirrors its module (a ported one names the app test files it ports); `tests/<Module>.types.ts` holds compile-time assertions (`@ts-expect-error` above a statement that must fail), checked by `tsconfig.test.json`, never executed. Pure tests import from `vite-plus/test` (lint-enforced); effectful ones use `@effect/vitest` (`it.effect`, and `layer(...)` to provide a layer — `Effect.provide` inside a test is `strict-effect-provide`), unwrapping with `Effect.fromResult` / `Effect.fromOption` instead of `getOrThrow`.
- **Lint**: `@enfect/oxlint`'s `recommended` Effect rules and `@effect/tsgo`'s preset, plus Oxlint's `correctness`, `suspicious` and `perf` categories across the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins, and Vite+'s `vite-plus/prefer-vite-plus-imports`, type-aware. Fix a finding in code; a rule is relaxed only in `vite.config.ts`, scoped to the files that need it, with its reason. In particular:
  - Import Effect modules as namespaces from their submodule (`import * as Effect from "effect/Effect"`), with canonical aliases such as `P` (Predicate), `R` (Record), `Eq` (Equal).
  - No `for`/`while`/`do` loops: use typed-array and `Arr` methods (`findIndex` for early exit, `reduce` for folds, `forEach`), `Arr.unfold`, or the `indexed` iterator in `src/internal/iterator.ts` instead of generators. Beware that `Arr.makeBy` and `Arr.range` never return an empty array; use `Array.from({ length }, f)` when the length may be 0.
  - No type assertions (`as T`, other than `as const`): use type guards, `instanceof` checks or better-typed helpers.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`. No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint, type-aware through oxlint-tsgolint; `typeCheck` off, see `vite.config.ts`). `vp run check` — the type gate: the package's `src` under `tsconfig.json`, its tests under `tsconfig.test.json`, and the dist-consumer declaration check (which builds `dist/` first). They are different commands. The gates are Vite Task tasks (root `vite.config.ts` and `vite.package.ts`), cached except `test:coverage`; `package.json` keeps only the release and helper scripts.
- `vp run -r test:unit` — unit tests (pure code; nothing here needs a database, a network or a credential).
- `vp run -r build` — `vp pack` → `dist/`.
- `vp run docgen` — compiles and runs each `@example` against `dist/`, writes the (git-ignored) API reference under `packages/*/docs/`.
- `vp run test:coverage` — the unit suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores.
- `pnpm changeset` — add a changeset (see Branches and pull requests).

Node and pnpm only: no bun, deno, npm, yarn or npx. Invoke everything through `vp` (`vp exec <bin>` for a package binary; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, `pnpm changeset`, and `scripts/release.sh`'s `pnpm pack` + `npm publish` on the release path. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. Parity install: `rm -rf node_modules packages/*/node_modules packages/*/dist tests/*/node_modules coverage && pnpm install --frozen-lockfile` — a warm local tree hides a missing peer; a fresh runner does not.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `vp run docgen`
7. `pnpm audit --audit-level high` (network)
8. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` — without the coverage map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the audit on its own. Fallow's config here is `.fallowrc.json`, not the `fallow.toml` the generated block below names.
9. A changeset for every change to the published package's behaviour.

Steps 2–7 are CI's `ci` job, in its order, on Node 22 and 24 ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

## Branches and pull requests

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. The linked `vp` at `~/.local/bin/vp` re-execs the nearest project-local `node_modules/vite-plus/bin/vp`, so a worktree needs its own `pnpm install` first.
- Every change to the published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` take a `patch` changeset; other docs-only changes (README, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. Publishing is npm trusted publishing (OIDC); there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).
- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Always open a PR** against `trunk` once a commit is pushed. **Watch it to merge or close**: investigate CI failures and review comments as they arrive, and rebase promptly when it goes conflicting. **Keep the PR body current** as the implementation diverges from it; an extraction PR lists which source-app files the package supersedes.
- GitHub writes go to `thomasfosterau/effect-ext` only — never to the owner's other repositories (the consuming apps, the sibling libraries, the archived effect-schema-ext) or upstream projects without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-ext` whenever the cwd might be another checkout. If another repo needs something, say so in the PR body.

## Work tracker

- Issues in `thomasfosterau/effect-ext` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file. Adoption of the Schema modules by each application is tracked in that application's own tracker (from website#2015), blocked on a release of this package; the tracking epic is website#2015, and decisions recorded there override anything older.
- The issue is the spec — read its comments; later comments override the body. Re-verify the issue's code claims against current `trunk` (and, for the Schema modules, the apps' current default branches) before editing.
- Record decisions and findings as comments on the issue they were found working.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.

## Effect

Read the installed package before writing Effect code: `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` (if the pinned version ships them), then the declarations in `node_modules/effect/dist/*.d.ts` and the source in `node_modules/effect/src`. Never guess at an Effect API or pattern. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer range is under `catalogs.peers`.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and puts `vp` (a re-exec shim to the nearest project-local vite-plus), `fallow` and `tsx` on PATH for non-interactive shells. It hydrates no secrets; nothing here needs one, and nothing here can publish.
- Two more hooks run in a session: every Write/Edit/MultiEdit of a `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.css`/`.json`/`.md` file is followed by `vp fmt --write` on that file, and a Bash `git commit` / `git push` first runs `fallow audit` (`.claude/hooks/fallow-gate.sh`), which blocks on a `fail` verdict; it audits against `origin/trunk` (`FALLOW_AUDIT_BASE` overrides) and regenerates a stale coverage map first.
- `.claude/settings.json` should enable the `@enfect/claude` plugin (Effect guidance, skills and post-write pattern checks; marketplace `mpsuesser/enfect`).
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network.

## Documentation surfaces

`README.md` at the root is the landing page; the package `README.md` is the API reference consumers read on npm; doc comments (`@since`, `@category`, `@example`) are the generated reference; the package `CLAUDE.md` carries its modules, terms, invariants and boundary; `CONTRIBUTING.md` carries setup, hooks, CI expectations and individual checks; `PUBLISHING.md` the release flow and its one-time owner setup; `SECURITY.md` vulnerability reporting and the supply-chain rationale. No `docs/` tree is committed (`packages/*/docs/` is docgen output); decisions go in issue comments.

---

<!-- fallow:setup-hooks:start -->

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `[audit] gate = "all"` in `fallow.toml` to gate every finding in changed files.

For non-skill agents, treat the task map below as the local onboarding source: run the listed fallow command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to... | Run |
| --- | --- |
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| find how one module reaches another | `fallow trace --path <from> <to>` (Reports `reachable: false` instead of failing when no import path exists; type-only hops are reported, not skipped.) |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| read a diff before approving it | `fallow review --base <ref> --brief` (orientation, never gates: deterministic and always exit 0, unlike the audit row) |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |

<!-- fallow:setup-hooks:end -->

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+ release. Add a tool name to select part of the graph. For example, run `vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use `vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
