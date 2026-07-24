/**
 * Native component tests for the collection-actions sidebar (W5 Task 7), rendered via react-native-web
 * under jsdom. Mirrors the web leaf: Add Recipes, the clone-only-visible Pull Updates action (FR-011),
 * Clone Collection's busy gate, and the two-stage, premium-gated (C1) visibility toggle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { RecipeVisibility } from '@kitchensink/recipe-core';

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
