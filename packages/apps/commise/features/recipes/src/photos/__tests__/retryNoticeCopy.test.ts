/**
 * Owner ruling T23 (2026-10-29): a failed photo upload sits beside a Retry button, so its notice says only what went
 * wrong. Same rule as T7 (`form/__tests__/retryNoticeCopy.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { photoMessages } from '../messages.js';

describe('the failed photo upload notice', () => {
    it('says what went wrong and does not ask for a retry the Retry button already offers', () => {
        const { uploadError, queueRetry } = photoMessages.en;

        expect(queueRetry).toBe('Retry');
        expect(uploadError).toBe('We couldn’t upload that photo.');
    });
});
