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
const nb = (text: string): string => text.replaceAll(' ', '\u00A0');
const DOT = '\u2060\u00A0\u2060· ';

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

        expect(textOf(container)).toBe(`${nb('45 min')}${DOT}Easy${DOT}${nb('No ratings yet')}${DOT}${nb('370 cal')}`);
    });

    it('keeps the star with a rating, as part of the run', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model({ ...base, averageRating: 4.75, ratingCount: 12 })}
            />,
        );

        expect(textOf(container)).toBe(`${nb('45 min')}${DOT}Easy${DOT}${nb('★ 4.8 (12)')}`);
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

        expect(textOf(container)).toBe(`${nb('No ratings yet')}${DOT}${nb('370 cal')}`);
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

        expect(textOf(container)).toBe(`${nb('45 min')}${DOT}Easy${DOT}${nb('No ratings yet')}`);
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

        expect(textOf(container)).toMatch(
            /^45\u00A0min\u2060\u00A0\u2060· Easy\u2060\u00A0\u2060· No\u00A0ratings\u00A0yet\u2060\u00A0\u2060· .+/u,
        );
    });
});

describe('RecipeCard (web, compact) — the brief run', () => {
    it('reads time · calories on a Home tile', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="compact" recipe={model(base)} nutrition={slot(known(370))} />,
        );

        expect(textOf(container)).toBe(`${nb('45 min')}${DOT}${nb('370 cal')}`);
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

        expect(textOf(container)).toBe('370\u00A0cal');
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

        expect(textOf(container)).toBe(`${nb('45 min')}${DOT}Easy${DOT}${nb('No ratings yet')}${DOT}${nb('370 cal')}`);
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

/** Every ordinary space in a run must follow a dot: the line may break only after a "·". */
const breaksOnlyAfterDots = (text: string): boolean =>
    [...text.matchAll(/ /gu)].every((m) => text[(m.index ?? 0) - 1] === '·');

describe.each(['grid', 'row'] as const)('RecipeCard (web, %s) — a part never breaks inside', (variant) => {
    it.each([
        ['an unrated recipe', { ...base, ratingCount: 0 }],
        ['a rated recipe', { ...base, averageRating: 4.75, ratingCount: 5 }],
    ] as const)('%s', (_name, over) => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant={variant} recipe={model(over)} nutrition={slot(known(370))} />,
        );
        const text = textOf(container) ?? '';

        expect(text).toContain('45\u00A0min');
        expect(text).toContain('370\u00A0cal');
        expect(breaksOnlyAfterDots(text)).toBe(true);
    });

    // Drawn text only: the loading label is `sr-only` (a screen reader hears it, nobody sees it wrap), so it stays plain text.
    it('keeps the calorie loading form unbreakable too, apart from its screen-reader-only label', () => {
        const { container } = renderCard(
            <RecipeCard
                headingLevel={3}
                variant={variant}
                recipe={model(base)}
                nutrition={slot({ status: 'pending' })}
            />,
        );

        const line = lineOf(container) as HTMLElement;

        line.querySelectorAll('.sr-only').forEach((node) => node.remove());
        expect(breaksOnlyAfterDots(line.textContent ?? '')).toBe(true);
    });
});

// qa-ios on 087051a43: a nested span that STARTS with a space or a dot lets a platform break at the span boundary. No span of
// the run starts with one: the calorie figure's lead is plain text in the run, outside the figure's own span.
describe('RecipeCard (web) — no span of the meta run starts with a space or a dot', () => {
    const startsBreakable = /^[\s\u00A0\u2060·]/u;

    it.each([
        ['an unrated recipe', { ...base, ratingCount: 0 }],
        ['a rated recipe', { ...base, averageRating: 4.75, ratingCount: 5 }],
    ] as const)('%s', (_name, over) => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="row" recipe={model(over)} nutrition={slot(known(370))} />,
        );
        const line = lineOf(container) as HTMLElement;
        const spans = [...line.querySelectorAll('*')];

        expect(spans.length).toBeGreaterThan(0);
        expect(spans.filter((node) => startsBreakable.test(node.textContent ?? ''))).toEqual([]);
        expect(line.textContent).toContain(`${DOT}370`);
    });

    it('keeps the loading placeholder’s lead in the run too', () => {
        const { container } = renderCard(
            <RecipeCard headingLevel={3} variant="row" recipe={model(base)} nutrition={slot({ status: 'pending' })} />,
        );
        const line = lineOf(container) as HTMLElement;

        expect([...line.querySelectorAll('*')].filter((node) => startsBreakable.test(node.textContent ?? ''))).toEqual(
            [],
        );
    });
});
