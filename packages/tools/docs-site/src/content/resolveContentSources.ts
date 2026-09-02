import { MissingContentSourceError } from './contentSource.errors.js';
import type { ContentSource, ResolvedContentSource } from './contentSource.js';

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
            return {
                id: source.id,
                label: source.label,
                routeBasePath: source.routeBasePath,
                state: 'present',
                mountPath: source.contentPath,
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
