/**
 * @module mobile/storage — the phone's kept cooking-session store (ADR-0094 sections 3 and 6), composed over the
 * device storage in `deviceStorage.ts`.
 */
import { createKeptSessionStore } from '@commise/features-recipes/session';

import { reportErrorToSentry } from '../observability/sentryErrorReporter.js';
import { nativeExclusiveRunner, nativeKeptPort } from './deviceStorage.js';

/** The phone's one kept store. A runner always exists here, so `warn` is never called. */
export const nativeKeptSessionStore = createKeptSessionStore({
    port: nativeKeptPort,
    exclusiveOf: () => nativeExclusiveRunner,
    now: () => new Date().toISOString(),
    report: reportErrorToSentry,
    warn: () => undefined,
});
