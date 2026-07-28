/**
 * Native component tests for the public-discovery result card (T076 / W4 S1), rendered via react-native-web
 * under jsdom. Mirrors the web leaf and is focused on the card's CLONE affordance: the list-level behaviour is
 * covered through `RecipeDiscoveryList.native.test.tsx`, which renders this card in situ.
 *
 * The clone control used to hand-roll a coral OUTLINE here while `CollectionActions.native.tsx` hand-rolled a
 * SOLID coral fill — the same action, two platforms, three visual answers across the product. See the web
 * sibling's module comment for why coral was the wrong register for clone at all; these assertions prove the
 * native leaf now takes the shared DS `secondary` tier, and that the 44pt floor and busy semantics its
 * hand-rolled `StyleSheet` justified itself with now come from the design system instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from '../../__tests__/cssColor.js';
import { pillOf } from '../../__tests__/dsPill.js';
import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryCard } from '../RecipeDiscoveryCard.native.js';
import type { RecipeDiscoveryCardProps } from '../model.js';

afterEach(cleanup);

const noop = () => undefined;

const RECIPE_TITLE = 'Mediterranean Grilled Lamb';

/** The row's clone control, addressed the way the list and Maestro address it — by its unique name. */
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

describe('RecipeDiscoveryCard (native) — clone contract', () => {
    it('reports the cloned recipe id upward', () => {
        const onClone = vi.fn();
        renderCard({ onClone });

        fireEvent.click(screen.getByRole('button', { name: cloneName() }));

        expect(onClone).toHaveBeenCalledWith('rec_1');
    });

    it('keeps the clone control a SIBLING of the select target, so cloning never also selects the row', () => {
        const onClone = vi.fn();
        const onSelect = vi.fn();
        renderCard({ onClone, onSelect });

        fireEvent.click(screen.getByRole('button', { name: cloneName() }));

        expect(onClone).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('names each row’s clone control by its recipe, so sibling rows are distinguishable', () => {
        renderCard({ recipe: toRecipeCardModel(makeRecipe({ id: 'rec_9', title: 'Ribollita' })) });

        expect(screen.getByRole('button', { name: cloneName('Ribollita') })).toBeTruthy();
    });

    it('disables the clone control and announces busy while THIS row’s clone is in flight', () => {
        const onClone = vi.fn();
        renderCard({ isCloning: true, onClone });

        // While busy the row is named by the in-flight template, not the idle one.
        const button = screen.getByRole('button', { name: `Cloning ${RECIPE_TITLE}` });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.getAttribute('aria-busy')).toBe('true');

        fireEvent.click(button);
        expect(onClone).not.toHaveBeenCalled();
    });

    it('reports NOT busy when idle', () => {
        renderCard();

        expect(screen.getByRole('button', { name: cloneName() }).getAttribute('aria-busy')).not.toBe('true');
    });
});

describe('RecipeDiscoveryCard (native) — the clone control is the DS secondary surface', () => {
    it('meets the 44pt touch floor the DS Button guarantees', () => {
        renderCard();

        // `pillOf` throws when no 44pt surface exists, so reaching this line IS the assertion.
        expect(pillOf(screen.getByRole('button', { name: cloneName() }))).toBeTruthy();
    });

    it('paints the DS secondary surface — a bordered white pill, NOT the old coral outline', () => {
        renderCard();
        const style = window.getComputedStyle(pillOf(screen.getByRole('button', { name: cloneName() })));

        expect(style.backgroundColor).toBe(cssColor(palette.white));
        // The hairline comes from the shared semantic border token, so a re-theme moves it with the DS.
        expect(style.borderTopColor).toBe(cssColor(semantic.border));
        // The regression this replaces: a bespoke coral edge on a transparent surface.
        expect(style.borderTopColor).not.toBe(cssColor(palette.coral));
    });

    it('labels in the tier foreground colour, not the old coral-on-transparent', () => {
        renderCard();

        expect(window.getComputedStyle(screen.getByText('Clone')).color).toBe(cssColor(palette.charcoal));
        expect(window.getComputedStyle(screen.getByText('Clone')).color).not.toBe(cssColor(palette.coral));
    });

    it('rounds from the radius scale, not a magic 999', () => {
        renderCard();

        expect(
            window.getComputedStyle(pillOf(screen.getByRole('button', { name: cloneName() }))).borderTopLeftRadius,
        ).toBe(`${nativeTokens.radius.full}px`);
    });

    it('keeps the row-unique accessible name as an explicit override of the generic visible label', () => {
        renderCard();

        // The visible label is the generic "Clone"; the row-unique name comes from `accessibilityLabel`, which
        // Maestro and the list tests both select by. The DS Button supports exactly that override.
        expect(screen.getByRole('button', { name: cloneName() }).getAttribute('aria-label')).toBe(cloneName());
        expect(screen.getByText('Clone')).toBeTruthy();
    });
});
