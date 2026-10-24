import { describe, expect, it } from 'vitest';

import { describeFailure } from '../describeFailure.js';

describe('describeFailure', () => {
    it('lists every esbuild message with its file and line', () => {
        const failure = {
            errors: [
                { text: 'Could not resolve "a"', location: { file: 'src/x.ts', line: 3 } },
                { text: 'No matching export', location: null },
                {},
            ],
        };

        expect(describeFailure(failure)).toBe(
            ['Could not resolve "a" (src/x.ts:3)', 'No matching export', 'unknown error'].join('\n'),
        );
    });

    it('uses the message of an ordinary Error', () => {
        expect(describeFailure(new Error('boom'))).toBe('boom');
    });

    it('stringifies anything else', () => {
        expect(describeFailure('plain')).toBe('plain');
        expect(describeFailure(7)).toBe('7');
    });
});
