// @vitest-environment jsdom
/**
 * Component tests for the web public-discovery result card (T076 / W4 S1), focused on its CLONE affordance.
 *
 * The card's list-level behaviour (select, per-row clone, per-row busy) is covered through
 * `RecipeDiscoveryList.test.tsx`, which renders it in situ. This file exists for the card's OWN contract at
 * the leaf: that the clone control is the design-system `Button` on the same `secondary` tier as every other
 * clone affordance in the product, and that migrating it did not cost the row-unique accessible name the list
 * and Playwright both select by.
 *
 * ## Why the clone control is no longer a hand-rolled coral outline
 *
 * This leaf painted `border border-coral … text-coral` while `CollectionActions` painted a SOLID coral fill and
 * the recipe-detail clone painted a third variant — three hand-rolled answers to one question, in one product.
 * The premise under all of them is false: no mockup contains a clone action at all, and the mockups never FILL
 * a button coral (their coral button form is `border-2 border-coral text-coral` over glass, filling only on
 * hover). Coral's documented role is the danger register — `Commise-Figma-Make-Prompt.md` line 38,
 * "Destructive/secondary actions, highlights, warm accents", which the mockups spend on the Danger Zone and the
 * allergy warning — and `palette.coral` (#E8917A) sits one hue from `palette.error` (#E17055). Clone is a safe,
 * additive, reversible action, so it belongs on the DS `secondary` tier, not in the danger register.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buttonSurfaceClass } from '@commise/ui/button';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import { RecipeCloneAction } from '../../actions/RecipeCloneAction.js';
import { RecipeDiscoveryCard } from '../RecipeDiscoveryCard.js';
import type { RecipeDiscoveryCardProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const RECIPE_TITLE = 'Mediterranean Grilled Lamb';

/** The row's clone control, addressed the way the list and Playwright address it — by its unique name. */
const cloneName = (title = RECIPE_TITLE) => `Clone ${title}`;

function renderCard(overrides: Partial<RecipeDiscoveryCardProps> = {}) {
    const props: RecipeDiscoveryCardProps = {
        recipe: toRecipeCardModel(makeRecipe({ id: 'rec_1', title: RECIPE_TITLE })),
        isCloning: false,
        onSelect: noop,
        onClone: noop,
        ...overrides,
    };
    render(<RecipeDiscoveryCard {...props} />);

    return props;
}

describe('RecipeDiscoveryCard (web) — clone contract', () => {
    it('reports the cloned recipe id upward', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderCard({ onClone });

        await user.click(screen.getByRole('button', { name: cloneName() }));

        expect(onClone).toHaveBeenCalledWith('rec_1');
    });

    it('keeps the clone control a SIBLING of the select target, so cloning never also selects the row', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        const onSelect = vi.fn();
        renderCard({ onClone, onSelect });

        await user.click(screen.getByRole('button', { name: cloneName() }));

        expect(onClone).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('names each row’s clone control by its recipe, so sibling rows are distinguishable', () => {
        renderCard({ recipe: toRecipeCardModel(makeRecipe({ id: 'rec_9', title: 'Ribollita' })) });

        expect(screen.getByRole('button', { name: cloneName('Ribollita') })).toBeTruthy();
    });

    it('disables the clone control and announces busy while THIS row’s clone is in flight', async () => {
        const user = userEvent.setup();
        const onClone = vi.fn();
        renderCard({ isCloning: true, onClone });

        // While busy the row is named by the in-flight template, not the idle one.
        const button = screen.getByRole<HTMLButtonElement>('button', { name: `Cloning ${RECIPE_TITLE}` });
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Cloning')).toBeTruthy();

        await user.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });

    it('reports NOT busy when idle', () => {
        renderCard();

        expect(screen.getByRole('button', { name: cloneName() }).getAttribute('aria-busy')).not.toBe('true');
    });
});

describe('RecipeDiscoveryCard (web) — the clone control is the DS secondary surface', () => {
    it('wears the DS secondary Button surface verbatim (no hand-rolled coral outline)', () => {
        renderCard();

        expect(screen.getByRole('button', { name: cloneName() }).className).toBe(buttonSurfaceClass('secondary'));
    });

    it('is the SAME surface the recipe-detail clone wears — one decision governs every clone affordance', () => {
        renderCard();
        render(<RecipeCloneAction canClone onClone={noop} />);

        // Compared against the sibling control's ACTUAL rendered class, not a re-spelled string: if either
        // leaf drifts onto its own tier, this fails even though both would still "be a DS Button".
        expect(screen.getByRole('button', { name: cloneName() }).className).toBe(
            screen.getByRole('button', { name: 'Clone' }).className,
        );
    });

    it('paints no coral at all — neither the outline nor the tint that put clone in the danger register', () => {
        renderCard();
        const className = screen.getByRole('button', { name: cloneName() }).className;

        expect(className).not.toContain('coral');
        // The replacement must be a real DS surface, not "no surface at all" (the bare-text regression).
        expect(className).toContain('bg-white');
    });

    it('gives the control the DS 44px touch floor, reset for the mouse at md', () => {
        renderCard();
        const className = screen.getByRole('button', { name: cloneName() }).className;

        // The hand-rolled outline had NO touch floor at all on web (the native leaf had bolted one on).
        expect(className).toContain('min-h-11');
        expect(className).toContain('md:min-h-0');
    });

    it('keeps the row-unique accessible name as an explicit override of the generic visible label', () => {
        renderCard();
        const button = screen.getByRole('button', { name: cloneName() });

        // The visible label is the generic "Clone" (there is no room for the title on a card); the row-unique
        // name comes from `accessibilityLabel`. Both must survive the DS migration — the DS Button supports
        // exactly this override, and the icon must NOT leak into the name.
        expect(button.getAttribute('aria-label')).toBe(cloneName());
        expect(button.textContent).toBe('Clone');
        expect(button.querySelector('svg')).not.toBeNull();
        expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it('swaps the icon slot for the DS spinner while cloning, keeping the surface stable', () => {
        renderCard({ isCloning: true });
        const button = screen.getByRole('button', { name: `Cloning ${RECIPE_TITLE}` });

        // Busy must not restyle the pill (that would shift the card's layout mid-flight).
        expect(button.className).toBe(buttonSurfaceClass('secondary'));
        expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    });

    it('keeps the idle control spinner-free', () => {
        renderCard();

        expect(screen.getByRole('button', { name: cloneName() }).querySelector('svg.animate-spin')).toBeNull();
    });
});
