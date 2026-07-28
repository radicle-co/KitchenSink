// @vitest-environment jsdom
/**
 * Component tests for the web collection-actions sidebar (W5 Task 7). Covers Add Recipes, the
 * clone-only-visible Pull Updates action (FR-011), Clone Collection's busy gate, and the two-stage,
 * premium-gated (C1) visibility toggle — including the free-tier gate that must disable Private, surface
 * the disabled reason, and refuse to ever emit a transition to `private`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buttonSurfaceClass } from '@commise/ui/button';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { RecipeCloneAction } from '../../actions/RecipeCloneAction.js';
import { CollectionActions } from '../CollectionActions.js';
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

describe('CollectionActions (web) — Pull Updates visibility (FR-011)', () => {
    it('renders no Pull Updates action for a non-cloned collection', () => {
        renderActions({ isCloned: false });

        expect(screen.queryByRole('button', { name: 'Pull Updates from Source' })).toBeNull();
    });

    it('renders Pull Updates for a cloned collection and reports activation upward', async () => {
        const user = userEvent.setup();
        const onPullUpdates = vi.fn();
        renderActions({ isCloned: true, onPullUpdates });

        await user.click(screen.getByRole('button', { name: 'Pull Updates from Source' }));

        expect(onPullUpdates).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy affordance while pulling updates, and cannot re-fire', async () => {
        const user = userEvent.setup();
        const onPullUpdates = vi.fn();
        renderActions({ isCloned: true, isPulling: true, onPullUpdates });

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Pull Updates from Source' });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Pulling updates…')).toBeTruthy();

        await user.click(button);
        expect(onPullUpdates).not.toHaveBeenCalled();
    });
});

describe('CollectionActions (web) — Add Recipes', () => {
    it('reports activation upward', async () => {
        const user = userEvent.setup();
        const onAddRecipes = vi.fn();
        renderActions({ onAddRecipes });

        await user.click(screen.getByRole('button', { name: 'Add Recipes' }));

        expect(onAddRecipes).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionActions (web) — Clone Collection', () => {
    it('reports activation upward', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderActions({ onClone });

        await user.click(screen.getByRole('button', { name: 'Clone Collection' }));

        expect(onClone).toHaveBeenCalledTimes(1);
    });

    it('disables the action and shows a busy affordance while cloning, and cannot re-fire', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderActions({ isCloning: true, onClone });

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Clone Collection' });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Cloning…')).toBeTruthy();

        await user.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });
});

/**
 * Clone Collection IS the design-system Button — the SAME `secondary` tier the recipe-detail clone wears.
 *
 * This control painted a solid-coral pill (`bg-coral … text-white`) while its sibling clone affordance on the
 * discovery card painted a coral OUTLINE and the detail clone painted a solid — three hand-rolled answers to
 * one question. The premise under all of them is false: no mockup contains a clone action at all, and the
 * mockups never FILL a button coral (their coral button form is `border-2 border-coral text-coral` over glass,
 * filling only on hover). Coral's documented role is the danger register, which is why a filled-coral pill put
 * a safe, additive, reversible action next to `palette.error`.
 *
 * The assertions pin the surface by EQUALITY against the shared recipe, so any re-hand-rolling — a stray
 * colour utility, a re-typed radius, a dropped touch floor — breaks them.
 */
describe('CollectionActions (web) — Clone Collection is the DS secondary surface', () => {
    it('wears the DS secondary Button surface verbatim (no hand-rolled pill)', () => {
        renderActions();

        expect(screen.getByRole('button', { name: 'Clone Collection' }).className).toBe(
            buttonSurfaceClass('secondary'),
        );
    });

    it('is the SAME surface the recipe-detail clone wears — one decision governs every clone affordance', () => {
        renderActions();
        render(<RecipeCloneAction canClone onClone={noop} />);

        // Compared against the sibling control's ACTUAL rendered class, not a re-spelled string: if either
        // leaf drifts onto its own tier, this fails even though both would still "be a DS Button".
        expect(screen.getByRole('button', { name: 'Clone Collection' }).className).toBe(
            screen.getByRole('button', { name: 'Clone' }).className,
        );
    });

    it('paints no coral FILL at rest — a reversible action stays out of the danger register', () => {
        renderActions();
        const className = screen.getByRole('button', { name: 'Clone Collection' }).className;

        // The DS secondary tier IS coral-outlined glass (the mockups' own secondary button), so coral is
        // expected on the border. What must never come back is the solid coral FILL at rest.
        expect(className).not.toContain('bg-coral');
        expect(className).toContain('border-coral');
        // The replacement must be a real DS surface, not "no surface at all" (the bare-text regression).
        expect(className).toContain('from-white/80');
    });

    it('gives the control the DS 44px touch floor, reset for the mouse at md', () => {
        renderActions();
        const className = screen.getByRole('button', { name: 'Clone Collection' }).className;

        expect(className).toContain('min-h-11');
        expect(className).toContain('md:min-h-0');
    });

    it('pairs the label with a decorative icon that never joins the accessible name', () => {
        renderActions();
        const button = screen.getByRole('button', { name: 'Clone Collection' });

        // The DS Button requires an icon and hides it, so the visible label alone owns the name — which is
        // what keeps `getByRole('button', { name: 'Clone Collection' })` stable in RTL AND in Playwright
        // (`tests/e2e/collections.spec.ts` selects this exact name).
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBeNull();
    });

    it('swaps the icon slot for the DS spinner while cloning, keeping the surface and label stable', () => {
        renderActions({ isCloning: true });
        const button = screen.getByRole('button', { name: 'Clone Collection' });

        // Busy must not restyle the pill (that would shift layout mid-flight) — same class string as idle.
        expect(button.className).toBe(buttonSurfaceClass('secondary'));
        expect(button.querySelector('svg.animate-spin')).not.toBeNull();
        // The separate live-region status survives the migration; the spinner does not replace it.
        expect(screen.getByRole('status').textContent).toBe('Cloning…');
    });

    it('keeps the idle control spinner-free and status-free', () => {
        renderActions();

        expect(screen.getByRole('button', { name: 'Clone Collection' }).querySelector('svg.animate-spin')).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('CollectionActions (web) — visibility toggle, premium viewer (canGoPrivate: true)', () => {
    it('enables the Private option and reports a selection upward', async () => {
        const user = userEvent.setup();
        const onVisibilityChange = vi.fn();
        renderActions({ canGoPrivate: true, onVisibilityChange });

        const priv = screen.getByRole<HTMLInputElement>('radio', { name: 'Private' });
        expect(priv.disabled).toBe(false);

        await user.click(priv);
        expect(onVisibilityChange).toHaveBeenCalledWith('private');
    });

    it('enables Save changes only when the pending selection differs from the saved visibility', () => {
        const onSaveVisibility = vi.fn();
        renderActions({
            visibility: RecipeVisibility.PUBLIC,
            pendingVisibility: RecipeVisibility.PUBLIC,
            onSaveVisibility,
        });

        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' }).disabled).toBe(true);
    });

    it('fires onSaveVisibility from an enabled Save changes when pending differs from saved', async () => {
        const user = userEvent.setup();
        const onSaveVisibility = vi.fn();
        renderActions({
            visibility: RecipeVisibility.PUBLIC,
            pendingVisibility: RecipeVisibility.PRIVATE,
            onSaveVisibility,
        });

        const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' });
        expect(save.disabled).toBe(false);

        await user.click(save);
        expect(onSaveVisibility).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionActions (web) — visibility toggle, free viewer (canGoPrivate: false)', () => {
    it('gates the Private option off and shows the disabled reason', () => {
        renderActions({
            canGoPrivate: false,
            disabledReason: 'Upgrade to premium to make a collection private.',
        });

        const priv = screen.getByRole<HTMLInputElement>('radio', { name: 'Private' });
        expect(priv.disabled).toBe(true);
        expect(screen.getByText('Upgrade to premium to make a collection private.')).toBeTruthy();
    });

    it('keeps Public selectable', async () => {
        const user = userEvent.setup();
        const onVisibilityChange = vi.fn();
        renderActions({
            canGoPrivate: false,
            visibility: RecipeVisibility.PRIVATE,
            pendingVisibility: RecipeVisibility.PRIVATE,
            onVisibilityChange,
        });

        const pub = screen.getByRole<HTMLInputElement>('radio', { name: 'Public' });
        expect(pub.disabled).toBe(false);

        await user.click(pub);
        expect(onVisibilityChange).toHaveBeenCalledWith('public');
    });

    it('never emits a transition to private, however the disabled control is clicked', async () => {
        const user = userEvent.setup();
        const onVisibilityChange = vi.fn();
        renderActions({ canGoPrivate: false, onVisibilityChange });

        await user.click(screen.getByRole('radio', { name: 'Private' }));

        expect(onVisibilityChange).not.toHaveBeenCalledWith('private');
    });
});

describe('CollectionActions (web) — premium gate is the boolean prop only', () => {
    it('contains no literal `premium`/`tier` string branch in the component source', () => {
        // Function.prototype.toString() reflects the component's actual executable body (not comments/
        // imports), so this proves the eligibility gate is the `canGoPrivate` boolean prop with no inline
        // tier/premium branch — not merely that the word is absent from a comment.
        const source = CollectionActions.toString();

        expect(source).not.toMatch(/premium/i);
        expect(source).not.toMatch(/\btier\b/i);
    });
});
