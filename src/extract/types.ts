/** One non-merge commit. `time` is the author timestamp in Unix seconds, not milliseconds. */
export interface CommitStat {
    hash: string;
    time: number;
    author: string;
    message: string;
    filesChanged: number;
    added: number;
    removed: number;
    /** Sampled: truncated by the log parser, while filesChanged/added/removed count every file. */
    paths: string[];
}

/** Node in the HEAD tree; for directories `size` and `fileCount` are rolled up from descendants. */
export interface TreeNode {
    name: string;
    path: string;
    type: "dir" | "file";
    size: number;
    fileCount: number;
    children: TreeNode[];
}

/**
 * Everything extracted from one repository. `firstCommitAt`/`lastCommitAt` are Unix seconds taken
 * from the ends of the oldest-first `commits` list, and are null for a repo with no commits.
 */
export interface RepoSnapshot {
    name : string;
    head : string | null;
    commitCount : number;
    firstCommitAt : number | null;
    lastCommitAt : number | null;
    commits : CommitStat[];
    tree: TreeNode;
    readme: { path: string; firstLine: string } | null;
    extensions: Record<string, number>;
}