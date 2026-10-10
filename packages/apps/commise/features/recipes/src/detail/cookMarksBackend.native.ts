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

/**
 * The native half of the sign-out's cook-marks end. Nothing to do: native keeps marks in memory only, and the
 * provider's session scope removes them when the cook changes — there is no document load to outrun it.
 */
export function clearStoredCookMarks(): void {}
