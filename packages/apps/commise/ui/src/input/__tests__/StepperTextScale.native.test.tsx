import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { FONT_SCALE_CAP } from '../../text/fontScaleCap.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { nativeTokens } from '../../tokens/native.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Stepper } from '../Stepper.native.js';

/**
 * Stepper (native) text scale: the count and the label are drawn by the house `Text` with a type role, so both grow
 * with the system text size and stop at the house cap (2x, ADR-0080 section 8). Before this, both used React Native's
 * raw `Text`, which iOS grew without limit (a "100" drew at about 50 pt at AX5, issue 252).
 */

afterEach(cleanup);

const IOS_AX5_SCALE = 3.1;

function renderStepper(textScale: number): void {
    renderWithTamagui(
        <Stepper
            id="servings"
            label="Servings"
            value={100}
            onChange={() => undefined}
            announce={(n) => `Serves ${String(n)}`}
            decreaseLabel="Fewer servings"
            increaseLabel="More servings"
        />,
        'light',
        textScale,
    );
}

function sizeOf(text: string): number {
    return Number.parseFloat(getComputedStyle(screen.getByText(text)).fontSize);
}

describe('Stepper (native) text scale', () => {
    it('draws the count and the label at the base type sizes at 1x', () => {
        renderStepper(1);

        expect(sizeOf('100')).toBe(nativeTokens.type.body.fontSize);
        expect(sizeOf('Servings')).toBe(nativeTokens.type.label.fontSize);
    });

    it('grows the count and the label with the system text size', () => {
        renderStepper(1.5);

        expect(sizeOf('100')).toBe(scaledTypeSize('body', 1.5).fontSize);
        expect(sizeOf('Servings')).toBe(scaledTypeSize('label', 1.5).fontSize);
    });

    it('stops the count and the label at the cap at iOS AX5', () => {
        renderStepper(IOS_AX5_SCALE);

        expect(sizeOf('100')).toBe(nativeTokens.type.body.fontSize * FONT_SCALE_CAP);
        expect(sizeOf('Servings')).toBe(nativeTokens.type.label.fontSize * FONT_SCALE_CAP);
    });
});
