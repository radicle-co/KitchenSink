/**
 * The `over` prop is retired (`componentFixes.md` §10): a button reads the surface it sits on, so there is no per-site
 * "what am I over" to get wrong. This pins it at the type level, which is where a prop's return would be a compile error
 * in every caller and not a test failure in one. Mutation lens: add `over` back to `ButtonCommon` and this file stops
 * compiling.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ButtonProps } from '../props.js';

describe('ButtonProps', () => {
    it('has no `over` prop on any tier', () => {
        type HasOver<T> = T extends unknown ? ('over' extends keyof T ? true : false) : never;

        expectTypeOf<HasOver<ButtonProps>>().toEqualTypeOf<false>();
        expect(true).toBe(true);
    });
});
