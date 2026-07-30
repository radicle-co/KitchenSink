/**
 * Native component tests for the full-screen modal sheet primitive (rendered via react-native-web under
 * jsdom). This primitive exists because three feature leaves — `PullUpdatesDialog`, `VersionPreviewModal`
 * and `VersionCompareView` — each hand-rolled the SAME `Modal` + `{ flex: 1, padding: 20 }` container, and
 * all three shipped the same defect: an Android full-screen `Modal` window spans the whole display, so with
 * a flat 20dp pad the sheet's heading rendered UNDER the status bar (invisible, and absent from the
 * accessibility hierarchy — how Maestro `collections-pull` caught it) while the Cancel/confirm row rendered
 * UNDER the navigation bar. Owning the inset math once is what stops a fourth leaf repeating it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { Text } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { FullScreenSheet, SHEET_PADDING } from '../FullScreenSheet.native.js';

// A DISTINCT value per edge, so an assertion cannot pass on a leaf that adds the wrong inset to the wrong
// side (the config-level stub serves a realistic top/bottom-only set; these four differ deliberately).
// Restated inside the factory because `vi.mock` is hoisted above every module-level binding.
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 8, bottom: 16, left: 4 }),
}));

const INSETS = { top: 24, right: 8, bottom: 16, left: 4 } as const;

afterEach(cleanup);

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property. Two sources have to be consulted:
 * `StyleSheet.create` styles compile to atomic `r-*` classes (walked back to their rules here, since
 * `getComputedStyle` does not resolve them), while styles computed per-render — such as this sheet's
 * inset-derived padding — land in the inline `style` attribute. Checking only one source would read
 * `undefined` for exactly the geometry under test. Extends the `appliedStyle` helper in
 * `RecipeHero.native.test.tsx` with the inline half.
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

/** The sheet's own padded surface — the labelled element `FullScreenSheet` renders around its children. */
function surface(label: string): HTMLElement {
    return screen.getByLabelText(label);
}

describe('FullScreenSheet (native) — content', () => {
    it('renders its children under the supplied accessible label', () => {
        render(
            <FullScreenSheet label="Pull sheet" onRequestClose={() => undefined}>
                <Text>{'SHEET BODY'}</Text>
            </FullScreenSheet>,
        );

        expect(screen.getByText('SHEET BODY')).toBeTruthy();
        expect(surface('Pull sheet')).toBeTruthy();
    });
});

describe('FullScreenSheet (native) — safe-area insets', () => {
    // The defect this primitive exists to prevent: a flat pad puts the heading behind the status bar and the
    // action row behind the navigation bar. Each edge must be the base pad PLUS that edge's device inset.
    it('adds the device top inset to the top padding, so the heading clears the status bar', () => {
        render(
            <FullScreenSheet label="Pull sheet" onRequestClose={() => undefined}>
                <Text>{'SHEET BODY'}</Text>
            </FullScreenSheet>,
        );

        expect(appliedStyle(surface('Pull sheet'), 'padding-top')).toBe(`${SHEET_PADDING + INSETS.top}px`);
    });

    it('adds the device bottom inset to the bottom padding, so the actions clear the navigation bar', () => {
        render(
            <FullScreenSheet label="Pull sheet" onRequestClose={() => undefined}>
                <Text>{'SHEET BODY'}</Text>
            </FullScreenSheet>,
        );

        expect(appliedStyle(surface('Pull sheet'), 'padding-bottom')).toBe(`${SHEET_PADDING + INSETS.bottom}px`);
    });

    it('adds the device left/right insets so nothing sits under a landscape cutout', () => {
        render(
            <FullScreenSheet label="Pull sheet" onRequestClose={() => undefined}>
                <Text>{'SHEET BODY'}</Text>
            </FullScreenSheet>,
        );

        const element = surface('Pull sheet');

        expect(appliedStyle(element, 'padding-left')).toBe(`${SHEET_PADDING + INSETS.left}px`);
        expect(appliedStyle(element, 'padding-right')).toBe(`${SHEET_PADDING + INSETS.right}px`);
    });
});

describe('FullScreenSheet (native) — dismissal', () => {
    it('wires the RN Modal onRequestClose (Android hardware back / web Escape) to the supplied callback', async () => {
        const user = userEvent.setup();
        const onRequestClose = vi.fn();
        render(
            <FullScreenSheet label="Pull sheet" onRequestClose={onRequestClose}>
                <Text>{'SHEET BODY'}</Text>
            </FullScreenSheet>,
        );

        // react-native-web's Modal only wires its Escape listener once its `animationType="slide"` entrance
        // animation completes (`ModalContent`'s `active` flag, driven by an `animationend` DOM event) — jsdom
        // never fires real CSS animation events, so this dispatches the same `animationend` a real browser
        // would once the transition finishes, driving the SAME real library code path Escape/the Android back
        // button use. Mirrors `PullUpdatesDialog.native.test.tsx`, which established this idiom.
        const portalRoot = document.body.lastElementChild;
        const animatedLayer = portalRoot?.firstElementChild;
        expect(animatedLayer).toBeTruthy();
        fireEvent.animationEnd(animatedLayer as Element);

        await user.keyboard('{Escape}');

        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });
});
