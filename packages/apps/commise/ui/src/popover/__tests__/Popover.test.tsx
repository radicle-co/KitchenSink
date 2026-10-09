/**
 * Popover (web) — the design-system disclosure panel over `@radix-ui/react-popover`, opened by ACTIVATION only
 * (`docs/design/ingredientStatusExplanation.md` §6d: no hover trigger, so WCAG 1.4.13 does not apply by construction).
 *
 * Covers: closed at rest with the trigger named and collapsed; open by click, by Enter and by Space; the panel is a
 * dialog named by its title; Escape and the Close control return focus to the trigger (APG), and an outside press
 * leaves it where the cook put it; the trigger meets the 44 px target the spec sets for web; and two popovers are
 * independent.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PopoverProps } from '../props.js';
import { PopupInsetsContext } from '../../popupInsets/popupInsetsContext.js';
import { Popover } from '../Popover.js';

afterEach(cleanup);

const renderPopover = (overrides: Partial<PopoverProps> = {}): void => {
    render(
        <div>
            <Popover
                triggerLabel="About Kale"
                triggerIcon="info"
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

    it('closes on an outside press, and leaves focus where the cook put it', async () => {
        const user = userEvent.setup();
        renderPopover();
        await user.click(trigger());

        await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' })));
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

    // Slice 2: the focus ring is the `focusRing` role every design-system control draws (3:1 on paper, canvas and
    // pearl, measured in `surfaceClass.test.ts`), not the seafoam ring it predates; the glyph is `ink`.
    it('draws the focusRing role on its trigger and its Close, and an ink trigger glyph', async () => {
        const user = userEvent.setup();
        renderPopover();

        expect(trigger().className.split(/\s+/u)).toEqual(
            expect.arrayContaining(['text-ink', 'focus-visible:ring-focus-ring']),
        );

        await user.click(trigger());

        expect(screen.getByRole('button', { name: 'Close details for Kale' }).className.split(/\s+/u)).toContain(
            'focus-visible:ring-focus-ring',
        );
    });

    it('hides the glyph from assistive tech: the label alone names the control', () => {
        renderPopover({ triggerIcon: 'info' });

        expect(trigger().textContent).toBe('');
        expect(trigger().querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    // UI-overhaul slice 2: the glyph is a meaning from the icon Registry, so no host draws its own.
    it('draws the Registry glyph for the meaning it is given', () => {
        renderPopover({ triggerIcon: 'triangleAlert' });

        expect(trigger().querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    });

    // UI-overhaul slice 2 (finding D2): the panel keeps clear of the page's own chrome, read as it opens.
    it('reads the page’s chrome insets when it opens', async () => {
        const user = userEvent.setup();
        const readInsets = vi.fn(() => ({ top: 0, bottom: 64 }));
        render(
            <PopupInsetsContext value={readInsets}>
                <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close Kale">
                    Body
                </Popover>
            </PopupInsetsContext>,
        );

        expect(readInsets).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'About Kale' }));

        expect(readInsets).toHaveBeenCalled();
    });

    it('hands its content a close action: an action inside the panel closes it, and focus returns to the trigger', async () => {
        const user = userEvent.setup();
        const act = vi.fn();
        render(
            <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close Kale">
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
        renderPopover({ triggerIcon: 'info', busy: true });

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
                    triggerIcon="info"
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

    it('two popovers open independently', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close Kale">
                    <p>Kale body</p>
                </Popover>
                <Popover triggerLabel="About Leek" triggerIcon="info" title="Leek" closeLabel="Close Leek">
                    <p>Leek body</p>
                </Popover>
            </div>,
        );

        await user.click(screen.getByRole('button', { name: 'About Leek' }));

        expect(screen.getByRole('dialog', { name: 'Leek' })).toBeTruthy();
        expect(screen.queryByText('Kale body')).toBeNull();
    });
});

/**
 * A host asks for focus on this trigger (V1 sign-off item 11). The request is a level, acknowledged once handled, so it
 * holds until the trigger exists to take it.
 */
describe('Popover (web) — a focus request', () => {
    const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn()) => (
        <div>
            <Popover
                triggerLabel="About Kale"
                triggerIcon="info"
                title="Kale"
                closeLabel="Close Kale"
                focusRequested={focusRequested}
                onFocusRequestHandled={onFocusRequestHandled}
            >
                <p>Body</p>
            </Popover>
            <button type="button">Elsewhere</button>
        </div>
    );

    it('moves focus to the trigger and acknowledges, once', () => {
        const handled = vi.fn();
        const { rerender } = render(requested(false, handled));
        expect(document.activeElement).toBe(document.body);

        rerender(requested(true, handled));

        expect(document.activeElement).toBe(trigger());
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('takes a request it MOUNTS with (the target may not exist when focus is asked for)', () => {
        const handled = vi.fn();

        render(requested(true, handled));

        expect(document.activeElement).toBe(trigger());
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('does nothing while no request stands', () => {
        const handled = vi.fn();
        const { rerender } = render(requested(false, handled));
        screen.getByRole('button', { name: 'Elsewhere' }).focus();

        rerender(requested(false, handled));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
        expect(handled).not.toHaveBeenCalled();
    });
});

/** A host that moves focus on at `onDismissed`, by the house focus request, to a second popover's trigger. */
const DismissingHost: FC<{ readonly onDismissed: () => void }> = ({ onDismissed }) => {
    const [requested, setRequested] = useState(false);

    return (
        <div>
            <Popover
                triggerLabel="About Kale"
                triggerIcon="info"
                title="Kale"
                closeLabel="Close details for Kale"
                onDismissed={() => {
                    onDismissed();
                    setRequested(true);
                }}
            >
                <p>No match for this.</p>
            </Popover>
            <Popover
                triggerLabel="About Garlic"
                triggerIcon="info"
                title="Garlic"
                closeLabel="Close details for Garlic"
                focusRequested={requested}
                onFocusRequestHandled={() => setRequested(false)}
            >
                <p>Matched.</p>
            </Popover>
            <button type="button">Elsewhere</button>
        </div>
    );
};

describe('Popover (web) — once it is gone', () => {
    it.each([
        ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
        [
            'the Close control',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: 'Close details for Kale' })),
        ],
        [
            'an outside press',
            async (user: ReturnType<typeof userEvent.setup>) =>
                user.click(screen.getByRole('button', { name: 'Elsewhere' })),
        ],
    ])(
        '%s: reports `onDismissed` once, and a focus request raised there is where focus ends',
        async (_route, close) => {
            const user = userEvent.setup();
            const onDismissed = vi.fn();
            render(<DismissingHost onDismissed={onDismissed} />);

            await user.click(screen.getByRole('button', { name: 'About Kale' }));
            expect(onDismissed).not.toHaveBeenCalled();
            await close(user);

            await vi.waitFor(() => expect(onDismissed).toHaveBeenCalledTimes(1));
            await vi.waitFor(() =>
                expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About Garlic' })),
            );
        },
    );
});
