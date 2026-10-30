import effect from "@enfect/oxlint"
import { defineConfig } from "vite-plus"

/**
 * What invalidates a cached task: Vite Task's automatic tracking of the files
 * a task reads, minus `node_modules`, plus the lockfile (a dependency bump
 * reruns the type-check, build and tests).
 */
const cacheInputs = [{ auto: true }, "!node_modules/**", "!coverage/**", "pnpm-lock.yaml"]

export default defineConfig({
  // The gates are Vite Task tasks rather than package.json scripts, so they are
  // cached (CI restores `node_modules/.vite/task-cache`) and `vp run check`
  // never collides with the built-in `vp check`.
  run: {
    tasks: {
      // The type gate: the native TypeScript 7 `tsc` over src, test and this config.
      check: {
        command: "tsc --noEmit -p tsconfig.json",
        cache: { input: cacheInputs, output: [] },
      },
      // `vp pack` (tsdown): one ESM bundle + declaration file per `src/*.ts`.
      build: {
        command: "vp pack",
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      "test:unit": {
        command: "vp test run",
        cache: { env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"], input: cacheInputs, output: [] },
      },
      // Uncached: it exists to write `coverage/coverage-final.json`, which the
      // fallow PreToolUse gate reads and never refreshes.
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false,
      },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/*.ts"],
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    sourcemap: true,
    exports: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
    // `vp run test:coverage` writes the Istanbul map `coverage/coverage-final.json`,
    // which `fallow audit` reads for exact per-function CRAP scores
    // (`health.coverage` in .fallowrc.json). Without it fallow scores every
    // function as uncovered.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
  lint: {
    extends: [effect.configs.recommended],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    // Oxlint's own categories on top of the Effect preset: `correctness`
    // (the default), plus `suspicious` and `perf`, at `error` like the preset.
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    // Vite+'s own plugin: `vitest` / `oxlint` imports go through `vite-plus`.
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // `_tag` is Effect's discriminant (tagged errors, Option, Result).
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // `@since` / `@category` are the Effect doc-comment tags AGENTS.md requires.
      "jsdoc/check-tag-names": ["error", { definedTags: ["since", "category"] }],
      // `@effect/vitest`'s `it.effect` is a test block.
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live", "it.scoped", "it.flakyTest"] },
      ],
    },
    ignorePatterns: ["dist/**", "coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**", "coverage/**", "CHANGELOG.md", ".changeset/*.md"],
    semi: false,
    printWidth: 100,
    sortPackageJson: true,
  },
})
