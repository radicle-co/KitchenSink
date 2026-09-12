/**
 * @module @commise/test-utils/async-util-budget — Testing Library's async-util budget for every Commise UI suite.
 *
 * `waitFor` and `findBy*` carry their OWN timeout (1000 ms by default), independent of vitest's `testTimeout`, so
 * a suite configured at 30 s still fails any wait that needs more than one second. Several screens gate their UI
 * behind a real debounce (`DISCOVERY_SEARCH_DEBOUNCE_MS`, 250 ms), and CI runs the monorepo's suites as dozens of
 * concurrent turbo tasks whose event-loop contention can consume the rest of that second.
 *
 * Raising the budget weakens no assertion: every `findBy*` still requires the element to appear, and a missing
 * element or a wrong value still fails, only after a longer wait. Fake timers are not the alternative — they would
 * defeat the tests that assert real debounce timing.
 *
 * Imported by each package's test setup (`web/tests/setup.ts`, `features/recipes/vitest.setup.ts`,
 * `mobile/tests/setup.native.ts`) through its own subpath, so a setup file does not load the provider helpers.
 */
import { configure } from '@testing-library/react';

/** The async-util budget, in milliseconds, shared by every Commise UI test setup. */
export const ASYNC_UTIL_TIMEOUT_MS = 5_000;

/**
 * Apply {@link ASYNC_UTIL_TIMEOUT_MS} to Testing Library's global configuration.
 *
 * @sideEffect Mutates Testing Library's process-wide configuration.
 */
export function configureAsyncUtilBudget(): void {
    configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });
}
