/**
 * U12 — the operator CLI's pure command parser. The fetch orchestration it drives is two routes that are
 * themselves integration- and e2e-tested (`promotionsApi.integration.test.ts`, `foodsApi.e2e.test.ts`);
 * what a unit can pin is that the parser refuses malformed invocations rather than firing a request at a
 * mangled path.
 */
import { describe, expect, it } from 'vitest';

import { parseInvocation } from '../promoteCli.js';

describe('parseInvocation', () => {
    it('accepts the four documented shapes', () => {
        expect(parseInvocation(['pending'])).toEqual({ command: 'pending', args: [] });
        expect(parseInvocation(['approve', 'row-1'])).toEqual({ command: 'approve', args: ['row-1'] });
        expect(parseInvocation(['reject', 'row-1'])).toEqual({ command: 'reject', args: ['row-1'] });
        expect(parseInvocation(['phase2', 'shared blend', 'food-1'])).toEqual({
            command: 'phase2',
            args: ['shared blend', 'food-1'],
        });
    });

    it.each([
        [[]],
        [['pending', 'extra']],
        [['approve']],
        [['approve', 'a', 'b']],
        [['phase2', 'only-one']],
        [['publish', 'row-1']],
    ])('refuses %j', (argv) => {
        expect(parseInvocation(argv as string[])).toBeUndefined();
    });
});
