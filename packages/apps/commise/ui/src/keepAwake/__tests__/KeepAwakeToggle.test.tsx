import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { buttonSurfaceClass, buttonToggleSurfaceClass } from '../../button/surfaceClass.js';
import { chipClass } from '../../chip/chipClass.js';
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

describe('KeepAwakeToggle (web)', () => {
    it('is a switch named by its label, off by default', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.textContent).toContain('Screen on');
    });

    // `componentFixes` issue 6 (2026-10-26): "Screen on" is a SWITCH, not a chip. It wears the secondary 44 px outline
    // pill (the Button surface), and when on the selected fill with a selected-edge outline. Mutation lens: the chip
    // recipe (a 32 px muted fill with no edge), or a 1.5 px edge only when on (a layout shift), fails below.
    it('⛔ off: the secondary Button surface (paper, lineControl outline, 44 px), never the chip recipe', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.className).toBe(`${buttonSurfaceClass('secondary', 'md')}`);
        expect(toggle.className).not.toBe(chipClass(false));
        expect(toggle.className).toContain('min-h-11');
        expect(toggle.className).toContain('border-line-control');
        expect(toggle.className).toContain('text-card-title');
    });

    it('on: the selectedFill with a selectedEdge outline, the same edge width and size as off', () => {
        render(<KeepAwakeToggle on onChange={vi.fn()} label="Screen on" display="labelled" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.className).toBe(buttonToggleSurfaceClass(true));
        expect(toggle.className).toContain('bg-selected-fill');
        expect(toggle.className).toContain('border-selected-edge');
        expect(toggle.className).not.toContain('bg-paper');
        expect(toggle.className).not.toContain('border-line-control');
        // Selecting must not move the neighbours: the border width token is the same one off uses.
        expect(toggle.className.split(' ')).toContain('border');
        expect(toggle.className).not.toMatch(/border-\[/u);
        expect(toggle.className).toContain('min-h-11');
    });

    it('draws the sun glyph at 20 px, decorative, outside the name', () => {
        const { container } = render(
            <KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />,
        );

        const sun = container.querySelector('svg.lucide-sun');

        expect(sun?.getAttribute('width')).toBe('20');
        expect(sun?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('reports the opposite of its state when pressed', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <KeepAwakeToggle on={false} onChange={onChange} label="Screen on" display="labelled" />,
        );

        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        expect(onChange).toHaveBeenLastCalledWith(true);

        rerender(<KeepAwakeToggle on onChange={onChange} label="Screen on" display="labelled" />);
        expect(screen.getByRole('switch', { name: 'Screen on' }).getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    it('icon-only keeps the full name and shows no visible label', () => {
        render(<KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="icon" />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });

        expect(toggle.textContent).toBe('');
    });

    it.each([
        { secure: false, api: true },
        { secure: true, api: false },
    ])('renders nothing without the capability (secure $secure, API $api)', ({ secure, api }) => {
        giveWakeLock(secure, api);

        const { container } = render(
            <KeepAwakeToggle on={false} onChange={vi.fn()} label="Screen on" display="labelled" />,
        );

        expect(container.innerHTML).toBe('');
        expect(screen.queryByRole('switch')).toBeNull();
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
