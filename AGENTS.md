# AGENTS.md

`CLAUDE.md` is a symlink to this file. Project conventions live here; personal style preferences live in user memory.

This repo publishes `effect-ext`: experimental extensions to the Effect (v4) standard library, as a single package at the repository root. Each `src/<Module>.ts` is a public entry point (`effect-ext/<Module>`), re-exported as a namespace from `src/index.ts`.

| Module           | Entry                       | What it is                                                                                               |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Allocator`      | `effect-ext/Allocator`      | An `Allocator` service (a `Context.Reference`) handing out `ArrayBuffer` blocks: heap, arena and tracked |
| `Layout`         | `effect-ext/Layout`         | Binary layouts (`u8` … `f64`, `bool`, structs, fixed arrays) with C-like alignment                       |
| `BufferStruct`   | `effect-ext/BufferStruct`   | Structs whose fields live in an `ArrayBuffer`, exposed as ordinary properties                            |
| `Vec`            | `effect-ext/Vec`            | A growable, `ArrayBuffer`-backed array, like Rust's `Vec<T>`                                             |
| `StructOfArrays` | `effect-ext/StructOfArrays` | A growable struct-of-arrays container with typed-array columns                                           |
| `String`         | `effect-ext/String`         | A growable, Allocator-backed UTF-8 string, like Rust's `String`                                          |
| `Str`            | `effect-ext/Str`            | An immutable UTF-8 string slice, like Rust's `str`; usable as a `HashMap` key                            |

Shared internals live in `src/internal/`: `bytes.ts` (a growable byte buffer), `iterator.ts` (the `indexed` iterator) and `utf8.ts` (the byte-level UTF-8 algorithms behind `String` and `Str`). They are not entry points.

A new module adds a row here and in `README.md`, an `export * as` line in `src/index.ts`, an `exports` entry in `package.json` (`vp pack` builds every `src/*.ts`), a `test/<Module>.test.ts` and a changeset.

## Common pitfalls

- **Never edit a version in `package.json`.** Versions live in the `pnpm-workspace.yaml` catalog (`catalogMode: strict` rejects anything else); the published peer range is under `catalogs.peers`. After editing the catalog, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `vite-plus`, `vite`, `vitest`, `@vitest/*` and `@enfect/oxlint` move together; Dependabot's `toolchain` group bumps them as one PR, except the `vite` npm alias (`npm:@voidzero-dev/vite-plus-core@<v>`, equal to `vite-plus`), which Dependabot cannot bump: set it by hand in that PR, or run `pnpm exec vp migrate`. `minimumReleaseAge` holds new versions for 8 hours (480 minutes); Dependabot's cooldown is 1 day.
- **`dist/` is the product.** The package is a `vp pack` (tsdown) library with one bundle per `src/*.ts`; `exports` points at `dist/`.
- **`"sideEffects": false` is a claim about `dist/`, and it is load-bearing.** Every emitted `.mjs` must be pure declarations: no top-level statements, no top-level `await`, no bare imports.
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consumer owns the singleton. The `effect` override in `pnpm-workspace.yaml` keeps the lint plugin's own `effect` (`@enfect/oxlint` pins 4.1.0) from adding a second copy here.
- **Lengths and offsets in `String` / `Str` are bytes**, as in Rust, not UTF-16 code units. A test that passes on ASCII alone proves nothing: include multi-byte characters.

## Conventions

- Follow Effect's style: data types are interfaces with a `TypeId`, operations are module-level functions, and multi-argument operations use `dual` so they work both data-first and in `pipe`.
- Fallible operations return `Effect` (or `Result` for synchronous allocator primitives); `*Unsafe` variants throw. Index lookups return `Option`.
- Every export gets a JSDoc block with `@since` and `@category`.
- Relative imports carry their `.ts` extension (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- Tests live in `test/` and use `@effect/vitest` (`it.effect` for effectful tests).
- `String` and `Str` mirror Rust's `String` and `str`: use Rust's method names in camelCase (`splitOnce`, `trimStartMatches`, `charIndices`, …) and Rust's semantics, including byte offsets/lengths and Rust's pattern behaviour (an empty pattern matches at every character boundary). Functions on a `String` that would return `&str` in Rust return a `Str` copy. The byte-level algorithms shared by both live in `src/internal/utf8.ts`; test against the examples in Rust's documentation where possible.
- Linting uses `@enfect/oxlint` (`configs.recommended`, every `effect/*` rule at `error`, anti-slop included) plus Oxlint's `correctness`, `suspicious` and `perf` categories, the `typescript`, `unicorn`, `oxc`, `import`, `promise`, `vitest` and `jsdoc` plugins, and Vite+'s `vite-plus/prefer-vite-plus-imports`, type-aware, with no rules disabled (`vite.config.ts` only configures options: `_tag` for `no-underscore-dangle`, `@since` / `@category` for `jsdoc/check-tag-names`, `it.effect` for `vitest/no-standalone-expect`). In particular:
  - Import Effect modules as namespaces from their submodule (`import * as Effect from "effect/Effect"`), with canonical aliases such as `P` (Predicate), `R` (Record), `Eq` (Equal).
  - No `for`/`while`/`do` loops: use typed-array and `Arr` methods (`findIndex` for early exit, `reduce` for folds, `forEach`), `Arr.unfold`, or the `indexed` iterator in `src/internal/iterator.ts` instead of generators. Beware that `Arr.makeBy` and `Arr.range` never return an empty array; use `Array.from({ length }, f)` when the length may be 0.
  - No `T | undefined` / `T | null` in types: use `Option` (also for internal state), and plain optional properties (`capacity?: number`) for options.
  - No type assertions (`as T`, other than `as const`): use type guards, `instanceof` checks or better-typed helpers.
  - Errors are `Schema.TaggedError` classes; no `try`/`catch` (use `Result.try` / `Effect.try`).
  - In tests, run effectful code with `it.effect` and unwrap with `Effect.fromResult` / `Effect.fromOption` instead of `getOrThrow`.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files). No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint, type-aware). `vp run check` — the type gate (`tsc --noEmit`). They are different commands. The gates (`check`, `build`, `test:unit`, `test:coverage`) are Vite Task tasks in `vite.config.ts`, cached except `test:coverage`; `package.json` keeps only the release and helper scripts.
- `vp run -r test:unit` — unit tests.
- `vp run -r build` — `vp pack` → `dist/`.
- `vp run test:coverage` — the unit suite under an Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores. Without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, and `pnpm changeset` / `pnpm publish` on the release path. This repo runs on Node and pnpm only: never bun, npm, yarn or npx. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules dist coverage && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `pnpm audit --audit-level high` (network)
7. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step). The PreToolUse fallow gate audits against `coverage/coverage-final.json` and never refreshes it, so run `test:coverage` first.

Steps 2–6 are CI's `ci` job, in its order, on Node 22 and 24 ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

## Branches and pull requests

- Branch off `trunk` (the default branch); PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. A worktree needs its own `pnpm install`.
- Every change to the published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` take a `patch` changeset; other docs-only changes (README, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).
- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Always open a PR** against `trunk` once a commit is pushed. **Watch it to merge or close**: investigate CI failures and review comments as they arrive, and rebase promptly when it goes conflicting. **Keep the PR body current** as the implementation diverges from it.
- GitHub writes go to `thomasfosterau/effect-ext` only — never to the owner's other repositories or upstream projects without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-ext` whenever the cwd might be another checkout. If another repo needs something, say so in the PR body.

## Work tracker

- Issues in `thomasfosterau/effect-ext` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. Re-verify the issue's code claims against current `trunk` before editing.
- Record decisions and findings as comments on the issue they were found working.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.

## Effect

Read the installed package before writing Effect code: `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` (if the pinned version ships them), then `node_modules/effect/dist/*.d.ts` and `node_modules/effect/src` for the exact API. Never guess at an Effect API or pattern.

- The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer range is under `catalogs.peers`. Raising the floor is a breaking change.
- Tagged errors are `Schema.TaggedError<Self>()(tag, fields)` classes.
- Before adding a module, check that Effect itself does not already provide it; an extension here should fill a gap, not duplicate `effect`.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`) and `fallow` on PATH for non-interactive shells. It hydrates no secrets; none are needed, and nothing here can publish.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- `.claude/settings.json` should enable the `@enfect/claude` plugin (Effect guidance, skills and post-write pattern checks; marketplace `mpsuesser/enfect`).
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network.

## Documentation surfaces

`README.md` is the landing page and the API overview consumers read on npm; doc comments (`@since`, `@category`) are the API reference; `CONTRIBUTING.md` carries human setup, CI expectations and single-check commands; `PUBLISHING.md` the release pipeline and its one-time owner setup; `SECURITY.md` the reporting channel and supply-chain posture. No `docs/` tree is committed; decisions go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base <ref>`                  |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |

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
