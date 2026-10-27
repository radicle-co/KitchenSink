import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const keepAwake = vi.hoisted(() => ({
    activateKeepAwakeAsync: vi.fn((_tag?: string) => Promise.resolve()),
    deactivateKeepAwake: vi.fn((_tag?: string) => Promise.resolve()),
}));

vi.mock('expo-keep-awake', () => keepAwake);

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { KeepAwakeToggle } from '../KeepAwakeToggle.native.js';
import { useKeepAwake } from '../useKeepAwake.native.js';

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

describe('KeepAwakeToggle (native)', () => {
    it('is a switch named by its label, reporting its state', () => {
        const onChange = vi.fn();
        render(<KeepAwakeToggle on={false} onChange={onChange} label="Screen on" display="labelled" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.textContent).toContain('Screen on');

        fireEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('shows checked when on, and turns off when pressed', () => {
        const onChange = vi.fn();
        render(<KeepAwakeToggle on onChange={onChange} label="Screen on" display="icon" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(toggle.textContent).toBe('');

        fireEvent.click(toggle);
        expect(onChange).toHaveBeenCalledWith(false);
    });
});

/** `#RRGGBB` → the `rgb(r, g, b)` spelling jsdom's `getComputedStyle` normalises colours to. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** The painted pill: the rounded element inside the switch. */
function pillOf(toggle: HTMLElement): HTMLElement {
    const pill = [toggle, ...Array.from(toggle.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (pill === undefined) {
        throw new Error('The switch paints no pill.');
    }

    return pill;
}

// `componentFixes` issue 6 (2026-10-26): a SWITCH wearing the secondary pill, not a 32 pt chip. Mutation lens: the chip
// geometry (32 pt, no edge), or an edge that is 1.5 pt only when on, fails.
describe('KeepAwakeToggle (native) — the secondary pill', () => {
    it('off: a 44 pt paper pill with a 1 pt lineControl outline and an ink cardTitle', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />);

        const pill = getComputedStyle(pillOf(screen.getByRole('switch', { name: 'Screen on' })));

        expect(pill.minHeight).toBe('44px');
        expect(pill.backgroundColor).toBe(rgb(role.paper));
        expect(pill.borderTopWidth).toBe('1px');
        expect(pill.borderTopColor).toBe(rgb(role.lineControl));
        expect(getComputedStyle(screen.getByText('Screen on')).fontSize).toBe(
            `${String(nativeTokens.type.cardTitle.fontSize)}px`,
        );
    });

    it('on: the selectedFill with a selectedEdge outline of the SAME width, so nothing shifts', () => {
        render(<KeepAwakeToggle on onChange={vi.fn()} label="Screen on" display="labelled" />);

        const pill = getComputedStyle(pillOf(screen.getByRole('switch', { name: 'Screen on' })));

        expect(pill.minHeight).toBe('44px');
        expect(pill.backgroundColor).toBe(rgb(role.selectedFill));
        expect(pill.borderTopWidth).toBe('1px');
        expect(pill.borderTopColor).toBe(rgb(role.selectedEdge));
    });

    it('draws the sun glyph, decorative, filled only when on', () => {
        const { container } = render(
            <KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />,
        );
        const sun = (): HTMLElement | null => container.querySelector('[data-commise-stub="icon"]');

        expect(sun()?.dataset['iconName']).toBe('sun');
        expect(sun()?.closest('[aria-hidden="true"]')).not.toBeNull();
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
