/**
 * Native component tests for the collection-actions sidebar (W5 Task 7), rendered via react-native-web
 * under jsdom. Mirrors the web leaf: Add Recipes, the clone-only-visible Pull Updates action (FR-011),
 * Clone Collection's busy gate, and the two-stage, premium-gated (C1) visibility toggle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { glass, palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { cssColor } from '../../__tests__/cssColor.js';
import { pillOf } from '../../__tests__/dsPill.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionActions } from '../CollectionActions.native.js';
import type { CollectionActionsProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderActions(overrides: Partial<CollectionActionsProps> = {}) {
    const props: CollectionActionsProps = {
        isCloned: false,
        visibility: RecipeVisibility.PUBLIC,
        pendingVisibility: RecipeVisibility.PUBLIC,
        canGoPrivate: true,
        isCloning: false,
        isPulling: false,
        onAddRecipes: noop,
        onPullUpdates: noop,
        onClone: noop,
        onVisibilityChange: noop,
        onSaveVisibility: noop,
        ...overrides,
    };
    render(<CollectionActions {...props} />);

    return props;
}

describe('CollectionActions (native) — Pull Updates visibility (FR-011)', () => {
    it('renders no Pull Updates action for a non-cloned collection', () => {
        renderActions({ isCloned: false });

        expect(screen.queryByRole('button', { name: 'Pull Updates from Source' })).toBeNull();
    });

    it('renders Pull Updates for a cloned collection and reports activation upward', () => {
        const onPullUpdates = vi.fn();
        renderActions({ isCloned: true, onPullUpdates });

        fireEvent.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));

        expect(onPullUpdates).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy affordance while pulling updates, and cannot re-fire', () => {
        const onPullUpdates = vi.fn();
        renderActions({ isCloned: true, isPulling: true, onPullUpdates });

        const button = screen.getByRole('button', { name: 'Pull Updates from Source' });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Pulling updates…')).toBeTruthy();

        fireEvent.click(button);
        expect(onPullUpdates).not.toHaveBeenCalled();
    });
});

describe('CollectionActions (native) — Add Recipes', () => {
    it('reports activation upward', () => {
        const onAddRecipes = vi.fn();
        renderActions({ onAddRecipes });

        fireEvent.click(screen.getByRole('button', { name: 'Add Recipes' }));

        expect(onAddRecipes).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionActions (native) — Clone Collection', () => {
    it('reports activation upward', () => {
        const onClone = vi.fn();
        renderActions({ onClone });

        fireEvent.click(screen.getByRole('button', { name: 'Clone Collection' }));

        expect(onClone).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy affordance while cloning, and cannot re-fire', () => {
        const onClone = vi.fn();
        renderActions({ isCloning: true, onClone });

        const button = screen.getByRole('button', { name: 'Clone Collection' });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Cloning…')).toBeTruthy();

        fireEvent.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });
});

/**
 * Clone Collection IS the design-system Button on native too — the SAME `secondary` tier as the web leaf and
 * as the recipe-detail clone. This leaf hand-rolled `backgroundColor: palette.coral` with a white label while
 * the discovery card's clone hand-rolled a coral OUTLINE: two platforms, three call sites, three answers. See
 * the web sibling's block for why coral was wrong here at all (no mockup has a clone action; the mockups never
 * fill a button coral; coral is the danger register).
 *
 * These assertions also stand in for what the hand-rolled `StyleSheet` promised and now gets from the DS: the
 * 44pt touch floor, the tokenised radius, and a real busy announcement.
 */
describe('CollectionActions (native) — Clone Collection is the DS secondary surface', () => {
    it('meets the 44pt touch floor the DS Button guarantees', () => {
        renderActions();

        // `pillOf` throws when no 44pt surface exists, so reaching this line IS the assertion.
        expect(pillOf(screen.getByRole('button', { name: 'Clone Collection' }))).toBeTruthy();
    });

    it('paints the DS secondary surface — a coral OUTLINE over glass, NOT the old solid coral fill', () => {
        renderActions();
        const style = window.getComputedStyle(pillOf(screen.getByRole('button', { name: 'Clone Collection' })));

        // The tier's own surface, from the tier's own token: `glass.subtle`'s solid fallback (RN cannot blur).
        expect(style.backgroundColor).toBe(glass.subtle.fallback);
        // Coral survives as the DS tier's accent EDGE — the mockups' secondary button — never as the fill.
        expect(style.borderTopColor).toBe(cssColor(palette.coral));
        expect(style.borderTopWidth).toBe('2px');
        // The regression this replaces: a bespoke solid coral fill that read as destructive.
        expect(style.backgroundColor).not.toBe(cssColor(palette.coral));
    });

    it('labels in the tier foreground colour — slate, not the old white-on-coral', () => {
        renderActions();

        // A leftover white label on the now-glass surface would be invisible; coral-as-text is 2.40:1. The
        // tier labels in slate (5.24:1), identically to the web leaf.
        expect(window.getComputedStyle(screen.getByText('Clone Collection')).color).toBe(cssColor(palette.slate));
        expect(window.getComputedStyle(screen.getByText('Clone Collection')).color).not.toBe(cssColor(palette.white));
    });

    it('rounds from the radius scale, not a magic 999', () => {
        renderActions();

        expect(
            window.getComputedStyle(pillOf(screen.getByRole('button', { name: 'Clone Collection' })))
                .borderTopLeftRadius,
        ).toBe(`${nativeTokens.radius.full}px`);
    });

    it('announces the in-flight clone through NATIVE busy semantics, not a web-only aria-busy prop', () => {
        renderActions({ isCloning: true });

        // `accessibilityState.busy` is what an on-device screen reader reads; react-native-web projects the
        // DS Button/PressScale's `aria-busy` alias, which is what makes it assertable here.
        expect(screen.getByRole('button', { name: 'Clone Collection' }).getAttribute('aria-busy')).toBe('true');
    });

    it('reports NOT busy when idle', () => {
        renderActions();

        expect(screen.getByRole('button', { name: 'Clone Collection' }).getAttribute('aria-busy')).not.toBe('true');
    });

    it('keeps the label as the sole accessible name (Maestro selects this control by it)', () => {
        renderActions();

        expect(screen.getByRole('button', { name: 'Clone Collection' }).getAttribute('aria-label')).toBe(
            'Clone Collection',
        );
    });
});

describe('CollectionActions (native) — visibility toggle, premium viewer (canGoPrivate: true)', () => {
    it('enables the Private option and reports a selection upward', () => {
        const onVisibilityChange = vi.fn();
        renderActions({ canGoPrivate: true, onVisibilityChange });

        const priv = screen.getByRole('radio', { name: 'Private' });
        expect(priv.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(priv);
        expect(onVisibilityChange).toHaveBeenCalledWith('private');
    });

    it('enables Save changes only when the pending selection differs from the saved visibility', () => {
        const onSaveVisibility = vi.fn();
        renderActions({
            visibility: RecipeVisibility.PUBLIC,
            pendingVisibility: RecipeVisibility.PUBLIC,
            onSaveVisibility,
        });

        expect(screen.getByRole('button', { name: 'Save changes' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('fires onSaveVisibility from an enabled Save changes when pending differs from saved', () => {
        const onSaveVisibility = vi.fn();
        renderActions({
            visibility: RecipeVisibility.PUBLIC,
            pendingVisibility: RecipeVisibility.PRIVATE,
            onSaveVisibility,
        });

        const save = screen.getByRole('button', { name: 'Save changes' });
        expect(save.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(save);
        expect(onSaveVisibility).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionActions (native) — visibility toggle, free viewer (canGoPrivate: false)', () => {
    it('gates the Private option off and shows the disabled reason', () => {
        renderActions({
            canGoPrivate: false,
            disabledReason: 'Upgrade to premium to make a collection private.',
        });

        const priv = screen.getByRole('radio', { name: 'Private' });
        expect(priv.getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('Upgrade to premium to make a collection private.')).toBeTruthy();
    });

    it('keeps Public selectable', () => {
        const onVisibilityChange = vi.fn();
        renderActions({
            canGoPrivate: false,
            visibility: RecipeVisibility.PRIVATE,
            pendingVisibility: RecipeVisibility.PRIVATE,
            onVisibilityChange,
        });

        const pub = screen.getByRole('radio', { name: 'Public' });
        expect(pub.getAttribute('aria-disabled')).not.toBe('true');

        fireEvent.click(pub);
        expect(onVisibilityChange).toHaveBeenCalledWith('public');
    });

    it('never emits a transition to private, however the disabled control is clicked', () => {
        const onVisibilityChange = vi.fn();
        renderActions({ canGoPrivate: false, onVisibilityChange });

        fireEvent.click(screen.getByRole('radio', { name: 'Private' }));

        expect(onVisibilityChange).not.toHaveBeenCalledWith('private');
    });
});

describe('CollectionActions (native) — premium gate is the boolean prop only', () => {
    it('contains no literal `premium`/`tier` string branch in the component source', () => {
        // Function.prototype.toString() reflects the component's actual executable body (not comments/
        // imports), so this proves the eligibility gate is the `canGoPrivate` boolean prop with no inline
        // tier/premium branch — not merely that the word is absent from a comment.
        const source = CollectionActions.toString();

        expect(source).not.toMatch(/premium/i);
        expect(source).not.toMatch(/\btier\b/i);
    });
});
