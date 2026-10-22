import effect from "@mpsuesser/oxlint-plugin-effect"
import { defineConfig } from "vite-plus"

export default defineConfig({
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
