import { describe, it, expect } from 'vitest';

import { outcomeDimensions } from '../outcome.js';

describe('outcomeDimensions', () => {
    it('emits only low-cardinality dimensions (outcome + path)', () => {
        const dims = outcomeDimensions({ outcome: 'created', path: 'webhook' });
        expect(dims).toEqual({ outcome: 'created', path: 'webhook' });
    });

    it('never includes a user id (cardinality guard)', () => {
        const dims = outcomeDimensions({ outcome: 'failed', path: 'read-through' });
        expect(Object.keys(dims)).toEqual(['outcome', 'path']);
        expect(JSON.stringify(dims)).not.toMatch(/user|sub|id/i);
    });
});
