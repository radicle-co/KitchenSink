// @vitest-environment jsdom
/**
 * Component tests for the web collection member row (W5 Task 9, C3). Covers every state the row adds on top
 * of the shared `RecipeCard` — the source-indicator (owner-added/protected vs from-source/will-sync), the
 * `by @handle` attribution (present/absent), the card-composed fields (title, calories, version badge past
 * v1, visibility) — plus select/remove reporting and the mandatory double-fire guard (Remove must never also
 * fire `onSelect`, since the two are sibling controls, not nested).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';

import { makeCollectionMemberRecipe } from '../../__fixtures__/index.js';
import { CollectionMemberRow } from '../CollectionMemberRow.js';
import type { CollectionMemberRowProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

function renderRow(overrides: Partial<CollectionMemberRowProps> = {}) {
    const props: CollectionMemberRowProps = {
        member: makeCollectionMemberRecipe(),
        onSelect: noop,
        onRemove: noop,
        ...overrides,
    };
    render(<CollectionMemberRow {...props} />);

    return props;
}

describe('CollectionMemberRow (web) — source indicator', () => {
    it('shows the owner-added/protected indicator when addedVia is manual', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.MANUAL }) });

        expect(screen.getByText('Added by you')).toBeTruthy();
        expect(screen.queryByText('From source collection')).toBeNull();
    });

    it('shows the from-source/will-sync indicator when addedVia is clone_seed', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.CLONE_SEED }) });

        expect(screen.getByText('From source collection')).toBeTruthy();
        expect(screen.queryByText('Added by you')).toBeNull();
    });

    it('shows the from-source/will-sync indicator when addedVia is pull', () => {
        renderRow({ member: makeCollectionMemberRecipe({ addedVia: RecipeCollectionAddedVia.PULL }) });

        expect(screen.getByText('From source collection')).toBeTruthy();
        expect(screen.queryByText('Added by you')).toBeNull();
    });
});

describe('CollectionMemberRow (web) — by @handle', () => {
    it('renders the by-@handle line when the member has an author handle', () => {
        renderRow({ member: makeCollectionMemberRecipe({ authorHandle: 'alexk' }) });

        expect(screen.getByText('by @alexk')).toBeTruthy();
    });

    it('omits the by-@handle line when the member has no author handle (never "by @undefined")', () => {
        renderRow({ member: makeCollectionMemberRecipe({ authorHandle: undefined }) });

        expect(screen.queryByText(/^by @/)).toBeNull();
    });
});

describe('CollectionMemberRow (web) — composes RecipeCard (not a hand-rolled duplicate)', () => {
    // The calorie assertion MOVED with the deferred lookup: the figure is no longer a card-model field, so a
    // member row renders none until this surface passes a `nutrition` slot (its own wiring task). Coverage of
    // the figure's states lives in `nutrition/__tests__/RecipeCalorieChip.test.tsx`.
    it('renders the title, version badge past v1, and visibility via the shared RecipeCard', () => {
        renderRow({
            member: makeCollectionMemberRecipe({
                title: 'Chicken Alfredo',
                currentVersion: 3,
                visibility: 'private',
                status: 'published',
                leadCaloriesPerServing: 520,
            }),
        });

        expect(screen.getByText('Chicken Alfredo')).toBeTruthy();
        expect(screen.getByLabelText('Version 3').textContent).toBe('v3');
        expect(screen.getByText('Private')).toBeTruthy();
        expect(screen.queryByText('520 cal')).toBeNull();
    });

    // NARROWED from "…and renders no calorie line when calories are absent (never 0)". With the figure gone
    // from the card model entirely, the calorie half could no longer fail for ANY implementation — coverage
    // theatre under a title that still advertised it. The test above keeps `leadCaloriesPerServing: 520` in
    // its fixture and asserts nothing renders, which is the assertion that still has teeth.
    it('hides the version badge at v1', () => {
        renderRow({ member: makeCollectionMemberRecipe({ currentVersion: 1 }) });

        expect(screen.queryByLabelText(/Version/)).toBeNull();
    });
});

describe('CollectionMemberRow (web) — select / remove', () => {
    it('reports the recipe id upward when the select target is activated', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), onSelect });

        await user.click(screen.getByRole('button', { name: 'Weeknight Pasta' }));

        expect(onSelect).toHaveBeenCalledWith('rec_1');
    });

    it('reports the recipe id upward when the remove control is activated', async () => {
        const user = userEvent.setup();
        const onRemove = vi.fn();
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }), onRemove });

        await user.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemove).toHaveBeenCalledWith('rec_1');
    });

    it('does NOT also fire onSelect when Remove is activated (double-fire guard — sibling controls, never nested)', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        const onRemove = vi.fn();
        renderRow({
            member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            onSelect,
            onRemove,
        });

        await user.click(screen.getByRole('button', { name: 'Remove Weeknight Pasta' }));

        expect(onRemove).toHaveBeenCalledWith('rec_1');
        expect(onSelect).not.toHaveBeenCalled();
    });
});

/**
 * Remove is painted in the ERROR register — with the error hue, not coral.
 *
 * The control already labelled itself `text-error-dark` (#B1442B) but tinted its hover with `bg-coral/10`
 * (#E8917A) — two adjacent-but-different hues inside one control, and the wrong one for a destructive action:
 * coral is a brand accent (the mockups spend it on tags and warm highlights), `error` is the destructive
 * token, and the design system's own `destructive` Button tier already tints with `hover:bg-error/10`. The
 * native leaf never had the coral at all (`palette.error` text, no tint), so this was a WEB-ONLY drift.
 */
describe('CollectionMemberRow (web) — Remove stays in the error register', () => {
    it('tints Remove’s hover with the error token, never coral', () => {
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) });
        const className = screen.getByRole('button', { name: 'Remove Weeknight Pasta' }).className;

        expect(className).toContain('text-error-dark');
        expect(className).toContain('hover:bg-error/10');
        expect(className).not.toContain('coral');
    });

    it('leaves the non-destructive select target out of the error register entirely', () => {
        renderRow({ member: makeCollectionMemberRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }) });
        const className = screen.getByRole('button', { name: 'Weeknight Pasta' }).className;

        // The counterweight assertion: "no coral" must not be reachable by painting EVERYTHING error-toned.
        expect(className).not.toContain('error');
        expect(className).not.toContain('coral');
    });
});
