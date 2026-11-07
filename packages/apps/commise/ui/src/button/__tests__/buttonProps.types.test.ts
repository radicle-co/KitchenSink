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

    // Designer ruling 2026-11-03: a neutral safe choice ("Keep editing") is a `secondary` button with its border and NO glyph,
    // because an `x` on it reads as close or discard. The glyph stays required where it carries the action itself.
    it('requires a glyph for primary and destructive, and lets secondary, ghost and quiet go without one', () => {
        type Bare<V extends string> = { readonly variant: V; readonly children: string };

        expectTypeOf<Bare<'secondary'>>().toExtend<ButtonProps>();
        expectTypeOf<Bare<'ghost'>>().toExtend<ButtonProps>();
        expectTypeOf<Bare<'quiet'>>().toExtend<ButtonProps>();
        expectTypeOf<Bare<'primary'>>().not.toExtend<ButtonProps>();
        expectTypeOf<Bare<'destructive'>>().not.toExtend<ButtonProps>();
        expectTypeOf<{ readonly children: string }>().not.toExtend<ButtonProps>();
        expect(true).toBe(true);
    });
});
