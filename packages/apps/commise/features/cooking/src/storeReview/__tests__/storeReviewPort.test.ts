import { describe, expect, it } from 'vitest';

import { STORE_REVIEW_REQUESTED_EVENT, isForwardedAnalyticsEvent } from '../storeReviewPort.js';

describe('isForwardedAnalyticsEvent (the one event S12 sends, po P53)', () => {
    it('is true for the S12 event name', () => {
        expect(isForwardedAnalyticsEvent(STORE_REVIEW_REQUESTED_EVENT)).toBe(true);
    });

    it.each(['anything.else', 'cooking.storeReview', `${STORE_REVIEW_REQUESTED_EVENT}.x`, ''])(
        'is false for %j (another name, a prefix, an extension, empty)',
        (name) => {
            expect(isForwardedAnalyticsEvent(name)).toBe(false);
        },
    );
});
