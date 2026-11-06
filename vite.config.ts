/**
 * Root workspace config: the repo-wide fmt / lint / staged passes and the root
 * `check`, `docgen`, `check:dist` and `test:coverage` aggregates. Every
 * package's own tasks come from `vite.package.ts`; this file compiles
 * nothing, but a new package adds itself to the aggregate lists below and to
 * `coverageFloors`.
 *
 * The lint config is one rule set for the whole workspace. The `effect-ai-*`
 * family and `effect-evals` (merged in from thomasfosterau/effect-ai-ext)
 * came with a looser one: their relaxations are scoped to `aiPackages` in
 * `overrides` below, each with its reason, so `effect-utilities` keeps the
 * stricter set. The same holds for the effect-utilities modules merged in
 * from thomasfosterau/effect-web (`webModules`), scoped to their files.
 *
 * @copyright Thomas Foster
 */

import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import { type CoverageFloor, resolveCoverageThresholds } from "./vite.package.ts";
import { coverageFloor as cohereFloor } from "./packages/effect-ai-cohere/vite.config.ts";
import { coverageFloor as elevenlabsFloor } from "./packages/effect-ai-elevenlabs/vite.config.ts";
import { coverageFloor as aiExtFloor } from "./packages/effect-ai-ext/vite.config.ts";
import { coverageFloor as gatewayFloor } from "./packages/effect-ai-gateway/vite.config.ts";
import { coverageFloor as mistralFloor } from "./packages/effect-ai-mistral/vite.config.ts";
import { coverageFloor as voyageFloor } from "./packages/effect-ai-voyage/vite.config.ts";
import { coverageFloor as evalsFloor } from "./packages/effect-evals/vite.config.ts";
import { coverageFloor as utilitiesFloor } from "./packages/effect-utilities/vite.config.ts";

/**
 * Each package's coverage ratchet, keyed by its directory. The floors live
 * next to each package's config; listing them here makes the root
 * `test:coverage` run enforce them package by package, as glob thresholds,
 * because Vitest reads `coverage` from the root config only and ignores the
 * projects' own.
 */
const coverageFloors = {
  "effect-ai-cohere": cohereFloor,
  "effect-ai-elevenlabs": elevenlabsFloor,
  "effect-ai-ext": aiExtFloor,
  "effect-ai-gateway": gatewayFloor,
  "effect-ai-mistral": mistralFloor,
  "effect-ai-voyage": voyageFloor,
  "effect-evals": evalsFloor,
  "effect-utilities": utilitiesFloor,
} satisfies Readonly<Record<string, CoverageFloor>>;

/** The packages that came from thomasfosterau/effect-ai-ext (see the header). */
const aiPackages = ["packages/effect-ai-*/**", "packages/effect-evals/**"];

/**
 * The effect-utilities modules that came from thomasfosterau/effect-web (see
 * the header): their subpath files, the directories behind them and their
 * tests.
 */
const webDirs =
  "{browser,browser-testing,css,encoding,json-feed,langtag,mime,observability,uri-template,web}";
const webTests =
  "packages/effect-utilities/tests/{atom-feed,css,encoding,json-feed,langtag,mime,robots,rss-feed,sitemap,uri-template,web}/**";
const webModules = [
  "packages/effect-utilities/src/{AtomFeed,Browser,BrowserTesting,Css,Encoding,EncodingBig5,EncodingEucKr,EncodingGb18030,EncodingJapanese,JsonFeed,Langtag,LangtagRegistry,Mime,Negotiate,Net,Observability,Robots,RssFeed,ServiceWorker,Sitemap,UriTemplate,Web}.ts",
  `packages/effect-utilities/src/${webDirs}/**`,
  `packages/effect-utilities/src/internal/${webDirs}/**`,
  "packages/effect-utilities/src/internal/xml.ts",
  webTests,
];

/** Every package name, for the root aggregates. */
const packageNames = [
  "@thomasfosterau/effect-ai-cohere",
  "@thomasfosterau/effect-ai-elevenlabs",
  "@thomasfosterau/effect-ai-ext",
  "@thomasfosterau/effect-ai-gateway",
  "@thomasfosterau/effect-ai-mistral",
  "@thomasfosterau/effect-ai-voyage",
  "@thomasfosterau/effect-evals",
  "@thomasfosterau/effect-utilities",
];

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },
  fmt: {
    // CHANGELOG.md files are written by `changeset version` and never
    // hand-edited, so the formatter leaves them as Changesets wrote them.
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/CHANGELOG.md"],
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
      // docgen's own tags: every `effect-utilities` export carries `@since`
      // and `@category` (AGENTS.md), and module headers `@module` /
      // `@copyright`. The AI packages use `@category` only.
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
      // Each AI package's `tests/helpers/effect.ts` asserts a typed failure
      // through `expectFailureInstanceOf`, and `node:assert` is used too.
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "expect*",
            "assert",
            "assert*",
            "expectFailureInstanceOf",
          ],
        },
      ],
      // `expect(value, message)`: Vitest's second argument labels a failure.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
    overrides: [
      // ---- The AI packages: the rule set they arrived with ----
      {
        files: aiPackages,
        rules: {
          // `casting-awareness` is an awareness prompt, not a defect rule — it
          // fires on every `as`, including the narrowings the Fetch / Workers
          // types structurally require. Stays visible as a warning.
          "effect/casting-awareness": "warn",
          // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options; the
          // AI packages use the full-name convention (`import * as Option from
          // "effect/Option"`) they share with their consumers.
          "effect/prefer-namespace-imports": "off",
          // `prefer-option-over-null` also fires on `?: T | undefined`, the
          // ONLY spelling of an optional member `exactOptionalPropertyTypes`
          // lets a caller forward an optional of its own into. A bare `null` /
          // `undefined` in a return type is still a finding to read.
          "effect/prefer-option-over-null": "warn",
          // `unknown` is the honest type at the boundaries these libraries sit
          // on: a caught failure handed to an error tracker or a log line, and
          // the free-form fields of a structured log event.
          "effect/no-unknown-parameters": "warn",
          "effect/no-unsafe-dictionary-type": "warn",
          "effect/no-runtime-typeof": "warn",
          // Spreading into a fresh object or array inside `map` is how this
          // family builds immutable values (a `readonly` embedding copied into
          // a mutable result); mutating in place would break the readonly
          // types the rule's fix needs.
          "oxc/no-map-spread": "off",
          // Effect 4 marks much of its surface `@stability unstable` (the
          // `effect/http*` modules, `AiError`, ...), so this fires on ~900
          // uses across the providers and drowns the findings that matter. The
          // language service keeps it as an editor suggestion
          // (tsconfig.base.json).
          "effecttsgo/unstable-api-usage": "off",
          // Oxlint's `suspicious` category, which effect-ext enables and the
          // AI packages arrived without (effect-ai-ext#161). Each rule below
          // fired on them at the merge; paying them down, and deleting each
          // line here as it reaches zero, is #24.
          // The AI suites provide layers per test with `Effect.provide`
          // (AGENTS.md → Tests), not `@effect/vitest`'s `layer(...)`.
          "effecttsgo/strict-effect-provide": "off",
          "typescript/no-unnecessary-type-arguments": "off",
          "typescript/no-unnecessary-type-conversion": "off",
          "typescript/no-unnecessary-type-assertion": "off",
          "typescript/no-unnecessary-type-parameters": "off",
          "typescript/consistent-return": "off",
          "unicorn/consistent-function-scoping": "off",
          "eslint/no-shadow": "off",
          "promise/always-return": "off",
        },
      },
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The same holds for the
      // other plain-Node files: the dist guard under `scripts/`, the
      // `effect-evals` bin launcher and its module-resolution hook
      // (`loader.mjs`), which run before the CLI's Effect runtime exists, and
      // the loader test fixtures that stand in for a consumer's plain modules.
      {
        files: [
          "scripts/**",
          "packages/effect-evals/bin/**",
          "packages/effect-evals/src/cli/loader.mjs",
          "packages/effect-evals/tests/fixtures/loader/**",
        ],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/avoid-process-env": "off",
          // Plain Node: native loops, `.length` and `Object.fromEntries` are
          // the idiom.
          "effect/imperative-loops": "off",
          "effect/no-length-comparison": "off",
          "effect/prefer-arr-match": "off",
          "effect/avoid-native-object-helpers": "off",
          "effect/use-console-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/avoid-native-fetch": "off",
          "effect/effect-promise-vs-trypromise": "off",
          // Plain Node again: `child_process` / `os` / `try`-`catch` / a native
          // `.sort()` are what is available without an Effect runtime, and
          // `makeDistResolve` is a hook factory, not an Effect service.
          "effect/use-command-executor-service": "off",
          "effect/use-temp-file-scoped": "off",
          "effect/avoid-try-catch": "off",
          "effect/prefer-arr-sort": "off",
          "effect/no-service-constructor-imports": "off",
          "effect/no-conditional-empty-object-spread": "off",
          // No Schema or tagged-error runtime is loaded here: the dist guard
          // reports through a thrown `Error` and reads `package.json` and
          // `tsc`'s output with `JSON.parse`, as plain Node does.
          "effect/avoid-untagged-errors": "off",
          "effect/avoid-direct-json": "off",
          // The dist guard imports each entry in turn so its report reads in
          // order and one failing import is attributed to its specifier.
          "eslint/no-await-in-loop": "off",
          // `flatMap` over a fresh spread of two diagnostic arrays, not an
          // element modified in place.
          "oxc/no-map-spread": "off",
        },
      },
      // Each AI package's `tests/helpers/effect.ts` IS the test harness
      // boundary `effect-run-in-body` names as the place to run an Effect
      // (`runTest` wraps `Effect.runPromise`), and its recording tracer must
      // hand Effect a mutable native `Map`: `Tracer.Span.attributes` is a
      // `ReadonlyMap` the span's own `attribute(key, value)` writes through.
      {
        files: ["packages/*/tests/helpers/effect.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
          "effect/avoid-native-object-helpers": "off",
        },
      },
      // The bin and loader tests spawn the real plain-Node launcher and
      // resolution hook as a child `node` with the bin's own flags, in a
      // scratch package they lay out on disk: what they assert is Node's own
      // process behaviour (argv, stderr warnings), which only the Node APIs
      // reproduce.
      {
        files: [
          "packages/effect-evals/tests/cli/bin.test.ts",
          "packages/effect-evals/tests/cli/loader.test.ts",
        ],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/use-command-executor-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/use-temp-file-scoped": "off",
        },
      },
      // `cli/Discover` globs with Node's `fs.promises.glob`: effect's
      // `FileSystem` has no glob (its paths go through the `Path` service).
      {
        files: ["packages/effect-evals/src/cli/Discover.ts"],
        rules: {
          "effect/use-filesystem-service": "off",
        },
      },
      // `Cache.hashKey` canonicalises native `Map` / `Set` inputs (a golden
      // is any user value), so its tests must build native ones: a `HashMap`
      // would test a different input and break the pinned digest.
      {
        files: ["packages/effect-evals/tests/cache.test.ts"],
        rules: {
          "effect/avoid-native-object-helpers": "off",
        },
      },
      // `jsonValidity` reports `JSON.parse`'s own `SyntaxError` message as its
      // reason (the user-facing point of the scorer); Schema's JSON codec
      // discards that cause for a generic "a valid JSON string" issue.
      // Its `Effect.try` necessarily carries `JSON.parse`'s thrown value as
      // `unknown` until `catchIf(isSyntaxError, …)` narrows it out and the
      // remainder dies, so `any-unknown-in-error-context` cannot apply.
      {
        files: ["packages/effect-evals/src/scorers/JsonValidity.ts"],
        rules: {
          "effect/avoid-direct-json": "off",
          "effecttsgo/any-unknown-in-error-context": "off",
        },
      },
      // `Cache.hashKey` hands `crypto.subtle.digest`'s rejection on as
      // `unknown` for one step before `Effect.orDie` turns it into a defect
      // (SHA-256 over bytes cannot fail); a typed error would name a failure
      // no caller can see.
      {
        files: ["packages/effect-evals/src/Cache.ts"],
        rules: {
          "effecttsgo/any-unknown-in-error-context": "off",
        },
      },
      // `cli/Run` builds a user eval file's exported `layer`, whose error and
      // services are whatever that file declares (`Layer.Layer<R, unknown>`):
      // the CLI cannot name them, and every failure is reported, not typed.
      {
        files: ["packages/effect-evals/src/cli/Run.ts"],
        rules: {
          "effecttsgo/any-unknown-in-error-context": "off",
        },
      },
      // The AI packages' test fixtures are the seams under test, not domain
      // code: a wall-clock `Date` standing in for a publication stamp, a `CI`
      // variable toggled to drive a reporter, or a single type assertion
      // that narrows a stub or a decoded fixture. Each stays visible as a
      // warning, because a fixture cannot be written another way.
      {
        files: ["packages/effect-ai-*/tests/**/*.ts", "packages/effect-evals/tests/**/*.ts"],
        rules: {
          "effect/require-safety-comment-for-type-assertion": "warn",
          "effect/use-clock-service": "warn",
          "effect/avoid-process-env": "warn",
          "effect/require-effect-concurrency": "warn",
        },
      },
      // ---- effect-utilities' web modules: the rule set they arrived with ----
      // Merged in from thomasfosterau/effect-web, whose own lint config these
      // lines carry over unchanged (its reasons, abridged). Unifying them
      // with the rest of effect-utilities (`Option` members, the `P` / `R`
      // aliases, no assertions) is #31; delete each line as it reaches zero.
      {
        files: webModules,
        rules: {
          // Full-name Effect imports (`import * as Predicate`), the convention
          // effect-web shares with its consumers; the rule has no options.
          "effect/prefer-namespace-imports": "off",
          // Fires on `?: T | undefined`, the only optional-member spelling
          // a caller can forward an optional of its own into under
          // `exactOptionalPropertyTypes`.
          "effect/prefer-option-over-null": "warn",
          // Narrowings the Fetch / DOM types structurally require; each
          // assertion carries a `SAFETY:` comment.
          "effect/casting-awareness": "warn",
          // `unknown` is the honest type of a caught failure handed to a log
          // line (`describeError`) and of a structured log event's fields.
          "effect/no-unknown-parameters": "warn",
          "effect/no-unsafe-dictionary-type": "warn",
          // The `effect/http*` modules are marked unstable throughout
          // Effect 4; the feeds, sitemap and request policies are built on them.
          "effecttsgo/unstable-api-usage": "off",
          // Immutable updates in `map` / `reduce`; the fix is mutation.
          "oxc/no-map-spread": "off",
          "oxc/no-accumulating-spread": "warn",
          // `BroadcastChannel.postMessage` takes no `targetOrigin`.
          "unicorn/require-post-message-target-origin": "off",
          // The in-memory Web Locks double mirrors the platform's promise
          // plumbing: its `then` callbacks return nothing on purpose.
          "promise/always-return": "off",
          "promise/no-callback-in-promise": "off",
          // A thrown decode error's text is Effect's rendering, not a contract.
          "vitest/require-to-throw-message": "off",
          // Misreads an exhaustive `switch` over a union as a missing return.
          "typescript/consistent-return": "off",
          // `describeError`'s documented last resort stringifies an object.
          "typescript/no-base-to-string": "warn",
          // effect-web's adoption allowances for the `suspicious` category
          // (48, 41 and 19 sites), each a pay-down item in #31.
          "eslint/no-shadow": "warn",
          "unicorn/consistent-function-scoping": "warn",
          "unicorn/prefer-set-has": "warn",
        },
      },
      // `logStructured` is called from plain code and runs its effect with
      // `Effect.runSync`: it IS the entry point, where providing the JSON
      // logger belongs.
      {
        files: ["packages/effect-utilities/src/Observability.ts"],
        rules: {
          "effecttsgo/strict-effect-provide": "off",
        },
      },
      // `fetchListener`'s route table is a heterogeneous tuple of
      // `Route<unknown, any>`: a matched handler's failure is `unknown` (a
      // rejection is what `respondWith` turns into a network error).
      {
        files: ["packages/effect-utilities/src/ServiceWorker.ts"],
        rules: {
          "effecttsgo/any-unknown-in-error-context": "off",
        },
      },
      // The web-platform-tests `mimesniff/` resources are binary files read
      // synchronously from disk at module load; `FileSystem` would need
      // `@effect/platform-node` for one test file.
      {
        files: ["packages/effect-utilities/tests/mime/wpt-sniffing.test.ts"],
        rules: {
          "effect/use-filesystem-service": "off",
          "effect/avoid-sync-fs": "off",
        },
      },
      // effect-web's suites run each case's program with `Effect.runPromise`
      // / `runSync` and provide its layers there, rather than through
      // `@effect/vitest`'s `it.effect` and `layer(...)`.
      {
        files: [webTests],
        rules: {
          "effect/effect-run-in-body": "off",
          "effecttsgo/strict-effect-provide": "off",
        },
      },
      // ---- effect-utilities ----
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
      // `VITEST_MAX_WORKERS` through `Config` has to run there. The configs
      // are plain build tooling: `Object.fromEntries` is the idiom.
      {
        files: ["vite.package.ts", "vite.config.ts", "packages/*/vite.config.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
          "effect/avoid-native-object-helpers": "off",
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
          ...packageNames.map((name) => `${name}#check`),
          "@effect-utilities/dist-consumer#check",
        ],
        cache: false,
      },
      // Every package's docgen: compiles AND RUNS each JSDoc `@example`
      // against the built `dist/`, then writes the API reference under that
      // package's (git-ignored) `docs/`. Same pure-graph-node shape.
      docgen: {
        command: "echo 'docgen: every example compiled and ran'",
        dependsOn: packageNames.map((name) => `${name}#docgen`),
        cache: false,
      },
      // Dist-level import check (scripts/check-dist.mjs): imports every
      // built entry and subpath under Node ESM, fails on a value export the
      // bundled `.d.ts` declares but the bundle lacks, type-checks every
      // bundled `.d.ts` with `skipLibCheck: false`, and launches the
      // `effect-evals` bin from a packed tarball under `node_modules`. Reads
      // `dist/`, hence the build edges.
      "check:dist": {
        command: "node scripts/check-dist.mjs",
        dependsOn: packageNames.map((name) => `${name}#build`),
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
      exclude: ["**/*.d.ts", "packages/effect-evals/src/cli/main.ts"],
      // Per package, not global: a glob's numbers aggregate only the files it
      // matches, so one package's surplus never offsets another's drop. A
      // weaker extra check, not the gate: the map here merges every package's
      // tests, so a package's files also count lines another package's tests
      // reach. The gate is `vp run -r test:coverage`, where each package's
      // own config measures it with only its own tests.
      thresholds: Object.fromEntries(
        Object.entries(coverageFloors).map(([dir, floor]) => [
          `packages/${dir}/src/**`,
          { ...resolveCoverageThresholds(floor) },
        ]),
      ),
    },
  },
});
