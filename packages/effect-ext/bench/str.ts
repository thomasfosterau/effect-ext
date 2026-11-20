// Per-string cost of `Str` views over short slices of one buffer: equality,
// order and decoding. Run with `vpx bench/str.ts` from the package directory.
import * as Str from "../src/Str.ts";

const COUNT = 50_000;
const ROUNDS = 60;

const makeInput = (width: number) => {
  const bytes = new Uint8Array(COUNT * width);
  for (let i = 0; i < bytes.length; i++) bytes[i] = 0x61 + ((i * 7) % 26);
  return bytes;
};

const bestOf = (run: () => number): number => {
  let best = Infinity;
  let sink = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now();
    sink += run();
    best = Math.min(best, performance.now() - start);
  }
  if (Number.isNaN(sink)) console.log(sink);
  return (best * 1e6) / COUNT;
};

const views = (bytes: Uint8Array, width: number) => {
  const out: Array<Str.Str> = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(Str.fromUtf8Unsafe(bytes.subarray(i * width, (i + 1) * width)));
  }
  return out;
};

const rows: Array<[string, number]> = [];
for (const width of [4, 8, 12, 16, 64]) {
  const bytes = makeInput(width);
  const keys = views(bytes.slice(), width);
  rows.push([
    `${width} B: subarray + fromUtf8Unsafe + len`,
    bestOf(() => {
      let total = 0;
      for (let i = 0; i < COUNT; i++) {
        total += Str.len(Str.fromUtf8Unsafe(bytes.subarray(i * width, (i + 1) * width)));
      }
      return total;
    }),
  ]);
  rows.push([
    `${width} B: Str.Equivalence(view, key), equal`,
    bestOf(() => {
      let equal = 0;
      for (let i = 0; i < COUNT; i++) {
        const view = Str.fromUtf8Unsafe(bytes.subarray(i * width, (i + 1) * width));
        if (Str.Equivalence(view, keys[i])) equal++;
      }
      return equal;
    }),
  ]);
  rows.push([
    `${width} B: Str.Order(view, key), equal`,
    bestOf(() => {
      let sum = 0;
      for (let i = 0; i < COUNT; i++) {
        const view = Str.fromUtf8Unsafe(bytes.subarray(i * width, (i + 1) * width));
        sum += Str.Order(view, keys[i]);
      }
      return sum;
    }),
  ]);
  rows.push([
    `${width} B: String(view)`,
    bestOf(() => {
      let total = 0;
      for (let i = 0; i < COUNT; i++) {
        total += String(Str.fromUtf8Unsafe(bytes.subarray(i * width, (i + 1) * width))).length;
      }
      return total;
    }),
  ]);
}
const multi = new TextEncoder().encode("héllo wörld!".repeat(COUNT));
const multiWidth = multi.length / COUNT;
rows.push([
  `${multiWidth} B non-ASCII: String(view)`,
  bestOf(() => {
    let total = 0;
    for (let i = 0; i < COUNT; i++) {
      total += String(
        Str.fromUtf8Unsafe(multi.subarray(i * multiWidth, (i + 1) * multiWidth)),
      ).length;
    }
    return total;
  }),
]);

console.log(`| Operation | Per string |\n| --- | --: |`);
for (const [name, ns] of rows) console.log(`| ${name} | ${ns.toFixed(0)} ns |`);
