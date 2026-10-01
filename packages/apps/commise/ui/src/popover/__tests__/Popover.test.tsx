/**
 * Popover (web) — the design-system disclosure panel over `@radix-ui/react-popover`, opened by ACTIVATION only
 * (`docs/design/ingredientStatusExplanation.md` §6d: no hover trigger, so WCAG 1.4.13 does not apply by construction).
 *
 * Covers: closed at rest with the trigger named and collapsed; open by click, by Enter and by Space; the panel is a
 * dialog named by its title; every close route (Escape, the Close control, an outside press) returns focus to the
 * trigger (APG); the trigger meets the 44 px target the spec sets for web; and two popovers are independent.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PopoverProps } from '../props.js';
import { Popover } from '../Popover.js';

afterEach(cleanup);

const renderPopover = (overrides: Partial<PopoverProps> = {}): void => {
    render(
        <div>
            <Popover
                triggerLabel="About Kale"
                triggerIcon={<span>i</span>}
                title="Kale"
                closeLabel="Close details for Kale"
                {...overrides}
            >
                <p>No match for this.</p>
            </Popover>
            <button type="button">Elsewhere</button>
        </div>,
    );
};

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'About Kale' });

describe('Popover (web)', () => {
    it('is closed at rest: the trigger is named, collapsed, and the panel is not in the document', () => {
        renderPopover();

        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
        expect(screen.queryByText('No match for this.')).toBeNull();
    });

    it('opens on click into a dialog named by its title, and marks the trigger expanded', async () => {
        const user = userEvent.setup();
        renderPopover();

        await user.click(trigger());

        const dialog = screen.getByRole('dialog', { name: 'Kale' });
        expect(dialog.textContent).toContain('No match for this.');
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(trigger().getAttribute('aria-controls')).toBe(dialog.id);
    });

    it.each(['{Enter}', ' '])('opens from the keyboard (%s)', async (key) => {
        const user = userEvent.setup();
        renderPopover();

        trigger().focus();
        await user.keyboard(key);

        expect(screen.getByRole('dialog', { name: 'Kale' })).toBeTruthy();
    });

    it('closes on Escape and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderPopover();
        await user.click(trigger());

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('closes through its Close control, named by closeLabel, and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        renderPopover();
        await user.click(trigger());

        await user.click(screen.getByRole('button', { name: 'Close details for Kale' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('closes on an outside press', async () => {
        const user = userEvent.setup();
        renderPopover();
        await user.click(trigger());

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('never submits an enclosing form: the trigger and Close are `type="button"` (regression pin)', async () => {
        const user = userEvent.setup();
        renderPopover();
        await user.click(trigger());

        expect(trigger().getAttribute('type')).toBe('button');
        expect(screen.getByRole('button', { name: 'Close details for Kale' }).getAttribute('type')).toBe('button');
    });

    it('sizes the trigger to the 44 px web target (WCAG 2.5.8, spec §3)', () => {
        renderPopover();

        expect(trigger().className).toContain('h-11');
        expect(trigger().className).toContain('w-11');
    });

    it('hides the glyph from assistive tech: the label alone names the control', () => {
        renderPopover({ triggerIcon: <svg data-glyph="info" /> });

        expect(trigger().textContent).toBe('');
        expect(trigger().querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it('hands its content a close action: an action inside the panel closes it, and focus returns to the trigger', async () => {
        const user = userEvent.setup();
        const act = vi.fn();
        render(
            <Popover triggerLabel="About Kale" triggerIcon={<span />} title="Kale" closeLabel="Close Kale">
                {(close) => (
                    <button
                        type="button"
                        onClick={() => {
                            close();
                            act();
                        }}
                    >
                        Do it
                    </button>
                )}
            </Popover>,
        );
        await user.click(trigger());

        await user.click(screen.getByRole('button', { name: 'Do it' }));

        expect(act).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('reads BUSY on the trigger while its work runs, and stays focusable', () => {
        renderPopover({ busy: true });

        expect(trigger().getAttribute('aria-busy')).toBe('true');
        expect(trigger().hasAttribute('disabled')).toBe(false);
    });

    it('shows busy to the EYE too: the glyph gives way to a spinner in the same box (V1 sign-off 3b)', () => {
        renderPopover({ triggerIcon: <span>i</span>, busy: true });

        expect(trigger().textContent).not.toContain('i');
        expect(trigger().querySelector('svg')).not.toBeNull();
        expect(trigger().className).toContain('h-11');
    });

    it('describes the trigger by the id it is given (the row\u2019s status word, V1 sign-off 1)', () => {
        render(
            <div>
                <span id="status-word">Resolution failed</span>
                <Popover
                    triggerLabel="About Kale"
                    triggerIcon={<span />}
                    title="Kale"
                    closeLabel="Close Kale"
                    describedBy="status-word"
                >
                    <p>Body</p>
                </Popover>
            </div>,
        );

        expect(trigger().getAttribute('aria-describedby')).toBe('status-word');
    });

    it('carries the trigger id it is given, so a host can hand focus to it (V1 sign-off item 11)', () => {
        renderPopover({ triggerId: 'row-glyph' });

        expect(trigger().id).toBe('row-glyph');
    });

    it('two popovers open independently', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <Popover triggerLabel="About Kale" triggerIcon={<span />} title="Kale" closeLabel="Close Kale">
                    <p>Kale body</p>
                </Popover>
                <Popover triggerLabel="About Leek" triggerIcon={<span />} title="Leek" closeLabel="Close Leek">
                    <p>Leek body</p>
                </Popover>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: 'About Leek' }));

        expect(screen.getByRole('dialog', { name: 'Leek' })).toBeTruthy();
        expect(screen.queryByText('Kale body')).toBeNull();
    });
});
