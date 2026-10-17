/**
 * The native Discover result card (`docs/design/uiOverhaul/buildSpec.md` §4.1): the shared `RecipeCard` in the variant the host
 * decided, with the author and the Save a copy icon button in its footer. The card is one link named by the title; the
 * Save a copy control sits beside it, never inside it, so a press on one cannot also open the other.
 *
 * ⚠️ REWRITTEN for slice 5. The card used to be a bespoke arrangement with a text "Clone" button on the secondary tier,
 * and this file pinned that button's tier and its row-unique name. "Clone" is retired by the glossary and the control is
 * now an icon in the card's footer; the row-unique name is kept ("Save a copy of {title}").
 */
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import { RecipeDiscoveryCard } from '../RecipeDiscoveryCard.native.js';
import type { RecipeDiscoveryCardProps } from '../model.js';
import { isolate } from '../../byline/bylineText.js';

afterEach(cleanup);

function renderCard(over: Partial<RecipeDiscoveryCardProps> = {}) {
    const props: RecipeDiscoveryCardProps = {
        recipe: toRecipeCardModel(makeRecipe({ id: 'rec_1', title: 'Lamb Shoulder' })),
        variant: 'grid',
        headingLevel: 3,
        authorUsername: 'braise',
        authorDisplayName: 'Eliza Moreno',
        saveCopy: { kind: 'idle' },
        onSelect: vi.fn(),
        onSave: vi.fn(),
        ...over,
    };

    render(
        <LocaleProvider locale="en">
            <RecipeDiscoveryCard {...props} />
        </LocaleProvider>,
    );

    return props;
}

describe('RecipeDiscoveryCard (native)', () => {
    it.each(['grid', 'compact'] as const)(
        'draws the %s card with the author and Save a copy in its footer',
        (variant) => {
            renderCard({ variant });

            // The byline (plan 2026-10-15-010 D11): "@username (Display Name)" on both variants; the disc only on grid.
            expect(screen.getByText(`${isolate('@braise')} (${isolate('Eliza Moreno')})`)).toBeTruthy();
            expect(screen.queryByText('B') !== null).toBe(variant === 'grid');
            expect(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' })).toBeTruthy();
        },
    );

    it('opens the recipe from its one link, and saves a copy from its own button without opening the recipe', () => {
        const props = renderCard();

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' }));

        expect(props.onSave).toHaveBeenCalledExactlyOnceWith('rec_1');
        expect(props.onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('link', { name: 'Lamb Shoulder' }));

        expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('rec_1');
    });

    it('keeps the Save a copy control out of the card’s link', () => {
        renderCard();

        expect(
            screen
                .getByRole('link', { name: 'Lamb Shoulder' })
                .contains(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' })),
        ).toBe(false);
    });

    it('shows the copy’s state on the control: saved is named “Saved a copy of …” and a press sends nothing', () => {
        const props = renderCard({ saveCopy: { kind: 'saved', copyId: 'copy_1' } });

        fireEvent.click(screen.getByRole('button', { name: 'Saved a copy of Lamb Shoulder' }));

        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('says an imported recipe’s source when it has no author', () => {
        renderCard({ authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: 'Serious Eats' });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
    });

    it.each(['grid', 'compact'] as const)(
        'keeps a long source on ONE clipped line in the %s card, with the whole text still its accessible text',
        (variant) => {
            const source = 'The Book of Household Management';

            renderCard({ variant, authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: source });

            const line = screen.getByText(`From ${source}`);
            const style = getComputedStyle(line);

            // jsdom has no layout, so this reads the style react-native-web wrote for `numberOfLines={1}`: it is what lets
            // the line give way to the Save control. The real proof that Save stays inside a 256 px rail card is the
            // design-artifact browser tier (`renderArtifact.e2e.test.ts`, the RecipeDiscoveryCard card).
            expect(style.whiteSpace).toBe('nowrap');
            expect(style.overflowX).toBe('hidden');
            expect(style.textOverflow).toBe('ellipsis');
            // Clipped on screen, never cut from the tree: the full attribution is what a screen reader reads.
            expect(line.textContent).toBe(`From ${source}`);
            expect(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' })).toBeTruthy();
        },
    );
});
