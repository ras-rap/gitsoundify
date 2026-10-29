export interface Example {
  repo: string;
  title: string;
  /** What to listen for — deliberately not a mode claim, since that depends on commit count. */
  blurb: string;
  tags: string[];
}

export const EXAMPLES: Example[] = [
  {
    repo: "octocat/Hello-World",
    title: "Hello-World",
    blurb:
      "Almost no folders and a handful of commits, so the file tree is doing all the writing. Structure mode at its plainest.",
    tags: ["tiny history", "few folders"],
  },
  {
    repo: "swyf-modding/Switchboard",
    title: "Switchboard",
    blurb:
      "A medium-sized repo with a good amount of files and a decent history. The structure is clear, but the ambient layer adds a lot of texture.",
    tags: ["tiny history", "compare"],
  },
  {
    repo: "Paymenter/Paymenter",
    title: "Paymenter",
    blurb:
      "A large repo with a lot of files and a long history. The structure is clear, but the ambient layer adds a lot of texture.",
    tags: ["long history", "denser"],
  },
];