/**
 * ⛔ `busyControlProps` is the ONE statement of "a control that goes busy keeps focus" for raw web controls that
 * cannot be the design-system `Button`. Each case would fail if the rule were broken the way it used to be broken
 * by hand: a native `disabled` (focus drops to <body>), a busy press that still acts, or an Enter in a form that
 * still submits through a busy default button.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BUSY_CONTROL_CLASS, busyControlProps, refusedPressProps } from '../busyControlProps.js';
import { buttonSurfaceClass } from '../surfaceClass.js';

describe('busyControlProps', () => {
    it('is inert when idle: the press acts, and no unavailable or busy state is claimed', () => {
        const onClick = vi.fn();

        render(
            <button type="button" {...busyControlProps({ busy: false, onClick })}>
                Save
            </button>,
        );
        const control = screen.getByRole('button', { name: 'Save' });
        fireEvent.click(control);

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(control.hasAttribute('aria-disabled')).toBe(false);
        expect(control.hasAttribute('aria-busy')).toBe(false);
    });

    it('⛔ when busy stays FOCUSABLE, says so, and refuses the press', () => {
        const onClick = vi.fn();

        render(
            <button type="button" {...busyControlProps({ busy: true, onClick })}>
                Save
            </button>,
        );
        const control = screen.getByRole('button', { name: 'Save' });
        control.focus();
        fireEvent.click(control);

        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.getAttribute('aria-busy')).toBe('true');
        expect(control.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(control);
        expect(onClick).not.toHaveBeenCalled();
    });

    /**
     * A control can also be unavailable for a RULE its press did not cause (an empty form, an unconfirmed gate).
     * That half is native `disabled` — out of the tab order — but only while idle: once the control is busy it is
     * the one just pressed, and a rule that reads the in-flight state must not strand its focus.
     */
    it('⛔ a blocked control is natively disabled while idle, and busy wins once its press is in flight', () => {
        const onClick = vi.fn();
        const { rerender } = render(
            <button type="button" {...busyControlProps({ busy: false, blocked: true, onClick })}>
                Save
            </button>,
        );
        const control = screen.getByRole('button', { name: 'Save' });

        expect(control.hasAttribute('disabled')).toBe(true);
        expect(control.hasAttribute('aria-disabled')).toBe(false);

        rerender(
            <button type="button" {...busyControlProps({ busy: true, blocked: true, onClick })}>
                Save
            </button>,
        );
        control.focus();
        fireEvent.click(control);

        expect(control.hasAttribute('disabled')).toBe(false);
        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(document.activeElement).toBe(control);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('is not disabled when nothing blocks it', () => {
        render(
            <button type="button" {...busyControlProps({ busy: false, onClick: vi.fn() })}>
                Save
            </button>,
        );

        expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    });

    it('⛔ cancels implicit submission through a busy default button (Enter in a field)', () => {
        const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());

        render(
            <form onSubmit={onSubmit}>
                <input aria-label="Name" />
                <button type="submit" {...busyControlProps({ busy: true })}>
                    Save
                </button>
            </form>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('its visual treatment is the design-system Button’s own, stated once', () => {
        expect(BUSY_CONTROL_CLASS).toContain('aria-disabled:opacity-60');
        expect(buttonSurfaceClass('primary')).toContain(BUSY_CONTROL_CLASS);
    });
});

/**
 * `refusedPressProps` is the same focus rule for a control that is UNAVAILABLE without being busy — a stepper at
 * its limit, where the press that reached the limit is the press that made the control unavailable. It claims no
 * work in flight.
 */
describe('refusedPressProps', () => {
    it('⛔ when unavailable stays FOCUSABLE, says so without claiming to be busy, and refuses the press', () => {
        const onClick = vi.fn();

        render(
            <button type="button" {...refusedPressProps({ unavailable: true, onClick })}>
                More
            </button>,
        );
        const control = screen.getByRole('button', { name: 'More' });
        control.focus();
        fireEvent.click(control);

        expect(control.getAttribute('aria-disabled')).toBe('true');
        expect(control.hasAttribute('aria-busy')).toBe(false);
        expect(control.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(control);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('acts when available, claiming nothing', () => {
        const onClick = vi.fn();

        render(
            <button type="button" {...refusedPressProps({ unavailable: false, onClick })}>
                More
            </button>,
        );
        const control = screen.getByRole('button', { name: 'More' });
        fireEvent.click(control);

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(control.hasAttribute('aria-disabled')).toBe(false);
    });
});
