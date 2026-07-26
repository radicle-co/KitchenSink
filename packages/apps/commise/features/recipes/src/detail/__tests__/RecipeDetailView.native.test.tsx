/**
 * Native component tests for the recipe-detail view (rendered via react-native-web under jsdom). Mirrors
 * the web leaf across every content branch — header, meta, ingredients (incl. user-entered), instructions,
 * nutrition (complete vs partial), and photos (present vs absent) — so the two platform renders can't drift.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pressable, Text } from 'react-native';
import { RecipeVisibility } from '@kitchensink/recipe-core';

import {
    makeIngredientView,
    makeNutrition,
    makePhoto,
    makeRecipeDetail,
    makeStepView,
} from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';

afterEach(cleanup);

describe('RecipeDetailView (native)', () => {
    it('renders the title as a heading', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ title: 'Mediterranean Grilled Lamb' })} />);

        expect(screen.getByRole('heading', { name: 'Mediterranean Grilled Lamb' })).toBeTruthy();
    });

    it('renders the description and badges', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ description: 'Tender and herby.', cuisine: 'Mediterranean' })}
            />,
        );

        expect(screen.getByText('Tender and herby.')).toBeTruthy();
        expect(screen.getByText('Mediterranean')).toBeTruthy();
    });

    it('renders meta times and servings', () => {
        render(
            <RecipeDetailView recipe={makeRecipeDetail({ prepTimeMinutes: 15, totalTimeMinutes: 45, servings: 4 })} />,
        );

        expect(screen.getByText('15 min')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
    });

    it('orders the stat cards Serves, Prep, Cook, Total (wireframe parity, C2)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    prepTimeMinutes: 15,
                    cookTimeMinutes: 30,
                    totalTimeMinutes: 45,
                    servings: 4,
                })}
            />,
        );

        const labels = screen.getAllByText(/^(Serves|Prep|Cook|Total)$/).map((el) => el.textContent);
        expect(labels).toEqual(['Serves', 'Prep', 'Cook', 'Total']);
    });

    it('renders each ingredient with its formatted quantity and name', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ name: 'Lamb leg', quantity: 1.5, unit: 'lbs' })],
                })}
            />,
        );

        expect(screen.getByText('Lamb leg')).toBeTruthy();
        expect(screen.getByText('1.5 lbs')).toBeTruthy();
    });

    it('marks user-entered ingredients with a badge', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: true })] })}
            />,
        );

        expect(screen.getByText('Custom')).toBeTruthy();
    });

    it('renders a step instruction', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [{ stepNumber: 1, instruction: 'Rub the lamb.' }] })}
            />,
        );

        expect(screen.getByText('Rub the lamb.')).toBeTruthy();
    });

    it('renders the per-serving macros', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ nutrition: makeNutrition({ calories: 520, proteinG: 32 }) })}
            />,
        );

        expect(screen.getByText('520')).toBeTruthy();
        expect(screen.getByText('32 g')).toBeTruthy();
    });

    it('shows the estimated indicator only when nutrition is incomplete', () => {
        const { unmount } = render(
            <RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: false }) })} />,
        );
        expect(screen.getByText('Estimated — some items aren’t counted yet')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ nutrition: makeNutrition({ isComplete: true }) })} />);
        expect(screen.queryByText('Estimated — some items aren’t counted yet')).toBeNull();
    });

    it('shows the standing USDA-source note when the recipe has a user-entered ingredient (REQ-034)', () => {
        // Distinct from the incomplete warning (D8): present even when nutrition IS complete, as long as the
        // recipe has a user-entered ingredient the note explains — never an unconditional standing fact.
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    nutrition: makeNutrition({ isComplete: true }),
                    ingredients: [makeIngredientView({ isUserEntered: true })],
                })}
            />,
        );

        expect(
            screen.getByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeTruthy();
    });

    it('hides the standing USDA-source note when no ingredient is user-entered (REQ-034)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ isUserEntered: false })] })}
            />,
        );

        expect(
            screen.queryByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeNull();
    });

    it('hides the standing USDA-source note for a recipe with no ingredients (REQ-034)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [] })} />);

        expect(
            screen.queryByText('Nutrition includes USDA database items; user-entered ingredients are marked Custom.'),
        ).toBeNull();
    });

    it('renders the photo gallery only when the recipe has photos', () => {
        const { unmount } = render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [makePhoto()] })} />);
        expect(screen.getByLabelText('Recipe photos')).toBeTruthy();
        unmount();

        render(<RecipeDetailView recipe={makeRecipeDetail({ photos: [] })} />);
        expect(screen.queryByLabelText('Recipe photos')).toBeNull();
    });
});

describe('RecipeDetailView (native) — interactivity (D4/D5/D6)', () => {
    it('renders each ingredient as a checkbox reflecting the checked set (D5)', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' }),
                        makeIngredientView({ ingredientId: 'ing_2', name: 'Garlic' }),
                    ],
                })}
                checkedIngredients={new Set(['ing_1'])}
            />,
        );

        // react-native-web renders role="checkbox" but not aria-checked, so assert the checked ✓ affordance.
        expect(screen.getByLabelText(/Olive oil/).getAttribute('role')).toBe('checkbox');
        expect(within(screen.getByLabelText(/Olive oil/)).queryByText('✓')).not.toBeNull();
        expect(within(screen.getByLabelText(/Garlic/)).queryByText('✓')).toBeNull();
    });

    it('invokes onToggleIngredient when an ingredient checkbox is pressed (D5)', async () => {
        const onToggleIngredient = vi.fn();
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [makeIngredientView({ ingredientId: 'ing_9', name: 'Salt' })],
                })}
                onToggleIngredient={onToggleIngredient}
            />,
        );

        await user.click(screen.getByLabelText(/Salt/));

        expect(onToggleIngredient).toHaveBeenCalledWith('ing_9');
    });

    it('renders a per-step checkbox and toggles it (D4)', async () => {
        const onToggleStep = vi.fn();
        const user = userEvent.setup();
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                checkedSteps={new Set()}
                onToggleStep={onToggleStep}
            />,
        );

        await user.click(screen.getByLabelText('Mark step 1 complete'));

        expect(onToggleStep).toHaveBeenCalledWith(1);
    });

    it('invokes onFilterByTag when a tag chip is pressed (D6)', async () => {
        const onFilterByTag = vi.fn();
        const user = userEvent.setup();
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} onFilterByTag={onFilterByTag} />);

        await user.click(screen.getByLabelText('Find recipes tagged grill'));

        expect(onFilterByTag).toHaveBeenCalledWith('grill');
    });
});

describe('RecipeDetailView (native) — touch targets (U4 / RC-3)', () => {
    it('gives the ingredient checkbox a 44pt tap target', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil' })] })}
                onToggleIngredient={vi.fn()}
            />,
        );

        const box = window.getComputedStyle(screen.getByLabelText(/Olive oil/));
        expect(box.width).toBe('44px');
        expect(box.height).toBe('44px');
    });

    it('gives the step marker a 44pt tap target', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ steps: [makeStepView({ stepNumber: 1, instruction: 'Rub the lamb.' })] })}
                onToggleStep={vi.fn()}
            />,
        );

        const marker = window.getComputedStyle(screen.getByLabelText('Mark step 1 complete'));
        expect(marker.width).toBe('44px');
        expect(marker.height).toBe('44px');
    });
});

describe('RecipeDetailView (native) — contrast (U4 / WCAG AA)', () => {
    it('renders tag chips with a slate (AA-legible) text colour, not the 2.2:1 coral', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ tags: ['grill'] })} onFilterByTag={vi.fn()} />);

        // The coral tint background stays; the tag TEXT is demoted to slate (rgb(99,110,114) ≈ 5:1). The old
        // coral-as-text (#E8917A) was 2.2:1.
        expect(window.getComputedStyle(screen.getByText('grill')).color).toBe('rgb(99, 110, 114)');
    });
});

describe('RecipeDetailView (native) — version + visibility badges (D3)', () => {
    it('shows the current-version badge when past v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 3 })} />);

        expect(screen.getByLabelText('Version 3')).toBeTruthy();
        expect(screen.getByText('v3')).toBeTruthy();
    });

    it('omits the version badge at v1', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a Public badge for a public recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PUBLIC })} />);

        expect(within(screen.getByLabelText('Recipe status')).getByText('Public')).toBeTruthy();
    });

    it('shows a Private badge for a private recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ visibility: RecipeVisibility.PRIVATE })} />);

        expect(within(screen.getByLabelText('Recipe status')).getByText('Private')).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — grouped footer (C3 wireframe parity)', () => {
    it('groups caller-supplied footerActions with the version + visibility badges in ONE footer row', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({ currentVersion: 2, visibility: RecipeVisibility.PUBLIC })}
                footerActions={
                    <Pressable accessibilityRole="button" accessibilityLabel="Clone">
                        <Text>Clone</Text>
                    </Pressable>
                }
            />,
        );

        const footer = screen.getByLabelText('Recipe status');
        expect(within(footer).getByRole('button', { name: 'Clone' })).toBeTruthy();
        expect(within(footer).getByText('v2')).toBeTruthy();
        expect(within(footer).getByText('Public')).toBeTruthy();
    });

    it('renders no footerActions slot when the caller omits it (e.g. the owner viewing their own recipe)', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ currentVersion: 1 })} />);

        expect(screen.queryByRole('button', { name: 'Clone' })).toBeNull();
    });
});
