/**
 * The Vite+ configuration every package in this workspace shares: the task
 * graph (`check`, `build`, `test:unit`, `test:coverage`, `docgen`), the
 * `vp pack` (tsdown) settings, the vitest / coverage settings and the coverage
 * ratchet. Each `packages/<name>/vite.config.ts` is a one-call instantiation
 * of one of the two factories below, which differ in how a package resolves
 * itself and its siblings during development:
 *
 * - `packageConfig` (the `effect-ai-*` family and `effect-evals`): the
 *   development `exports` point at `src/` and `publishConfig` rewrites them to
 *   `dist/` on publish, so a test or type check that imports a package by
 *   name, its own or a sibling's, resolves to `src/` with no alias and no
 *   build first. Only `docgen`, which runs its examples against `dist/`,
 *   carries build edges.
 * - `distExportsPackageConfig` (`effect-utilities`): `exports` point at
 *   `dist/` in development too, so `tests/dist-consumer` and docgen consume
 *   the package exactly as a consumer does. Its tests import the package by
 *   name through an alias to `src/`, and a sibling is consumed through its
 *   `dist/`, hence the build edge on every task.
 *
 * Copied from the effect-web library's `vite.package.ts`; the one-module-per-
 * subpath layout (`src/<Module>.ts`) is Effect's own.
 */
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import { defineConfig } from "vite-plus";

/** One Istanbul threshold per metric, in percent. */
export interface CoverageThresholds {
  readonly lines: number;
  readonly branches: number;
  readonly functions: number;
  readonly statements: number;
}

/**
 * The coverage every package ratchets toward: effect-web's thresholds, the
 * family standard. A package that omits a metric from its `coverageFloor` is
 * held to the value here.
 */
export const coverageTarget: CoverageThresholds = {
  lines: 90,
  branches: 85,
  functions: 90,
  statements: 90,
};

/**
 * A package's ratchet: the coverage it must not drop below, set from its own
 * measured numbers rounded down to the integer. Raise a metric whenever the
 * package's coverage rises; delete it to fall back to `coverageTarget`. Never
 * lower one to make a change pass: add the tests instead.
 */
export type CoverageFloor = Partial<CoverageThresholds>;

/** A package's enforced thresholds: its floor, the target for any metric it omits. */
export const resolveCoverageThresholds = (floor: CoverageFloor = {}): CoverageThresholds => ({
  ...coverageTarget,
  ...floor,
});

/**
 * Input fingerprint for a package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install) and docgen's own output, with the lockfile back explicitly so a
 * dependency upgrade still invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!docs/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

const testEnv = ["VITEST_MAX_WORKERS", "NODE_OPTIONS"];

/**
 * The vitest settings both factories share. `include` is narrow on purpose:
 * `effect-evals`' `tests/eval-glob-separation.test.ts` pins this exact value
 * so the unit suite can never start picking up `*.eval.ts` files, which may
 * need real provider credentials to run.
 */
const testOptions = (floor: CoverageFloor, coverageExclude: ReadonlyArray<string>) => {
  // Read once, synchronously, from the environment (`Config`'s default
  // provider); unset leaves vitest's own default in place.
  const maxWorkers = Effect.runSync(Config.option(Config.Int("VITEST_MAX_WORKERS")));
  const options = {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "istanbul" as const,
      // `json` writes coverage-final.json, the Istanbul map `fallow audit`
      // reads for exact per-function CRAP scores (`health.coverage` in
      // .fallowrc.json); without it every function scores as uncovered.
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts", ...coverageExclude],
      // A coverage drop below the package's floor fails the run. Vitest reads
      // `coverage` from the root config only, so this binds the per-package
      // `test:coverage` task; the root task applies the same floors per
      // package through glob thresholds (root `vite.config.ts`).
      thresholds: { ...resolveCoverageThresholds(floor) },
    },
  };
  // `maxWorkers` is added only when the environment names one.
  return Option.match(maxWorkers, {
    onNone: () => options,
    onSome: (workers) => ({ ...options, maxWorkers: workers }),
  });
};

/** What differs per `effect-ai-*` / `effect-evals` package. */
export interface PackageConfigOptions {
  /**
   * `pack.entry`: output name (without extension) → source file. One entry per
   * `publishConfig.exports` subpath (plus the `effect-evals` CLI), so the
   * built file names match what `publishConfig` points at.
   */
  readonly entry: Readonly<Record<string, string>>;
  /** Extra coverage exclusions (beyond declaration files). */
  readonly coverageExclude?: ReadonlyArray<string>;
  /**
   * The package's coverage ratchet (see `CoverageFloor`). Declared as the
   * `coverageFloor` named export of the package's `vite.config.ts`. The gate is
   * `vp run -r test:coverage`, which measures each package with only its own
   * tests. The root config also reads it for its per-package glob thresholds,
   * a weaker extra check: same numbers, but measured with every package's
   * tests, so another package's tests can hide a drop.
   */
  readonly coverageFloor?: CoverageFloor;
  /** Whether the package type-checks its tests through a `tsconfig.test.json`. Default true. */
  readonly testTsconfig?: boolean;
}

/** A package whose development `exports` point at `src/` (see the header). */
export const packageConfig = ({
  entry,
  coverageExclude = [],
  coverageFloor = {},
  testTsconfig = true,
}: PackageConfigOptions) =>
  defineConfig({
    run: {
      tasks: {
        // `src` under the native, Effect-patched `tsc`, then the tests under
        // `tsconfig.test.json`. `effect-evals` has no tsconfig.test.json: its
        // `tsconfig.json` already covers its tests and configs.
        check: {
          command: testTsconfig
            ? "tsc -p tsconfig.json && tsc -p tsconfig.test.json"
            : "tsc -p tsconfig.json",
          cache: { input: cacheInputs, output: [] },
        },
        // The published artifact: one ESM bundle + declaration file per entry
        // point (`vp pack` → tsdown). `sideEffects: false` is a claim about
        // this output: no top-level statements.
        build: {
          command: "vp pack",
          cache: { input: cacheInputs, output: ["dist/**"] },
        },
        "test:unit": {
          command: "vp test run tests",
          cache: { env: testEnv, input: cacheInputs, output: [] },
        },
        "test:coverage": {
          command: "vp test run tests --coverage",
          cache: { env: testEnv, input: cacheInputs, output: ["coverage/**"] },
        },
        // Compiles AND RUNS every JSDoc `@example` (see the package's
        // docgen.json), then writes the API reference under its git-ignored
        // `docs/`. Examples import packages by name, exactly as a consumer
        // would; development `exports` here point at `src/`, so each
        // docgen.json maps those names onto `dist/` through
        // `examplesCompilerOptions.paths` (honoured by both the examples' `tsc`
        // and the `tsx` that runs them). Hence the build edges: the package's
        // own and its workspace dependencies' (`@thomasfosterau/effect-ai-ext`).
        docgen: {
          command: "docgen",
          dependsOn: ["build", { task: "build", from: "dependencies" }],
          cache: { input: cacheInputs, output: ["docs/**"] },
        },
      },
    },
    pack: {
      entry: { ...entry },
      format: "esm",
      platform: "neutral",
      // The tsup build this replaced emitted untranspiled `esnext`; without
      // this tsdown would lower syntax to `engines.node` where a package
      // declares one.
      target: "esnext",
      dts: true,
      outDir: "dist",
      clean: true,
      deps: {
        // `effect`, `@effect/*` and the workspace `@thomasfosterau/*` packages
        // stay external so the published package shares the consumer's
        // singleton copies; `@cloudflare/*` (the gateway's optional,
        // types-only peer) has no runtime presence to bundle; `node:*`
        // builtins (the `effect-evals` CLI) are the runtime's own, and naming
        // them here keeps the `neutral` platform from reporting them as
        // unresolved imports.
        neverBundle: [
          /^effect(\/|$)/,
          /^@effect\//,
          /^@thomasfosterau\//,
          /^@cloudflare\//,
          /^node:/,
        ],
      },
    },
    test: testOptions(coverageFloor, coverageExclude),
  });

/** What differs per package whose `exports` point at `dist/`. */
export interface DistExportsPackageConfigOptions {
  /** The package's `import.meta.url`, so paths resolve relative to it. */
  readonly url: string;
  /** The published name (`@thomasfosterau/effect-utilities`), for the test alias. */
  readonly name: string;
  /** `pack.entry`: `index` → `src/index.ts`, every other key → `src/<key>.ts`. */
  readonly entries: ReadonlyArray<string>;
  /** The package's coverage ratchet (see `PackageConfigOptions.coverageFloor`). */
  readonly coverageFloor?: CoverageFloor;
}

/**
 * A sibling package is consumed the way a consumer does — through its
 * `exports`, so its `dist/` — hence the build edge on every task that
 * resolves one. A package with no workspace dependency gets an empty edge.
 */
const siblingBuild = { task: "build", from: "dependencies" as const };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** A package whose `exports` point at `dist/` (see the header). */
export const distExportsPackageConfig = ({
  url,
  name,
  entries,
  coverageFloor = {},
}: DistExportsPackageConfigOptions) => {
  const srcDir = new URL("./src/", url).pathname;
  const subpaths = entries.filter((entry) => entry !== "index");
  const entry = R.fromEntries(
    Arr.map(entries, (one) => [one, one === "index" ? "src/index.ts" : `src/${one}.ts`] as const),
  );
  return defineConfig({
    run: {
      tasks: {
        // `src` under the native, Effect-patched `tsc`, then the type-level
        // tests (`tests/*.types.ts`, whose expect-error directives are the
        // assertions) under tsconfig.test.json, which resolves the package
        // name to `src/` so this package's own build is never needed first.
        check: {
          command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: [] },
        },
        // The published artifact: one ESM bundle + declaration file per entry
        // point (`vp pack` → tsdown, `platform: neutral`). `sideEffects:
        // false` is a claim about this output: no top-level statements.
        build: {
          command: "vp pack",
          dependsOn: [siblingBuild],
          cache: { input: cacheInputs, output: ["dist/**"] },
        },
        "test:unit": {
          command: "vp test run tests",
          dependsOn: [siblingBuild],
          cache: { env: testEnv, input: cacheInputs, output: [] },
        },
        "test:coverage": {
          command: "vp test run tests --coverage",
          dependsOn: [siblingBuild],
          cache: { env: testEnv, input: cacheInputs, output: ["coverage/**"] },
        },
        // Compiles AND RUNS every JSDoc `@example`: docgen.json's
        // `"runExamples": true` turns that on, and `--run-examples` is the
        // backstop docgen falls back to if the key is ever dropped (the key
        // wins when present, so an explicit `false` still turns it off).
        // Examples import the package by name exactly as a consumer would,
        // which resolves through `exports` to `dist/` — hence the build edge.
        docgen: {
          command: "docgen --run-examples",
          dependsOn: ["build"],
          cache: { input: cacheInputs, output: ["docs/**"] },
        },
      },
    },
    pack: {
      entry,
      format: "esm",
      platform: "neutral",
      dts: true,
      outDir: "dist",
      clean: true,
    },
    resolve: {
      // Tests import the package by name, exactly as a consumer would (and as
      // tsconfig.test.json's `paths` type-checks them), so the runner resolves
      // that name to `src/` rather than to the built `dist/` that `exports`
      // points at — a unit run never needs a build first.
      alias: [
        { find: new RegExp(`^${escapeRegExp(name)}$`), replacement: `${srcDir}index.ts` },
        ...Arr.match(subpaths, {
          onEmpty: () => [],
          onNonEmpty: (values) => [
            {
              find: new RegExp(`^${escapeRegExp(name)}/(${values.map(escapeRegExp).join("|")})$`),
              replacement: `${srcDir}$1.ts`,
            },
          ],
        }),
      ],
    },
    test: testOptions(coverageFloor, []),
  });
};
