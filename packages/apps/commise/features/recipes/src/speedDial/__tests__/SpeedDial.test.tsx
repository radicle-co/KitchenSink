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
import userEvent from '@testing-library/user-event';

import { SpeedDial } from '../SpeedDial.js';
import type { SpeedDialAction } from '../model.js';

afterEach(cleanup);

const TRIGGER_LABEL = 'New recipe';
const MENU_LABEL = 'Create a recipe';
const SCRATCH = 'Create from Scratch';

/** The dial as it actually ships: exactly ONE destination. `extra` proves the arithmetic generalises. */
function renderDial(onSelect = vi.fn(), extra: readonly SpeedDialAction[] = []) {
    const actions: readonly [SpeedDialAction, ...SpeedDialAction[]] = [
        { id: 'scratch', label: SCRATCH, onSelect },
        ...extra,
    ];
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

    it('gives the trigger AND every destination a visible keyboard focus indicator', async () => {
        // This is the control a keyboard user lives in, and a background tint alone (which is what the
        // destinations first shipped with) is a weak indicator on a card surface. The package's own
        // convention is an explicit `focus-visible:ring-2`, so it is asserted rather than left to the UA.
        const user = userEvent.setup();
        const { trigger } = renderDial();

        expect(trigger.className).toContain('focus-visible:ring-2');

        await user.click(trigger);

        expect(screen.getByRole('menuitem', { name: SCRATCH }).className).toContain('focus-visible:ring-2');
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

    it('carries its gated open animation on the element that MOUNTS on open, not on a wrapper', async () => {
        // REWRITTEN after review. This first asserted the class on the menu's PARENT — a design-system
        // `EnterTransition` wrapper. That wrapper was rendered unconditionally, so it mounted with the recipe
        // list and its pure-CSS keyframe ran once, immediately, over an empty box, finishing long before a
        // cook could press anything: the dial never animated, and the old assertion passed anyway because a
        // class name is not a behaviour. A CSS mount animation fires when the element CARRYING it is
        // inserted, so the utility has to live on the menu itself — which is the only thing here that mounts
        // on open. `motion-safe:` remains the gate: under `prefers-reduced-motion: reduce` no animation, and
        // therefore no hidden from-state, is emitted at all.
        const user = userEvent.setup();
        const { trigger } = renderDial();

        await user.click(trigger);

        const menu = screen.getByRole('menu', { name: MENU_LABEL });
        expect(menu.className).toContain('motion-safe:animate-section-enter');
        // And nothing above it animates: a re-introduced always-mounted wrapper would put the keyframe back
        // on an element that is already on screen.
        expect(menu.parentElement?.className ?? '').not.toContain('animate-section-enter');
    });

    it('closes again when the FAB itself is pressed while the dial is open', async () => {
        const user = userEvent.setup();
        const { trigger } = renderDial();

        // ⚠️ REWRITTEN with the 2026-08-27 swap to `@radix-ui/react-dropdown-menu` + `modal={false}`, and
        // the OLD COMMENT is why. It read: "a press on the FAB while open is an OUTSIDE press: the trigger
        // sits outside the dismissable layer, so the page (the FAB included) is inert to the pointer…
        // `user.click` refuses to click through `pointer-events: none`." All of that was true of the MODAL
        // Dialog, which set `disableOutsidePointerEvents`. Non-modal does not, so the FAB is a real button
        // again and a real user simply presses it. `user.click` is now the honest model of the interaction,
        // and `fireEvent.pointerDown` would be reaching around a barrier that no longer exists.
        await user.click(trigger);
        await user.click(trigger);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        // Focus lands on the FAB because the FAB is what was pressed — not because anything restored it.
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

    it('TRAPS Tab inside the open menu — a DELIBERATE deviation from the Menu Button pattern', async () => {
        // WAI-ARIA APG says Tab should leave the menu and dismiss it. The requirement for THIS control is the
        // opposite, and it is the requirement that wins: focus trapped while open, restored on close, because
        // a dial that drops focus to `<body>` strands the keyboard user it exists to serve. Recorded as a
        // deviation rather than dressed up as compliance — see the module docstring.
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
    it('closes on an outside pointer press and does NOT steal focus back from what was pressed', async () => {
        // ⛔ REWRITTEN — AND THE ASSERTION IS INVERTED, deliberately (2026-08-27 swap to
        // `@radix-ui/react-dropdown-menu` + `modal={false}`).
        //
        // The old test asserted that focus RETURNS TO THE TRIGGER after an outside press, and used
        // `fireEvent.pointerDown(document.body)` because "the dismissable layer sets `pointer-events: none`
        // on the body, which is exactly the modal behaviour under test". Both halves belonged to the modal
        // Dialog. Non-modal sets `disableOutsidePointerEvents: false`, so nothing is inert and a real press
        // lands on whatever was pressed.
        //
        // ⛔ Restoring focus to the trigger here would now be a DEFECT, not a feature: the cook pressed
        // something else, and yanking the caret back to the FAB would steal focus from the control they
        // just chose. Escape and item activation still restore — those are dismissals with nowhere else
        // for focus to go, and they keep their own tests. This one proves the opposite guarantee.
        const user = userEvent.setup();
        const { onSelect, trigger } = renderDial();
        const elsewhere = document.createElement('button');

        elsewhere.textContent = 'Elsewhere';
        document.body.appendChild(elsewhere);

        await user.click(trigger);
        await user.click(elsewhere);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onSelect).not.toHaveBeenCalled();
        // The pressed control keeps focus. Asserted as an identity, not as "not the trigger", so a future
        // change that sent focus to `<body>` — losing it entirely — fails here too.
        await waitFor(() => expect(document.activeElement).toBe(elsewhere));

        elsewhere.remove();
    });
});
