import { MissingContentSourceError } from './contentSource.errors.js';
import { MIRROR_ROOT, type ContentSource, type ResolvedContentSource } from './contentSource.js';

/**
 * Whether `inner` lies strictly inside `outer`, compared by PATH SEGMENT.
 *
 * A string prefix test would call `docs-generated/x` a child of `docs`; both are repo-root-relative
 * POSIX paths with no `.`/`..` segments (the registry's own contract), so segment equality is the
 * whole comparison.
 */
function isInside(inner: string, outer: string): boolean {
    return inner.startsWith(`${outer}/`);
}

/**
 * Answers "does this repo-root-relative directory hold at least one Markdown document?".
 *
 * Passed in rather than imported so this module stays PURE and the degradation rules can be proved
 * without a filesystem. {@link resolveContentSources} is the policy; the predicate is the I/O.
 */
export type HasMarkdownContent = (repoRelativePath: string) => boolean;

/**
 * Resolves the declared content registry against what is actually on disk.
 *
 * Pattern: a policy module over a discriminated union, with the NULL OBJECT as its degradation path —
 * an ungenerated source resolves to a placeholder directory of the same shape, so every route in the
 * navbar exists whether or not its generator has run. That matters more than it looks: the failure
 * mode this site was built to end is documentation that *asserts* something it no longer reaches, and
 * a dangling navbar link is that failure in miniature.
 *
 * The two absences are treated differently ON PURPOSE, and collapsing them is the bug to avoid:
 * a missing `required` source is a REGRESSION (someone moved the ADRs), while a missing `generated`
 * source is an ORDINARY state (the generator has not run in this checkout yet).
 *
 * @param sources - The declared registry, in navbar order.
 * @param hasMarkdownContent - Predicate over the SOURCE path. Never consulted for a placeholder.
 * @returns One resolved source per declared source, in the same order.
 * @throws {MissingContentSourceError} When a `required` source has no Markdown behind it.
 */
export function resolveContentSources(
    sources: readonly ContentSource[],
    hasMarkdownContent: HasMarkdownContent,
): ResolvedContentSource[] {
    return sources.map((source) => {
        const present = hasMarkdownContent(source.contentPath);

        if (present) {
            // Docusaurus cannot serve two docs instances whose directories nest — see the "nested
            // content directories" block in this module's test for the measured failure. A nested
            // source is therefore mounted from a mirror; everything else is mounted where it lives.
            const nested = sources.some(
                (other) => other.id !== source.id && isInside(source.contentPath, other.contentPath),
            );

            return {
                id: source.id,
                label: source.label,
                routeBasePath: source.routeBasePath,
                state: 'present',
                mountPath: nested ? `${MIRROR_ROOT}/${source.id}` : source.contentPath,
                sourcePath: source.contentPath,
                include: source.include,
            };
        }

        if (source.availability === 'required') {
            throw new MissingContentSourceError(source.id, source.contentPath);
        }

        return {
            id: source.id,
            label: source.label,
            routeBasePath: source.routeBasePath,
            state: 'awaitingGeneration',
            mountPath: source.placeholderPath,
            include: source.include,
            expectedPath: source.contentPath,
        };
    });
}
