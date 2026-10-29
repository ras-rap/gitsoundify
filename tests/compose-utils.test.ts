import { expect, test } from "bun:test";
import { hash32, hashPath, makeSeed, pathToUnit, Rng } from "../src/compose/random";
import { degreeToMidi, pathToDegree, pickKey, SCALES } from "../src/compose/scales";

test("golden: hash32 and makeSeed", () => {
  // These constants are the compatibility contract: changing the hash or seed mix silently
  // re-tunes every repo ever rendered.
  expect(hash32("hello")).toBe(2290972270);
  expect(hash32("")).toBe(2872998923);
  expect(hash32("src/a.ts")).toBe(3876039695);
  expect(makeSeed("Switchboard", "ambient")).toBe(2057370169);
  // The repo name is trimmed and case-folded before hashing; the mode is always mixed in.
  expect(makeSeed("  switchboard ", "ambient")).toBe(makeSeed("Switchboard", "ambient"));
  expect(makeSeed("switchboard", "structure")).not.toBe(makeSeed("switchboard", "ambient"));
});

test("golden: mulberry32 sequence (matches the reference implementation)", () => {
  const r = new Rng(1);
  // Pinned against the reference mulberry32: a previously rendered piece must replay bit-identically.
  expect(r.next()).toBeCloseTo(0.6270739405881613, 15);
  expect(r.next()).toBeCloseTo(0.002735721180215478, 15);
  expect(r.next()).toBeCloseTo(0.5274470399599522, 15);
});

test("same seed gives same sequence, different seeds differ", () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 20 }, () => a.next());
  expect(Array.from({ length: 20 }, () => b.next())).toEqual(sa);
  expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(sa);
});

test("next() stays in [0,1) and is roughly uniform", () => {
  const r = new Rng(7);
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    const x = r.next();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
    sum += x;
  }
  // 20k draws give a standard error near 0.002, so 0.01 catches real bias without flaking.
  expect(Math.abs(sum / 20000 - 0.5)).toBeLessThan(0.01);
});

test("int is inclusive on both ends and hits every value", () => {
  const r = new Rng(3);
  const seen = new Set<number>();
  for (let i = 0; i < 500; i++) seen.add(r.int(2, 6));
  expect([...seen].sort()).toEqual([2, 3, 4, 5, 6]);
});

test("fork ignores how much the parent has been used, and labels are independent", () => {
  const fresh = new Rng(99);
  const used = new Rng(99);
  for (let i = 0; i < 1000; i++) used.next();
  // fork() mixes seed + label only, so a parent's consumption never leaks into child streams.
  expect(used.fork("bass").next()).toBe(fresh.fork("bass").next());
  expect(fresh.fork("bass").next()).not.toBe(fresh.fork("lead").next());
});

test("pick throws on empty", () => {
  expect(() => new Rng(1).pick([])).toThrow();
});

test("pathToUnit is stable, in [0,1), and salt changes it", () => {
  expect(pathToUnit("src/a.ts")).toBe(pathToUnit("src/a.ts"));
  expect(pathToUnit("src/a.ts")).toBeGreaterThanOrEqual(0);
  expect(pathToUnit("src/a.ts")).toBeLessThan(1);
  expect(hashPath("src/a.ts", 1)).not.toBe(hashPath("src/a.ts", 2));
});

test("pickKey is deterministic and valid for every seed tried", () => {
  expect(pickKey(new Rng(5))).toEqual(pickKey(new Rng(5)));
  const scalesSeen = new Set<string>();
  for (let s = 0; s < 200; s++) {
    const k = pickKey(new Rng(hash32(String(s))));
    expect(k.root).toBeGreaterThanOrEqual(0);
    expect(k.root).toBeLessThanOrEqual(11);
    scalesSeen.add(k.scale.name);
  }
  expect(scalesSeen.size).toBe(SCALES.length);
});

test("degreeToMidi: root, octave wrap, negative degrees, clamp", () => {
  const key = { root: 0, scale: SCALES[0]! }; 
  // Middle C (MIDI 60) is degree 0 of the root scale; octave 1 is the reference register.
  expect(degreeToMidi(key, 0)).toBe(60);
  expect(degreeToMidi(key, 1)).toBe(63);
  expect(degreeToMidi(key, 5)).toBe(72);
  expect(degreeToMidi(key, -1)).toBe(58); 
  expect(degreeToMidi(key, 0, 2)).toBe(36);
  // Degrees past the top of the range keep climbing octaves, then clamp to the MIDI ceiling.
  expect(degreeToMidi(key, 9999)).toBe(127);
  expect(degreeToMidi({ ...key, root: 7 }, 0)).toBe(67); 
});

test("pathToDegree is stable, bounded, and spreads evenly across degrees", () => {
  expect(pathToDegree("src/a.ts", 10)).toBe(pathToDegree("src/a.ts", 10));
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 2000; i++) {
    const d = pathToDegree(`src/module${i}/file${i * 7}.ts`, 10);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(10);
    bins[d]++;
  }
  // 2000 paths over 10 bins is 200 each if flat; 140 leaves room for hash noise but still
  // rules out an uneven mapping.
  for (const n of bins) expect(n).toBeGreaterThan(140); 
});