// @vitest-environment jsdom
/**
 * The meta line is ONE run of text (UI Designer ruling, 2026-11-03, designAnswers.md): "45 min · Easy · No ratings yet ·
 * 370 cal", a no-break space before each dot, no clock glyph, the star with the rating, wrapping like text. Web leaf.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { RecipeDifficulty, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeRecipe } from '../../__fixtures__/index.js';
import type { RecipeNutritionBatchReading } from '../../nutrition/model.js';
import { RecipeNutritionSlot } from '../../nutrition/RecipeNutritionSlot.js';
import { CARD_LIST_CLASS } from '../cardGridClass.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.js';

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

/** The meta line: the one `<p>` set in the meta type role. */
const lineOf = (container: HTMLElement): HTMLElement | null => container.querySelector('p[class*="text-meta"]');
const textOf = (container: HTMLElement): string | undefined => lineOf(container)?.textContent;

describe.each(['grid', 'row'] as const)('RecipeCard (web, %s) — the meta line is one run of text', (variant) => {
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
        const classes = line.outerHTML.match(/class="[^"]*"/gu)?.join(' ') ?? '';

        expect(line.querySelector('svg')).toBeNull();
        expect(classes).not.toMatch(
            /\b(flex|inline-flex|truncate|overflow-hidden|line-clamp-\d|whitespace-nowrap|h-lh|h-6)\b/u,
        );
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

    it('keeps the calorie loading form’s text inside the run', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model(base)}
                nutrition={slot({ status: 'pending' })}
            />,
        );

        expect(textOf(container)).toMatch(/^45 min\u00A0· Easy\u00A0· No ratings yet\u00A0· .+/u);
    });
});

describe('RecipeCard (web, compact) — the brief run', () => {
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
describe('RecipeCard (web, row) — the status line', () => {
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
    ] as const)('shows %web as a pill with its word', (_name, over, word) => {
        const { container } = rowOf(over);

        expect(container.textContent).toContain(word);
    });
});

// UI Designer ruling (2026-11-03): tiles in one grid row share the height of the tallest tile, with the content
// top-aligned. On the web the list is a CSS grid whose items stretch by default, so each card must fill its cell
// (`h-full`) and the list must not override the stretch.
describe.each(['grid', 'compact'] as const)('RecipeCard (web, %s) — the tile fills its grid row', (variant) => {
    it('fills the cell it is given', () => {
        const { container } = renderCard(<RecipeCard headingLevel={3} variant={variant} recipe={model(base)} />);

        expect(container.querySelector('article')?.className.split(/\s+/u)).toContain('h-full');
    });

    it('is laid out by a list that stretches its items', () => {
        expect(CARD_LIST_CLASS[variant]).toMatch(/\bgrid\b/u);
        expect(CARD_LIST_CLASS[variant]).not.toMatch(/\bitems-(start|center|end|baseline)\b/u);
        expect(CARD_LIST_CLASS[variant]).not.toMatch(/\balign-items\b|\bself-/u);
    });
});
