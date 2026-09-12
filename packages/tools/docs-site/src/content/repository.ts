/**
 * Where this repository is browsable, for links that leave the published corpus.
 *
 * Stated as constants rather than parsed out of the root manifest's `repository.url` at build time.
 * That URL is a git remote (`git+https://...git`), and turning a git remote into a browse URL is a
 * parsing job with real edge cases (ssh, `git://`, shorthand, other forges) — for exactly ONE known
 * input. Pinning the answer and asserting it still agrees with the manifest closes the only hazard
 * (someone moves the repository) without a parser or a dependency to carry.
 *
 * The agreement is asserted by `repository.test.ts`.
 */

/** Browse root of the repository, with no trailing slash. */
export const REPOSITORY_BROWSE_URL = 'https://github.com/radicle-co/KitchenSink';

/**
 * The ref produced links point at.
 *
 * `main`, not the building commit: these links are read long after the build, and a link pinned to a
 * feature branch's SHA rots the moment that branch is deleted. The accepted consequence is that a
 * link to a file which exists only on an unmerged branch resolves once that branch lands.
 */
export const REPOSITORY_REF = 'main';
