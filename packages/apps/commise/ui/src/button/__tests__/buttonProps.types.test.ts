/**
 * The `over` prop is retired (`componentFixes.md` §10): a button reads the surface it sits on, so there is no per-site
 * "what am I over" to get wrong. This pins it at the type level, which is where a prop's return would be a compile error
 * in every caller and not a test failure in one. Mutation lens: add `over` back to `ButtonCommon` and this file stops
 * compiling.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { glyphToneOf, type ButtonProps } from '../props.js';

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

    // The action glyph is a SECONDARY option: a filled tier's glyph sits on its fill, and ghost is already actionText.
    it('offers glyphTone on secondary alone', () => {
        type Toned<V extends string> = {
            readonly variant: V;
            readonly icon: 'chevronRight';
            readonly glyphTone: 'action';
            readonly children: string;
        };

        expectTypeOf<Toned<'secondary'>>().toExtend<ButtonProps>();
        expectTypeOf<Toned<'primary'>>().not.toExtend<ButtonProps>();
        expectTypeOf<Toned<'ghost'>>().not.toExtend<ButtonProps>();
        expectTypeOf<Toned<'quiet'>>().not.toExtend<ButtonProps>();
        expectTypeOf<Toned<'destructive'>>().not.toExtend<ButtonProps>();
        expect(true).toBe(true);
    });
});

describe('glyphToneOf', () => {
    it('defaults to label, so every existing button keeps its glyph colour', () => {
        expect(glyphToneOf({ variant: 'secondary', icon: 'chevronLeft', children: 'Back' })).toBe('label');
        expect(glyphToneOf({ icon: 'plus', children: 'Add' })).toBe('label');
    });

    it('answers action for a secondary that asks for it, including while busy', () => {
        const toned = { variant: 'secondary', icon: 'chevronRight', glyphTone: 'action', children: 'Next' } as const;

        expect(glyphToneOf(toned)).toBe('action');
        // Busy wins over disabled and refused, as everywhere on the button: the spinner keeps the tone.
        expect(glyphToneOf({ ...toned, busy: true, disabled: true, refused: true })).toBe('action');
    });

    it('drops the action cue on a disabled or refused button that is not busy', () => {
        const toned = { variant: 'secondary', icon: 'chevronRight', glyphTone: 'action', children: 'Next' } as const;

        expect(glyphToneOf({ ...toned, disabled: true })).toBe('label');
        expect(glyphToneOf({ ...toned, refused: true })).toBe('label');
    });
});
