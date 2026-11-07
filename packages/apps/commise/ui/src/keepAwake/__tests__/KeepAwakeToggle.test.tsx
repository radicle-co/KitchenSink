import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { Button } from '../../button/Button.js';
import { buttonSurfaceClass } from '../../button/surfaceClass.js';
import { KeepAwakeToggle } from '../KeepAwakeToggle.js';
import { useKeepAwake } from '../useKeepAwake.js';

/**
 * The web `KeepAwakeToggle` and `useKeepAwake` (blueprint A20, build spec §6.3). The toggle is a `switch` named
 * "Screen on" with `aria-checked`, labelled from a 720 body and icon-only below it; with no Wake Lock API (an older
 * browser, an insecure context) it renders NOTHING — never a disabled control. The hook holds the screen lock while
 * `on` and lets it go when `on` turns off or the page unmounts.
 */

const release = vi.fn(() => Promise.resolve());
const request = vi.fn(() => Promise.resolve({ released: false, release }));

function giveWakeLock(secure: boolean, api: boolean): void {
    Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });

    if (api) {
        Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    } else {
        Reflect.deleteProperty(navigator, 'wakeLock');
    }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    request.mockClear();
    release.mockClear();
    giveWakeLock(true, true);
});

afterEach(() => {
    cleanup();
    giveWakeLock(false, false);
});

/**
 * REWRITTEN IN SLICE 1 (designer, iosBatch1): "Screen on" is a QUIET text action in the action row, after Edit recipe or Save a
 * copy: the sun glyph and the label, no outline and no fill, with the switch role and `aria-checked`. It was a separate
 * outlined pill (the secondary Button surface), and the icon-only display is gone with the section switch.
 */
describe('KeepAwakeToggle (web)', () => {
    it('is a switch named by its label, off by default, with the label always drawn', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.textContent).toContain('Screen on');
    });

    it('⛔ is the quiet Button surface: no fill and no outline, off or on', () => {
        for (const on of [false, true]) {
            render(<KeepAwakeToggle on={on} onChange={vi.fn()} label="Screen on" />);

            const toggle = screen.getByRole('switch', { name: 'Screen on' });

            expect(toggle.className).toBe(buttonSurfaceClass('quiet', { size: 'md' }));
            expect(toggle.className).not.toMatch(/bg-selected-fill|border-selected-edge|border-line-control/u);
            cleanup();
        }
    });

    // Designer, after iosBatch1: the hint is the switch's accessibility description, never visible text.
    it('carries the hint as the switch’s description, and draws it as no text', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" hint="Keeps the screen awake." />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.getAttribute('aria-description')).toBe('Keeps the screen awake.');
        expect(screen.queryByText('Keeps the screen awake.')).toBeNull();
    });

    it('carries no description when it is given no hint', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);

        expect(screen.getByRole('switch', { name: 'Screen on' }).getAttribute('aria-description')).toBeNull();
    });

    it('presses like Button: the same PressScale wrapper', () => {
        const { container: button } = render(
            <Button icon="check" variant="secondary">
                Done
            </Button>,
        );
        const { container: toggle } = render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);
        const toggleWrapper = toggle.querySelector('span');

        expect(toggleWrapper?.className).toBe(button.querySelector('span')?.className);
        expect(toggleWrapper?.querySelector('[role="switch"]')).not.toBeNull();
    });

    it('draws the sun glyph at 20 px, decorative, outside the name, filled only when on', () => {
        const { container, rerender } = render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);
        const sun = (): Element | null => container.querySelector('svg.lucide-sun');

        expect(sun()?.getAttribute('width')).toBe('20');
        expect(sun()?.closest('[aria-hidden="true"]')).not.toBeNull();
        const off = sun()?.outerHTML;

        rerender(<KeepAwakeToggle on onChange={vi.fn()} label="Screen on" />);

        expect(sun()?.outerHTML).not.toBe(off);
    });

    it('reports the opposite of its state when pressed', () => {
        const onChange = vi.fn();
        const { rerender } = render(<KeepAwakeToggle on={false} onChange={onChange} label="Screen on" />);

        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        expect(onChange).toHaveBeenLastCalledWith(true);

        rerender(<KeepAwakeToggle on onChange={onChange} label="Screen on" />);
        expect(screen.getByRole('switch', { name: 'Screen on' }).getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    it.each([
        { secure: false, api: true },
        { secure: true, api: false },
    ])('renders nothing without the capability (secure $secure, API $api)', ({ secure, api }) => {
        giveWakeLock(secure, api);

        const { container } = render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" />);

        expect(container.firstChild).toBeNull();
    });
});

describe('useKeepAwake (web)', () => {
    it('holds the screen lock while on, and releases it when turned off', async () => {
        const { rerender } = renderHook(({ on }) => useKeepAwake(on), { initialProps: { on: true } });
        await settle();
        expect(request).toHaveBeenCalledWith('screen');

        rerender({ on: false });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('holds nothing while off', async () => {
        renderHook(() => useKeepAwake(false));
        await settle();

        expect(request).not.toHaveBeenCalled();
    });

    it('releases the lock when the page unmounts', async () => {
        const { unmount } = renderHook(() => useKeepAwake(true));
        await settle();

        unmount();

        expect(release).toHaveBeenCalledTimes(1);
    });
});
