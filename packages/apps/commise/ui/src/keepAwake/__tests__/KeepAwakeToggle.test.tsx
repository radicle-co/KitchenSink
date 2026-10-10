import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

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
