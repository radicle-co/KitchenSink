/**
 * motionPropsOf — the one place the design system decides whether a Tamagui element animates.
 *
 * Only a KNOWN `false` answer moves: React Native reads the setting asynchronously, so `undefined` ("not read yet") must
 * not animate, or the first open of every session would play motion for a cook who turned it off.
 */
import { describe, expect, it } from 'vitest';

import { motionPropsOf } from '../motionPropsOf.js';

const INSTANT = { type: 'timing', duration: 0 };

describe('motionPropsOf', () => {
    it('names the sheet spring and sets no instant config when reduce motion is known to be off', () => {
        const { sheet } = motionPropsOf(false);

        expect(sheet).toEqual({ transition: 'sheet' });
    });

    it('fades the overlay in and out when reduce motion is known to be off', () => {
        const { overlay } = motionPropsOf(false);

        // Tamagui 3 removed `enterStyle` and `exitStyle` (a device logs `prop "enterStyle" was removed in v3`); a fade is the
        // opacity clause `value enter:start exit:end`.
        expect(overlay).toEqual({ transition: 'sheet', opacity: '1 enter:0 exit:0' });
    });

    it.each([
        ['on', true],
        ['not read yet', undefined],
    ] as const)('moves the sheet instantly, with no named spring, when reduce motion is %s', (_state, answer) => {
        const { sheet } = motionPropsOf(answer);

        expect(sheet).toEqual({ transitionConfig: INSTANT });
        expect(sheet).not.toHaveProperty('transition');
    });

    // Rewritten 2026-11-12: the overlay keeps its `transition` in every mode, so an open overlay never gains or loses it
    // (Tamagui's animation hooks follow that prop); with no opacity clause there is still nothing to fade.
    it.each([
        ['on', true],
        ['not read yet', undefined],
    ] as const)('gives the overlay no fade, but keeps its transition, when reduce motion is %s', (_state, answer) => {
        expect(motionPropsOf(answer).overlay).toEqual({ transition: 'sheet' });
    });

    it('keeps the same overlay prop keys apart from the fade in every mode', () => {
        const keys = (answer: boolean | undefined): string[] =>
            Object.keys(motionPropsOf(answer).overlay).filter((key) => key !== 'opacity');

        expect(keys(true)).toEqual(keys(false));
        expect(keys(undefined)).toEqual(keys(false));
    });
});
