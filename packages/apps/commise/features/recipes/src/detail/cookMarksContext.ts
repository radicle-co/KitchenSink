/**
 * @module @commise/features-recipes — the context that carries the session's cook-marks store and the cook it belongs
 * to, from `CookMarksProvider` to `useCookMarks`. Absent outside a provider, which `useCookMarks` refuses.
 */
import { createContext } from 'react';

import type { CookMarksStore } from './cookMarksStore.js';

/** What a provider hands its subtree. */
export interface CookMarksScope {
    readonly store: CookMarksStore;
    /** The signed-in cook, or `undefined` while none is known. */
    readonly subject: string | undefined;
}

/** The session's cook-marks scope. */
export const CookMarksContext = createContext<CookMarksScope | undefined>(undefined);
