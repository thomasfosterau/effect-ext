/**
 * Peer-floor check: `vp run peer-floors [group...]`.
 *
 * The peer ranges in `pnpm-workspace.yaml` (`catalogs.*`) are tested claims.
 * Packages are grouped by the catalog their `effect` peer names (`peers`,
 * `ai-cloudflare-peers`, …), since the workspace holds one copy of `effect`.
 * For each group, this rewrites the default `catalog` to the lowest version
 * each of the group's peer ranges allows (the whole Effect line, the entries
 * pinned with `effect`, moving to the `effect` floor), installs, checks that
 * the floors are what got installed, and runs each package's `check` and
 * `test:unit`.
 *
 * With no argument every group runs in turn; `--list` only prints the
 * groups and their floors. Outside CI the workspace file and lockfile are
 * restored and the catalog versions reinstalled afterwards; `--keep` leaves
 * the last group's floors in place.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceFile = path.join(root, "pnpm-workspace.yaml");
const lockFile = path.join(root, "pnpm-lock.yaml");

const args = process.argv.slice(2);
const keep = args.includes("--keep") || Boolean(process.env.CI);
const requested = args.filter((arg) => !arg.startsWith("--"));

/** `"@scope/name": value` or `name: value` at exactly `indent` spaces. */
const entryLine = (indent) => new RegExp(`^ {${indent}}("?)([^\\s":#]+)\\1:\\s*(.*?)\\s*$`);

/** Strips a trailing comment and one level of quotes from a YAML scalar. */
const scalar = (raw) => raw.replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2");

/** The top-level key (`catalog`, `catalogs`, `overrides`, …) a line sits under. */
const sectioned = (text) => {
  let section;
  return text.split("\n").map((line) => {
    if (/^\S/.test(line)) section = line.replace(/:.*$/, "");
    return { line, section };
  });
};

/** The `name: value` entries of a flat top-level map such as `catalog` or `overrides`. */
const topLevelEntries = (text, section) =>
  sectioned(text).flatMap((row) => {
    const match = row.section === section && entryLine(2).exec(row.line);
    return match ? [[match[2], scalar(match[3])]] : [];
  });

/** Each named catalog under `catalogs`, as a map of package name to range. */
const namedCatalogs = (text) => {
  const named = new Map();
  let current;
  for (const { line } of sectioned(text).filter((row) => row.section === "catalogs")) {
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) named.set(header[1], (current = new Map()));
    const match = entryLine(4).exec(line);
    if (match) current?.set(match[2], scalar(match[3]));
  }
  return named;
};

/**
 * The default catalog and the named catalogs, read line by line: both are
 * flat maps of package name to version, which is all this needs (and keeps
 * the comments when the file is rewritten).
 */
const readCatalogs = (text) => ({
  catalog: new Map(topLevelEntries(text, "catalog")),
  named: namedCatalogs(text),
});

const parseVersion = (version) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`peer-floors: not a plain version: ${version}`);
  return match.slice(1).map(Number);
};

const compareVersions = (a, b) => {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/**
 * The lowest version a range allows. Only the shapes the peer catalogs use:
 * `||` unions of `^x.y.z`, `~x.y.z`, `>=x.y.z` and exact versions.
 */
const lowest = (range) =>
  range
    .split("||")
    .map((part) => {
      const first = part.trim().split(/\s+/)[0];
      const match = /^(\^|~|>=|=)?(v?\d+\.\d+\.\d+)$/.exec(first);
      if (!match) throw new Error(`peer-floors: unsupported range: ${range}`);
      return match[2].replace(/^v/, "");
    })
    .reduce((a, b) => (compareVersions(a, b) <= 0 ? a : b));

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const publishedPackages = readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readJson(path.join(root, "packages", entry.name, "package.json")))
  .filter((manifest) => !manifest.private);

/** `catalog:<name>` → `<name>`; the bare `catalog:` is the default one. */
const catalogName = (spec) => /^catalog:(.*)$/.exec(spec)?.[1] || "default";

const originalText = readFileSync(workspaceFile, "utf8");
const { catalog, named } = readCatalogs(originalText);

/** The default catalog's entries that move with `effect` (one exact version). */
const effectLine = [...catalog].filter(([, version]) => version === catalog.get("effect"));

/** Each group's packages and the catalog versions that put them on their floors. */
const groups = new Map();
for (const manifest of publishedPackages) {
  const peers = manifest.peerDependencies ?? {};
  if (!peers.effect) continue;
  const group = catalogName(peers.effect);
  const entry = groups.get(group) ?? { packages: [], floors: new Map() };
  entry.packages.push(manifest.name);
  for (const [name, spec] of Object.entries(peers)) {
    const range = named.get(catalogName(spec))?.get(name);
    if (!range) throw new Error(`peer-floors: ${manifest.name}: no catalog range for ${name}`);
    const floor = lowest(range);
    const previous = entry.floors.get(name);
    if (!previous || compareVersions(floor, previous) > 0) entry.floors.set(name, floor);
  }
  groups.set(group, entry);
}
/** Every package a manifest names, in any dependency field. */
const namedBy = (manifest) =>
  ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
    Object.keys(manifest[field] ?? {}),
  );
/** Named by the root manifest or pinned through `overrides` (`@effect/platform-node-shared`). */
const rootNames = new Set([
  ...namedBy(readJson(path.join(root, "package.json"))),
  "@effect/platform-node-shared",
]);
for (const [group, { packages, floors }] of groups) {
  const effectFloor = floors.get("effect");
  const used = new Set(rootNames);
  const pending = [...packages];
  for (const name of pending) {
    const manifest = publishedPackages.find((candidate) => candidate.name === name);
    for (const dependency of namedBy(manifest)) {
      // Workspace siblings are built and type-checked here too, so their
      // dependencies count.
      const sibling = publishedPackages.some((candidate) => candidate.name === dependency);
      if (sibling && !pending.includes(dependency)) pending.push(dependency);
      used.add(dependency);
    }
  }
  // Only the Effect-line packages this group installs for itself: the rest
  // need not exist at its floor (`@effect/ai-cloudflare` has no 4.0.0).
  for (const [name] of effectLine.filter(([entry]) => used.has(entry))) {
    const own = floors.get(name);
    if (own && compareVersions(own, effectFloor) > 0) {
      throw new Error(
        `peer-floors: ${group}: ${name} ${own} is above its effect floor ${effectFloor}`,
      );
    }
    floors.set(name, effectFloor);
  }
}

const unknown = requested.filter((group) => !groups.has(group));
if (unknown.length > 0) {
  console.error(
    `peer-floors: unknown group(s) ${unknown.join(", ")}; known: ${[...groups.keys()].join(", ")}`,
  );
  process.exit(2);
}
const selected = requested.length > 0 ? requested : [...groups.keys()];

const describe = (group) => {
  const { packages, floors } = groups.get(group);
  console.log(`\n== peer floors: ${group} (${packages.join(", ")})`);
  for (const [name, floor] of floors) console.log(`   ${name} ${floor}`);
};

if (args.includes("--list")) {
  selected.forEach(describe);
  process.exit(0);
}

/**
 * The workspace file with each default-catalog entry in `floors` replaced,
 * and an `overrides` entry for each that has none, so a transitive copy
 * (`@effect/docgen` 4.0.0 depends on `@effect/platform-node` 4.1.x) lands on
 * the floor too.
 */
const withFloors = (text, floors) => {
  const overridden = new Set(topLevelEntries(text, "overrides").map(([name]) => name));
  const added = [...floors.keys()]
    .filter((name) => !overridden.has(name))
    .map((name) => `  "${name}": "catalog:"`);
  const floorLine = ({ line, section }) => {
    const match = section === "catalog" && entryLine(2).exec(line);
    return match && floors.has(match[2]) ? `  "${match[2]}": "${floors.get(match[2])}"` : line;
  };
  return sectioned(text)
    .map(floorLine)
    .flatMap((line) => (line === "overrides:" ? [line, ...added] : [line]))
    .join("\n");
};

/** The workspace's own `vp` once installed (its vitest is the one `@effect/vitest` pairs with), else the global one. */
const localVp = path.join(root, "node_modules", ".bin", "vp");
const vp = (vpArgs) => {
  const command = existsSync(localVp) ? localVp : "vp";
  console.log(`\n$ vp ${vpArgs.join(" ")}`);
  return spawnSync(command, vpArgs, { cwd: root, stdio: "inherit" }).status === 0;
};

/** The installed version of each floor (hoisted linker: one copy at the root). */
const installedMismatches = (floors) =>
  [...floors].flatMap(([name, floor]) => {
    const installed = readJson(path.join(root, "node_modules", name, "package.json")).version;
    return installed === floor ? [] : [`${name}: wanted ${floor}, installed ${installed}`];
  });

const originalLock = readFileSync(lockFile, "utf8");
const failures = [];
try {
  for (const group of selected) {
    const { packages, floors } = groups.get(group);
    describe(group);
    writeFileSync(workspaceFile, withFloors(originalText, floors));
    if (!vp(["install", "--no-frozen-lockfile"])) {
      failures.push(`${group}: install`);
      continue;
    }
    const mismatches = installedMismatches(floors);
    if (mismatches.length > 0) {
      failures.push(...mismatches.map((mismatch) => `${group}: ${mismatch}`));
      continue;
    }
    for (const name of packages) {
      for (const task of ["check", "test:unit"]) {
        if (!vp(["run", "--filter", name, task])) failures.push(`${group}: ${name}#${task}`);
      }
    }
  }
} finally {
  if (!keep) {
    writeFileSync(workspaceFile, originalText);
    writeFileSync(lockFile, originalLock);
    vp(["install", "--frozen-lockfile"]);
  }
}

if (failures.length > 0) {
  console.error(`\npeer-floors: failed\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`\npeer-floors: ${selected.join(", ")} green on their floors`);
