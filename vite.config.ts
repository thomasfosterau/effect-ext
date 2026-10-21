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
  },
  lint: {
    extends: [effect.configs.recommended],
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // This package implements low-level, allocation-sensitive data structures
      // over ArrayBuffers. A few Effect-first rules target application code and
      // conflict with that, so they are disabled here:
      // - Byte-level hot paths (UTF-8 validation, copying, struct field access)
      //   need plain loops; `Arr.*` combinators allocate per call.
      "effect/imperative-loops": "off",
      // - Internal mutable state (e.g. `block: Block | undefined`) and optional
      //   option-bag fields follow Effect's own `| undefined` convention;
      //   wrapping them in `Option` would allocate on every access.
      "effect/prefer-option-over-null": "off",
      // - Assertions are allowed when justified: every one must carry a
      //   `// SAFETY:` comment (enforced by
      //   `effect/require-safety-comment-for-type-assertion`).
      "effect/casting-awareness": "off",
    },
    overrides: [
      {
        files: ["test/**"],
        rules: {
          // Unwrapping known-good values is the point of many assertions.
          "effect/avoid-option-getorthrow": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: ["dist/**", "CHANGELOG.md", ".changeset/*.md"],
    semi: false,
    printWidth: 100,
    sortPackageJson: true,
  },
})
