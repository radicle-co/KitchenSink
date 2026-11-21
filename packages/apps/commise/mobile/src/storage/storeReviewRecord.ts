/**
 * @module mobile/storage — the phone's store-review record (S12 U2): the feature's record over the device storage port
 * the kept cooking-session store already uses, and its serial queue, so two writes in the same tick both land.
 *
 * It is deliberately outside `endDeviceSession`: a plain sign-out keeps the cook's entry. Only the close and erase
 * sequences clear it (`useLeaveAfterClearingReviewRecord`).
 *
 * @pattern Adapter — the feature's record bound to the phone's port, clock and reporter.
 */
import { createStoreReviewRecord } from '@commise/features-cooking/storeReview';

import { reportErrorToSentry } from '../observability/sentryErrorReporter.js';
import { nativeExclusiveRunner, nativeKeptPort } from './deviceStorage.js';

/** The phone's one store-review record. */
export const nativeStoreReviewRecord = createStoreReviewRecord({
    port: nativeKeptPort,
    exclusive: nativeExclusiveRunner,
    now: () => new Date().toISOString(),
    report: reportErrorToSentry,
});
