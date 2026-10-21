# effect-ext

Experimental extensions to the Effect (v4) standard library, published as the single package
`effect-ext`. Each `src/<Module>.ts` is a public entry point (`effect-ext/<Module>`), re-exported as a
namespace from `src/index.ts`.

## Conventions

- Follow Effect's style: data types are interfaces with a `TypeId`, operations are module-level
  functions, and multi-argument operations use `dual` so they work both data-first and in `pipe`.
- Fallible operations return `Effect` (or `Result` for synchronous allocator primitives); `*Unsafe`
  variants throw. Index lookups return `Option`.
- Every export gets a JSDoc block with `@since` and `@category`.
- Tests live in `test/` and use `@effect/vitest` (`it.effect` for effectful tests).
- Linting uses `@mpsuesser/oxlint-plugin-effect` (recommended preset, configured in
  `vite.config.ts`). In particular: import Effect modules as namespaces from their submodule
  (`import * as Effect from "effect/Effect"`, with canonical aliases such as `P` for
  `effect/Predicate`, `R` for `effect/Record`, `Eq` for `effect/Equal`), define errors with
  `Schema.TaggedError`, and justify every type assertion with a `// SAFETY:` comment.
  `imperative-loops` and `prefer-option-over-null` are disabled because hot paths need plain loops
  and allocation-free internal state; see the comments in `vite.config.ts`.
- Add a changeset (`vp run changeset`) for any user-facing change.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

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
