/**
 * The Clerk webhook boundary for the username (plan 2026-10-15-010 D4/D5). Clerk sends `username` on every user
 * payload, `null` for a user without one; the bound is identity-core's, so a value Clerk could not have accepted is
 * refused here rather than written to `profiles.username` and fanned out to the recipe database.
 */
import { MAX_USERNAME_LENGTH } from '@kitchensink/identity-core';
import { describe, expect, it } from 'vitest';

import { idpWebhookEventSchema } from '../idpPayload.schema.js';

function userEvent(type: 'user.created' | 'user.updated', extra: Record<string, unknown>) {
    return {
        type,
        object: 'event',
        data: {
            id: 'user_1',
            email_addresses: [{ email_address: 'a@b.com' }],
            first_name: 'A',
            last_name: 'B',
            ...extra,
        },
    };
}

describe.each(['user.created', 'user.updated'] as const)('%s username', (type) => {
    it('carries the username Clerk sent', () => {
        const parsed = idpWebhookEventSchema.parse(userEvent(type, { username: 'goodfellow' }));

        expect(parsed.data).toHaveProperty('username', 'goodfellow');
    });

    it.each([
        ['null (a user without one)', { username: null }],
        ['absent', {}],
        ['exactly the bound', { username: 'u'.repeat(MAX_USERNAME_LENGTH) }],
    ])('accepts %s', (_case, extra) => {
        expect(idpWebhookEventSchema.safeParse(userEvent(type, extra)).success).toBe(true);
    });

    it.each([
        ['empty', { username: '' }],
        ['past the bound', { username: 'u'.repeat(MAX_USERNAME_LENGTH + 1) }],
        ['not a string', { username: 42 }],
    ])('refuses a username that is %s', (_case, extra) => {
        expect(idpWebhookEventSchema.safeParse(userEvent(type, extra)).success).toBe(false);
    });
});
