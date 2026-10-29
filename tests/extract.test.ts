import { expect, test } from "bun:test";
import { parseLog } from "../src/extract/history";
import { buildTree, extensionBytes, parseLsTree } from "../src/extract/tree";

test("parseLog handles numstat, binaries, and empty commits", () => {
  // Records are \x1e-separated with \x1f-separated header fields; numstat rows follow
  // each header until the next record.
  const raw =
    "\x1eaaa\x1f100\x1fAda\x1ffirst\n\n10\t2\tsrc/a.ts\n-\t-\tlogo.png\n" +
    "\x1ebbb\x1f200\x1fBo\x1f\n"; 
  const [a, b] = parseLog(raw);
  // The binary row reports "-" for both counts, so it adds a path but no lines.
  expect(a).toMatchObject({ hash: "aaa", time: 100, author: "Ada", message: "first", filesChanged: 2, added: 10, removed: 2 });
  expect(a!.paths).toEqual(["src/a.ts", "logo.png"]);
  expect(b).toMatchObject({ hash: "bbb", filesChanged: 0, message: "" });
});

test("parseLsTree skips submodules and parses sizes", () => {
  // Raw `git ls-tree -lz` output: NUL-separated entries with a right-aligned size column.
  const raw =
    "100644 blob abc123   120\tREADME.md\0" +
    "160000 commit def456     -\tvendor/sub\0" +
    "100644 blob 789abc  4096\tsrc/deep/file.rs\0";
  // Mode 160000 is a submodule commit pointer: it has no size of its own, so it is dropped.
  expect(parseLsTree(raw)).toEqual([
    { path: "README.md", size: 120 },
    { path: "src/deep/file.rs", size: 4096 },
  ]);
});

test("buildTree rolls up sizes and counts", () => {
  const tree = buildTree(
    [
      { path: "a.txt", size: 1 },
      { path: "src/x.ts", size: 10 },
      { path: "src/deep/y.ts", size: 100 },
    ],
    "demo",
  );
  expect(tree.size).toBe(111);
  expect(tree.fileCount).toBe(3);
  const src = tree.children!.find((c) => c.name === "src")!;
  expect(src.size).toBe(110);
  // Children are name-sorted with no dirs-first rule, so "deep" precedes "x.ts".
  expect(src.children!.map((c) => c.name)).toEqual(["deep", "x.ts"]);
});

test("extensionBytes groups by lowercase extension", () => {
  // Case is folded for grouping, and dotfiles count as extensionless like a bare Makefile.
  expect(extensionBytes([{ path: "A.TS", size: 5 }, { path: "b.ts", size: 6 }, { path: "Makefile", size: 2 }, { path: ".gitignore", size: 1 }])).toEqual({ ts: 11, "": 3 });
});