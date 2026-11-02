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

        expect(overlay).toEqual({ transition: 'sheet', enterStyle: { opacity: 0 }, exitStyle: { opacity: 0 } });
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
});
