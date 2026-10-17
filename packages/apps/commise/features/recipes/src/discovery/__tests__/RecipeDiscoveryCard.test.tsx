// @vitest-environment jsdom
/**
 * The Discover result card (`docs/design/uiOverhaul/buildSpec.md` §4.1): the shared `RecipeCard` in the variant the host
 * decided, with the author and the Save a copy icon button in its footer. The card is one link named by the title; the
 * Save a copy control sits beside it, never inside it, so a press on one cannot also open the other.
 *
 * ⚠️ REWRITTEN for slice 5. The card used to be a bespoke arrangement with a text "Clone" button on the secondary tier,
 * and this file pinned that button's tier and its row-unique name. "Clone" is retired by the glossary and the control is
 * now an icon in the card's footer; the row-unique name is kept ("Save a copy of {title}").
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../../card/model.js';
import { RecipeDiscoveryCard } from '../RecipeDiscoveryCard.js';
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

describe('RecipeDiscoveryCard (web)', () => {
    it.each(['grid', 'compact'] as const)(
        'draws the %s card with the author and Save a copy in its footer',
        (variant) => {
            renderCard({ variant });
            const card = screen.getByRole('article', { name: 'Lamb Shoulder' });

            expect(card.getAttribute('data-card-variant')).toBe(variant);
            // The byline (plan 2026-10-15-010 D11): "@username (Display Name)" on both variants; the disc only on grid.
            expect(within(card).getByText(`${isolate('@braise')} (${isolate('Eliza Moreno')})`)).toBeTruthy();
            expect(within(card).queryByText('B') !== null).toBe(variant === 'grid');
            expect(within(card).getByRole('button', { name: 'Save a copy of Lamb Shoulder' })).toBeTruthy();
        },
    );

    it('opens the recipe from its one link, and saves a copy from its own button without opening the recipe', () => {
        const props = renderCard({ href: '/en/recipes/rec_1' });

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' }));

        expect(props.onSave).toHaveBeenCalledExactlyOnceWith('rec_1');
        expect(props.onSelect).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('link', { name: 'Lamb Shoulder' }));

        expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('rec_1');
    });

    it('keeps the Save a copy control out of the card’s link', () => {
        renderCard({ href: '/en/recipes/rec_1' });

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

    it('keeps a long unbroken source inside its cell: a shrinkable column, a truncated line, Save still there', () => {
        const source = 'A'.repeat(300);

        renderCard({ authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: source });
        const card = screen.getByRole('article', { name: 'Lamb Shoulder' });

        // An implicit grid column is `auto`, so the unbreakable word's min-content widened the cell and pushed Save out.
        expect(card.className.split(/\s+/u)).toContain('grid-cols-[minmax(0,1fr)]');
        expect(screen.getByText(`From ${source}`).className.split(/\s+/u)).toEqual(
            expect.arrayContaining(['truncate', 'min-w-0']),
        );
        expect(within(card).getByRole('button', { name: 'Save a copy of Lamb Shoulder' })).toBeTruthy();
    });

    it.each(['grid', 'compact'] as const)(
        'keeps a long source on ONE truncating line in the %s card, with the whole text still its accessible text',
        (variant) => {
            const source = 'The Book of Household Management';

            renderCard({ variant, authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: source });

            const line = screen.getByText(`From ${source}`);

            // jsdom has no layout, so this pins the structure that LETS the line give way: `truncate` clips it to one line
            // with an ellipsis and `min-w-0` lets the flex row shrink it below its text, so Save keeps its 44 px. The real
            // proof that it does is the design-artifact browser tier (`renderArtifact.e2e.test.ts`, the
            // RecipeDiscoveryCard card): every card is measured in Chromium and none may spill sideways.
            expect(line.className.split(/\s+/u)).toEqual(expect.arrayContaining(['truncate', 'min-w-0', 'flex-1']));
            // Clipped on screen, never cut from the tree: the full attribution is what a screen reader reads.
            expect(line.textContent).toBe(`From ${source}`);
            expect(screen.getByRole('button', { name: 'Save a copy of Lamb Shoulder' })).toBeTruthy();
        },
    );
});
