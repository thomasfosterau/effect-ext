/**
 * Root workspace config: the repo-wide fmt / lint / staged passes and the root
 * `check`, `docgen` and `test:coverage` aggregates. Per-package tasks come
 * from `vite.package.ts`.
 *
 * @copyright Thomas Foster
 */

import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**"],
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      "eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "eslint/prefer-const": "warn",
      // The `Buffer` global is typed `any` wherever a consumer loads
      // @cloudflare/workers-types next to @types/node (every application this
      // library serves), so every call on it is unchecked there. Use
      // Uint8Array / TextEncoder / DataView instead.
      "eslint/no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The `Buffer` global is typed `any` wherever @cloudflare/workers-types is loaded. Use Uint8Array / TextEncoder / DataView.",
        },
      ],
      // docgen's own tags: every export carries `@since` and `@category`
      // (AGENTS.md), and module headers `@module` / `@copyright`.
      "jsdoc/check-tag-names": [
        "error",
        { definedTags: ["since", "category", "module", "copyright"] },
      ],
      // `_tag` is Effect's discriminant, read on every tagged value.
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // `@effect/vitest`'s `it.effect` is a test block, and so is `arena.effect`:
      // the tests that run inside `layer(Allocator.layerArena(n))` name its
      // handle `arena` so it does not shadow `it` (`eslint/no-shadow`).
      "vitest/no-standalone-expect": [
        "error",
        {
          additionalTestBlockFunctions: [
            "it.effect",
            "it.live",
            "it.scoped",
            "it.flakyTest",
            "arena.effect",
          ],
        },
      ],
      // Every assertion is already gated twice, by `effect/casting-awareness`
      // (an error on each `as` other than `as const`) and by
      // `effect/require-safety-comment-for-type-assertion` (a `SAFETY:`
      // invariant above it); `src/` has none left.
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // `@effect/vitest` is Effect's own test runner, released in lockstep
      // with `effect` and pinned exactly beside it in the catalog, so an
      // "unstable" break arrives in the `effect` Dependabot PR and fails
      // there. Every `it.effect` call would otherwise warn.
      {
        files: ["packages/*/tests/**"],
        rules: {
          "effecttsgo/unstable-api-usage": "off",
        },
      },
      // `String.make()` / `String.makeScoped()` mirror Rust's `String::new()`,
      // and a thunk keeps module evaluation free of top-level calls, which
      // `"sideEffects": false` claims of `dist/` (a constant would be one).
      {
        files: ["packages/effect-utilities/src/String.ts"],
        rules: {
          "effecttsgo/lazy-effect": "off",
        },
      },
      // `AllocationError` echoes the caller's `size` / `align` back, including
      // the NaN or Infinity it was rejected for ("size must be a non-negative
      // integer"), so its fields are `Schema.Number` on purpose: `Finite`
      // would fail to construct the very error that reports them.
      {
        files: ["packages/effect-utilities/src/Allocator.ts"],
        rules: {
          "effecttsgo/schema-number": "off",
        },
      },
      // Vite evaluates a config module synchronously in bare Node, before any
      // Effect runtime exists, so the config IS the run boundary: reading
      // `VITEST_MAX_WORKERS` through `Config` has to run there.
      {
        files: ["vite.package.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
        },
      },
      // Type-level tests: the expect-error directives ARE the assertions
      // (a statement that must fail to compile), and every binding exists to
      // be asserted against, never to be read.
      {
        files: ["**/tests/**/*.types.ts", "tests/dist-consumer/src/*.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          // An expect-error directive above a statement that must fail to
          // compile is the assertion itself (AGENTS.md), so this rule cannot
          // apply here.
          "effect/avoid-ts-ignore": "off",
          // `Equals<A, B>` compares `<X>() => X extends A ? 1 : 2` with its
          // twin: each `X` is used once by design, it is the standard exact
          // type-equality idiom.
          "typescript/no-unnecessary-type-parameters": "off",
          // `typeof X.Type` is the subject under test here: the assertion is
          // that the schema's decoded type survives (declaration emit), so
          // swapping in the exported alias would test the alias instead.
          "effecttsgo/unnecessary-typeof-type": "off",
        },
      },
      // The dist-consumer fixture resolves the package to its EMITTED
      // `dist/` declarations, which `vp check` does not build first: before a
      // build every imported type is `any`, so this union rule misreads the
      // assertions. `vp run check` (which builds) is that fixture's gate.
      {
        files: ["tests/dist-consumer/**"],
        rules: {
          "typescript/no-redundant-type-constituents": "off",
        },
      },
    ],
    // Type-aware rules on (oxlint-tsgolint, Effect-patched by `prepare`).
    // tsgolint reads each file's nearest tsconfig.json, so the package's
    // tests have `tests/tsconfig.json` (extending tsconfig.test.json).
    // `typeCheck` stays off, measured 2026-10-30: on a clean tree (CI runs
    // `vp check` before the build) it reports 10 false TS errors in
    // `tests/dist-consumer`, whose fixture resolves the package to its
    // not-yet-built `dist/` declarations (0 errors once `dist/` exists), and
    // `src` + tests already pass the Effect-patched `tsc` in `vp run check`,
    // which also builds and checks that fixture.
    options: {
      typeAware: true,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  run: {
    tasks: {
      // The CI typecheck gate, as one task: the package's `check` (`src`
      // under tsconfig.json, the type-level tests under tsconfig.test.json),
      // plus the dist-consumer check that type-checks a consumer fixture
      // against the EMITTED declarations (a brand that degrades to `string`,
      // or a codec that emits as `any`, only shows up there). A pure graph
      // node; a new package adds itself here and to `docgen` below.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: [
          "@thomasfosterau/effect-utilities#check",
          "@effect-utilities/dist-consumer#check",
        ],
        cache: false,
      },
      // Every package's docgen: compiles AND RUNS each JSDoc `@example`
      // against the built `dist/`, then writes the API reference under that
      // package's (git-ignored) `docs/`. Same pure-graph-node shape.
      docgen: {
        command: "echo 'docgen: every example compiled and ran'",
        dependsOn: ["@thomasfosterau/effect-utilities#docgen"],
        cache: false,
      },
      // Every package's unit suite under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse hook
      // `.claude/hooks/fallow-gate.sh` runs the audit on `git commit` /
      // `git push`).
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
    },
  },
  test: {
    // One entry per package: each package's own vite.config.ts is a vitest
    // project, so the root run and the root coverage map cover them all.
    projects: ["packages/*/vite.config.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
