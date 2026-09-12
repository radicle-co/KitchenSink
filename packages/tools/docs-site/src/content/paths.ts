import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The two filesystem anchors this package needs, derived once.
 *
 * Every other module states paths as repo-root-relative POSIX strings — which keeps the registry a
 * plain comparable value — and this module is the single place that turns those into real locations.
 */

/** Absolute path of the Docusaurus site directory (this package's root). */
export const SITE_DIR: string = resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * Site-directory-relative path of the repository root, in the form Docusaurus wants for `path`
 * options (it resolves plugin paths against the site directory, not the config file).
 *
 * Pinned against {@link REPO_ROOT} by `contentRegistry.test.ts`, so moving this package fails a test
 * rather than silently mounting the wrong tree.
 */
export const SITE_TO_REPO_ROOT = '../../..';

/** Absolute path of the repository root. */
export const REPO_ROOT: string = resolve(SITE_DIR, SITE_TO_REPO_ROOT);
