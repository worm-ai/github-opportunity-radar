export type RepositoryDocument = {
  path: string;
  url: string;
  sha: string;
  excerpt: string;
  observedAt: string;
  stale?: boolean;
  ref?: string;
  commitSha?: string;
};

export type RepositoryDocumentation = {
  documents: RepositoryDocument[];
  attemptedPaths: string[];
  warnings: string[];
  observedAt: string;
  // Requested collection context; retained documents carry their own version.
  ref?: string;
  commitSha?: string;
};
