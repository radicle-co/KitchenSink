import { describe, expect, it } from 'vitest';

import { pseudonymizeId, scrubLogInput } from '../log-scrub.js';

describe('log-scrub', () => {
    describe('pseudonymizeId', () => {
        it('is deterministic, prefixed, and non-reversible in shape', () => {
            const raw = '01JQ8N2X4RBV6WK3ZT5Y7A9C0P';
            const token = pseudonymizeId(raw);
            expect(token).toMatch(/^anon_[0-9a-f]{16}$/);
            expect(pseudonymizeId(raw)).toBe(token);
            expect(pseudonymizeId('user_2abcDEF')).not.toBe(token);
            expect(token).not.toContain(raw);
        });
    });

    describe('scrubLogInput', () => {
        it('pseudonymizes person-linked id VALUES, leaves bare/non-person ids, redacts secrets', () => {
            const out = scrubLogInput({
                ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                userId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                sub: 'user_2abcDEF',
                jobId: 'job-1',
                recipeId: 'rec-1',
                count: 3,
                token: 'secret',
                nested: { requesterId: 'svc_import', note: 'ok' },
            });

            expect(out.ownerId).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.ownerId).not.toBe('01JQ8N2X4RBV6WK3ZT5Y7A9C0P');
            expect(out.userId).toBe(out.ownerId); // same id → same token (correlatable)
            expect(out.sub).toBe(pseudonymizeId('user_2abcDEF'));
            expect(out.jobId).toBe('job-1'); // non-person id untouched
            expect(out.recipeId).toBe('rec-1');
            expect(out.count).toBe(3);
            expect(out.token).toBe('[redacted]');
            expect(out.nested.requesterId).toBe(pseudonymizeId('svc_import'));
            expect(out.nested.note).toBe('ok');
        });

        it('passes Error instances through unchanged (does not drop message/stack)', () => {
            const err = new Error('boom');
            expect(scrubLogInput(err)).toBe(err);
            expect((scrubLogInput(err) as Error).message).toBe('boom');
        });
    });
});
