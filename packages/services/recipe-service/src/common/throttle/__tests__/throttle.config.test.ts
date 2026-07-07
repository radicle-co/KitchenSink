import { describe, it, expect } from 'vitest';

import {
    THROTTLE_WINDOW_MS,
    ThrottleGroup,
    photoThrottle,
    searchThrottle,
    throttleGroups,
    writeThrottle,
} from '../throttle.config.js';

describe('throttle configuration', () => {
    it('uses a one-minute window expressed in milliseconds', () => {
        expect(THROTTLE_WINDOW_MS).toBe(60_000);
    });

    it('limits write endpoints to 30 requests per minute', () => {
        expect(writeThrottle).toEqual({ name: ThrottleGroup.WRITES, limit: 30, ttl: 60_000 });
    });

    it('limits photo-upload endpoints to 10 requests per minute', () => {
        expect(photoThrottle).toEqual({ name: ThrottleGroup.PHOTOS, limit: 10, ttl: 60_000 });
    });

    it('limits search endpoints to 60 requests per minute', () => {
        expect(searchThrottle).toEqual({ name: ThrottleGroup.SEARCH, limit: 60, ttl: 60_000 });
    });

    it('exposes every group in a single array for ThrottlerModule registration', () => {
        expect(throttleGroups).toEqual([writeThrottle, photoThrottle, searchThrottle]);
    });

    it('has a unique name per group', () => {
        const names = throttleGroups.map((group) => group.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('shares the one-minute window across every group', () => {
        for (const group of throttleGroups) {
            expect(group.ttl).toBe(THROTTLE_WINDOW_MS);
        }
    });
});
