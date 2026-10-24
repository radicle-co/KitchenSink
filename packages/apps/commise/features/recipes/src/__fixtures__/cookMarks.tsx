/**
 * @module @commise/features-recipes — the session's cook-marks scope for a test, as each app root mounts it: a
 * `CookMarksProvider` over a fresh in-memory backend, so no test leaks a mark into another.
 */
import type { FC, ReactNode } from 'react';

import { CookMarksProvider } from '../detail/CookMarksProvider.js';
import { memoryCookMarksBackend } from '../detail/cookMarksStore.js';

/** A test's cook-marks scope: one cook, one fresh store. */
export const CookMarksTestProvider: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <CookMarksProvider subject="user_test" backend={memoryCookMarksBackend()}>
        {children}
    </CookMarksProvider>
);

/**
 * What a detail body's shell binds, at rest: no marks, Screen on off, the description clamped. For a test that renders
 * the PURE body (`RecipeDetailBody`) directly. Spread it, then override what the test is about.
 */
export const idleDetailBodyState = {
    marks: {
        checkedLines: new Set<string>(),
        currentStep: undefined,
        toggleLine: (): void => undefined,
        toggleStep: (): void => undefined,
    },
    screenOn: { on: false, onChange: (): void => undefined },
    descriptionExpanded: false,
    onToggleDescription: (): void => undefined,
} as const;
