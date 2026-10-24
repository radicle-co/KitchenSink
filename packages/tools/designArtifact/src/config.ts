/**
 * @module config — where this package reads from and writes to. Every path derives from {@link REPO_ROOT}, the
 * same root the docs generator uses, so nothing here names a machine.
 */
import { join, resolve } from 'node:path';

import { REPO_ROOT } from '@kitchensink/docgen-components';

export { REPO_ROOT };

/** This package's root directory. */
export const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

/** The git-ignored publish payload. */
export const DIST_DIR = join(PACKAGE_ROOT, 'dist');

/** The authored content: the brand book, the cards and the canvas boards. */
export const CONTENT_DIR = join(PACKAGE_ROOT, 'content');

/** The Commise product tree. */
export const COMMISE_ROOT = join(REPO_ROOT, 'packages/apps/commise');

/** The design-system package's sources. */
export const UI_SRC = join(COMMISE_ROOT, 'ui/src');
