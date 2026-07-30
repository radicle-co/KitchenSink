/**
 * Native component tests for the collection-header view (W5 Task 6, rendered via react-native-web under
 * jsdom). Mirrors the web leaf across every branch — non-cloned public, cloned private with full
 * attribution + last-pulled, cloned with an unresolved source owner, the Back affordance, and the
 * Edit/Delete affordances — so the two platform renders cannot drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';

import { tintOf } from '../../__tests__/cssColor.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionHeader } from '../CollectionHeader.native.js';
import type { CollectionHeaderViewProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderHeader(overrides: Partial<CollectionHeaderViewProps> = {}) {
    const props: CollectionHeaderViewProps = {
        name: 'Keto Week',
        visibility: 'public',
        recipeCount: 8,
        onEdit: noop,
        onDelete: noop,
        ...overrides,
    };
    render(<CollectionHeader {...props} />);

    return props;
}

describe('CollectionHeader (native) — non-cloned collection', () => {
    it('renders the name, the Public badge, and the recipe count', () => {
        renderHeader();

        expect(screen.getByRole('heading', { name: 'Keto Week' })).toBeTruthy();
        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.getByText('8 recipes')).toBeTruthy();
    });

    it('renders no source-attribution or last-pulled line', () => {
        renderHeader();

        expect(screen.queryByText(/^Source:/)).toBeNull();
        expect(screen.queryByText(/^Last pulled/)).toBeNull();
    });
});

describe('CollectionHeader (native) — cloned collection with full attribution', () => {
    it('renders the Private badge, the templated source attribution, and the last-pulled date', () => {
        renderHeader({
            visibility: 'private',
            sourceCollectionName: 'Keto Staples',
            sourceOwnerHandle: 'clara',
            lastPulledAt: '2026-05-01T00:00:00.000Z',
        });

        expect(screen.getByText('Private')).toBeTruthy();
        expect(screen.getByText('Source: @clara’s "Keto Staples"')).toBeTruthy();
        expect(screen.getByText(/Last pulled: May 1, 2026/)).toBeTruthy();
    });
});

describe('CollectionHeader (native) — cloned collection with an unresolved source owner', () => {
    it('shows the source name without an @handle, and does not crash', () => {
        renderHeader({ sourceCollectionName: 'Keto Staples', sourceOwnerHandle: undefined });

        expect(screen.getByText('Source: "Keto Staples"')).toBeTruthy();
        expect(screen.queryByText(/@/)).toBeNull();
    });
});

describe('CollectionHeader (native) — Back affordance', () => {
    it('renders a Back control that fires onBack', () => {
        const onBack = vi.fn();
        renderHeader({ onBack });

        fireEvent.click(screen.getByRole('button', { name: /back/i }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders no Back control when onBack is omitted', () => {
        renderHeader({ onBack: undefined });

        expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
    });
});

/**
 * Cross-platform parity for the web leaf's seafoam-as-text fix. Three foregrounds here are read as text — Back,
 * Rename, and the visibility badge — and all three were `palette.seafoam`: 4.02:1 on the header's white surface,
 * and 3.57:1 for the badge once its own 10%-alpha seafoam tint is composited. The 4.5:1 body-text floor governs
 * all three; the badge's TINT is a background and stays (see `@commise/ui`'s palette JSDoc).
 *
 * Measured, not spelled: `expect(...color).toBe(cssColor(palette['ocean-dark']))` would pin a token NAME and
 * still pass if the palette re-themed it to near-white. A ratio cannot.
 */
describe('CollectionHeader (native) — the seafoam text foregrounds clear the AA body-text floor', () => {
    it('keeps the Back label legible', () => {
        renderHeader({ onBack: noop });

        expect(
            computedContrast(screen.getByText('Back to My Collections')),
            'Back to My Collections',
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the Rename label legible', () => {
        renderHeader();

        expect(computedContrast(screen.getByText('Rename')), 'Rename').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the visibility badge legible over its own seafoam tint, in both visibility states', () => {
        renderHeader({ visibility: 'public' });
        // The tint lives on the badge leaf ITSELF, so `computedContrast` reads it off the DOM and composites it
        // over the white header — no guessed alpha.
        expect(computedContrast(screen.getByText('Public')), 'Public badge').toBeGreaterThanOrEqual(4.5);

        cleanup();
        renderHeader({ visibility: 'private' });
        expect(computedContrast(screen.getByText('Private')), 'Private badge').toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the badge’s seafoam TINT — a background, which the 4.5 floor never governed', () => {
        renderHeader();

        // Derived from the token, so a re-theme moves the test and an `rgba(...)` literal on the wrong hue
        // cannot pass by coincidence (RN has no alpha-suffix colour syntax, so the leaf spells the tint out).
        expect(window.getComputedStyle(screen.getByText('Public')).backgroundColor).toBe(tintOf(palette.seafoam, 0.1));
    });
});

describe('CollectionHeader (native) — Edit/Delete affordances', () => {
    it('reports edit and delete requests upward', () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        renderHeader({ onEdit, onDelete });

        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});

/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules. `getComputedStyle` does not resolve these, and a `style`
 * attribute check would miss `StyleSheet.create` styles entirely. Mirrors `RecipeHero.native.test.tsx`.
 */
function appliedStyle(element: Element, property: string): string | undefined {
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

/**
 * Regression (Maestro `collections` / `collections-pagination`): the title row is
 * `[name][Rename][Delete]` at `justifyContent: 'space-between'`, and React Native's default `flexShrink`
 * is 0 — so a long collection name took its full intrinsic width and pushed the action group off the
 * right edge. On-device, "Rename" was clipped to a 33px slither at x=1047..1080 and **"Delete" was not in
 * the view hierarchy at all** (laid out past the 1080px screen edge), making deleting a collection
 * impossible on mobile. jsdom has no layout engine, so this asserts the flex CONTRACT that prevents it:
 * the name is allowed to shrink (and wrap), the action group is not.
 */
describe('CollectionHeader (native) — title row cannot squeeze its actions off-screen', () => {
    it('lets a long name shrink instead of pushing Rename/Delete out of the viewport', () => {
        renderHeader({ name: 'Maestro renamed collection with a deliberately very long name' });

        const heading = screen.getByRole('heading', {
            name: 'Maestro renamed collection with a deliberately very long name',
        });

        // `flexShrink: 0` (RN's default) is exactly the bug; anything shrinkable keeps the actions on screen.
        expect(appliedStyle(heading, 'flex-shrink')).toBe('1');
    });

    it('never shrinks the action group itself, so neither control is clipped', () => {
        renderHeader({ name: 'Maestro renamed collection with a deliberately very long name' });

        const actions = screen.getByRole('button', { name: 'Delete' }).parentElement;

        expect(actions).not.toBeNull();
        expect(appliedStyle(actions as Element, 'flex-shrink')).toBe('0');
    });
});
