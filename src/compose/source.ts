export type NoteSource =
  | { kind: "file"; path: string; size?: number; hash?: string }
  | { kind: "readme"; path: string; word: string }
  | { kind: "section"; name: string; files: number }
  | { kind: "slice"; index: number; dir: string; commits: number; hash?: string; from?: number; to?: number }
  | { kind: "coda" };

const short = (hash: string) => hash.slice(0, 7);

export function describeSource(s: NoteSource | undefined): string {
  if (!s) return "unknown";
  switch (s.kind) {
    case "file":
      return `${s.path}${s.hash ? ` @ ${short(s.hash)}` : ""}`;
    case "readme":
      return `README "${s.word}" (${s.path})`;
    case "section":
      return `folder ${s.name} · ${s.files} file${s.files === 1 ? "" : "s"}`;
    case "slice": {
      const n = `${s.commits} commit${s.commits === 1 ? "" : "s"}`;
      return `${s.dir} · ${n}${s.hash ? ` · ${short(s.hash)}` : ""}`;
    }
    case "coda":
      return "coda";
  }
}