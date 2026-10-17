import { describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

describe('scalarText', () => {
    it('reads a YAML scalar as its text', () => {
        expect(scalarText('node_modules')).toBe('node_modules');
        expect(scalarText(true)).toBe('true');
        expect(scalarText(30)).toBe('30');
    });

    it('reads an absent value as the fallback', () => {
        expect(scalarText(undefined)).toBe('');
        expect(scalarText(null, 'false')).toBe('false');
    });

    it('⛔ refuses a mapping or a sequence rather than reading it as "[object Object]"', () => {
        expect(() => scalarText({ path: 'x' })).toThrow(/mapping/u);
        expect(() => scalarText(['a', 'b'])).toThrow(/sequence/u);
    });
});
