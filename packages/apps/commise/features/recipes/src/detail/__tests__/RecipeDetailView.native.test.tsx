/**
 * Native component tests for the recipe-detail view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across every content branch — header, meta, ingredients (incl. user-entered), instructions,
 * nutrition (complete vs partial), and photos (present vs absent) — so the two platform renders can't drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderUnscoped, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessibilityInfo } from 'react-native';
import { FoodResolutionStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { computedContrast, guardedFoodClient, renderWithFoodClient } from '@commise/test-utils';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';

import { cssColor } from '../../__tests__/cssColor.js';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
    idleUnreachableRetry,
} from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { QUANTITY_LINE_SHAPES } from '../__fixtures__/quantityLineShapes.js';
import { RecipeDetailBody } from '../RecipeDetailBody.native.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';
import type { FC, ReactElement, ReactNode } from 'react';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CookMarksTestProvider, idleDetailBodyState } from '../../__fixtures__/cookMarks.js';
import { heldKeepAwakeTags } from '@commise/ui/testing/expo-keep-awake';

/** Every detail renders inside the session’s cook-marks scope, as each app root mounts it. */
const render = (
    ui: ReactElement,
    wrapper: FC<{ readonly children: ReactNode }> = CookMarksTestProvider,
): ReturnType<typeof renderUnscoped> => renderUnscoped(ui, { wrapper });

/** The owner's view also mounts the ambiguity review, which reads the food client. */
const ownerWrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>{children}</CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(cleanup);

const SOURCE_NOTE = 'Nutrition comes from public food databases.';
const CUSTOM_NOTE = 'Custom ingredients count only the nutrition you entered for them.';

describe('RecipeDetailView (native)', () => {
    it('renders the title as a heading', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    // U8 brand leaf: the title must resolve to a REGISTERED Playfair face. A CSS font stack renders as the
    // system font on device with no error at all, so this reads the family react-native-web actually applied
    // (the class-compiled rule — `getComputedStyle` does not resolve it) and rejects any stack.
    it('paints the title in the registered bold Playfair face, never a CSS font stack', () => {
        render(
            <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail({ title: 'Lamb' })} />,
        );

        const applied = appliedFontFamily(screen.getByRole('heading', { name: 'Lamb' }));

        expect(applied).toBe(nativeTokens.fontFace.display.bold);
        expect(applied).not.toContain(',');
    });

    it('does not wrap the title or the description in a gradient title band', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', description: 'Tender and herby.' })}
            />,
        );
        // "No box in a box" (`docs/design/uiOverhaul/buildSpec.md` §1.6): a card exists only to group, and the page
        // canvas already carries the beach-glow wash, so the heading sits on the canvas, not in a second gradient.
        expect(
            screen.getByRole('heading', { name: 'Lamb' }).closest('[data-commise-stub="linear-gradient"]'),
        ).toBeNull();
        expect(screen.getByText('Tender and herby.').closest('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    it('renders the description and badges', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ description: 'Tender and herby.', cuisine: 'Mediterranean' })}
            />,
        );

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
        expect(screen.getByText('Mediterranean')).toBeTruthy();
    });

    it('renders meta times and servings', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ prepTimeMinutes: 15, totalTimeMinutes: 45, servings: 4 })}
            />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('orders the stat strip Total, Prep, Cook, Difficulty (§6.1)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 15,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    difficulty: 'hard',
                })}
            />,
        );

        const labels = screen.getAllByText(/^(Total|Prep|Cook|Difficulty)$/u).map((el) => el.textContent);
        expect(labels).toEqual(['Total', 'Prep', 'Cook', 'Difficulty']);
        expect(screen.getByText('Hard')).toBeTruthy();
    });

    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ name: 'Lamb leg', quantity: { kind: 'exact', value: 1.5 }, unit: 'lbs' }),
                    ],
                })}
            />,
        );

        expect(screen.getByText('Lamb leg')).toBeTruthy();
        expect(screen.getByText('1.5 lbs')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('renders a step instruction', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ steps: [{ stepNumber: 1, instruction: 'Rub the lamb.' }] })}
            />,
        );

        expect(screen.getByText('Rub the lamb.')).toBeTruthy();
    });

    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ calories: 520, proteinG: 32 }) })}
            />,
        );

        expect(screen.getByText('520')).toBeTruthy();
        expect(screen.getByText('32 g')).toBeTruthy();
    });

    it('shows the estimated indicator only when nutrition is incomplete', () => {
        const { unmount } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })}
            />,
        );
        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
        unmount();

        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })}
            />,
        );
        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });

    it('⛔ shows the stale-data notice only when the figures were served from saved food data (KTD-3b)', () => {
        const stale = 'These figures include saved food data, so they may be out of date.';
        const { unmount } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ freshness: 'stale' }) })}
            />,
        );
        expect(screen.getByText(stale)).toBeTruthy();
        unmount();

        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ freshness: 'fresh' }) })}
            />,
        );
        expect(screen.queryByText(stale)).toBeNull();
    });

    it('renders the stale notice ALONGSIDE the partial one — each its own sentence', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false, freshness: 'stale' }) })}
            />,
        );

        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
        expect(screen.getByText('These figures include saved food data, so they may be out of date.')).toBeTruthy();
    });

    it('keeps the notices in reading order: partial, range, stale, then review', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: false, rangeDerivedBound: 'low', freshness: 'stale' }),
                    ingredients: [makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW })],
                })}
            />,
        );

        const partial = screen.getByText('Estimated — some items aren’t counted yet');
        const range = screen.getByText('Estimated from the lower amount of each stated range');
        const stale = screen.getByText('These figures include saved food data, so they may be out of date.');
        const review = screen.getByText(recipeMessages.en.detail.needsReviewNoticeOne);

        expect(partial.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(range.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(stale.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    /*
     * The nutrition note (`docs/design/ingredientSpecialization.md` §S15): two sentences, each with its own condition,
     * and on native the link is its own 48 dp row that opens the Data sources sheet. These replace the three REQ-034
     * tests that asserted the old sentence naming USDA; FR-007a's condition is the custom sentence's. The web file
     * holds the same set.
     */
    it('shows the custom sentence, and no catalog sentence or link, for a recipe of user-entered lines (FR-007a)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: true }),
                    ingredients: [makeIngredientView({ isUserEntered: true })],
                })}
            />,
        );

        expect(screen.getByText(CUSTOM_NOTE)).toBeTruthy();
        expect(screen.queryByText(SOURCE_NOTE)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('shows the catalog sentence and the Data sources link for a recipe with a catalog line (§S15)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
            />,
        );

        expect(screen.getByText(SOURCE_NOTE)).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Data sources' })).toBeTruthy();
        expect(screen.queryByText(CUSTOM_NOTE)).toBeNull();
    });

    it('sizes the link row to the 48 dp touch floor (§S15, §S18)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
            />,
        );

        expect(window.getComputedStyle(screen.getByRole('link', { name: 'Data sources' })).minHeight).toBe('48px');
    });

    // One type scale on both platforms: the web note is `text-caption` (`docs/design/readSurfacesEvaluation.md` D9).
    it('sets the note and its link in the caption size, the web note’s size', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
            />,
        );

        const caption = `${String(nativeTokens.fontSize.caption)}px`;

        expect(appliedStyle(screen.getByText(SOURCE_NOTE), 'font-size')).toBe(caption);
        expect(
            appliedStyle(
                within(screen.getByRole('link', { name: 'Data sources' })).getByText('Data sources'),
                'font-size',
            ),
        ).toBe(caption);
    });

    it('shows both sentences, each once, for a recipe with a catalog line and a user-entered line', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'cat', foodId: 'food_salt' }),
                        makeIngredientView({ ingredientId: 'own', isUserEntered: true }),
                    ],
                })}
            />,
        );

        expect(screen.getAllByText(SOURCE_NOTE)).toHaveLength(1);
        expect(screen.getAllByRole('link', { name: 'Data sources' })).toHaveLength(1);
        expect(screen.getAllByText(CUSTOM_NOTE)).toHaveLength(1);
        // Sentence 1, then its link row, then sentence 2 (§S15, native).
        const link = screen.getByRole('link', { name: 'Data sources' });
        expect(screen.getByText(SOURCE_NOTE).compareDocumentPosition(link)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(link.compareDocumentPosition(screen.getByText(CUSTOM_NOTE))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('counts a line whose food could not be asked: saved catalog figures stand in for it (KTD-3b)', () => {
        render(
            <RecipeDetailView
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
            <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail({ ingredients: [] })} />,
        );

        expect(screen.queryByText(SOURCE_NOTE)).toBeNull();
        expect(screen.queryByText(CUSTOM_NOTE)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Data sources' })).toBeNull();
    });

    it('⛔ names no single source anywhere on the read view (D16)', () => {
        const { container } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'cat', foodId: 'food_aleppo', name: 'Aleppo pepper' }),
                        makeIngredientView({ ingredientId: 'own', isUserEntered: true }),
                    ],
                })}
            />,
        );

        expect(screen.getByText(SOURCE_NOTE)).toBeTruthy();
        expect(screen.getByText(CUSTOM_NOTE)).toBeTruthy();
        expect(container.textContent).not.toMatch(/USDA/u);
    });

    it('opens the Data sources sheet from the link, and returns the reading cursor to the link on close (§S16)', async () => {
        const client = guardedFoodClient();

        vi.spyOn(client, 'listSources').mockReturnValue(new Promise(() => undefined));
        renderWithFoodClient(
            <CookMarksTestProvider>
                <RecipeDetailView
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ foodId: 'food_salt' })] })}
                />
            </CookMarksTestProvider>,
            client,
        );

        expect(screen.queryByRole('heading', { name: 'Data sources' })).toBeNull();
        fireEvent.click(screen.getByRole('link', { name: 'Data sources' }));
        expect(await screen.findByRole('heading', { name: 'Data sources' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Close data sources' }));

        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Data sources' })).toBeNull());
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('link', { name: 'Data sources' }),
            'focus',
        );
    });

    it('renders the photo gallery only when the recipe has photos', () => {
        const { unmount } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ photos: [makePhoto()] })}
            />,
        );
        expect(screen.getByLabelText('Recipe photos')).toBeTruthy();
        unmount();

        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail({ photos: [] })} />);
        expect(screen.queryByLabelText('Recipe photos')).toBeNull();
    });
});

/** The first slice of 008 FR-035 (build spec §6.3), bound by the view itself through the session's cook marks. */
describe('RecipeDetailView (native) — tap-to-check and the current step', () => {
    const cookable = () =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({
                    ingredientId: 'ing_9',
                    name: 'Garlic',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cloves',
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
            tags: ['grill'],
        });

    it('checks a whole row, announces it, and unchecks it on a second press', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={cookable()} />);

        const garlic = screen.getByRole('checkbox', { name: '2 cloves Garlic' });
        expect(garlic.getAttribute('aria-checked')).toBe('false');

        fireEvent.click(garlic);
        expect(garlic.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('checkbox', { name: '1 tsp Salt' }).getAttribute('aria-checked')).toBe('false');

        fireEvent.click(garlic);
        expect(garlic.getAttribute('aria-checked')).toBe('false');
    });

    it('keeps ONE current step, and a second press clears it', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={cookable()} />);

        const first = screen.getByRole('button', { name: 'Mark step 1 as current' });
        const second = screen.getByRole('button', { name: 'Mark step 2 as current' });

        fireEvent.click(first);
        fireEvent.click(second);
        expect(first.getAttribute('aria-pressed')).toBe('false');
        expect(second.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(second);
        expect(second.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows tags as text, with no pressable chip', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={cookable()} />);

        expect(screen.getByText('grill')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /grill/u })).toBeNull();
    });

    it('offers Screen on as a switch, and holds the screen awake while it is on', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={cookable()} />);

        const toggle = screen.getByRole('switch', { name: 'Screen on' });
        expect(heldKeepAwakeTags.size).toBe(0);

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        expect(heldKeepAwakeTags.size).toBe(1);

        fireEvent.click(toggle);
        expect(heldKeepAwakeTags.size).toBe(0);
    });

    it('releases the hold when the cook leaves the recipe', () => {
        const { unmount } = render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={cookable()} />);

        fireEvent.click(screen.getByRole('switch', { name: 'Screen on' }));
        unmount();

        expect(heldKeepAwakeTags.size).toBe(0);
    });

    it('says a recipe has no steps, and offers the owner the editor there', () => {
        const onEditSection = vi.fn();
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                viewerIsOwner
                onEditSection={onEditSection}
                recipe={makeRecipeDetail({ steps: [] })}
            />,
            ownerWrapper,
        );

        expect(screen.getByText('No steps yet.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Add steps' }));
        expect(onEditSection).toHaveBeenCalledWith('steps');
    });
});

describe('RecipeDetailView (native) — touch targets (U4 / RC-3)', () => {
    it('gives every ingredient row at least 48 dp and the step toggle 44 pt', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail()} />);

        for (const row of screen.getAllByRole('checkbox')) {
            expect(appliedStyle(row, 'min-height')).toBe('48px');
        }

        const toggle = screen.getByRole('button', { name: 'Mark step 1 as current' });
        expect(appliedStyle(toggle, 'width')).toBe('44px');
        expect(appliedStyle(toggle, 'height')).toBe('44px');
    });
});

describe('RecipeDetailView (native) — contrast (WCAG AA)', () => {
    it('makes the step timer label legible (4.02:1 as seafoam, under the 4.5:1 floor)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    steps: [makeStepView({ stepNumber: 1, instruction: 'Rest the lamb.', timerSeconds: 120 })],
                })}
            />,
        );

        expect(computedContrast(screen.getByText('2 min')), 'step timer label').toBeGreaterThanOrEqual(4.5);
    });

    /** F1 — mirrors the web leaf: hours and minutes, and a glyph a screen reader names "Timer". */
    it('says a step timer in hours and minutes, marked as a timer', () => {
        render(
            <RecipeDetailView
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
});

describe('RecipeDetailView (native) — footer facts and the rating line (§6.1)', () => {
    it('states the version and opens the version history', () => {
        const onViewVersions = vi.fn();
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ currentVersion: 3 })}
                onViewVersions={onViewVersions}
            />,
        );

        expect(screen.getByText('Version 3')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
        expect(onViewVersions).toHaveBeenCalledTimes(1);
    });

    it('shows the owner the visibility, and another cook none', () => {
        const owner = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                viewerIsOwner
                recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })}
            />,
            ownerWrapper,
        );
        expect(screen.getByText('Private')).toBeTruthy();
        owner.unmount();

        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })}
            />,
        );
        expect(screen.queryByText('Private')).toBeNull();
    });

    it('states the rating and its count beside a star', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ averageRating: 4.8, ratingCount: 12 })}
            />,
        );

        expect(screen.getByText('4.8 (12)')).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — iOS shadow-clipping guard', () => {
    /**
     * The stat strip and the ingredient/step cards carry a tokenized `elevation.sm`. On iOS a layer masks
     * its OWN drop shadow the moment it also sets `overflow: 'hidden'` (Android's `elevation` does not), so
     * an elevated card must never clip. This guards that invariant across the whole detail surface — the
     * same structural rule `RecipeCard.native` enforces with its shell/content split.
     */
    it('never puts a card shadow and an overflow clip on the same node', () => {
        const { container } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb' })],
                    steps: [makeStepView({ instruction: 'Grill it.' })],
                    nutrition: makeNutrition(),
                    photos: [makePhoto()],
                })}
            />,
        );

        const elevated = [...container.querySelectorAll<HTMLElement>('*')].filter(
            (node) => window.getComputedStyle(node).boxShadow !== '',
        );

        // The elevation is present (the guard would be vacuous if the shadows had simply been dropped)…
        expect(elevated.length).toBeGreaterThan(0);

        // …and no elevated node clips.
        for (const node of elevated) {
            expect(window.getComputedStyle(node).overflowX).not.toBe('hidden');
        }
    });
});

describe('RecipeDetailView (native) — hero cover (mockup screenRecipeDetail)', () => {
    it('LEADS the screen with the cover hero — it precedes the title heading in document order', () => {
        const { container } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', photos: [makePhoto({ url: 'https://cdn/hero.jpg' })] })}
            />,
        );
        // The lead surface is the carousel, whose slides render after layout; its region is there from the start.
        const hero: Element | null = screen.getByLabelText('Recipe photos');
        const heading = screen.getByRole('heading', { name: 'Lamb' });

        expect(container.contains(hero)).toBe(true);
        // DOCUMENT_POSITION_FOLLOWING (4) — the heading comes AFTER the hero, i.e. the hero leads the screen.
        const relation = hero === null ? 0 : hero.compareDocumentPosition(heading);
        expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    /**
     * F2 — mirrors the web leaf, and REPLACES "sources the hero from coverPhotoUrl, NOT from photos[0]". That test's
     * premise was that the two could differ; the service makes the cover `photos[0]` on every read path
     * (`recipeDetail.assembler.ts`), and `coverPhotoUrl` is its small thumbnail. Reading `photos` alone shows the cover
     * once, at full size, and no second carousel repeats it.
     */
    it('shows the cover photo once: the lead surface IS the carousel, slide 1 the cover', () => {
        const photos = [0, 1, 2].map((index) =>
            makePhoto({ id: `pho_${String(index)}`, url: `https://cdn/p${String(index)}.jpg` }),
        );
        const { container } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', photos, coverPhotoUrl: 'https://cdn/p0.thumb.jpg' })}
            />,
        );

        // The slides themselves render after layout (see `PhotoCarousel.native.test.tsx`); what exists before it is
        // enough here: one photo surface, and no thumbnail-sized cover painted beside it.
        expect(container.innerHTML).not.toContain('p0.thumb.jpg');
        expect(screen.getAllByLabelText('Recipe photos')).toHaveLength(1);
    });

    it('renders the deliberate no-photo hero fallback for a recipe with no cover', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Lamb', coverPhotoUrl: undefined, photos: [] })}
            />,
        );

        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
        // And the title still renders — a missing cover degrades the hero, never the screen.
        expect(screen.getByRole('heading', { name: 'Lamb' })).toBeTruthy();
    });
});

/**
 * Read back the `font-family` react-native-web ACTUALLY applied to `element`.
 *
 * RNW compiles a `StyleSheet` `fontFamily` into an atomic `r-fontFamily-*` class whose rule it injects into
 * the document; jsdom's `getComputedStyle` does not resolve that rule (it reports the RNW default text
 * stack), so the honest read is the injected declaration itself. Returns `undefined` when the element
 * carries no compiled family — which is itself a failure for a leaf that is supposed to set one.
 */
/**
 * Resolve the value react-native-web actually APPLIED for a CSS property, by walking the element's atomic
 * `r-*` classes back to their compiled rules and falling back to the inline `style` attribute. Same helper as
 * `CollectionHeader.native.test.tsx` / `RecipeFilterBar.native.test.tsx`, which established the idiom.
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    const sheets = document.styleSheets;
    let resolved: string | undefined;

    for (const className of classNames) {
        for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
            const rules = sheets[sheetIndex]?.cssRules;

            for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
                const rule = rules?.[ruleIndex];

                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return (resolved ?? (element as HTMLElement).style.getPropertyValue(property)) || undefined;
}

/**
 * Regression sweep (same family as `CollectionHeader.native.tsx`'s clipped Rename / absent Delete): the
 * ingredient checklist row is `[44pt checkbox][qty][name][notes][Custom badge]` on one non-wrapping line with
 * the badge pushed right by `marginLeft: 'auto'`, and React Native defaults `flexShrink` to 0 — so a long
 * ingredient name plus notes claimed their full intrinsic width and pushed the badge (and the notes
 * themselves) past the card and screen edge. Two of the three variable-length values in this row come
 * straight from user data, so it needs no unusual recipe to hit.
 *
 * jsdom has no layout engine, so this pins the flex CONTRACT: the user-supplied text yields width, the fixed
 * chrome (the 44pt tap target) never does. The badge is no longer chrome: it flows inside the text block (E2 I1,
 * below).
 */
describe('RecipeDetailView (native) — a long ingredient line cannot push the row chrome off the screen', () => {
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

    it('lets the line’s text block shrink and wrap instead of claiming its intrinsic width', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={longIngredient()} />);

        const block = textBlockOf(/Slow-roasted San Marzano tomatoes/u) as Element;

        expect(['0', '0px']).toContain(appliedStyle(block, 'min-width'));
        expect(appliedStyle(block, 'flex-grow')).toBe('1');
    });

    it('keeps the whole row at least 48 dp tall, the touch floor', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={longIngredient()} />);

        expect(
            appliedStyle(screen.getByRole('checkbox', { name: /Slow-roasted San Marzano tomatoes/u }), 'min-height'),
        ).toBe('48px');
    });
});

/**
 * E2 I1 — a named row's status badge flows INSIDE the name's text block, never in a column beside it. The mirror
 * of the web suite's block of the same name (§14).
 *
 * ⚠️ This REPLACES the old "never shrinks the trailing user-entered badge" test, which pinned the defect: a
 * `flexShrink: 0` badge beside the fixed 44 dp checkbox leaves the name 0 px wide at a large font scale
 * (`ingredientSpecialization.md` E2). The row now holds exactly the tick and the text block, the amount flows inside
 * that block with the name (D1, below), and every badge wraps inside it too. jsdom has no layout, so this pins the
 * STRUCTURE, not a measured width.
 */
describe('RecipeDetailView (native) — a status badge flows inside the name block (E2 I1)', () => {
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
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [line, healthy] })}
                />,
            );

            const block = textBlockOf(/Plain flour/u);

            expect(block?.contains(screen.getByText('Plain flour'))).toBe(true);
            expect(block?.contains(screen.getByText(badge))).toBe(true);
        });

        it(`gives the row no badge column beside the name for ${what}`, () => {
            render(
                <RecipeDetailView
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [line, healthy] })}
                />,
            );

            const row = screen.getByRole('checkbox', { name: /Plain flour/u });

            // Exactly the tick and the text block, which holds the amount, the name and the badge: nothing sits beside
            // the block to squeeze it.
            expect(row?.children).toHaveLength(2);
            expect(row?.lastElementChild?.contains(screen.getByText('Plain flour'))).toBe(true);
        });
    }
});

/** The text block of the row whose checkbox is named `name`: the row's last child, beside the tick. */
function textBlockOf(name: RegExp): Element | null | undefined {
    // The whole row is the checkbox: its last child is the one text block.
    return screen.getByRole('checkbox', { name }).lastElementChild;
}

/**
 * The quantity reads with the name (`docs/design/variantDetailsMockup.html` frame 1, the E2 re-check;
 * `docs/design/readSurfacesEvaluation.md` D1). The amount and the name are ONE paragraph, so a long name wraps under
 * the amount instead of taking a line of its own below it. The row aligns its items to the top, and the text block's
 * top padding centres the paragraph's first line on the 44 dp tick target. jsdom lays nothing out, so this pins the
 * structure and the numbers that make the geometry; the device check is owed (font scale grows the line, not the
 * target).
 */
describe('RecipeDetailView (native) — the quantity flows with the name (D1)', () => {
    const line = makeIngredientView({ ingredientId: 'line', name: 'Plain flour', unit: 'cups' });

    it('puts the amount and the name in one paragraph, the amount first', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [line] })}
            />,
        );

        const quantity = screen.getByText('2 cups');
        const name = screen.getByText('Plain flour');

        expect(quantity.parentElement).toBe(name.parentElement);
        expect(name.parentElement?.textContent).toBe('2 cups Plain flour');
    });

    it('aligns the row to the top, so a two-line row keeps its box by the first line', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [line] })}
            />,
        );

        expect(appliedStyle(screen.getByRole('checkbox', { name: '2 cups Plain flour' }), 'align-items')).toBe(
            'flex-start',
        );
    });

    for (const shape of QUANTITY_LINE_SHAPES) {
        it(`${shape.what}: the quantity leads the name in the row's one text block`, () => {
            render(
                <RecipeDetailView
                    unreachableRetry={idleUnreachableRetry}
                    recipe={makeRecipeDetail({ ingredients: [shape.line] })}
                />,
            );

            const row = screen.getByRole('checkbox', { name: shape.checkbox });
            const block = row?.lastElementChild;
            const name = screen.getByText(shape.name);

            expect(row?.children).toHaveLength(2);
            expect(block?.contains(name)).toBe(true);
            expect(block?.textContent?.startsWith(shape.quantity === '' ? shape.name : `${shape.quantity}`)).toBe(true);

            if (shape.quantity !== '') {
                const quantity = screen.getByText(shape.quantity);

                expect(block?.contains(quantity)).toBe(true);
                expect(quantity.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            }
        });
    }

    it('starts the paragraph with the name when the line states no amount', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [{ ...line, quantity: { kind: 'absent' }, unit: undefined }] })}
            />,
        );

        expect(screen.getByText('Plain flour').parentElement?.textContent).toBe('Plain flour');
    });
});

function appliedFontFamily(element: Element): string | undefined {
    const className = element.className.split(' ').find((name) => name.startsWith('r-fontFamily-'));

    if (className === undefined) {
        return undefined;
    }

    const sheets = document.styleSheets;

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        const rules = sheets[sheetIndex]?.cssRules;

        for (let ruleIndex = 0; ruleIndex < (rules?.length ?? 0); ruleIndex += 1) {
            const rule = rules?.[ruleIndex];

            if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                return rule.style.getPropertyValue('font-family');
            }
        }
    }

    return undefined;
}

describe('RecipeDetailView (native) — the current step is tellable from the others', () => {
    it('fills the current step’s numeral with the action colour and shows the here bar; the others do neither', () => {
        const { container } = render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    steps: [
                        makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' }),
                        makeStepView({ stepNumber: 2, instruction: 'Roast it.' }),
                    ],
                })}
            />,
        );
        const numeral = (step: number): string =>
            getComputedStyle(
                screen.getByRole('button', { name: `Mark step ${step} as current` }).firstElementChild as Element,
            ).backgroundColor;

        fireEvent.click(screen.getByRole('button', { name: 'Mark step 1 as current' }));

        expect(numeral(1)).toBe(cssColor(palette.seafoam));
        expect(numeral(2)).not.toBe(numeral(1));
        expect(container.querySelectorAll('[data-here-bar]')).toHaveLength(1);
    });
});

/**
 * Gap A — the recipe's ORIGIN, on the detail view itself (native leaf).
 *
 * Provenance used to reach the screen only through the old clone action, which mobile mounts only when the
 * viewer CAN clone — so an owner never saw it, and `sourceUrl` reached nobody on either platform.
 */
describe('RecipeDetailView (native) — recipe source', () => {
    it('renders the source link for a recipe that has one, with no viewer context at all', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    sourceUrl: 'https://www.seriouseats.com/recipes/lamb',
                    sourceAttribution: 'Serious Eats',
                })}
            />,
        );

        // The link is labelled by the VERIFIED host; the untrusted attribution renders beside it as text.
        expect(screen.getByRole('link').textContent).toBe('www.seriouseats.com');
        expect(screen.getByText('Serious Eats')).toBeTruthy();
    });

    it('renders the attribution alone when there is no linkable URL', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ sourceAttribution: 'Grandma’s cookbook' })}
            />,
        );

        expect(screen.getByText('Grandma’s cookbook')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders NO source affordance for a recipe that has none', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail({})} />);

        expect(screen.queryByText('Source')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});

/**
 * Gap B — configurable serving size (native leaf). Mirrors the web assertions so the two platforms cannot
 * diverge on WHAT scales: quantities and prep yes, cook time and step timers deliberately not.
 */
describe('RecipeDetailView (native) — serving scale', () => {
    // Session state in a module singleton: without this, one test's doubling leaks into the next.
    afterEach(resetServingScale);

    const scalable = () =>
        makeRecipeDetail({
            servings: 4,
            prepTimeMinutes: 15,
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
                unreachableRetry={idleUnreachableRetry}
                recipe={scalable()}
                servings={servings}
                onServingsChange={vi.fn()}
                onOpenDataSources={vi.fn()}
                dataSourcesReturnFocusSignal={0}
                layout={{ columns: 'one', statsPerRow: 4 }}
                {...idleDetailBodyState}
            />,
        );

    it('opens at the serving count the recipe was created with', () => {
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={scalable()} />);

        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.queryByText(/Amounts scaled from/)).toBeNull();
    });

    it('rescales the WHOLE view when the cook uses the control — no app wiring involved', async () => {
        // The wiring assertion: the native detail binds the scale itself, exactly as the web leaf does, so
        // `RecipeDetailScreen` cannot ship the screen with the control inert.
        render(<RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={scalable()} />);

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(screen.getByText('5')).toBeTruthy();
        expect(screen.getByText('2.5 tbsp')).toBeTruthy();
        expect(screen.getByText(/Amounts scaled from 4 servings/)).toBeTruthy();
    });

    it('scales ingredient quantities to the chosen serving count', () => {
        renderAt(8);

        expect(screen.getByText('4 tbsp')).toBeTruthy();
        expect(screen.queryByText('2 tbsp')).toBeNull();
    });

    it('scales prep and the total, and leaves cook time and step timers alone', () => {
        renderAt(8);

        expect(screen.getByText('30 min')).toBeTruthy(); // prep 15 -> 30
        // Said in hours and minutes through `formatDuration` (§6.1), so the rebuilt 60 minutes reads "1 h".
        expect(screen.getByText('1 h')).toBeTruthy(); // total 45 + the prep delta
        expect(screen.getByText('25 min')).toBeTruthy(); // cook: UNCHANGED
        expect(screen.getByText('10 min')).toBeTruthy(); // step timer: UNCHANGED
    });

    it('leaves PER-SERVING nutrition untouched, because it is invariant under scaling', () => {
        renderAt(12);

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

    it('scales DOWN as well as up', () => {
        renderAt(2);

        expect(screen.getByText('1 tbsp')).toBeTruthy();
        expect(screen.getByText('8 min')).toBeTruthy(); // prep 15 -> 7.5, rounded to a whole minute
    });

    it('renders a recipe authored beyond the display cap at its own yield rather than crashing', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ id: 'rec_huge', servings: 250 })}
            />,
        );

        expect(screen.getByText('250')).toBeTruthy();
    });
});

/**
 * U9 / R42 + R38 — a ranged or absent quantity on the READ surface, native leaf.
 *
 * The one-for-one mirror of the web suite's block. The accessible name is composed from the SAME
 * `formatQuantity` output both platforms share, so an en-dash rendered on one and not the other fails here.
 */
describe('RecipeDetailView (native) — ranged and absent quantities (U9)', () => {
    it('renders a stated range as a span, not as its lower bound alone', () => {
        render(
            <RecipeDetailView
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

        expect(screen.getByLabelText('2–3 cups Flour')).toBeTruthy();
    });

    it('renders an ABSENT quantity as the unit alone, with no fabricated number (R40)', () => {
        render(
            <RecipeDetailView
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

        expect(screen.getByLabelText('the size of an egg Butter')).toBeTruthy();
        expect(screen.queryByLabelText(/^0 /u)).toBeNull();
        expect(screen.queryByLabelText(/^1 /u)).toBeNull();
    });

    it('discloses that the nutrition figure came from one bound of a stated range (R38)', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ rangeDerivedBound: 'low' }) })}
            />,
        );

        expect(screen.getByText('Estimated from the lower amount of each stated range')).toBeTruthy();
    });

    it('shows NO range disclosure when nothing was collapsed', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ nutrition: makeNutrition() })}
            />,
        );

        expect(screen.queryByText('Estimated from the lower amount of each stated range')).toBeNull();
    });
});

/**
 * U26 — the preparation on the NATIVE read surface, mirroring the web leaf.
 *
 * ⛔ §14's cross-platform rule is the point: the two detail leaves are separate files with no compiler edge,
 * so a field rendered on one and forgotten on the other ships a recipe that reads differently depending on
 * which device the cook picked up.
 */
describe('RecipeDetailView (native) — ingredient preparation (U26)', () => {
    it('renders the preparation when the line carries one', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Onion', preparation: 'finely chopped' })],
                })}
            />,
        );

        expect(screen.getByText('finely chopped')).toBeTruthy();
    });

    it('⛔ NEVER concatenates the preparation into the food name', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Onion', preparation: 'finely chopped' })],
                })}
            />,
        );

        expect(screen.getByText('Onion')).toBeTruthy();
        expect(screen.queryByText('Onion finely chopped')).toBeNull();
    });

    it('renders BOTH the preparation and a `notes` display override — they are different facts', () => {
        render(
            <RecipeDetailView
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
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ name: 'Salt' })] })}
            />,
        );

        expect(screen.getByText('Salt')).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — a failed refresh of what is on screen', () => {
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

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' }),
            'focus',
        );
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2 and N2 (recipe detail): the title header names the screen, so the
 * body carries no name and the title is said once (N4). The header sits inside the gradient band, not directly in the
 * body. The recipe has no cover: with one, the hero photo is named by the title too, and N2 leaves that to a device
 * check.
 */
describe('RecipeDetailView (native) — N1: the title is said once, by its header', () => {
    it('says the title through one header, and no node is labelled with it', () => {
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb', coverPhotoUrl: undefined, photos: [] })}
            />,
        );

        expect(screen.getAllByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Mediterranean Grilled Lamb')).toEqual([]);
    });
});
