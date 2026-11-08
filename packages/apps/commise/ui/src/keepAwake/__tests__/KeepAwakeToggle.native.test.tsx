import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const keepAwake = vi.hoisted(() => ({
    activateKeepAwakeAsync: vi.fn((_tag?: string) => Promise.resolve()),
    deactivateKeepAwake: vi.fn((_tag?: string) => Promise.resolve()),
}));

vi.mock('expo-keep-awake', () => keepAwake);

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { Button } from '../../button/Button.native.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { KeepAwakeToggle } from '../KeepAwakeToggle.native.js';
import { useKeepAwake } from '../useKeepAwake.native.js';
import { pressScaleOf, render, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';

/**
 * The native `KeepAwakeToggle` and `useKeepAwake` (blueprint A20). Native always has the capability, so the toggle
 * always renders: a `switch` named "Screen on" with its checked state. The hook activates `expo-keep-awake` under a
 * tag of its own while `on` and deactivates THAT tag when `on` turns off or the screen unmounts, so a second holder
 * elsewhere in the app is never released by this one.
 */

beforeEach(() => {
    keepAwake.activateKeepAwakeAsync.mockClear();
    keepAwake.deactivateKeepAwake.mockClear();
});

afterEach(cleanup);

/**
 * REWRITTEN IN SLICE 1 (designer, iosBatch1): "Screen on" is a QUIET text action in the action row, after Edit recipe or Save a
 * copy: the sun glyph and the label, no outline and no fill, with the switch role and its checked state. It was a
 * separate outlined pill (the secondary Button surface), and the icon-only display is gone with the section switch.
 */
describe('KeepAwakeToggle (native)', () => {
    it('is a switch named by its label, reporting its state, with the label always drawn', () => {
        const onChange = vi.fn();
        render(<KeepAwakeToggle on={false} onChange={onChange} label="Screen on" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.textContent).toContain('Screen on');

        fireEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('shows checked when on, and turns off when pressed', () => {
        const onChange = vi.fn();
        render(<KeepAwakeToggle on onChange={onChange} label="Screen on" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });
        expect(toggle.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith(false);
    });
});

// The switch presses as a Button does: the SAME `PressScale`, so a held press shrinks it and reduce-motion calms it.
describe('KeepAwakeToggle (native) — presses like Button', () => {
    it.each([true, false])('carries the press-scale transform Button carries, on=%s', (on) => {
        render(
            <>
                <Button icon="check" variant="secondary" onPress={vi.fn()}>
                    Done
                </Button>
                <KeepAwakeToggle on={on} onChange={vi.fn()} label="Screen on" />
            </>,
        );

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(pressScaleOf(toggle)).toBe('1');
        expect(pressScaleOf(toggle)).toBe(pressScaleOf(screen.getByRole('button', { name: 'Done' })));
    });
});

/** `#RRGGBB` → the `rgb(r, g, b)` spelling a resolved colour is read as. */
const rgbOf = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
};

describe('KeepAwakeToggle (native) — the quiet action', () => {
    const row = (): HTMLElement => screen.getByRole('switch', { name: 'Screen on' }).firstElementChild as HTMLElement;

    it('has no fill and no outline, off or on', () => {
        for (const on of [false, true]) {
            render(<KeepAwakeToggle on={on} onChange={vi.fn()} label="Screen on" />);

            expect(resolvedColour(row(), 'backgroundColor')).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/u);
            expect(resolvedStyle(row(), 'borderTopWidth')).toBe('0px');
            cleanup();
        }
    });

    it('sets the label in the label role in ink', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);

        const label = screen.getByText('Screen on');

        expect(resolvedColour(label, 'color')).toBe(rgbOf(role.ink));
        expect(resolvedStyle(label, 'fontSize')).toBe(`${String(nativeTokens.type.label.fontSize)}px`);
    });

    it('is as tall as the platform touch floor', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);

        expect(Number.parseFloat(resolvedStyle(row(), 'minHeight'))).toBeGreaterThanOrEqual(44);
    });

    it('draws the sun glyph in the action text colour, decorative, filled only when on', () => {
        const sun = (): Element => document.querySelector('[data-icon-name="sun"]') as Element;

        const filled = (): boolean => !['none', null].includes(sun().getAttribute('data-icon-fill'));

        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);
        expect(sun().getAttribute('data-icon-color')).toBe(role.actionText);
        expect(filled()).toBe(false);
        cleanup();

        render(<KeepAwakeToggle on onChange={vi.fn()} label="Screen on" />);
        expect(filled()).toBe(true);
    });
});

describe('useKeepAwake (native)', () => {
    it('activates its own tag while on and deactivates the same tag when turned off', () => {
        const { rerender } = renderHook(({ on }) => useKeepAwake(on), { initialProps: { on: true } });

        expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
        const tag = keepAwake.activateKeepAwakeAsync.mock.calls[0]?.[0];
        expect(typeof tag).toBe('string');

        rerender({ on: false });
        expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith(tag);
    });

    it('two holders hold two different tags', () => {
        renderHook(() => useKeepAwake(true));
        renderHook(() => useKeepAwake(true));

        const [first, second] = keepAwake.activateKeepAwakeAsync.mock.calls.map((call) => call[0]);
        expect(first).not.toBe(second);
    });

    it('does nothing while off, and deactivates on unmount', () => {
        const off = renderHook(() => useKeepAwake(false));
        expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
        off.unmount();
        expect(keepAwake.deactivateKeepAwake).not.toHaveBeenCalled();

        const on = renderHook(() => useKeepAwake(true));
        on.unmount();
        expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    });
});
