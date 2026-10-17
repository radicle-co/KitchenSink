/**
 * The one lookup every extractor makes of its upstream files (plan U23): a role's verified bytes, or a named refusal.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { isTableFormatError } from '../tableExtract.errors.js';
import { upstreamOf } from '../tableExtractor.js';

describe('upstreamOf', () => {
    it('returns the bytes given for the role', () => {
        const bytes = Buffer.from('workbook');

        expect(upstreamOf(new Map([['table', bytes]]), 'table')).toBe(bytes);
    });

    it('refuses a role no file was given for, naming the role', () => {
        let thrown: unknown;

        try {
            upstreamOf(new Map([['foods', Buffer.from('x')]]), 'composition');
        } catch (error) {
            thrown = error;
        }

        expect(isTableFormatError(thrown)).toBe(true);
        expect(String(thrown)).toContain('composition');
    });
});
