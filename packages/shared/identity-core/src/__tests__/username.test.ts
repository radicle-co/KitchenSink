/**
 * The username boundary: one bound, taken from Clerk's documented limit, applied wherever a Clerk username enters
 * our system (the webhook payload, the handle-sync message, the token claim).
 */
import { describe, expect, it } from 'vitest';

import { MAX_USERNAME_LENGTH, parseUsername, usernameSchema } from '../username.js';

describe('usernameSchema', () => {
    it('is bounded at Clerk’s documented maximum of 64', () => {
        expect(MAX_USERNAME_LENGTH).toBe(64);
    });

    it.each([
        ['one character (a customised minimum is never refused)', 'a'],
        ['Clerk’s default minimum', 'abcd'],
        ['exactly the maximum', 'u'.repeat(64)],
        ['mixed case, kept as sent', 'GoodFellow'],
        ['digits, dash and underscore', 'cook_42-x'],
    ])('accepts %s', (_case, value) => {
        expect(usernameSchema.parse(value)).toBe(value);
    });

    it.each([
        ['empty', ''],
        ['one past the maximum', 'u'.repeat(65)],
        ['a number', 42],
        ['null', null],
    ])('refuses %s', (_case, value) => {
        expect(usernameSchema.safeParse(value).success).toBe(false);
    });

    it('stores what Clerk sends: no trim, no case fold', () => {
        expect(usernameSchema.parse('Mixed')).toBe('Mixed');
        expect(usernameSchema.safeParse(' padded ').success).toBe(true);
        expect(usernameSchema.parse(' padded ')).toBe(' padded ');
    });
});

describe('parseUsername', () => {
    it('returns a valid username unchanged', () => {
        expect(parseUsername('goodfellow')).toBe('goodfellow');
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['too long', 'u'.repeat(65)],
        ['not a string', 7],
    ])('drops a username that is %s', (_case, value) => {
        expect(parseUsername(value)).toBeUndefined();
    });
});
