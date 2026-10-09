/**
 * @module @commise/features-recipes/editor — the recipe Preview draws (build spec §7.7 item 4): the real detail page,
 * from the DRAFT. Everything the draft says comes from the draft, through the same quantity reading the wire uses
 * (`draftQuantity`), so a range shows as a range (F3). What only the server knows — photos, the author, ratings, the
 * nutrition it computed — comes from the stored recipe, or is empty for a recipe not yet stored.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Adapter — the editor's draft onto the detail page's recipe shape
 */
import {
    RecipeSourceType,
    RecipeStatus,
    type RecipeDetail,
    type RecipeIngredientView,
    type RecipeStepView,
} from '@kitchensink/recipe-core';

import { draftQuantity } from '../form/quantity.js';
import { computeTotalTime } from '../form/totalTime.js';
import type { RecipeFormValues } from '../form/values.js';

/** What a preview is drawn from. */
export interface PreviewInput {
    readonly values: RecipeFormValues;
    /** The stored recipe, for what only the server knows; `undefined` before the server create. */
    readonly recipe: RecipeDetail | undefined;
    /** Now, ISO 8601: a new recipe's created and updated time. */
    readonly now: string;
}

/** The id a recipe not yet stored previews under. Never sent anywhere. */
const PREVIEW_ID = 'preview';

/**
 * The recipe the preview draws.
 *
 * @param input - The draft, the stored recipe if any, and now.
 * @returns A detail-page recipe. Pure.
 */
export function previewRecipeOf(input: PreviewInput): RecipeDetail {
    const { values, recipe, now } = input;
    const base: RecipeDetail = recipe ?? blankRecipe(now);
    const description = values.description.trim();
    const cuisine = values.cuisine.trim();

    return {
        ...withoutDraftFields(base),
        title: values.title.trim(),
        description,
        ...(cuisine === '' ? {} : { cuisine }),
        ...(values.difficulty === undefined ? {} : { difficulty: values.difficulty }),
        ...(values.mealType === undefined ? {} : { mealType: values.mealType }),
        servings: values.servings,
        prepTimeMinutes: values.prepTimeMinutes,
        cookTimeMinutes: values.cookTimeMinutes,
        totalTimeMinutes: computeTotalTime(values.prepTimeMinutes, values.cookTimeMinutes),
        visibility: values.visibility,
        tags: [...values.tags],
        dietaryFlags: [...values.dietaryFlags],
        ingredients: values.ingredients.map((line): RecipeIngredientView => ({
            ingredientId: line.ingredientId ?? '',
            ...(line.name === undefined ? {} : { name: line.name }),
            ...(line.foodId === undefined ? {} : { foodId: line.foodId }),
            ...(line.variant === undefined ? {} : { variant: line.variant }),
            quantity: draftQuantity(line),
            ...(line.unit === undefined || line.unit === '' ? {} : { unit: line.unit }),
            ...(line.notes === undefined || line.notes === '' ? {} : { notes: line.notes }),
            ...(line.preparation === undefined || line.preparation.trim() === ''
                ? {}
                : { preparation: line.preparation.trim() }),
            ...(line.groupLabel === undefined || line.groupLabel.trim() === ''
                ? {}
                : { groupLabel: line.groupLabel.trim() }),
            isUserEntered: line.isUserEntered,
            ...(line.resolutionStatus === undefined ? {} : { resolutionStatus: line.resolutionStatus }),
        })),
        steps: values.steps
            .filter((step) => step.instruction.trim() !== '')
            .map((step, index): RecipeStepView => ({
                stepNumber: index + 1,
                instruction: step.instruction,
                ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
            })),
    };
}

/** The base without the optional fields the draft decides, so a field the draft cleared is absent. Pure. */
function withoutDraftFields(base: RecipeDetail): RecipeDetail {
    const { cuisine: _cuisine, difficulty: _difficulty, mealType: _mealType, ...rest } = base;

    return rest;
}

/** A recipe not yet stored: everything the server would add is empty. Pure. */
function blankRecipe(now: string): RecipeDetail {
    return {
        id: PREVIEW_ID,
        ownerId: '',
        title: '',
        description: '',
        prepTimeMinutes: 0,
        cookTimeMinutes: 0,
        totalTimeMinutes: 0,
        servings: 1,
        visibility: 'public',
        status: RecipeStatus.DRAFT,
        sourceType: RecipeSourceType.USER_CREATED,
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        currentVersion: 0,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: now,
        updatedAt: now,
        ingredients: [],
        steps: [],
        photos: [],
        nutrition: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, isComplete: false, freshness: 'fresh' },
    };
}
