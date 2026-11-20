# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents.

## Before changing code

- Read the `AGENTS.md` of each package you touch: it states the boundary and invariants.
- Read the issue you're working on in full, comments included, and re-check its claims against current `trunk`.
- Write idiomatic Effect v4, reading `node_modules/effect` rather than guessing an API. Non-idiomatic code you find outside your change (hand-rolled utilities Effect provides, Promise chains, `null` where `Option` fits) gets an issue listing the sites and the replacement, unless the fix is trivial.

## Pitfalls

- `vp check` (format + lint) and `vp run check` (the type gate) are different commands.
- `vp run docgen` executes every `@example`: each must be a complete program that runs offline, imports what it uses and never uses `declare const`. Docgen doesn't compare output, so update `// →` comments by hand.
- `String` / `Str` lengths and offsets are UTF-8 bytes, as in Rust; test with multi-byte text.
- `Arr.makeBy` and `Arr.range` never return an empty array.
- Publish only through the Release workflow (`vp run release`: `vp pm publish -r`, then `changeset git-tag`). Release-path registry calls go through `vp pm`, never `npm` / `pnpm` directly, and `release` depends only on the build and offline checks (`check:dist`).
- Running every package's type check in parallel can exhaust a small container's memory; if `vp run check` is killed, run it per package (`vp run --filter ./packages/<name> check`).

## Process

- You may open PRs in this repository, and should watch them through CI and review.
- Out-of-scope work you notice: file an issue (search for duplicates first) and move on.
- Use the GitHub MCP tools or `gh`, whichever is available. Write only to `thomasfosterau/effect-ext`; with `gh`, pass `-R thomasfosterau/effect-ext` when the cwd might be another checkout.

## Fallow

The `fallow` agent skill is linked into `.claude/skills/` from the installed `fallow` package after `vp install`; repository-specific rules (the pre-commit audit, tracing before deleting) are in docs/CONTRIBUTING.md.
