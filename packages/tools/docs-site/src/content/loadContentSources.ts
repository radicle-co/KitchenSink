import { globSync } from 'node:fs';
import { join } from 'node:path';

import { CONTENT_SOURCES } from './contentRegistry.js';
import type { ResolvedContentSource } from './contentSource.js';
import { REPO_ROOT } from './paths.js';
import { resolveContentSources } from './resolveContentSources.js';

/**
 * Answers whether a repo-root-relative directory currently holds any Markdown.
 *
 * "Holds Markdown", not "exists": a generator that has created its output directory but not yet
 * written into it — or one that wrote a `manifest.json` and no rendered view — leaves a directory
 * that exists and documents nothing. Treating that as present hands Docusaurus an empty corpus and
 * produces a section with no pages, which is the dishonest outcome the placeholder exists to avoid.
 *
 * Exported for its own test tier: the case that matters — a directory that EXISTS and holds no
 * documentation — cannot be observed against the committed tree, so it is built on disk instead.
 *
 * @sideEffect Reads the filesystem.
 */
export function hasMarkdownContent(repoRelativePath: string): boolean {
    // `globSync` answers `[]` for a path that does not exist, so absence and emptiness collapse into
    // the one question this predicate is actually asking.
    return globSync('**/*.{md,mdx}', { cwd: join(REPO_ROOT, repoRelativePath) }).length > 0;
}

/**
 * Resolves the declared registry against this checkout.
 *
 * The impure shell around the pure {@link resolveContentSources} policy: this function supplies the
 * filesystem, and every rule about what an absence MEANS lives in the policy where it can be proved.
 *
 * @sideEffect Reads the filesystem.
 * @throws `MissingContentSourceError` when a required documentation source has no Markdown behind it.
 */
export function loadContentSources(): ResolvedContentSource[] {
    return resolveContentSources(CONTENT_SOURCES, hasMarkdownContent);
}
