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

afterEach(cleanup);

function renderCard(over: Partial<RecipeDiscoveryCardProps> = {}) {
    const props: RecipeDiscoveryCardProps = {
        recipe: toRecipeCardModel(makeRecipe({ id: 'rec_1', title: 'Lamb Shoulder' })),
        variant: 'grid',
        authorHandle: 'braise.club',
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

            expect(screen.getByText('@braise.club')).toBeTruthy();
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
        renderCard({ authorHandle: undefined, sourceAttribution: 'Serious Eats' });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
    });
});
