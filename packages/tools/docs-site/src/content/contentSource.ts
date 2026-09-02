/**
 * The content-source CONTRACT for the documentation site.
 *
 * Pattern: a discriminated union (Visitor-by-exhaustive-switch) over the two ways a documentation
 * corpus reaches this site. The distinction is load-bearing and is why `availability` is a tag rather
 * than a boolean field on one shape:
 *
 * - `required` — hand-written material that is committed and always present. Its absence is a BUILD
 *   FAILURE, because a site that silently drops the ADRs is worse than no site.
 * - `generated` — material produced by a generator that may not have run yet. Its absence is an
 *   EXPECTED state that must render honestly, never crash and never be fabricated.
 *
 * Making that a union rather than an `optional: boolean` means `placeholderPath` cannot be omitted on
 * a generated source and cannot be supplied on a required one — the resolver has no unreachable
 * branch to get wrong.
 */

/** Every content source this site knows how to mount. Order is navbar order. */
export const CONTENT_SOURCE_IDS = ['handbook', 'infrastructure', 'components', 'design'] as const;

export type ContentSourceId = (typeof CONTENT_SOURCE_IDS)[number];

interface ContentSourceBase {
    /** Stable identity; doubles as the Docusaurus docs-plugin instance id. */
    readonly id: ContentSourceId;
    /** Navbar label. Developer-facing English — see the localization note in the package README. */
    readonly label: string;
    /** Site route this source is served at, e.g. `/architecture`. */
    readonly routeBasePath: string;
    /**
     * Repo-root-relative POSIX path of the directory holding the Markdown.
     * Repo-root-relative (not absolute) so the registry stays a pure, comparable value.
     */
    readonly contentPath: string;
    /** Docusaurus `include` globs, relative to `contentPath`. An ALLOWLIST, never a blocklist. */
    readonly include: readonly string[];
}

/** Committed, hand-written material. Absent ⇒ the build fails. */
export interface RequiredContentSource extends ContentSourceBase {
    readonly availability: 'required';
}

/** Material emitted by a generator. Absent ⇒ the placeholder is mounted in its place. */
export interface GeneratedContentSource extends ContentSourceBase {
    readonly availability: 'generated';
    /** Package-relative POSIX path of the directory mounted when `contentPath` has no content. */
    readonly placeholderPath: string;
}

export type ContentSource = RequiredContentSource | GeneratedContentSource;

/** A source whose Markdown was found on disk. */
export interface PresentContentSource {
    readonly id: ContentSourceId;
    readonly label: string;
    readonly routeBasePath: string;
    readonly state: 'present';
    /** Repo-root-relative POSIX path Docusaurus should mount. */
    readonly mountPath: string;
    readonly include: readonly string[];
}

/** A generated source that has not been generated yet; the placeholder is mounted instead. */
export interface AwaitingGenerationContentSource {
    readonly id: ContentSourceId;
    readonly label: string;
    readonly routeBasePath: string;
    readonly state: 'awaitingGeneration';
    /** Repo-root-relative POSIX path Docusaurus should mount (the placeholder). */
    readonly mountPath: string;
    readonly include: readonly string[];
    /** Where the generator is expected to write. Reported so the placeholder page can name it. */
    readonly expectedPath: string;
}

export type ResolvedContentSource = PresentContentSource | AwaitingGenerationContentSource;
