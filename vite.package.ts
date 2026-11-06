/**
 * The Vite+ configuration every package in this workspace shares: the task
 * graph (`check`, `build`, `test:unit`, `test:coverage`, `docgen`), the
 * `vp pack` (tsdown) settings, the vitest / coverage settings and the coverage
 * ratchet. Each `packages/<name>/vite.config.ts` is a one-call instantiation
 * of one of the two factories below, which differ in how a package resolves
 * itself and its siblings during development:
 *
 * - `packageConfig` (the `effect-ai-*` providers): the development `exports`
 *   point at `src/` and `publishConfig` rewrites them to `dist/` on publish,
 *   so a test or type check that imports a provider by name resolves to its
 *   `src/` with no alias and no build first. `@thomasfosterau/effect-ext`,
 *   whose `exports` point at `dist/`, is aliased to its `src/` for the tests
 *   (`effectExtAlias`) and mapped there by each provider's tsconfig `paths`.
 *   Only `docgen`, which runs its examples against `dist/`, carries build
 *   edges.
 * - `distExportsPackageConfig` (`effect-ext`): `exports` point at
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
 * effect-ext's `tests/evals/eval-glob-separation.test.ts` pins this exact value
 * so the unit suite can never start picking up `*.eval.ts` files, which may
 * need real provider credentials to run.
 */
const testOptions = (
  floor: CoverageFloor,
  coverageExclude: ReadonlyArray<string>,
  globFloors: Readonly<Record<string, CoverageFloor>> = {},
) => {
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
      // A glob floor binds the files it matches as well: effect-ext keeps the
      // floors the AI abstractions and the evals toolkit arrived with.
      thresholds: {
        ...resolveCoverageThresholds(floor),
        ...R.map(globFloors, (glob) => ({ ...resolveCoverageThresholds(glob) })),
      },
    },
  };
  // `maxWorkers` is added only when the environment names one.
  return Option.match(maxWorkers, {
    onNone: () => options,
    onSome: (workers) => ({ ...options, maxWorkers: workers }),
  });
};

/** What differs per `effect-ai-*` provider package. */
export interface PackageConfigOptions {
  /**
   * `pack.entry`: output name (without extension) → source file. One entry per
   * `publishConfig.exports` subpath, so the
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
}

/**
 * Resolves `@thomasfosterau/effect-ext` and its top-level subpaths (the AI
 * abstractions the providers implement) to its `src/` for the providers'
 * tests: its `exports` point at `dist/`, which a unit run must not need.
 */
const effectExtSrc = new URL("./packages/effect-ext/src/", import.meta.url).pathname;
const effectExtAlias = [
  { find: /^@thomasfosterau\/effect-ext$/, replacement: `${effectExtSrc}index.ts` },
  { find: /^@thomasfosterau\/effect-ext\/(\w+)$/, replacement: `${effectExtSrc}$1.ts` },
];

/** A package whose development `exports` point at `src/` (see the header). */
export const packageConfig = ({
  entry,
  coverageExclude = [],
  coverageFloor = {},
}: PackageConfigOptions) =>
  defineConfig({
    run: {
      tasks: {
        // `src` under the native, Effect-patched `tsc`, then the tests under
        // `tsconfig.test.json`.
        check: {
          command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
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
        // own and its workspace dependencies' (`@thomasfosterau/effect-ext`).
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
    resolve: { alias: effectExtAlias },
    test: testOptions(coverageFloor, coverageExclude),
  });

/** What differs per package whose `exports` point at `dist/`. */
export interface DistExportsPackageConfigOptions {
  /** The package's `import.meta.url`, so paths resolve relative to it. */
  readonly url: string;
  /** The published name (`@thomasfosterau/effect-ext`), for the test alias. */
  readonly name: string;
  /**
   * `pack.entry`: every key is `src/<key>.ts` built to `dist/<key>.js`, and
   * the subpath the test alias resolves: `index` is the package name itself,
   * `<dir>/index` is the `./<dir>` barrel, any other key is `./<key>`.
   */
  readonly entries: ReadonlyArray<string>;
  /** The package's coverage ratchet (see `PackageConfigOptions.coverageFloor`). */
  readonly coverageFloor?: CoverageFloor;
  /**
   * Floors for parts of the package, by glob relative to it: each binds the
   * files it matches on top of `coverageFloor`, which binds every file.
   */
  readonly coverageGlobFloors?: Readonly<Record<string, CoverageFloor>>;
  /** Extra coverage exclusions (beyond declaration files). */
  readonly coverageExclude?: ReadonlyArray<string>;
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
  coverageGlobFloors = {},
  coverageExclude = [],
}: DistExportsPackageConfigOptions) => {
  const srcDir = new URL("./src/", url).pathname;
  const entry = R.fromEntries(Arr.map(entries, (one) => [one, `src/${one}.ts`] as const));
  // `index` → the package name, `<dir>/index` → `<name>/<dir>`, `<key>` → `<name>/<key>`.
  const specifier = (one: string) =>
    one === "index" ? name : `${name}/${one.replace(/\/index$/, "")}`;
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
      // `node:*` builtins (the `effect-evals` CLI) are the runtime's own;
      // naming them keeps the `neutral` platform from reporting them as
      // unresolved imports.
      deps: { neverBundle: [/^node:/] },
    },
    resolve: {
      // Tests import the package by name, exactly as a consumer would (and as
      // tsconfig.test.json's `paths` type-checks them), so the runner resolves
      // that name to `src/` rather than to the built `dist/` that `exports`
      // points at — a unit run never needs a build first.
      alias: Arr.map(entries, (one) => ({
        find: new RegExp(`^${escapeRegExp(specifier(one))}$`),
        replacement: `${srcDir}${one}.ts`,
      })),
    },
    test: testOptions(coverageFloor, coverageExclude, coverageGlobFloors),
  });
};
