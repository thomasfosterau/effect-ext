# AGENTS.md

Guidance for coding agents, and the conventions every contributor follows, in this repository of experimental extensions to Effect (v4). The project overview and the package list are in [README.md](README.md); setup, the git workflow and the commands are in [CONTRIBUTING.md](CONTRIBUTING.md). Claude Code reads this file through [`.claude/CLAUDE.md`](.claude/CLAUDE.md), which adds only Claude-specific guidance. Personal style preferences live in user memory.

There are two families of packages: `@thomasfosterau/effect-ext` (the standard-library extensions, the AI service abstractions and the `./evals` toolkit) and the `@thomasfosterau/effect-ai-<vendor>` providers, whose conventions, which effect-ext's AI and evals modules share, are in [The AI packages](#the-ai-packages).

The Schema modules came from `thomasfosterau/effect-schema-ext`, merged here before either package was published. They serve the website, gardeneria and preferenceflow apps (whose copies are their behavioural spec and test corpus) and back effect-jsonapi and effect-drizzle-ext, so they carry no JSON:API, Drizzle or application vocabulary. In ported comments, `effect-schema-ext#NN` is that repository's tracker and a bare `#NNN` next to an app name is an app issue (website unless stated).

The AI packages came from `thomasfosterau/effect-ai-ext`, merged here with their history after they were published (the providers' changelogs continue). Two of them were then folded into effect-ext before its first release: `@thomasfosterau/effect-ai-ext` became its seven AI modules (`src/<Module>.ts`, one subpath each) and `@thomasfosterau/effect-evals` its `./evals` toolkit (`src/evals/`, the `effect-evals` bin in `bin/`); both 0.5.1 releases are deprecated on npm. In `packages/effect-ai-*`, those effect-ext files (`aiPackages` in the root `vite.config.ts`), `scripts/check-dist.mjs` and the comments that came with them, a bare `#NNN` written before the merge is effect-ai-ext's tracker, unless the comment was itself ported from an application, where it names that app's tracker. New comments cite this repository's issues as `#NNN` and the old tracker as `effect-ai-ext#NNN`.

The web-platform modules came from `thomasfosterau/effect-web`, merged here with their history (#32) and folded into `effect-ext`, one subpath per former entry point (the map is in the package README, under "Moving from effect-web"). Three of its packages had been published (`@thomasfosterau/effect-web`, `-robots`, `-sitemap`, all 0.1.0); they are deprecated in favour of this package. Like the Schema modules, they serve the website, gardeneria and preferenceflow apps, whose copies are their behavioural spec, and carry no application vocabulary. In those modules' files (the `webModules` globs in the root `vite.config.ts`) and in `scripts/generate-language-subtag-registry.mjs`, a bare `#NNN` written before the merge is effect-web's tracker; new comments cite it as `effect-web#NNN`. An invariant id (`CACHE-AUTH-003`) names a rule from the apps' specs, defined for this repository in [SECURITY.md](SECURITY.md#invariant-ids).

The numeric modules came from `thomasfosterau/effect-numeric` and the time modules from `thomasfosterau/effect-time`, each merged here with its history and folded into `effect-ext`, one subpath per module (`effect-numeric/U8` → `U8`; effect-time's modules keep their names). Neither was ever published, so nothing is deprecated, and both repositories are deleted after the merge. Rust's documented semantics are the numeric modules' spec; effect-time's identity re-exports of `effect/Clock` and `effect/DateTime` were dropped, since Effect provides them. Their allowances are scoped per file in the root `vite.config.ts`, and their invariants are in the package `AGENTS.md`.

The packages and their peers are listed in [README.md § Packages](README.md#packages); `tests/dist-consumer` (`@effect-ext/dist-consumer`, private) type-checks a fixture against the emitted `dist/` declarations. Each package's modules, terms, invariants and import boundary are in its own `packages/<name>/AGENTS.md`; read it before touching that package's `src/`.

## Common pitfalls

- **Versions live only in the `pnpm-workspace.yaml` catalog** (`catalogMode: strict` rejects anything else); never edit one in a `package.json`. After editing the catalog, run `pnpm install` and commit `pnpm-lock.yaml` — a stale lockfile fails CI with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `@effect/tsgo`, `@typescript/native` and `vite-plus` move together; read their catalog comments first. Dependabot groups only the lockstep sets: `toolchain` (vite-plus, vitest, `@vitest/*`, `@effect/tsgo`) and `effect` (`effect`, `@effect/*`, `@effect/docgen` included); everything else, the Effect lint plugin `@enfect/oxlint` included, arrives as its own PR. When the new oxlint outruns `@effect/tsgo`'s `components` table the toolchain PR is red until fixed by hand. Dependabot cannot move the npm-alias entries (`vite`, `typescript`, `@typescript/native`), `@effect/platform-node-shared`, the `overrides` literals or the Release job's pinned npm: set those by hand on the matching PR (the list heads `.github/dependabot.yml`). `minimumReleaseAge` holds a new version for 8 hours; Dependabot's `cooldown` (1 day, its smallest unit) is longer, so it never proposes one pnpm would refuse.
- **The Effect line moves as one.** `effect`, `@effect/vitest`, `@effect/ai-anthropic`, `@effect/ai-cloudflare`, `@effect/platform-browser`, `@effect/platform-node` and the transitive `@effect/platform-node-shared` share one exact version in the default catalog. Bump `@effect/platform-node-shared` by hand: only the catalog and `overrides` name it, so Dependabot never proposes it.
- **The `effect` peer floor is a tested claim.** `catalogs.peers.effect` (and the AI packages' `@effect/ai-anthropic` / `@effect/platform-node` peers, on the same floor) is the oldest `effect` every package has been type-checked, tested and had its examples run against: 4.0.0, the first stable release (raised from rc.118 in #30). The range is `^4.0.0` (a caret, per the owner's peer-range policy), as are the other effect-family peers, and it is decided per package: raise a package's range only when its own dependencies require it, in a named catalog of its own (`catalogs.<dependency>-peers`) whose comment names the dependency. One package's do: `effect-ai-cloudflare` peers on `@effect/ai-cloudflare`, whose first release with AI Gateway routing (4.0.6) peers on `effect ^4.0.6`, so its floor is `catalogs.ai-cloudflare-peers.effect` (`^4.0.6`), where its tests' use of the tagged file-data forms effect 4.0.6 added to `Prompt.FilePartEncoded` also type-checks. Raising the dev pin does not raise the floor, and Dependabot's `effect` group moves only the dev pin, never `catalogs.peers`; lowering the floor, or using an API the floor lacks, means re-running the gates with the catalog pin set to the floor first. Raising the floor is a breaking change.
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consumer owns the singleton. The `effect` override in `pnpm-workspace.yaml` keeps the lint plugin's own `effect` (`@enfect/oxlint` pins 4.1.0) from adding a second copy here.
- **`dist/` is the product.** Every package is a `vp pack` (tsdown) library with one bundle per entry point. The two families resolve themselves differently in development (`vite.package.ts` has one factory for each): `effect-ext`'s `exports` point at `dist/`, so `tests/dist-consumer` and docgen consume it the way a consumer does, while the providers develop with `exports` → `./src/index.ts` and `publishConfig` rewrites `exports` / `main` / `types` to `dist/` on publish. A provider resolves effect-ext to its `src/` (tsconfig `paths`, and the test alias in `vite.package.ts`), so its tests and type checks need no build, and `vp run check:dist` is what proves the built entries. `tests/dist-consumer` type-checks a fixture against the emitted declarations with `Equals<…>` assertions — a brand that emits as `string` or a signature that emits as `any` fails there, not in an application.
- **`"sideEffects": false` is a claim about `dist/`, and it is load-bearing.** Every emitted `.js` must be pure declarations: no top-level statements with effects, no top-level `await`, no bare imports. That is what lets a consumer's bundler drop what it does not use.
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` as a program and runs it, importing the package by name through `dist/`. An example must be complete, must not use `declare const`, and must not throw. docgen does not compare output: when a change alters what an example prints, update its `// →` comments by hand.
- **Lengths and offsets in `String` / `Str` are bytes**, as in Rust, not UTF-16 code units. A test or example that passes on ASCII alone proves nothing: include multi-byte characters.

## Conventions

- **Effect's style.** Data types are interfaces with a `TypeId`, operations are module-level functions, and multi-argument operations use `dual` so they work both data-first and in `pipe`. Schemas are Effect `Schema`. Pure total functions stay plain functions.
- **Fallible operations return `Effect`** (or `Result` for synchronous allocator primitives); `*Unsafe` variants throw. Index lookups return `Option`. Errors are `Schema.TaggedError<Self, { readonly brand: unique symbol }>()(tag, fields)` classes; no `try`/`catch` (use `Result.try` / `Effect.try`).
- **`Option`, never `T | undefined` / `T | null`** in types — also for internal state — except where the plain nullable is the contract (the tri-state's nullable encoding). That contract is asserted without writing a `| null` union (`NonNullable` / `Extract` in `tests/dist-consumer`), so it needs no `oxlint-disable`.
- **Option objects.** The Schema modules' optional option members are `x?: Option.Option<T>` (owner decision on effect-schema-ext#79): omit the key for the default, pass `Option.some(v)` for a value, and a caller forwarding an optional of its own passes `Option.fromUndefinedOr(x)`; a three-state option is two constructors, not a sentinel (`pagination` / `requiredPagination`). The binary-data modules still take plain optional members (`capacity?: number`); unifying the two is #17.
- **One module per subpath**, Effect's own layout: `src/<Module>.ts` is `@thomasfosterau/effect-ext/<Module>`, and the evals toolkit's `src/evals/<path>.ts` is `@thomasfosterau/effect-ext/evals/<path>` (its barrel `./evals` stays off the root barrel). A new module is `src/<Module>.ts`, re-exported as a namespace from `src/index.ts`, and listed in `entries` (package `vite.config.ts`), `exports` (package `package.json`), `.fallowrc.json` `entry`, the module tables in the package `AGENTS.md` and `README.md` (with a README section), a `tests/<Module>.test.ts`, and a changeset. Before adding one, check that Effect itself does not already provide it; an extension here fills a gap, it does not duplicate `effect`.
- **The rules in this section are `effect-ext`'s.** The AI packages follow the same Effect style, with the differences listed under [The AI packages](#the-ai-packages). effect-ext's web modules keep effect-web's conventions, which match the AI packages' on option members (`?: T | undefined`) and full-name Effect imports, allow `SAFETY:`-commented type assertions, and run each test's program with `Effect.runPromise`; their relaxations are `webModules` in the root `vite.config.ts`, and unifying them is #31. An optional peer is imported only by the modules that need it, and those modules stay out of the `.` barrel.
- **Every export has a JSDoc block with a one-line summary, `@since` and `@category`; every exported function, schema and error class also has a runnable `@example`** (docgen executes it). Types and plain constants need no example.
- **Exported generics carry explicit return annotations**, so the emitted declarations are the ones written, not the ones inferred.
- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`). `erasableSyntaxOnly` is on, because the apps load TypeScript under Node's strip-only loader: no enums, namespaces or constructor parameter properties.
- **Tests import the package by name** (`tsconfig.test.json` and the vitest alias resolve it to `src/`). `tests/<Module>.test.ts` mirrors its module (a ported one names the app test files it ports); `tests/<Module>.types.ts` holds compile-time assertions (`@ts-expect-error` above a statement that must fail), checked by `tsconfig.test.json`, never executed. Pure tests import from `vite-plus/test` (lint-enforced); effectful ones use `@effect/vitest` (`it.effect`, and `layer(...)` to provide a layer — `Effect.provide` inside a test is `strict-effect-provide`), unwrapping with `Effect.fromResult` / `Effect.fromOption` instead of `getOrThrow`.
- **Lint**: one config for the whole workspace (root `vite.config.ts`); the AI packages' relaxations are a scoped override there, each with its reason. `@enfect/oxlint`'s `recommended` Effect rules and `@effect/tsgo`'s preset, plus Oxlint's `correctness`, `suspicious` and `perf` categories across the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins, and Vite+'s `vite-plus/prefer-vite-plus-imports`, type-aware. Fix a finding in code; a rule is relaxed only in `vite.config.ts`, scoped to the files that need it, with its reason. In particular:
  - Import Effect modules as namespaces from their submodule (`import * as Effect from "effect/Effect"`), with canonical aliases such as `P` (Predicate), `R` (Record), `Eq` (Equal).
  - No `for`/`while`/`do` loops: use typed-array and `Arr` methods (`findIndex` for early exit, `reduce` for folds, `forEach`), `Arr.unfold`, or the `indexed` iterator in `src/internal/iterator.ts` instead of generators. Beware that `Arr.makeBy` and `Arr.range` never return an empty array; use `Array.from({ length }, f)` when the length may be 0.
  - No type assertions (`as T`, other than `as const`): use type guards, `instanceof` checks or better-typed helpers.

## The AI packages

`packages/effect-ai-*`, and effect-ext's AI modules, `src/evals/`, `bin/` and `tests/{ai,evals}/` (`aiPackages` in the root `vite.config.ts`), follow the Conventions above with these differences, which came with them from effect-ai-ext and are kept until someone unifies them deliberately (the follow-up the merge PR names):

- **Upstream boundary.** Write no local package for a provider the Effect org already ships (`@effect/ai-anthropic` today; OpenAI/Google if published); repoint the upstream package instead, as `effect-ai-cloudflare/src/Anthropic.ts` does.
- **`@effect/*` packages a published package needs are peers too** (`catalog:peers`), never exact-pinned dependencies: their own `effect` peer would reject a consumer's older rc.
- **The `apiUrl` override is a contract, not a convenience:** it is how a routing layer (`effect-ai-cloudflare`) repoints a provider's client for BYOK. Every provider has a test that points `apiUrl` at a stub server.
- **Errors leave a provider only as `AiError`.** No transport- or schema-level failure escapes a provider's public surface.
- **A provider-neutral abstraction mirrors `effect/ai`'s `EmbeddingModel`:** a `Context.Service` tag, a `Service` interface, a `make(...)` that validates provider results, a typed `AiError` channel, `Effect.withSpan` telemetry and options/provider-options interfaces. The example is `effect-ext/src/RerankerModel.ts`.
- **A first-party provider mirrors `effect-ai-mistral`:** a `<Vendor>Client` (a `Context.Service` over `HttpClient` with base-URL prefixing, an optional `Redacted` key, and a `make` / `layer` / `layerConfig` triad); per-capability models implementing the relevant `effect/ai` or `effect-ai-ext` service; hand-written request interfaces (plain objects sent as JSON); lenient response decoding (`Schema.optional` + `Schema.NullOr`, free strings for enums the mapper narrows) so a new vendor field never fails an otherwise-valid response; and `internal/errors.ts` mapping `HttpClientError` / `SchemaError` to `AiError` through `AiError.reasonFromHttpStatus`.
- **Option members** are `?: T | undefined` (forwardable under `exactOptionalPropertyTypes`), not `Option` — the #17 unification covers these packages too.
- **Imports and barrels.** Effect modules are imported by their full names (`import * as Option from "effect/Option"`; `effect/prefer-namespace-imports` is off for them). Relative imports are extensionless, except in effect-ext's `src/evals/` (`.ts` extensions, like the rest of effect-ext). Barrels re-export each module as a namespace (`export * as MistralClient from "./MistralClient"`); effect-ai-cloudflare's barrel is flat (`export *` of each module, plus `@effect/ai-cloudflare`'s namespaces) and re-exports no `RerankerModel` name (consumers import it from `@thomasfosterau/effect-ext/RerankerModel`). effect-ext's AI modules are its subpaths directly and namespaces on its barrel, which does not re-export `effect/ai`.
- **Doc comments put the description first**, including module headers (summary sentence, details, then tags), because hovers show only the text before the first tag. The providers carry no `@since` (each provider's `docgen.json` sets `enforceVersion: false`) and `@category` only; effect-ext's AI and evals exports carry `@since`, which its docgen enforces. Every `@example` is compiled and run, so it must run offline: build layers and programs, but don't execute anything that calls a vendor API. Each `docgen.json` maps the package names onto `dist/` through `examplesCompilerOptions.paths`.
- **Tests.** No live-key or live-network tests: stub at `FetchHttpClient.Fetch` (capture the request, return a canned `Response` or SSE stream) or at the abstraction's `make` seam. Effect helpers live per package in `tests/helpers/effect.ts` (effect-ext: `tests/ai/helpers/` and `tests/evals/helpers/`) (`runTest`, `runTestExit`, `expectFailureInstanceOf`, `recordingTracer`); layers are provided per test with `Effect.provide` (so `effecttsgo/strict-effect-provide` is off for these packages). Streaming providers also prove backpressure (a chunked stub, no unbounded buffering) and interruption (interrupting the Effect cancels the in-flight HTTP stream). Tests are type-checked by each package's `tsconfig.test.json` in `vp run check`.
- **Lint.** Oxlint's `suspicious` category runs on these packages as on the rest of the workspace; the rules that fired at the merge were paid down in #24. Two allowances remain, each with its reason in the root `vite.config.ts`: `effecttsgo/strict-effect-provide` (the per-test `Effect.provide` convention under Tests below) and `typescript/no-unnecessary-type-parameters` for the evals suites' `unsafeCoerce<T>` helper.
- **No live credentials, tokens or secrets** in code or fixtures.

## Commands

The commands, and the rule that everything runs through `vp`, are in [CONTRIBUTING.md § Commands](CONTRIBUTING.md#commands).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. Parity install: `rm -rf node_modules packages/*/node_modules packages/*/dist tests/*/node_modules coverage && pnpm install --frozen-lockfile` — a warm local tree hides a missing peer; a fresh runner does not.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r test:coverage` (the coverage floors; also writes the root map step 10 reads)
6. `vp run -r build`
7. `vp run check:dist`
8. `vp run docgen`
9. `pnpm audit --audit-level high` (network)
10. `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` — without the coverage map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the audit on its own. Fallow's config here is `.fallowrc.json`, not the `fallow.toml` the generated block below names.
11. A changeset for every change to a published package's behaviour.

Steps 2–9 are CI's `ci` job, in its order, on Node 22 and 24 ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

Every workflow defaults to `permissions: {}` and locks each action to its commit in `.github/workflows/actions.lock` (exact release tags in `uses:`; the owner generates the lock with `gh actions-lock`, and the `Lockfile` workflow runs `gh actions-lock --verify`). Besides CI and Release, `dependabot-failures.yml` runs every 3 hours (and on dispatch) from `trunk`, never on a PR or Dependabot event: it opens a `dependabot-failure` issue for each open Dependabot PR whose head commit fails a check, updates it when the SHA or the failing checks change, and closes it when the PR passes or merges (completed) or closes unmerged (not planned). Its job holds `contents: read`, `pull-requests: read`, `checks: read`, `statuses: read` and `issues: write`, scoped to issues; it checks out only the default branch and never runs PR code. The logic is `.github/scripts/dependabot-failures.sh`, which `--dry-run` runs locally and read-only (`--repo owner/name`). `auto-assign.yml` assigns the owner to every PR that opens with no assignee (skipping Dependabot's, which `dependabot.yml` assigns); its job holds only `pull-requests: write`, checks nothing out and runs only `gh pr edit`. Beyond Release's, those two are the only write permissions in any workflow. `devcontainer.yml` builds and starts `.devcontainer/` with the devcontainers CLI whenever the container's inputs change (`.devcontainer/**`, the SessionStart hook, `package.json`, `pnpm-workspace.yaml`, the lockfile), and fails on any `[session-start]` failure line or when `vp` (at the catalog pin), `node`, `node_modules`, `gh`, `rg`, `jq` or `claude` is missing in the container: the hook itself never fails.

## Branches and pull requests

The branch model, rebasing and changesets are in [CONTRIBUTING.md § Branches and pull requests](CONTRIBUTING.md#branches-and-pull-requests). On top of them:

- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Always open a PR** against `trunk` once a commit is pushed. **Watch it to merge or close**: investigate CI failures and review comments as they arrive, and rebase promptly when it goes conflicting. **Keep the PR body current** as the implementation diverges from it; an extraction PR lists which source-app files the package supersedes.
- GitHub writes go to `thomasfosterau/effect-ext` only — never to the owner's other repositories (the consuming apps, the sibling libraries, the archived effect-schema-ext, and effect-ai-ext, which this repository supersedes) or upstream projects without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-ext` whenever the cwd might be another checkout. If another repo needs something, say so in the PR body.

## Work tracker

- Issues in `thomasfosterau/effect-ext` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file. Adoption of the Schema modules by each application is tracked in that application's own tracker (from website#2015), blocked on a release of this package; the tracking epic is website#2015, and decisions recorded there override anything older.
- The issue is the spec — read its comments; later comments override the body. Re-verify the issue's code claims against current `trunk` (and, for the Schema modules, the apps' current default branches) before editing.
- Record decisions and findings as comments on the issue they were found working.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.

## Effect

Read the installed package before writing Effect code: `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` (if the pinned version ships them), then the declarations in `node_modules/effect/dist/*.d.ts` and the source in `node_modules/effect/src`. Never guess at an Effect API or pattern. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer range is under `catalogs.peers`.

## Documentation surfaces

`README.md` at the root is the landing page; the package `README.md` is the API reference consumers read on npm; doc comments (`@since`, `@category`, `@example`) are the generated reference; the package `AGENTS.md` carries its modules, terms, invariants and boundary (its `CLAUDE.md` only imports it); this file carries the conventions, gates and agent rules; `CONTRIBUTING.md` carries setup, the branch model, hooks, CI expectations and the commands; `.claude/CLAUDE.md` carries only Claude Code's hooks, plugins and session notes, and imports this file, `CONTRIBUTING.md` and `README.md`; `PUBLISHING.md` the release flow and its one-time owner setup; `SECURITY.md` vulnerability reporting and the supply-chain rationale. No `docs/` tree is committed (`packages/*/docs/` is docgen output); decisions go in issue comments.

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

<!-- Generated by `vp config` (from `pnpm install`), which rewrites this block
     with its own line breaks; the formatter leaves it as written so the two
     never undo each other. -->
<!-- prettier-ignore-start -->
<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
<!-- prettier-ignore-end -->
