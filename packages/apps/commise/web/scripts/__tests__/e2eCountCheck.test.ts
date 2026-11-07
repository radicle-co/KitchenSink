// @vitest-environment node
/**
 * The argument check of `scripts/e2eCountCheck.ts`. A count that is not a whole number must fail the shard, because a
 * check that quietly reads `NaN` as "equal to anything" is no check. The listing itself runs Playwright and is
 * exercised by the CI wiring guard, not here.
 */
import { describe, expect, it, vi } from 'vitest';

import { main } from '../e2eCountCheck';

describe('e2eCountCheck main', () => {
    it.each([[[]], [['abc']], [['-1']], [['1.5']]])('refuses the expected count %j', (args) => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(main(args)).toBe(1);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
