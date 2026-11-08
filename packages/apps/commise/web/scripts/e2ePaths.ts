/**
 * Where the local Playwright door keeps its files. One home for each path so the modules agree.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../..');

/** Where each lane's log, the listing and the merged report go. */
export const LANE_LOG_DIR = 'test-results/lanes';

/** Where each lane's blob report goes before the merge. */
export const BLOB_DIR = 'blob-report';

/** Where the route recorder (`tests/e2e/utils/routeRecorder.ts`) writes, one file per lane. */
export const ROUTES_DIR = 'test-results/routes';

/** The committed duration table the lanes are balanced by (`npm run e2e:durations` rewrites it). */
export const DURATIONS_FILE = 'tests/e2e/testDurations.json';
