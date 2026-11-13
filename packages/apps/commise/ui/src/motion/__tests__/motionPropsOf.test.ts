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

    it.each([
        ['on', true],
        ['not read yet', undefined],
    ] as const)('gives the overlay no fade when reduce motion is %s', (_state, answer) => {
        expect(motionPropsOf(answer).overlay).toEqual({});
    });

    // An element whose props gain or lose a `transition` is keyed by the mode, so it remounts instead of changing hook count.
    it.each([
        ['off', false, 'moving'],
        ['on', true, 'still'],
        ['not read yet', undefined, 'still'],
    ] as const)('names the mode %s as %s', (_state, answer, mode) => {
        expect(motionPropsOf(answer).mode).toBe(mode);
    });
});
