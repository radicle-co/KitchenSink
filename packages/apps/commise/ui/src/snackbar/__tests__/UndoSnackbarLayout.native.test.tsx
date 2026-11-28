/**
 * Where Undo lands in the native snackbar, read from the real Yoga layout engine (`testing/yogaSnackbarLayout.ts`), not
 * from the declared style. Issue 409: the declared rows were green while the device kept Undo beside the message at
 * twice the text size, because Yoga keeps a message that may shrink on the line and squeezes it, where CSS breaks the
 * line on its basis. Written before the fix, against the shrinking message.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asLoadedFace, measureTextWidth } from '../../testing/measureText.js';
import { present } from '../../testing/present.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { snackbarBarOf, undoFrameOf } from '../../testing/undoSnackbarParts.js';
import { layOutSnackbar, type SnackbarLayout } from '../../testing/yogaSnackbarLayout.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { bodyFontFace } from '../../tokens/scale.js';
import { typeRole } from '../../tokens/typography.js';

/** The system text size the test sets, read through `useWindowDimensions`. */
const text = vi.hoisted(() => ({ scale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: text.scale }) };
});

import { UndoSnackbar } from '../UndoSnackbar.native.js';

afterEach(() => {
    cleanup();
    text.scale = 1;
});

/** A phone: a 360 pt screen with the host's 14 pt margin on each side, which the bar fills. */
const BAR_WIDTH = 332;
/** The bar's own padding on each side. */
const PADDING = 16;
const LONG = 'Removed Slow-roasted tomato and white bean stew from your Weeknight Dinners collection.';
const SHORT = 'Recipe deleted';

const layOut = (message: string, adjust: (bar: HTMLElement) => void = () => undefined): SnackbarLayout => {
    renderWithTamagui(
        <UndoSnackbar
            message={message}
            action={{ label: 'Undo', onAction: vi.fn() }}
            onPause={vi.fn()}
            onResume={vi.fn()}
        />,
        'light',
    );
    const messageElement = screen.getByText(message);
    const undo = screen.getByRole('button', { name: 'Undo' });

    const bar = snackbarBarOf(messageElement, undo);
    adjust(bar);

    return layOutSnackbar(
        {
            bar,
            messageBox: present(messageElement.parentElement, 'the message box'),
            actionSlot: present(undo.parentElement, "Undo's slot"),
            actionFrame: undoFrameOf(undo),
        },
        { message, label: 'Undo', systemScale: text.scale },
        BAR_WIDTH,
    );
};

/** Whether Undo's frame sits under the message box, on a row of its own. */
const isUnder = (layout: SnackbarLayout): boolean =>
    layout.actionFrame.top >= layout.messageBox.top + layout.messageBox.height;

describe('UndoSnackbar (native) layout, in the real Yoga engine', () => {
    it('drops Undo under a long message at twice the text size, which then uses the whole content width', () => {
        text.scale = 2;
        const layout = layOut(LONG);

        expect(isUnder(layout)).toBe(true);
        expect(layout.messageBox.width).toBe(BAR_WIDTH - 2 * PADDING);
        // Undo stays at the end of its row.
        expect(layout.actionFrame.left + layout.actionFrame.width).toBe(BAR_WIDTH - PADDING);
    });

    it('keeps Undo beside a long message at the default text size, where the message still has room', () => {
        const layout = layOut(LONG);

        expect(isUnder(layout)).toBe(false);
        expect(layout.actionFrame.left).toBeGreaterThanOrEqual(layout.messageBox.left + layout.messageBox.width);
    });

    it('leaves Undo at the end of the row beside a short message', () => {
        const layout = layOut(SHORT);

        expect(isUnder(layout)).toBe(false);
        expect(layout.actionFrame.left + layout.actionFrame.width).toBe(BAR_WIDTH - PADDING);
    });

    it('never makes the message wider than the bar, at any text size', () => {
        text.scale = 3;
        const layout = layOut(LONG);

        expect(layout.messageBox.width).toBeLessThanOrEqual(BAR_WIDTH - 2 * PADDING);
    });

    it("sizes Undo's frame from the label role, not the body role (mutant: the label measured as body text)", () => {
        text.scale = 2;
        const layout = layOut(LONG);
        const label = 'Undo';
        const face = asLoadedFace(bodyFontFace[typeRole.label.weight]);
        const width = measureTextWidth(label, face, scaledTypeSize('label', text.scale).fontSize);
        const frame = undoFrameOf(screen.getByRole('button', { name: label }));
        const padding = Number.parseFloat(resolvedStyle(frame, 'paddingLeft')) * 2;
        const floor = Number.parseFloat(resolvedStyle(frame, 'minWidth'));

        expect(layout.actionFrame.width).toBeCloseTo(Math.max(floor, width + padding), 0);
    });

    it('refuses a style it cannot model, so a changed style cannot leave the harness laying out another bar', () => {
        text.scale = 1;

        expect(() =>
            layOut(SHORT, (bar) => {
                bar.style.alignItems = 'flex-end';
            }),
        ).toThrow(/cannot model alignItems/u);
    });
});
