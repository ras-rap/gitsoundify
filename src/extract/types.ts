export interface CommitStat {
    hash: string;
    time: number;
    author: string;
    message: string;
    filesChanged: number;
    added: number;
    removed: number;
    paths: string[];
}

export interface TreeNode {
    name: string;
    path: string;
    type: "dir" | "file";
    size: number;
    fileCount: number;
    children: TreeNode[];
}

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