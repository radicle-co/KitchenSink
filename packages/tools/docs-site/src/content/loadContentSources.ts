import { cpSync, globSync, rmSync } from 'node:fs';
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
 * Refills a mirror directory from the source it mirrors.
 *
 * REPLACES rather than merges: a document the generator stopped emitting must stop being published,
 * and a mirror that is only ever added to would keep serving it forever — the "documentation that
 * asserts something it no longer reaches" failure this site exists to end, reintroduced by its own
 * build step.
 *
 * @sideEffect Deletes and rewrites `${REPO_ROOT}/${mountPath}`.
 */
function fillMirror(sourcePath: string, mountPath: string): void {
    const destination = join(REPO_ROOT, mountPath);

    rmSync(destination, { recursive: true, force: true });
    cpSync(join(REPO_ROOT, sourcePath), destination, { recursive: true });
}

/**
 * Resolves the declared registry against this checkout, filling any mirror the policy asks for.
 *
 * The impure shell around the pure {@link resolveContentSources} policy: this function supplies the
 * filesystem, and every rule about what an absence MEANS — or about which sources may not be mounted
 * where they live — stays in the policy where it can be proved. The shell copies what it is told to
 * copy and decides nothing.
 *
 * ⚠️ The mirror is refilled when the config LOADS, so under `docusaurus start` a change to a mirrored
 * corpus needs a restart. That is the right trade for a corpus nobody hand-edits: its author is a
 * generator, and the generator run is already a separate command.
 *
 * @sideEffect Reads the filesystem, and rewrites the mirror directory of every nested source.
 * @throws `MissingContentSourceError` when a required documentation source has no Markdown behind it.
 */
export function loadContentSources(): ResolvedContentSource[] {
    const resolved = resolveContentSources(CONTENT_SOURCES, hasMarkdownContent);

    for (const source of resolved) {
        if (source.state === 'present' && source.mountPath !== source.sourcePath) {
            fillMirror(source.sourcePath, source.mountPath);
        }
    }

    return resolved;
}
