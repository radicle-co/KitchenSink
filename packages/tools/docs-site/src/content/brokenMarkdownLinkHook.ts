import { existsSync } from 'node:fs';

import { REPO_ROOT, SITE_DIR } from './paths.js';
import { REPOSITORY_BROWSE_URL, REPOSITORY_REF } from './repository.js';
import type { BrokenMarkdownLink } from './repositoryLinkFallback.js';
import { resolveRepositoryLink } from './repositoryLinkFallback.js';

/**
 * Docusaurus's `markdown.hooks.onBrokenMarkdownLinks` handler.
 *
 * The impure shell around {@link resolveRepositoryLink}: this supplies the filesystem and the
 * repository coordinates, and every decision about what a link MEANS lives in the pure policy.
 *
 * Returning a string replaces the link; returning `undefined` leaves Docusaurus to report it under
 * the configured severity — which is what keeps a genuine typo a build failure rather than a 404.
 *
 * @sideEffect Reads the filesystem.
 */
export function onBrokenMarkdownLink(link: BrokenMarkdownLink): string | undefined {
    return resolveRepositoryLink(link, {
        repoRoot: REPO_ROOT,
        siteDir: SITE_DIR,
        repositoryUrl: REPOSITORY_BROWSE_URL,
        ref: REPOSITORY_REF,
        fileExists: existsSync,
    });
}
