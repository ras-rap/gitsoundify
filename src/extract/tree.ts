import { git, gitMaybe } from "./git";
import type { TreeNode } from "./types";

export interface FileEntry {
  path: string;
  size: number;
}

/**
 * Parses NUL-separated `git ls-tree -r -l` records (`<mode> <type> <sha> <size>\t<path>`).
 * Only blobs survive: with `-r` tree entries have no size, and gitlinks encode theirs as `-`.
 */
export function parseLsTree(raw: string): FileEntry[] {
  const entries: FileEntry[] = [];
  const re = /^\d+ (\w+) [0-9a-f]+ +(-|\d+)\t([\s\S]+)$/;

  for (const rec of raw.split("\0")) {
    if (!rec) continue;
    const m = re.exec(rec);
    if (!m || m[1] !== "blob") continue;
    entries.push({ path: m[3]!, size: Number(m[2]) });
  }
  return entries;
}

/**
 * Builds a nested tree from flat HEAD entries. Intermediate directories are synthesised from the
 * paths, and each directory's `size`/`fileCount` are rolled up from its descendants.
 */
export function buildTree(entries: FileEntry[], rootName: string): TreeNode {
  const root: TreeNode = { name: rootName, path: "", type: "dir", size: 0, fileCount: 0, children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);

  const ensureDir = (path: string): TreeNode => {
    const existing = dirs.get(path);
    if (existing) return existing;

    // Recurse so a missing parent chain is created before the leaf directory.
    const slash = path.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : path.slice(0, slash));
    const node: TreeNode = {
      name: path.slice(slash + 1),
      path,
      type: "dir",
      size: 0,
      fileCount: 0,
      children: [],
    };
    parent.children!.push(node);
    dirs.set(path, node);
    return node;
  };

  for (const { path, size } of entries) {
    const slash = path.lastIndexOf("/");
    const parent = ensureDir(slash === -1 ? "" : path.slice(0, slash));
    parent.children!.push({
      name: path.slice(slash + 1),
      path,
      type: "file",
      size,
      fileCount: 1,
    });
  }

  const rollUp = (node: TreeNode): void => {
    if (node.type === "file") return;
    // Sort by name so the rendered tree does not depend on git's traversal order.
    node.children!.sort((a, b) => a.name.localeCompare(b.name));
    node.size = 0;
    node.fileCount = 0;
    for (const child of node.children!) {
      rollUp(child);
      node.size += child.size;
      node.fileCount += child.fileCount;
    }
  };
  rollUp(root);

  return root;
}

/** Total bytes per lowercased extension; extensionless files are keyed by `""`. */
export function extensionBytes(entries: FileEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { path, size } of entries) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    // `dot > 0` keeps dotfiles whole: ".gitignore" has no extension, not extension "gitignore".
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    out[ext] = (out[ext] ?? 0) + size;
  }
  return out;
}

export async function readTree(dir: string): Promise<FileEntry[]> {
  const raw = await git(dir, ["ls-tree", "-r", "-l", "-z", "HEAD"]);
  return parseLsTree(raw);
}

/**
 * First root-level readme blob (`README`, `README.md`, ...) and its first non-empty line with
 * leading Markdown decoration stripped, capped at 200 chars for inline display.
 */
export async function findReadme(
  dir: string,
  entries: FileEntry[],
): Promise<{ path: string; firstLine: string } | null> {
  const readme = entries.find((e) => !e.path.includes("/") && /^readme(\.|$)/i.test(e.path));
  if (!readme) return null;

  const text = await gitMaybe(dir, ["show", `HEAD:${readme.path}`]);
  if (text === null) return null;

  const firstLine =
    text
      .split("\n")
      .map((l) => l.replace(/^[#\s>*_-]+/, "").trim())
      .find((l) => l.length > 0) ?? "";

  return { path: readme.path, firstLine: firstLine.slice(0, 200) };
}