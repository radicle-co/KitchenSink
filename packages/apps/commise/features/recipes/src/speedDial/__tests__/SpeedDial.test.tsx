// @vitest-environment jsdom
/**
 * Component tests for the web SpeedDial FAB (U34, owner ruling 2026-08-25).
 *
 * A FAB that opens a menu is a DIFFERENT CONTROL from a button, so every state it can be in is covered:
 * closed, open, item activated, dismissed by Escape, dismissed by an outside press, and dismissed by the
 * trigger itself. The keyboard assertions are on real focus (`document.activeElement`) rather than on which
 * handler ran — a dial that opens a perfectly-marked-up menu and leaves focus on `<body>` has stranded its
 * keyboard user, and only a focus assertion can see that.
 *
 * The dial's placement and glyph are asserted here too, because the ruling is explicit that the dial
 * replaces what the FAB does on press and NOT where it sits: those are properties of the shipped control
 * that this component now owns, and `RecipeList` no longer spells them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';

import { SpeedDial } from '../SpeedDial.js';
import type { SpeedDialAction } from '../model.js';

afterEach(cleanup);

const TRIGGER_LABEL = 'New recipe';
const MENU_LABEL = 'Create a recipe';
const SCRATCH = 'Create from Scratch';

/** The dial as it actually ships: exactly ONE destination. `extra` proves the arithmetic generalises. */
function renderDial(onSelect = vi.fn(), extra: readonly SpeedDialAction[] = []) {
    const actions: readonly SpeedDialAction[] = [{ id: 'scratch', label: SCRATCH, onSelect }, ...extra];
    render(<SpeedDial triggerLabel={TRIGGER_LABEL} menuLabel={MENU_LABEL} actions={actions} />);

    return { onSelect, trigger: screen.getByRole('button', { name: TRIGGER_LABEL }) };
}

describe('SpeedDial (web) — closed', () => {
    it('presents the FAB as a MENU trigger, collapsed', () => {
        const { trigger } = renderDial();

        // `aria-haspopup="menu"`, not the `"dialog"` the underlying primitive emits: the popup IS a menu, and
        // announcing it as a dialog would promise a different interaction model.
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });

    it('draws the trigger glyph as a geometrically centred SVG, never the text "+"', () => {
        // Inherited from the FAB this replaces: flex centres the LINE BOX but ink is placed by the BASELINE,
        // so a "+" character paints ~1.7px low and no centring property corrects it.
        const { trigger } = renderDial();

        expect(trigger.querySelector('svg')).not.toBeNull();
        expect(trigger.textContent).toBe('');
    });

    it('keeps the seafoam FAB surface the list already shipped', () => {
        const { trigger } = renderDial();

        expect(trigger.className).toContain('bg-seafoam');
        expect(trigger.className).toContain('hover:bg-ocean-dark');
    });

    it('keeps the FAB offset DERIVED from the bottom nav and the device safe-area inset', () => {
        // Not a hardcoded pixel value: `calc(5rem + env(safe-area-inset-bottom))` clears the narrow-breakpoint
        // bottom nav plus the gesture bar, and `lg:bottom-8` drops to the base offset once that nav becomes a
        // desktop sidebar at the shared `lg` cutover.
        const { trigger } = renderDial();
        const anchor = trigger.parentElement;

        expect(anchor?.className).toContain('fixed');
        expect(anchor?.className).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]');
        expect(anchor?.className).toContain('lg:bottom-8');
    });
});

describe('SpeedDial (web) — open', () => {
    it('opens on click, marks itself expanded, and exposes a MENU of MENU ITEMS', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('menu', { name: MENU_LABEL })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: SCRATCH })).toBeTruthy();
    });

    it('renders exactly ONE destination — Scan / Import / AI are not rendered at all', async () => {
        // U34 is explicit: those belong to features 004 and 005, and promising a stopped feature is worse
        // than omitting it. A dead or "coming soon" second item fails this.
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);

        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    });

    it('moves focus onto the first destination when it opens', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: SCRATCH }));
    });

    it('gates its open animation behind motion-safe, so a reduce-motion viewer gets no animation at all', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);

        // The design-system `EnterTransition` wrapper carries the gated utility. An UNgated `animate-…`
        // would mean a reduce-motion viewer still sees the rise + fade.
        const wrapper = screen.getByRole('menu', { name: MENU_LABEL }).parentElement;
        expect(wrapper?.className).toContain('motion-safe:animate-section-enter');
    });

    it('closes again when the FAB itself is pressed while the dial is open', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);
        // A press on the FAB while open is an OUTSIDE press: the trigger sits outside the dismissable
        // layer, so the page (the FAB included) is inert to the pointer and the layer's own document
        // listener is what answers. `fireEvent` models that; `user.click` refuses to click through
        // `pointer-events: none`, which is the very behaviour under test.
        fireEvent.pointerDown(trigger);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});

describe('SpeedDial (web) — activation', () => {
    it('runs the destination once, then closes and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        const { onSelect, trigger } = renderDial();

        await user.click(trigger);
        await user.click(screen.getByRole('menuitem', { name: SCRATCH }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('activates the focused destination with Enter', async () => {
        const user = userEvent.setup();
        const { onSelect, trigger } = renderDial();

        await user.click(trigger);
        await user.keyboard('{Enter}');

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('activates the focused destination with Space', async () => {
        const user = userEvent.setup();
        const { onSelect, trigger } = renderDial();

        await user.click(trigger);
        await user.keyboard(' ');

        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

describe('SpeedDial (web) — keyboard', () => {
    it('opens from the keyboard on ArrowDown with the first destination focused', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        trigger.focus();
        await user.keyboard('{ArrowDown}');

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: SCRATCH }));
    });

    it('opens onto the LAST destination on ArrowUp', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial(vi.fn(), [{ id: 'import', label: 'Import', onSelect: vi.fn() }]);

        trigger.focus();
        await user.keyboard('{ArrowUp}');

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import' }));
    });

    it('arrow-navigates between destinations once a second one exists', async () => {
        // The shipped dial has one item, so wrap arithmetic is unfalsifiable against it alone. Adding a
        // destination is the DATA change the ruling exists to make cheap — this proves it works.
        const user = userEvent.setup();
        const { trigger } = renderDial(vi.fn(), [{ id: 'import', label: 'Import', onSelect: vi.fn() }]);

        await user.click(trigger);
        await user.keyboard('{ArrowDown}');

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import' }));

        await user.keyboard('{ArrowDown}');

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: SCRATCH }));
    });

    it('REOPENS on the first destination, not wherever the last arrow press left it', async () => {
        // A pointer user who opens the menu expects its top item. Carrying the previous session's cursor
        // over is invisible on today's one-item dial and wrong the moment a second destination exists —
        // which is exactly the class of defect that survives until the feature that adds one.
        const user = userEvent.setup();
        const { trigger } = renderDial(vi.fn(), [{ id: 'import', label: 'Import', onSelect: vi.fn() }]);

        await user.click(trigger);
        await user.keyboard('{ArrowDown}');

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Import' }));

        await user.keyboard('{Escape}');
        await user.click(trigger);

        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: SCRATCH }));
    });

    it('closes on Escape and RETURNS FOCUS to the trigger', async () => {
        // Mandatory mutant: suppress the focus restoration and this fails with `<body>` active — a keyboard
        // user whose next Tab starts over from the top of the page.
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement).toBe(trigger);
    });

    it('TRAPS Tab inside the open menu instead of letting focus escape to the page', async () => {
        const user = userEvent.setup();
        render(
            <>
                <SpeedDial
                    triggerLabel={TRIGGER_LABEL}
                    menuLabel={MENU_LABEL}
                    actions={[{ id: 'scratch', label: SCRATCH, onSelect: vi.fn() }]}
                />
                <button type="button">Somewhere else</button>
            </>,
        );
        const trigger = screen.getByRole('button', { name: TRIGGER_LABEL });
        // Captured BEFORE opening on purpose: while the dial is open the rest of the page is `aria-hidden`,
        // so a role query cannot even see this button — which is itself part of the containment contract.
        const outside = screen.getByRole('button', { name: 'Somewhere else' });

        await user.click(trigger);
        await user.tab();

        const item = screen.getByRole('menuitem', { name: SCRATCH });
        expect(document.activeElement).toBe(item);
        expect(document.activeElement).not.toBe(outside);
        expect(document.activeElement).not.toBe(trigger);
        expect(document.activeElement).not.toBe(document.body);

        await user.tab({ shift: true });

        expect(document.activeElement).toBe(item);
    });
});

describe('SpeedDial (web) — outside dismissal', () => {
    it('closes on an outside pointer press and returns focus to the trigger', async () => {
        const user = userEvent.setup();
        const { onSelect, trigger } = renderDial();

        await user.click(trigger);
        // `fireEvent`, not `user.click`: while the dial is open the dismissable layer sets
        // `pointer-events: none` on the body, which is exactly the modal behaviour under test — userEvent
        // refuses to click through it, while the real dismissal listener is on the document either way.
        fireEvent.pointerDown(document.body);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
        // Restoration is deferred by a task (the focus scope dispatches its unmount-autofocus event from a
        // `setTimeout`), so this waits rather than asserting on the same tick — the guarantee is that focus
        // LANDS on the trigger, not that it never passes through anywhere.
        await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
});
