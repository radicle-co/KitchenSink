/**
 * The meta line is ONE run of text (UI Designer ruling, 2026-11-03, designAnswers.md): "45 min · Easy · No ratings yet ·
 * 370 cal", a no-break space before each dot, no clock glyph, the star with the rating, wrapping like text. Native leaf (react-native-web).
 */
import { cleanup, screen, within } from '@testing-library/react';
import { render } from '@commise/ui/testing/tamagui';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { RecipeNutritionBatchReading } from '../../nutrition/model.js';
import { RecipeNutritionSlot } from '../../nutrition/RecipeNutritionSlot.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.native.js';

afterEach(cleanup);

const model = (over: Parameters<typeof makeRecipe>[0] = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';
const DOT = '\u00A0· ';

/** A calorie figure the way a host draws it: the slot over a settled (or pending, or omitting) batch reading. */
const known = (calories: number): RecipeNutritionBatchReading => ({
    status: 'settled',
    response: {
        nutrition: {
            [RECIPE_ID]: {
                state: 'known',
                caloriesPerServing: calories,
                proteinG: 1,
                carbsG: 1,
                fatG: 1,
                isComplete: true,
                freshness: 'fresh',
            },
        },
    },
});
const slot = (reading: RecipeNutritionBatchReading) => <RecipeNutritionSlot reading={reading} recipeId={RECIPE_ID} />;
const base = { id: RECIPE_ID, totalTimeMinutes: 45, difficulty: RecipeDifficulty.EASY, ratingCount: 0 } as const;

/** The meta line: the one text node that follows the title in the card body, or null. */
const lineOf = (container: HTMLElement): HTMLElement | null => {
    const title = [...container.querySelectorAll<HTMLElement>('div')].find(
        (node) => node.textContent === 'Weeknight Pasta' && node.children.length === 0,
    );
    const next = title?.nextElementSibling ?? null;

    return next instanceof HTMLElement ? next : null;
};

const textOf = (container: HTMLElement): string | undefined => lineOf(container)?.textContent;

describe.each(['grid', 'row'] as const)('RecipeCard (native, %s) — the meta line is one run of text', (variant) => {
    it('reads time · difficulty · rating · calories with a no-break space before each dot', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model(base)} nutrition={slot(known(370))} />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}Easy${DOT}No ratings yet${DOT}370 cal`);
    });

    it('keeps the star with a rating, as part of the run', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ ...base, averageRating: 4.75, ratingCount: 12 })}
            />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}Easy${DOT}★ 4.8 (12)`);
    });

    it('draws no clock glyph and no separate part boxes: the line is text', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model(base)} nutrition={slot(known(370))} />,
        );
        const line = lineOf(container) as HTMLElement;
        const style = window.getComputedStyle(line);

        expect(line.querySelector('svg')).toBeNull();
        expect(style.display).not.toBe('flex');
        expect(style.overflowX).not.toBe('hidden');
        expect(style.height).not.toMatch(/px/u);
        expect(style.textOverflow).not.toBe('ellipsis');
    });

    it('leaves out a part with no data together with its separator', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ ...base, totalTimeMinutes: 0, difficulty: undefined })}
                nutrition={slot(known(370))}
            />,
        );

        expect(textOf(container)).toBe(`No ratings yet${DOT}370 cal`);
    });

    it('leaves no dot behind when the calorie figure settles on nothing', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model(base)}
                nutrition={slot({ status: 'settled', response: { nutrition: {} } })}
            />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}Easy${DOT}No ratings yet`);
    });

    it('keeps the calorie loading placeholder inside the run, after its lead', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model(base)}
                nutrition={slot({ status: 'pending' })}
            />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}Easy${DOT}No ratings yet${DOT}`);
    });
});

describe('RecipeCard (native, compact) — the brief run', () => {
    it('reads time · calories on a Home tile', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model(base)} nutrition={slot(known(370))} />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}370 cal`);
    });

    it('reads just the calories, with no leading dot, when there is no time', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                recipe={model({ ...base, totalTimeMinutes: 0 })}
                nutrition={slot(known(370))}
            />,
        );

        expect(textOf(container)).toBe('370 cal');
    });

    it('draws no line at all when no part has data', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model({ ...base, totalTimeMinutes: 0 })} />,
        );

        expect(lineOf(container)).toBeNull();
    });

    it('draws the full run on a tile that asks for it (fullMeta)', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant="compact"
                fullMeta
                recipe={model(base)}
                nutrition={slot(known(370))}
            />,
        );

        expect(textOf(container)).toBe(`45 min${DOT}Easy${DOT}No ratings yet${DOT}370 cal`);
    });
});

// UI Designer ruling (2026-11-03): a public recipe shows no status mark; Draft and Private are pills with words, and a
// glyph alone is never a status.
describe('RecipeCard (native, row) — the status line', () => {
    const rowOf = (over: Parameters<typeof makeRecipe>[0]) =>
        renderCard(<RecipeCard headingLevel={3} variant="row" recipe={model({ ...base, ...over })} />);

    it('shows no status mark for a public recipe: no globe, no lock, no Public word', () => {
        const { container } = rowOf({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC });

        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).not.toMatch(/Public|Private|Draft/u);
    });

    it.each([
        ['a draft', { status: RecipeStatus.DRAFT, visibility: RecipeVisibility.PRIVATE }, 'Draft'],
        ['a private recipe', { status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PRIVATE }, 'Private'],
    ] as const)('shows %native as a pill with its word', (_name, over, word) => {
        const { container } = rowOf(over);

        expect(container.textContent).toContain(word);
    });
});

// UI Designer ruling (2026-11-03): tiles in one grid row share the height of the tallest tile, with the content
// top-aligned. A tile can only stretch if its surface is the card's outermost box and grows (`flexGrow`): a press frame
// around the surface, with no growth of its own, kept the surface at its content height.
describe.each(['grid', 'compact'] as const)('RecipeCard (native, %s) — the tile fills its grid row', (variant) => {
    it('makes the surface the outermost box, growing to the height it is given, with the link inside it', () => {
        renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                onSelect={() => undefined}
                recipe={model({ ...base, title: 'Herb Risotto' })}
            />,
        );
        const link = screen.getByRole('link');
        let clip: HTMLElement | null = screen.getByText('Herb Risotto');

        while (clip !== null && window.getComputedStyle(clip).overflowX !== 'hidden') {
            clip = clip.parentElement;
        }

        const surface = clip?.parentElement as HTMLElement;

        expect(window.getComputedStyle(surface).flexGrow).toBe('1');
        expect(surface.contains(link)).toBe(true);
        expect(link.contains(surface)).toBe(false);
    });

    it('keeps the content at the top: the link does not grow to centre it', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} onSelect={() => undefined} recipe={model(base)} />,
        );
        const link = within(container).getByRole('link');

        expect(window.getComputedStyle(link).justifyContent).not.toBe('center');
    });
});
