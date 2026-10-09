/**
 * @module @commise/features-recipes — where cook marks are kept on native: memory (blueprint A13). They last while the
 * app runs and end at sign-out through the store's session scope; nothing is written to the device.
 */
import { memoryCookMarksBackend, type CookMarksBackend } from './cookMarksStore.js';

/**
 * The backend this platform keeps cook marks in.
 *
 * @returns An in-memory backend.
 */
export function defaultCookMarksBackend(): CookMarksBackend {
    return memoryCookMarksBackend();
}
