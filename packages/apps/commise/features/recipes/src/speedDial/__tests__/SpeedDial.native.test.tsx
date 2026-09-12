/**
 * Native component tests for the SpeedDial FAB (U34, owner ruling 2026-08-25), rendered via
 * react-native-web under jsdom.
 *
 * Mirrors the web leaf across EVERY state — closed, open, destination pressed, dismissed by the backdrop —
 * so the two platform renders cannot drift on what the dial DOES. What differs is what each platform can
 * prove: there is no Tab key on a phone, so the containment guarantee here is the modal window itself
 * (`aria-modal`, React Native's own alias for `accessibilityViewIsModal`, which is the ONE form
 * react-native-web also surfaces in the DOM and therefore the only assertable one).
 *
 * The geometry assertions are the reason this file reads insets at all: the menu escapes into a modal
 * window that spans the WHOLE display, so it no longer inherits the recipes screen's bottom padding and has
 * to re-add the device inset itself. The stub serves NON-ZERO insets precisely so that `base + inset` is
 * distinguishable from an offset that ignored the gesture bar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { compositeOver } from '@commise/test-utils';
import { palette, tint } from '@commise/ui';

import { STUB_INSETS } from '../../../test-utils/safeAreaContextStub.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { FAB_BOTTOM, FAB_SIZE, MENU_GAP, SpeedDial } from '../SpeedDial.native.js';
import type { SpeedDialAction } from '../model.js';

afterEach(cleanup);

const TRIGGER_LABEL = 'New recipe';
const MENU_LABEL = 'Create a recipe';
const DISMISS_LABEL = 'Close the create menu';
const SCRATCH = 'Create from Scratch';

/** The dial as it actually ships: exactly ONE destination. */
function renderDial(onSelect = vi.fn(), extra: readonly SpeedDialAction[] = []) {
    const actions: readonly [SpeedDialAction, ...SpeedDialAction[]] = [
        { id: 'scratch', label: SCRATCH, onSelect },
        ...extra,
    ];
    render(
        <SpeedDial
            triggerLabel={TRIGGER_LABEL}
            menuLabel={MENU_LABEL}
            dismissLabel={DISMISS_LABEL}
            actions={actions}
        />,
    );

    return { onSelect, trigger: screen.getByRole('button', { name: TRIGGER_LABEL }) };
}

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property. `StyleSheet.create` styles compile
 * to atomic `r-*` classes that `getComputedStyle` does not resolve, while per-render values (the dial's
 * inset-derived offset) land in the inline `style` attribute — reading only one source would report
 * `undefined` for exactly the geometry under test. Same helper as `FullScreenSheet.native.test.tsx`.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const inline = (element as HTMLElement).style.getPropertyValue(property);

    if (inline !== '') {
        return inline;
    }

    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return resolved;
}

describe('SpeedDial (native) — closed', () => {
    it('presents the FAB as a collapsed disclosure', () => {
        const { trigger } = renderDial();

        // `aria-expanded` is React Native's own first-class ALIAS for `accessibilityState.expanded`, and the
        // only one react-native-web puts in the DOM — the object form alone would be unassertable.
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(screen.queryByRole('button', { name: DISMISS_LABEL })).toBeNull();
    });

    it('draws the FAB glyph as an icon, never a baseline-positioned "+" character', () => {
        // The icon stub renders null here, so the falsifiable assertion is the ABSENCE of the text glyph:
        // a "+" character in the FAB is exactly the defect this inherited from the button it replaces.
        const { trigger } = renderDial();

        expect(within(trigger).queryByText('+')).toBeNull();
    });

    it('keeps the round seafoam FAB surface the list already shipped', () => {
        const { trigger } = renderDial();

        // Compared through `compositeOver` rather than against a literal string: react-native-web emits
        // `rgba(r,g,b,1.00)`, so a raw string match would pin a FORMAT, and comparing to the token is what
        // makes this fail if the FAB ever stops being seafoam.
        expect(compositeOver(appliedStyle(trigger, 'background-color') ?? '', palette.white)).toBe(
            palette.seafoam.toLowerCase(),
        );
        expect(appliedStyle(trigger, 'width')).toBe(`${FAB_SIZE}px`);
        expect(appliedStyle(trigger, 'height')).toBe(`${FAB_SIZE}px`);
        expect(appliedStyle(trigger, 'bottom')).toBe(`${FAB_BOTTOM}px`);
    });
});

describe('SpeedDial (native) — open', () => {
    it('opens on press, marks itself expanded, and exposes a MENU of MENU ITEMS', () => {
        const { trigger } = renderDial();

        fireEvent.click(trigger);

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('menu', { name: MENU_LABEL })).toBeTruthy();
        expect(screen.getByRole('menuitem', { name: SCRATCH })).toBeTruthy();
    });

    it('renders exactly ONE destination — Scan / Import / AI are not rendered at all', () => {
        // U34 is explicit: those belong to features 004 and 005, and promising a stopped feature is worse
        // than omitting it. A dead or "coming soon" second item fails this.
        const { trigger } = renderDial();

        fireEvent.click(trigger);

        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    });

    it('scopes assistive tech to the open menu, which is the native focus containment', () => {
        const { trigger } = renderDial();

        fireEvent.click(trigger);

        expect(screen.getByRole('menu', { name: MENU_LABEL }).getAttribute('aria-modal')).toBe('true');
    });

    it('clears the gesture bar by RE-ADDING the device inset the modal window does not inherit', () => {
        // The FAB sits inside the recipes screen, which already pads by `insets.bottom`. The menu does not:
        // an Android modal window spans the whole display. Composing `inset + base` (rather than restating a
        // literal) is what makes this fail if the inset term is ever dropped — the stub's insets are
        // deliberately non-zero so `base + 0` cannot masquerade as correct.
        const { trigger } = renderDial();

        fireEvent.click(trigger);

        const expected = STUB_INSETS.bottom + FAB_BOTTOM + FAB_SIZE + MENU_GAP;
        expect(appliedStyle(screen.getByRole('menu', { name: MENU_LABEL }), 'bottom')).toBe(`${expected}px`);
        expect(expected).toBeGreaterThan(FAB_BOTTOM + FAB_SIZE + MENU_GAP);
    });
});

describe('SpeedDial (native) — dismissal', () => {
    it('runs the destination once and closes the dial', () => {
        const { onSelect, trigger } = renderDial();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('menuitem', { name: SCRATCH }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('paints the backdrop from the palette token, never a hand-written rgba literal', () => {
        // React Native has no alpha-suffix colour syntax, so a tint has to be spelled out — and a decimal
        // literal is a second representation of a palette colour that stops moving when the token does.
        const { trigger } = renderDial();

        fireEvent.click(trigger);

        const backdrop = screen.getByRole('button', { name: DISMISS_LABEL });
        expect(compositeOver(appliedStyle(backdrop, 'background-color') ?? '', palette.white)).toBe(
            compositeOver(tint(palette.charcoal, 0.2), palette.white),
        );
    });

    it('closes on a backdrop tap without running any destination', () => {
        const { onSelect, trigger } = renderDial();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: DISMISS_LABEL }));

        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes again when the FAB itself is pressed a second time', () => {
        const { trigger } = renderDial();

        fireEvent.click(trigger);
        fireEvent.click(trigger);

        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('unmounts the menu rather than merely hiding it', () => {
        // react-native-web's `Modal` keeps its portal content in the DOM across a `visible` toggle, so a
        // leaf that relied on `visible` alone would leave a closed menu findable — and tappable.
        const { trigger } = renderDial();

        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: DISMISS_LABEL }));

        expect(screen.queryByLabelText(MENU_LABEL)).toBeNull();
        expect(screen.queryByText(SCRATCH)).toBeNull();
    });
});
