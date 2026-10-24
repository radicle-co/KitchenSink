/**
 * The response headers api.data.gov reports the key's own quota in (ADR-0053 §5). Food-service's source register
 * declares them for its block rule, and the remote search service passes them through to food-service, so both read
 * one statement of their names.
 */
import { describe, expect, it } from 'vitest';

import { USDA_QUOTA_HEADERS } from '../quotaHeaders.js';

describe('USDA_QUOTA_HEADERS', () => {
    it('names the two api.data.gov rate-limit headers', () => {
        expect(USDA_QUOTA_HEADERS).toStrictEqual({
            remainingHeader: 'X-RateLimit-Remaining',
            limitHeader: 'X-RateLimit-Limit',
        });
    });

    it('cannot be changed at run time', () => {
        expect(Object.isFrozen(USDA_QUOTA_HEADERS)).toBe(true);
    });
});
