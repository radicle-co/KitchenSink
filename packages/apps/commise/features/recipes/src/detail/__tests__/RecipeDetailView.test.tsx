// @vitest-environment jsdom
/**
 * Component tests for the web recipe-detail view. Covers every content branch T066 requires — header
 * (title, description, badges), meta (times + servings), ingredients (quantity/unit/notes/user-entered),
 * instructions (ordered, optional timer), nutrition (complete vs partial/estimated), and photos (present
 * vs absent) — asserting on role/name/text so a missing section or a dropped branch fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render as renderUnscoped, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoodResolutionStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { renderWithRecipeClient, utilityContrast } from '@commise/test-utils';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
    idleUnreachableRetry,
} from '../../__fixtures__/index.js';
import { RecipeDetailBody } from '../RecipeDetailBody.js';
import { RecipeDetailView } from '../RecipeDetailView.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';
import type { ReactElement } from 'react';
import { idleDetailBodyState } from '../../__fixtures__/cookMarks.js';
import { DetailTestScope } from '../../__fixtures__/detailScope.js';
import { ScrollHost } from '@commise/ui/scroll-host';

import { CookMarksProvider } from '../CookMarksProvider.js';
import { memoryCookMarksBackend } from '../cookMarksStore.js';

/** Every detail renders inside its page's scroll host and the session’s cook-marks scope, as the app mounts them. */
const render = (ui: ReactElement): ReturnType<typeof renderUnscoped> =>
    renderUnscoped(ui, { wrapper: DetailTestScope });

/** The owner's view also mounts the ambiguity review, which reads the recipe client. */
const renderAsOwner = (ui: ReactElement): ReturnType<typeof renderUnscoped> =>
    renderWithRecipeClient(
        <FoodServiceProvider
            client={
                new FoodServiceClient({
                    baseUrl: 'https://food.test',
                    fetch: () => Promise.reject(new Error('offline')),
                })
            }
            subject="user_test"
        >
            <DetailTestScope>{ui}</DetailTestScope>
        </FoodServiceProvider>,
        createFakeRecipeServiceClient(),
    );

afterEach(cleanup);

describe('RecipeDetailView (web) — header', () => {
    it('renders the title as the top-level heading', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })}
            />,
        );

        expect(screen.getByRole('heading', { level: 1, name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('does not wrap the title or the description in a gradient title band', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', description: 'Tender and herby.' })}
            />,
        );

        // "No box in a box" (`docs/design/uiOverhaul/buildSpec.md` §1.6): a card exists only to group, and the page
        // canvas already carries the beach-glow wash, so the heading sits on the canvas, not in a second gradient.
        for (const start of [
            screen.getByRole('heading', { level: 1, name: 'Lamb' }),
            screen.getByText('Tender and herby.'),
        ]) {
            for (let node: HTMLElement | null = start; node !== null; node = node.parentElement) {
                expect(node.style.backgroundImage, 'a gradient surface wraps the header').not.toContain(
                    'linear-gradient',
                );
            }
        }
    });

    it('renders the description', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ description: 'Tender and herby.' })}
            />,
        );

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
    });

    it('sets the title in the large-title role, three lines at most, its full text kept as its name (§6.1)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })}
            />,
        );

        const heading = screen.getByRole('heading', { level: 1, name: 'Mediterranean Grilled Lamb' });
        expect(heading.className).toContain('text-large-title');
        expect(heading.className).toContain('line-clamp-3');
    });

    it('leads with the cuisine and, on another cook’s recipe, the author', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ cuisine: 'Moroccan', authorHandle: 'braise.club' })}
            />,
        );

        expect(screen.getByText('Moroccan')).toBeTruthy();
        expect(screen.getByText('by @braise.club')).toBeTruthy();
    });

    it('shows dietary flags and tags as one line of TEXT — nothing there is pressable (Settled 21)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ dietaryFlags: ['Gluten-Free'], tags: ['grill', 'summer'] })}
            />,
        );

        expect(screen.getByText('Gluten-Free · grill · summer')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /grill/u })).toBeNull();
    });

    it('states the rating and count, and the owner’s visibility, in one line under the title', () => {
        renderAsOwner(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                viewerIsOwner
                recipe={makeRecipeDetail({ averageRating: 4.8, ratingCount: 12, visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.getByText('4.8 (12)')).toBeTruthy();
        expect(utilityContrast(screen.getByText('Public').className, { foreground: 'text' })).toBeGreaterThanOrEqual(
            4.5,
        );
    });

    it('shows another cook’s viewer no visibility', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })}
            />,
        );

        expect(screen.queryByText('Public')).toBeNull();
    });

    it('clamps a long description to four lines with a More that expands it in place', async () => {
        const user = userEvent.setup();
        const long = 'Slow-roasted shoulder. '.repeat(12);
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ description: long })}
            />,
        );

        const more = screen.getByRole('button', { name: 'More' });
        const description = screen.getByText(long.trim(), { normalizer: (text) => text.trim() });
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(description.className).toContain('line-clamp-4');

        await user.click(more);

        expect(screen.getByRole('button', { name: 'Less' }).getAttribute('aria-expanded')).toBe('true');
        expect(description.className).not.toContain('line-clamp-4');
    });

    it('offers no More for a description too short to clamp', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ description: 'Tender and herby.' })}
            />,
        );

        expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    });
});

/**
 * The hero badge row and the tag chip above are already measured; these are the three seafoam-as-TEXT leaves
 * further down the page that the same pass left under the floor. Which seafoam sites are accents (3:1) and
 * which are text (4.5:1) is stated once, in `@commise/ui`'s palette JSDoc.
 */
describe('RecipeDetailView (web) — seafoam-as-text below the hero is WCAG-AA legible', () => {
    it('makes a step numeral legible, current and not (the reader reads the number)', async () => {
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
            />,
        );

        const toggle = screen.getByRole('button', { name: 'Mark step 1 as current' });
        const numeral = (): string => toggle.querySelector('[data-numeral]')?.className ?? '';
        expect(utilityContrast(numeral()), 'step numeral').toBeGreaterThanOrEqual(4.5);

        await user.click(toggle);
        expect(utilityContrast(numeral()), 'current step numeral').toBeGreaterThanOrEqual(4.5);
    });

    it('makes the step timer label legible', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    steps: [makeStepView({ stepNumber: 1, instruction: 'Rest the lamb.', timerSeconds: 120 })],
                })}
            />,
        );

        expect(utilityContrast(screen.getByText('2 min').className), 'step timer').toBeGreaterThanOrEqual(4.5);
    });

    /**
     * F1 (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md`): a timer read "16200s timer" and the cook had to divide
     * by 3600. It is said in hours and minutes now, and the glyph that marks it as a timer carries that meaning for a
     * screen reader too, since the duration alone does not say what it is.
     */
    it('says a step timer in hours and minutes, marked as a timer', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    steps: [makeStepView({ stepNumber: 1, instruction: 'Roast low.', timerSeconds: 16200 })],
                })}
            />,
        );

        expect(screen.getByText('4 h 30 min')).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Timer' })).toBeTruthy();
        expect(screen.queryByText(/16200/)).toBeNull();
    });

    it('makes the footer’s version line legible', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ currentVersion: 3 })}
            />,
        );

        const line = screen.getByText('Version 3');

        expect(utilityContrast(`${line.parentElement?.className ?? ''}`), 'version line').toBeGreaterThanOrEqual(4.5);
    });
});

describe('RecipeDetailView (web) — meta', () => {
    it('renders prep, cook, total times and servings', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 15,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    servings: 4,
                })}
            />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('30 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        // REWRITTEN (serving scaling): the Serves cell is no longer static text — it is the labelled
        // serving-count control, opening at the recipe's own yield. The assertion below proves the SAME
        // fact (the strip reports 4 servings) against the new affordance; the coverage did not move.
        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '4');
    });

    it('orders the stat strip Total, Prep, Cook, Difficulty, and hides a missing time (§6.1)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 0,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    difficulty: 'medium',
                })}
            />,
        );

        const labels = screen.getAllByRole('term').map((el) => el.textContent);
        expect(labels.slice(0, 3)).toEqual(['Total', 'Cook', 'Difficulty']);
        expect(screen.getByText('Medium')).toBeTruthy();
        expect(screen.queryByText('0 min')).toBeNull();
    });
});

describe('RecipeDetailView (web) — ingredients', () => {
    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ name: 'Lamb leg', quantity: { kind: 'exact', value: 1.5 }, unit: 'lbs' }),
                    ],
                })}
            />,
        );

        const ingredients = screen.getByRole('region', { name: 'Ingredients' });
        expect(within(ingredients).getByText('Lamb leg')).toBeTruthy();
        expect(within(ingredients).getByText('1.5 lbs')).toBeTruthy();
    });

    it('renders ingredient notes when present', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ notes: 'butterflied' })] })}
            />,
        );

        expect(screen.getByText('butterflied')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('does not show the custom badge for resolved ingredients', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: false })] })}
            />,
        );

        expect(screen.queryByText('Custom')).toBeNull();
    });
});

describe('RecipeDetailView (web) — instructions', () => {
    it('renders steps in an ordered list', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Grill each side.' }),
                    ],
                })}
            />,
        );

        const steps = screen.getByRole('region', { name: 'Steps' });
        const list = within(steps).getByRole('list');
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(within(items[0]!).getByText('Rub the lamb.')).toBeTruthy();
        expect(within(items[1]!).getByText('Grill each side.')).toBeTruthy();
    });
});

/** The detail's stale-nutrition disclosure (owner ruling 2026-09-12; copy per staff-ux-engineer SPECIFY). */
const STALE_NOTICE = 'These figures include saved food data, so they may be out of date.';

describe('RecipeDetailView (web) — nutrition', () => {
    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ calories: 520, proteinG: 32, carbsG: 18, fatG: 34 }),
                })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText('520')).toBeTruthy();
        expect(within(nutrition).getByText('32 g')).toBeTruthy();
    });

    it('shows an estimated indicator when nutrition is incomplete', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })}
            />,
        );

        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
    });

    it('hides the estimated indicator when nutrition is complete', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })}
            />,
        );

        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });

    it('⛔ says so when the figures were served from saved food data (KTD-3b)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ freshness: 'stale' }) })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText(STALE_NOTICE)).toBeTruthy();
    });

    it('shows no freshness sentence for figures fetched for this read', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ freshness: 'fresh' }) })}
            />,
        );

        expect(screen.queryByText(STALE_NOTICE)).toBeNull();
    });

    it('keeps each notice its own sentence, in reading order: partial, range, stale, then review', () => {
        // Source/reading order of the sibling notices — the order a screen reader walks. It cannot see a CSS
        // reorder, so it is not a claim about visual position.
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: false, rangeDerivedBound: 'low', freshness: 'stale' }),
                    ingredients: [makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW })],
                })}
            />,
        );

        const partial = screen.getByText('Estimated — some items aren’t counted yet');
        const range = screen.getByText('Estimated from the lower amount of each stated range');
        const stale = screen.getByText(STALE_NOTICE);
        const review = screen.getByText(recipeMessages.en.detail.needsReviewNoticeOne);

        expect(partial.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(range.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(stale.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    /*
     * The nutrition note (`docs/design/ingredientSpecialization.md` §S15). It was one sentence that named USDA, shown
     * only for a recipe with a user-entered line. It is now two sentences, each with its own condition: the catalog
     * sentence and its Data sources link wherever catalog numbers count (D15: attribution is owed there), and the
     * custom sentence wherever a line is user-entered (001 FR-007a). These replace the three REQ-034 tests that
     * asserted the old sentence; FR-007a's condition is the custom sentence's, below.
     */
    const SOURCE_NOTE = 'Nutrition comes from public food databases.';
    const CUSTOM_NOTE = 'Custom ingredients count only the nutrition you entered for them.';

    it('shows the custom sentence, and no catalog sentence or link, for a recipe of user-entered lines (FR-007a)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: true }),
                    ingredients: [makeIngredientView({ isUserEntered: true })],
                })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText(CUSTOM_NOTE)).toBeTruthy();
        expect(within(nutrition).queryByText(SOURCE_NOTE)).toBeNull();
        expect(within(nutrition).queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('draws no Data sources link without an address, and still shows the catalog sentence', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText(SOURCE_NOTE, { exact: false })).toBeTruthy();
        expect(within(nutrition).queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('shows the catalog sentence and the Data sources link for a recipe with a catalog line (§S15)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
                dataSourcesHref="/fr/host-owned/sources"
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getByText(SOURCE_NOTE)).toBeTruthy();
        // A route in this app, so it opens in the same tab: no `target`.
        const link = within(nutrition).getByRole('link', { name: 'Data sources' });
        // The web app's router owns the address, so the link takes the one its host passes.
        expect(link.getAttribute('href')).toBe('/fr/host-owned/sources');
        expect(link.getAttribute('target')).toBeNull();
        expect(within(nutrition).queryByText(CUSTOM_NOTE)).toBeNull();
    });

    it('shows both sentences, each once, for a recipe with a catalog line and a user-entered line', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'cat', foodId: 'food_salt' }),
                        makeIngredientView({ ingredientId: 'own', isUserEntered: true }),
                    ],
                })}
            />,
        );

        const nutrition = screen.getByRole('region', { name: 'Nutrition (per serving)' });
        expect(within(nutrition).getAllByText(SOURCE_NOTE)).toHaveLength(1);
        expect(within(nutrition).getAllByRole('link', { name: 'Data sources' })).toHaveLength(1);
        expect(within(nutrition).getAllByText(CUSTOM_NOTE)).toHaveLength(1);
    });

    it('counts a line whose food could not be asked: saved catalog figures stand in for it (KTD-3b)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            name: undefined,
                            resolutionStatus: FoodResolutionStatus.FOOD_UNREACHABLE,
                        }),
                    ],
                })}
            />,
        );

        expect(screen.getByRole('link', { name: 'Data sources' })).toBeTruthy();
    });

    it('does not count a line whose catalog figures the verification gate withheld (U14)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            foodId: 'food_flour',
                            resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
                        }),
                    ],
                })}
            />,
        );

        expect(screen.queryByText(SOURCE_NOTE)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('shows neither sentence for a recipe with no ingredients', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [] })}
            />,
        );

        expect(screen.queryByText(SOURCE_NOTE)).toBeNull();
        expect(screen.queryByText(CUSTOM_NOTE)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('⛔ names no single source anywhere on the read view (D16)', () => {
        const { container } = render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'cat', foodId: 'food_aleppo', name: 'Aleppo pepper' }),
                        makeIngredientView({ ingredientId: 'own', isUserEntered: true }),
                    ],
                })}
            />,
        );

        // Both notes render, so the sentence that used to say USDA is on screen and is checked.
        expect(screen.getByText(SOURCE_NOTE)).toBeTruthy();
        expect(screen.getByText(CUSTOM_NOTE)).toBeTruthy();
        expect(container.textContent).not.toMatch(/USDA/u);
    });
});

describe('RecipeDetailView (web) — photos', () => {
    it('renders each photo with an accessible name', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Grilled Lamb', photos: [makePhoto({ url: 'https://cdn/x.jpg' })] })}
            />,
        );

        expect(screen.getByRole('img', { name: 'Grilled Lamb photo 1' })).toBeTruthy();
    });

    it('renders no photo gallery when the recipe has no photos', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ photos: [] })}
            />,
        );

        // The GALLERY is absent — asserted on the carousel's own region and its slide controls, not on "no
        // image anywhere on the screen": with no photos the lead surface is the labelled no-photo placeholder.
        expect(screen.queryByRole('region', { name: 'Recipe photos' })).toBeNull();
        expect(screen.queryByRole('button', { name: /full screen$/ })).toBeNull();
    });

    /**
     * F2 (`docs/design/uiOverhaul/evaluateRecipeAndWizard.md`): the cover showed twice — once as the hero, and again as
     * slide 1 of a second carousel lower down. This test REPLACES "they are independent", which pinned that defect. The
     * service makes the cover `photos[0]` (`recipeDetail.assembler.ts`), so the lead surface is the carousel itself,
     * built from `photos` alone, and nothing else on the screen paints a photo.
     */
    it('shows the cover photo once: the lead surface IS the carousel, slide 1 the cover', () => {
        const photos = [0, 1, 2].map((index) =>
            makePhoto({ id: `pho_${String(index)}`, url: `https://cdn/p${String(index)}.jpg` }),
        );
        const { container } = render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', photos, coverPhotoUrl: 'https://cdn/p0.thumb.jpg' })}
            />,
        );

        expect(container.querySelectorAll('img[src="https://cdn/p0.jpg"]')).toHaveLength(1);
        expect(container.querySelectorAll('img')).toHaveLength(3);
        expect(screen.getAllByRole('region', { name: 'Recipe photos' })).toHaveLength(1);
    });
});

/**
 * The first slice of 008 FR-035 (build spec §6.3): tap-to-check ingredients and the current step, bound by the view
 * itself through the session's cook marks — no app wiring involved.
 */
describe('RecipeDetailView (web) — tap-to-check and the current step', () => {
    const cookable = () =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    ingredientId: 'ing_9',
                    name: 'Flour',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cups',
                }),
                makeIngredientView({
                    ingredientId: 'ing_10',
                    name: 'Salt',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'tsp',
                }),
            ],
            steps: [
                makeStepView({ stepNumber: 1, instruction: 'Mix.' }),
                makeStepView({ stepNumber: 2, instruction: 'Bake.' }),
            ],
        });

    it('checks a whole ingredient row and unchecks it on a second press', async () => {
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={cookable()}
            />,
        );

        const flour = screen.getByRole('checkbox', { name: '2 cups Flour' });
        await user.click(flour);
        expect(flour.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: '1 tsp Salt' }).getAttribute('aria-checked')).toBe('false');

        await user.click(flour);
        expect(flour.getAttribute('aria-checked')).toBe('false');
    });

    it('a checked row dims and is never struck through', async () => {
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={cookable()}
            />,
        );

        await user.click(screen.getByRole('checkbox', { name: '2 cups Flour' }));

        expect(document.body.innerHTML).not.toContain('line-through');
        expect(screen.getByText('Flour').closest('[data-line-text]')?.className).toContain('text-ink-muted');
    });

    it('keeps ONE current step: marking another moves it, and a second press clears it', async () => {
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={cookable()}
            />,
        );

        const first = screen.getByRole('button', { name: 'Mark step 1 as current' });
        const second = screen.getByRole('button', { name: 'Mark step 2 as current' });

        await user.click(first);
        expect(first.getAttribute('aria-pressed')).toBe('true');

        await user.click(second);
        expect(first.getAttribute('aria-pressed')).toBe('false');
        expect(second.getAttribute('aria-pressed')).toBe('true');

        await user.click(second);
        expect(second.getAttribute('aria-pressed')).toBe('false');
    });

    it('keeps the marks when the view unmounts and comes back in the same session', async () => {
        const user = userEvent.setup();
        const { unmount } = renderUnscoped(
            <ScrollHost>
                <CookMarksProvider subject="user_test" backend={backend}>
                    <RecipeDetailView
                        dataSourcesHref="/en/legal/sources"
                        unreachableRetry={idleUnreachableRetry}
                        recipe={cookable()}
                    />
                </CookMarksProvider>
            </ScrollHost>,
        );
        await user.click(screen.getByRole('checkbox', { name: '2 cups Flour' }));
        unmount();

        renderUnscoped(
            <ScrollHost>
                <CookMarksProvider subject="user_test" backend={backend}>
                    <RecipeDetailView
                        dataSourcesHref="/en/legal/sources"
                        unreachableRetry={idleUnreachableRetry}
                        recipe={cookable()}
                    />
                </CookMarksProvider>
            </ScrollHost>,
        );

        expect(screen.getByRole('checkbox', { name: '2 cups Flour' }).getAttribute('aria-checked')).toBe('true');
    });

    const backend = memoryCookMarksBackend();
});

describe('RecipeDetailView (web) — the section switch and Screen on (§6.2, §6.3)', () => {
    it('links the three sections from a sticky switch, each to its focusable heading', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail()}
            />,
        );

        const nav = screen.getByRole('navigation', { name: 'Recipe sections' });

        for (const [label, id] of [
            ['Ingredients', 'ingredients'],
            ['Steps', 'steps'],
            ['Nutrition', 'nutrition'],
        ] as const) {
            expect(within(nav).getByRole('link', { name: label }).getAttribute('href')).toBe(`#${id}`);
            expect(document.getElementById(id)?.getAttribute('tabindex')).toBe('-1');
        }
    });

    it('marks the section the screen’s scroll spy reports, and only it', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail()}
                currentSection="steps"
            />,
        );

        const nav = screen.getByRole('navigation', { name: 'Recipe sections' });
        expect(within(nav).getByRole('link', { name: 'Steps' }).getAttribute('aria-current')).toBe('location');
        expect(within(nav).getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBeNull();
    });

    it('draws no Screen on control where the browser cannot keep the screen awake — never a disabled one', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail()}
                headerActions={<button type="button">Edit recipe</button>}
            />,
        );

        expect(screen.queryByRole('switch', { name: 'Screen on' })).toBeNull();
    });

    it('draws Screen on in the switch and the action row from ONE state, and holds the lock while on', async () => {
        const release = vi.fn(() => Promise.resolve());
        const request = vi.fn(() => Promise.resolve({ released: false, release }));
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
        Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
        const user = userEvent.setup();

        try {
            render(
                <RecipeDetailView
                    dataSourcesHref="/en/legal/sources"
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail()}
                    headerActions={<button type="button">Edit recipe</button>}
                />,
            );

            const toggles = screen.getAllByRole('switch', { name: 'Screen on' });
            expect(toggles).toHaveLength(2);
            expect(toggles.every((toggle) => toggle.getAttribute('aria-checked') === 'false')).toBe(true);

            await user.click(toggles[0] as HTMLElement);

            expect(toggles.every((toggle) => toggle.getAttribute('aria-checked') === 'true')).toBe(true);
            expect(request).toHaveBeenCalledTimes(1);

            await user.click(toggles[1] as HTMLElement);
            expect(release).toHaveBeenCalledTimes(1);
        } finally {
            Reflect.deleteProperty(navigator, 'wakeLock');
            Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        }
    });
});

describe('RecipeDetailView (web) — empty sections (§6.7)', () => {
    it('says a recipe has no steps and no ingredients, and offers the owner the editor at each', () => {
        renderAsOwner(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                editHref="/en/recipes/rec_1/edit"
                viewerIsOwner
                recipe={makeRecipeDetail({ steps: [], ingredients: [] })}
            />,
        );

        expect(screen.getByText('No steps yet.')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Add steps' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1/edit#steps',
        );
        expect(screen.getByText('No ingredients yet.')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Add ingredients' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1/edit#ingredients',
        );
    });

    it('offers another cook no editor', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                editHref="/en/recipes/rec_1/edit"
                recipe={makeRecipeDetail({ steps: [] })}
            />,
        );

        expect(screen.getByText('No steps yet.')).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Add steps' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Edit steps' })).toBeNull();
    });

    it('gives the owner an Edit link on each filled section heading', () => {
        renderAsOwner(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                editHref="/en/recipes/rec_1/edit"
                viewerIsOwner
                recipe={makeRecipeDetail()}
            />,
        );

        expect(screen.getByRole('link', { name: 'Edit steps' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1/edit#steps',
        );
        expect(screen.getByRole('link', { name: 'Edit ingredients' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1/edit#ingredients',
        );
    });
});

describe('RecipeDetailView (web) — footer facts (§6.1)', () => {
    it('states the version and links the version history', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                versionsHref="/en/recipes/rec_1/versions"
                recipe={makeRecipeDetail({ currentVersion: 3 })}
            />,
        );

        expect(screen.getByText('Version 3')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Version history' }).getAttribute('href')).toBe(
            '/en/recipes/rec_1/versions',
        );
    });

    it('draws no Version history link without an address', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ currentVersion: 3 })}
            />,
        );

        expect(screen.queryByRole('link', { name: 'Version history' })).toBeNull();
    });

    it('puts the caller’s actions in the action row, before the description', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ description: 'Tender and herby.' })}
                headerActions={<button type="button">Save a copy</button>}
            />,
        );

        const action = screen.getByRole('button', { name: 'Save a copy' });
        const description = screen.getByText('Tender and herby.');
        expect(action.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — hero cover (mockup screenRecipeDetail)', () => {
    it('LEADS the screen with the cover hero — it precedes the title heading in document order', () => {
        const { container } = render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', photos: [makePhoto({ url: 'https://cdn/hero.jpg' })] })}
            />,
        );
        const hero = screen.getByRole('img', { name: 'Lamb photo 1' });
        const heading = screen.getByRole('heading', { level: 1, name: 'Lamb' });

        expect(container.contains(hero)).toBe(true);
        // DOCUMENT_POSITION_FOLLOWING (4) — the heading comes AFTER the hero, i.e. the hero leads the screen.
        expect(hero.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the deliberate no-photo hero fallback for a recipe with no cover', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: undefined, photos: [] })}
            />,
        );

        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
        // And the title still renders — a missing cover degrades the hero, never the screen.
        expect(screen.getByRole('heading', { level: 1, name: 'Lamb' })).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — touch targets (44px floor)', () => {
    it('gives the step toggle a 44px target and every ingredient row 48px', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail()}
            />,
        );

        for (const toggle of screen.getAllByRole('button', { name: /^Mark step \d+ as current$/u })) {
            expect(toggle.className).toContain('size-11');
        }

        for (const row of screen.getAllByRole('checkbox')) {
            expect(row.className).toContain('min-h-12');
        }
    });
});

/**
 * Cross-platform parity for the native leaf's ingredient-row fix. CSS flex items shrink by default, so this
 * leaf degraded more gracefully than RN — but `min-width: auto` still lets a single long token overflow the
 * card, and the trailing `Custom` badge was itself shrinkable (its pill would deform before the text yielded).
 * Pinning both keeps the two leaves' overflow behaviour from drifting again.
 */
describe('RecipeDetailView (web) — a long ingredient line cannot push the row chrome off the screen', () => {
    const longIngredient = () =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    name: 'Slow-roasted San Marzano tomatoes from the co-op down the road',
                    notes: 'peeled, deseeded, and crushed by hand just before serving',
                    isUserEntered: true,
                }),
            ],
        });

    it('lets the ingredient name shrink and wrap rather than overflow the row', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={longIngredient()}
            />,
        );

        // The name sits in the row's ONE flowing text block with its preparation and notes (namelessLineCopy.md
        // §2c), so the shrink-and-wrap classes are on that block, the name's parent.
        const block = screen.getByText('Slow-roasted San Marzano tomatoes from the co-op down the road').parentElement;

        expect(block?.className).toContain('min-w-0');
        expect(block?.className).toContain('break-words');
    });

    /**
     * ⚠️ This REPLACES "never shrinks the fixed-format quantity", which pinned the quantity as a `shrink-0` column
     * beside the text block. That column sat apart from the name's line on every row of two lines or more
     * (`docs/design/readSurfacesEvaluation.md` D1), so the quantity now leads the name inside the block (mockup frame
     * 1), and a long name wraps under it.
     */
    it('keeps the quantity in the flowing block, ahead of a long name', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={longIngredient()}
            />,
        );

        const name = screen.getByText('Slow-roasted San Marzano tomatoes from the co-op down the road');
        const quantity = screen.getByText('2 tbsp');

        expect(name.parentElement?.contains(quantity)).toBe(true);
        expect(quantity.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

/**
 * E2 I1 — a named row's status badge flows INSIDE the name's text block, never in a column beside it.
 *
 * ⚠️ This REPLACES the old "never shrinks the trailing user-entered badge" test, which pinned the defect: a
 * `shrink-0 ml-auto` badge column left the name 37 px wide at 320 px and 0 px under 200% text
 * (`ingredientSpecialization.md` E2, `namelessLineCopy.md` §2c). The row now has exactly two columns — the tick and
 * the text block, which also holds the amount (D1) — and every badge is inline content of that block, so the name
 * has the block's whole width and a badge wraps under it rather than squeezing it. jsdom has no layout, so this pins
 * the STRUCTURE; the width gain itself was measured in a browser, not here.
 *
 * Every badge kind is a case, because each was its own trailing element and each could be left behind.
 */
describe('RecipeDetailView (web) — a status badge flows inside the name block (E2 I1)', () => {
    const en = recipeMessages.en.detail;
    const healthy = makeIngredientView({ ingredientId: 'healthy', name: 'Salt' });
    const cases = [
        {
            what: 'the Custom badge',
            line: makeIngredientView({ ingredientId: 'line', name: 'Plain flour', isUserEntered: true }),
            badge: en.userEnteredBadge,
        },
        {
            what: 'the needs-review badge',
            line: makeIngredientView({
                ingredientId: 'line',
                name: 'Plain flour',
                resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
            }),
            badge: en.needsReviewBadge,
        },
        {
            what: 'the needs-a-pick badge',
            line: makeIngredientView({
                ingredientId: 'line',
                name: 'Plain flour',
                resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
            }),
            badge: en.ambiguousBadge,
        },
        {
            what: 'the food-removed badge',
            line: makeIngredientView({
                ingredientId: 'line',
                name: 'Plain flour',
                resolutionStatus: FoodResolutionStatus.FOOD_REMOVED,
            }),
            badge: en.removedFoodBadge,
        },
    ] as const;

    for (const { what, line, badge } of cases) {
        it(`renders ${what} inside the name's text block`, () => {
            render(
                <RecipeDetailView
                    dataSourcesHref="/en/legal/sources"
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [line, healthy] })}
                />,
            );

            const block = screen.getByText('Plain flour').parentElement;

            expect(block?.contains(screen.getByText(badge))).toBe(true);
        });

        it(`gives the row no badge column beside the name for ${what}`, () => {
            render(
                <RecipeDetailView
                    dataSourcesHref="/en/legal/sources"
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [line, healthy] })}
                />,
            );

            const row = screen.getByRole('checkbox', { name: /Plain flour/u });
            const block = screen.getByText('Plain flour').parentElement;

            // Exactly the tick and the text block, which holds the amount too (D1): nothing sits beside the block to
            // squeeze it.
            expect(row?.children).toHaveLength(2);
            expect(row?.lastElementChild).toBe(block);
        });
    }
});

/**
 * Gap A — the recipe's ORIGIN, on the detail view itself.
 *
 * `sourceUrl`/`sourceAttribution` used to render nowhere on this view: attribution appeared only inside
 * the old clone action, which the container mounts only for a NON-owner, so the owner of an imported recipe
 * could never see where it came from and `sourceUrl` was shown to nobody. This view takes no viewer, which
 * is the structural fix — provenance is a property of the recipe, not of who is looking.
 */
describe('RecipeDetailView (web) — recipe source', () => {
    it('renders the source link for a recipe that has one, with no viewer context at all', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    sourceUrl: 'https://www.seriouseats.com/recipes/lamb',
                    sourceAttribution: 'Serious Eats',
                })}
            />,
        );

        // The link is labelled by the VERIFIED host (never by the untrusted attribution, which renders
        // beside it as text) — see `RecipeSourceLine`.
        const link = screen.getByRole('link', { name: 'www.seriouseats.com' });
        expect(link.getAttribute('href')).toBe('https://www.seriouseats.com/recipes/lamb');
        expect(screen.getByText('Serious Eats')).toBeTruthy();
    });

    it('renders the source even when the view is handed owner-style props (no footer clone action)', () => {
        // The regression this locks: provenance must not be coupled to the clone affordance again.
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ sourceAttribution: 'Grandma’s cookbook' })}
            />,
        );

        expect(screen.getByText('Grandma’s cookbook')).toBeTruthy();
    });

    it('renders NO source affordance for a recipe that has none', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({})}
            />,
        );

        expect(screen.queryByText('Source')).toBeNull();
        // The section switch's in-page links are the only links left.
        expect(screen.queryAllByRole('link').every((link) => link.getAttribute('href')?.startsWith('#'))).toBe(true);
    });
});

/**
 * Gap B — configurable serving size.
 *
 * The model under test is deliberately partial, and these tests are what hold it in place: ingredient
 * amounts and hands-on PREP scale with the yield; COOK time and per-step timers do NOT, because thermal
 * cooking time is not proportional to batch size. Per-serving nutrition is invariant and must not move.
 */
describe('RecipeDetailView (web) — serving scale', () => {
    // The scale is session state, keyed by recipe id, and the store is a module singleton: without this,
    // one test's doubling leaks into the next.
    afterEach(resetServingScale);

    const scalable = () =>
        makeRecipeDetail({
            servings: 4,
            prepTimeMinutes: 15,
            // Distinct from the prep time on purpose: at 2x, prep becomes 30 and a shared value would let a
            // "cook time scaled" bug hide behind an ambiguous text match.
            cookTimeMinutes: 25,
            totalTimeMinutes: 45,
            ingredients: [
                makeIngredientView({
                    ingredientId: 'ing_1',
                    name: 'Olive oil',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                }),
            ],
            steps: [makeStepView({ stepNumber: 1, instruction: 'Simmer gently.', timerSeconds: 600 })],
            nutrition: makeNutrition({ calories: 520, isComplete: true }),
        });

    /** Render the PURE body at an explicit serving count — the ratio cases, with no store involved. */
    const renderAt = (servings: number) =>
        render(
            <RecipeDetailBody
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={scalable()}
                servings={servings}
                onServingsChange={vi.fn()}
                {...idleDetailBodyState}
            />,
        );

    it('opens at the serving count the recipe was created with', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={scalable()}
            />,
        );

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '4');
        // …and nothing is presented as adjusted.
        expect(screen.queryByText(/Amounts scaled from/)).toBeNull();
    });

    it('rescales the WHOLE view when the cook uses the control — no app wiring involved', async () => {
        // The end-to-end wiring assertion: `RecipeDetailView` binds the scale itself, so a container that
        // knows nothing about scaling still ships a working control. This is the structural answer to the
        // defect class this feature came from (a capability that only reaches the screen if someone
        // remembers to pass it down).
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={scalable()}
            />,
        );

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '5');
        expect(screen.getByText('2.5 tbsp')).toBeTruthy();
        expect(screen.getByText(/Amounts scaled from 4 servings/)).toBeTruthy();
    });

    it('keeps each recipe’s scale to itself', async () => {
        const { unmount } = render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={scalable()}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
        unmount();

        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ id: 'rec_other', servings: 2 })}
            />,
        );

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '2');
    });

    it('scales ingredient quantities to the chosen serving count', () => {
        renderAt(8);

        expect(screen.getByText('4 tbsp')).toBeTruthy();
        expect(screen.queryByText('2 tbsp')).toBeNull();
    });

    it('scales HANDS-ON prep time and rebuilds the total from it', () => {
        renderAt(8);

        expect(screen.getByText('30 min')).toBeTruthy(); // prep 15 -> 30
        // Said in hours and minutes through `formatDuration` (§6.1), so the rebuilt 60 minutes reads "1 h".
        expect(screen.getByText('1 h')).toBeTruthy(); // total 45 + the 15-minute prep delta
    });

    it('does NOT scale cook time', () => {
        const { container } = renderAt(8);

        // Read the Cook cell specifically: doubling the batch must leave it at the stored 25 minutes. A
        // "scale every timing" implementation renders 50 here and would tell a cook to bake twice as long.
        const cook = Array.from(container.querySelectorAll('div')).find(
            (cell) => cell.querySelector('dt')?.textContent === 'Cook',
        );

        expect(cook?.querySelector('dd')?.textContent).toBe('25 min');
    });

    it('does NOT scale a step timer', () => {
        renderAt(8);

        expect(screen.getByText('10 min')).toBeTruthy();
        expect(screen.queryByText('20 min')).toBeNull();
    });

    it('leaves PER-SERVING nutrition untouched, because it is invariant under scaling', () => {
        renderAt(12);

        // Restating it here would double-count the ratio; a fabricated or recomputed figure is the failure.
        expect(screen.getByText('520')).toBeTruthy();
    });

    it('discloses what scaled and what deliberately did not, but only while scaled', () => {
        const { unmount } = renderAt(4);

        expect(screen.queryByText(/Cook times and step timers are shown unchanged/)).toBeNull();
        unmount();

        renderAt(6);

        expect(screen.getByText(/Amounts scaled from 4 servings/)).toBeTruthy();
        expect(screen.getByText(/Cook times and step timers are shown unchanged/)).toBeTruthy();
    });

    it('announces the disclosure rather than leaving it to sighted scanning', () => {
        renderAt(6);

        // REWRITTEN, not a lone `getByRole('status')`: the serving stepper carries its own status region (the
        // spoken count), so the disclosure is asserted as ONE OF the status regions — still a live region, not text.
        const statuses = screen.getAllByRole('status').map((node) => node.textContent ?? '');
        expect(statuses.some((text) => text.includes('Amounts scaled from 4 servings'))).toBe(true);
    });

    it('scales DOWN as well as up', () => {
        renderAt(2);

        expect(screen.getByText('1 tbsp')).toBeTruthy();
        expect(screen.getByText('8 min')).toBeTruthy(); // prep 15 -> 7.5, rounded to a whole minute
    });

    it('renders a recipe authored beyond the display cap at its own yield rather than crashing', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ id: 'rec_huge', servings: 250 })}
            />,
        );

        expect(screen.getByLabelText('Servings')).toHaveProperty('value', '250');
    });
});

/**
 * U9 / R42 + R38 — a ranged or absent quantity on the READ surface.
 *
 * The checkbox's accessible name is the assertion that matters: it is composed from the same formatted
 * quantity the sighted row shows, so a bound dropped from one is dropped from both. The native suite
 * asserts the identical set.
 */
describe('RecipeDetailView (web) — ranged and absent quantities (U9)', () => {
    it('renders a stated range as a span, not as its lower bound alone', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            name: 'Flour',
                            quantity: { kind: 'range', low: 2, high: 3 },
                            unit: 'cups',
                        }),
                    ],
                })}
            />,
        );

        expect(screen.getByRole('checkbox', { name: '2–3 cups Flour' })).toBeTruthy();
    });

    it('renders an ABSENT quantity as the unit alone, with no fabricated number (R40)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            name: 'Butter',
                            quantity: { kind: 'absent' },
                            unit: 'the size of an egg',
                        }),
                    ],
                })}
            />,
        );

        expect(screen.getByRole('checkbox', { name: 'the size of an egg Butter' })).toBeTruthy();
        // Mutation guard: a `?? 0` or a `?? 1` fallback would put a digit in front of a cook here.
        expect(screen.queryByRole('checkbox', { name: /^0 /u })).toBeNull();
        expect(screen.queryByRole('checkbox', { name: /^1 /u })).toBeNull();
    });

    it('discloses that the nutrition figure came from one bound of a stated range (R38)', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ rangeDerivedBound: 'low' }) })}
            />,
        );

        expect(screen.getByText('Estimated from the lower amount of each stated range')).toBeTruthy();
    });

    it('shows NO range disclosure when nothing was collapsed', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition() })}
            />,
        );

        expect(screen.queryByText('Estimated from the lower amount of each stated range')).toBeNull();
    });
});

/**
 * U26 — the preparation on the READ surface.
 *
 * ⛔ Without this the field round-trips and is INVISIBLE: a cook types "finely chopped" in the editor, saves,
 * opens the recipe, and cooks from a line that never mentions it. A field the author can set and the reader
 * cannot see is not a shipped feature.
 */
describe('RecipeDetailView — ingredient preparation (U26)', () => {
    it('renders the preparation when the line carries one', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Onion', preparation: 'finely chopped' })],
                })}
            />,
        );

        expect(screen.getByText('finely chopped')).toBeTruthy();
    });

    // ⛔ U26's headline rule on the read surface. A concatenated name would ALSO make the assertion above
    // pass via `getByText` on a longer string, so the name is pinned separately and exactly.
    it('⛔ NEVER concatenates the preparation into the food name', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Onion', preparation: 'finely chopped' })],
                })}
            />,
        );

        expect(screen.getByText('Onion')).toBeTruthy();
        expect(screen.queryByText('Onion finely chopped')).toBeNull();
        expect(screen.queryByText('Onion (finely chopped)')).toBeNull();
    });

    it('renders BOTH the preparation and a `notes` display override — they are different facts', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            name: 'Flour',
                            preparation: 'sifted',
                            notes: '2 cups all-purpose flour, sifted',
                        }),
                    ],
                })}
            />,
        );

        expect(screen.getByText('sifted')).toBeTruthy();
        expect(screen.getByText('2 cups all-purpose flour, sifted')).toBeTruthy();
    });

    it('renders NOTHING extra for a line that states no preparation', () => {
        render(
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ name: 'Salt' })] })}
            />,
        );

        expect(screen.getByText('Salt')).toBeTruthy();
    });
});

describe('RecipeDetailView (web) — a failed refresh of what is on screen', () => {
    const notice = (
        overrides: Partial<{ failed: boolean; refreshing: boolean; recoveries: number; onRetry: () => void }> = {},
    ) => ({
        failed: false,
        refreshing: false,
        onRetry: () => undefined,
        recoveries: 0,
        ...overrides,
    });

    function viewWith(refreshNotice: ReturnType<typeof notice>) {
        return (
            <RecipeDetailView
                dataSourcesHref="/en/legal/sources"
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })}
                refreshNotice={refreshNotice}
            />
        );
    }

    it('shows no notice while nothing has failed', () => {
        render(viewWith(notice()));

        expect(screen.queryByText('We couldn’t refresh this recipe.')).toBeNull();
    });

    it('⛔ keeps what is shown and says the refresh failed, with a Try again that retries', () => {
        const onRetry = vi.fn();
        render(viewWith(notice({ failed: true, onRetry })));

        expect(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
        expect(screen.getAllByText('We couldn’t refresh this recipe.').length).toBeGreaterThan(0);
        screen.getByRole('button', { name: 'Try again' }).click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves focus to the title when a retry from the notice succeeds, since its button is gone', () => {
        const { rerender } = render(viewWith(notice({ failed: true })));

        rerender(viewWith(notice({ recoveries: 1 })));

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' }));
    });
});
