/**
 * Recipe lines with no name, on the web recipe detail (plan 002 R2, R9, R36; `docs/design/namelessLineCopy.md`).
 *
 * A line reaches the page without a name when the viewer may not see its food, when the food is gone, or when food
 * could not be asked on this read. What this file pins that the pure tests cannot:
 *
 * - **The stand-in is the name.** It renders in the name's place as text the row is announced with, and replaces
 *   the status badge instead of sitting beside it (§2a). The row checkbox is named by quantity and stand-in, never
 *   "undefined" (D1).
 * - **One unreachable notice per recipe, with a retry**, hidden (not unmounted) while the page-level refresh notice
 *   shows, so two "Try again" buttons never answer one cause (§3c).
 * - **Focus after the retry.** A full recovery removes the pressed button, so focus goes to the Ingredients heading
 *   and the recovery is announced; a partial recovery leaves the button, and focus stays on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail, idleUnreachableRetry } from '../../__fixtures__/index.js';
import { RecipeDetailView } from '../RecipeDetailView.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;
const standIns = recipeMessages.en.ingredientLineName;

afterEach(() => {
    cleanup();
    resetServingScale();
});

const nameless = (id: string, status: RecipeIngredientView['resolutionStatus']) =>
    makeIngredientView({
        ingredientId: id,
        name: undefined,
        quantity: { kind: 'exact', value: 2 },
        unit: 'tbsp',
        resolutionStatus: status,
    });

const salt = makeIngredientView({ ingredientId: 'salt', name: 'Salt', quantity: { kind: 'absent' }, unit: undefined });

const ingredientsSection = () => screen.getByLabelText(en.ingredientsHeading);

/** The text an element's `aria-describedby` points at, as assistive technology reads it — `''` when none. */
const descriptionOf = (element: HTMLElement): string =>
    (element.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((id) => id !== '')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

describe('RecipeDetailView (web) — a line whose food is private to another cook', () => {
    const view = () =>
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({
                    ingredients: [nameless('private', FoodResolutionStatus.RESOLVED_UNAVAILABLE), salt],
                })}
            />,
        );

    it('shows the stand-in in the name’s place and never the word "undefined"', () => {
        view();

        expect(within(ingredientsSection()).getByText(standIns.privateFood)).toBeTruthy();
        expect(ingredientsSection().textContent).not.toContain('undefined');
    });

    it('⛔ names the row checkbox by quantity and stand-in (D1)', () => {
        view();

        expect(screen.getByRole('checkbox', { name: `2 tbsp ${standIns.privateFood}` })).toBeTruthy();
    });

    it('⛔ shows no separate status badge: the stand-in already says it (§2a)', () => {
        view();

        expect(screen.queryByText('Details unavailable')).toBeNull();
        expect(within(ingredientsSection()).getAllByText(standIns.privateFood)).toHaveLength(1);
    });

    it('⛔ keeps the stand-in readable by assistive technology — it IS the name', () => {
        view();

        expect(screen.getByText(standIns.privateFood).closest('[aria-hidden="true"]')).toBeNull();
    });

    it('explains nothing with a tile: the stand-in explains itself, and a reader cannot act on it (§3a)', () => {
        view();

        expect(screen.queryByRole('note')).toBeNull();
    });
});

describe('RecipeDetailView (web) — a removed food that took its name with it', () => {
    const view = () =>
        render(
            <RecipeDetailView
                unreachableRetry={idleUnreachableRetry}
                recipe={makeRecipeDetail({ ingredients: [nameless('gone', FoodResolutionStatus.FOOD_REMOVED), salt] })}
            />,
        );

    it('shows the removed stand-in and no second "Food removed" badge on the same row', () => {
        view();

        expect(within(ingredientsSection()).getByText(standIns.removedFood)).toBeTruthy();
        expect(screen.queryByText(en.removedFoodBadge)).toBeNull();
    });

    it('⛔ tells the cook with the unnamed sentence, never an empty quotation (D3)', () => {
        view();

        expect(screen.getByRole('note').textContent).toBe(en.removedFoodNoticeOneUnnamed);
    });
});

describe('RecipeDetailView (web) — lines food could not be asked about', () => {
    const retry = (overrides: Partial<{ refreshing: boolean; recoveries: number; onRetry: () => void }> = {}) => ({
        refreshing: false,
        recoveries: 0,
        onRetry: () => undefined,
        ...overrides,
    });
    const pageNotice = (failed: boolean) => ({ failed, refreshing: false, recoveries: 0, onRetry: () => undefined });

    const unreachableRecipe = (count: number) =>
        makeRecipeDetail({
            ingredients: [
                ...Array.from({ length: count }, (_, index) =>
                    nameless(`far-${index}`, FoodResolutionStatus.FOOD_UNREACHABLE),
                ),
                makeIngredientView({ ingredientId: 'olive', name: 'Olive oil' }),
            ],
        });

    const loadedRecipe = () =>
        makeRecipeDetail({
            ingredients: [
                makeIngredientView({ ingredientId: 'far-0', name: 'Za’atar' }),
                makeIngredientView({ ingredientId: 'olive', name: 'Olive oil' }),
            ],
        });

    it('shows the not-loaded stand-in on each line', () => {
        render(<RecipeDetailView recipe={unreachableRecipe(2)} unreachableRetry={retry()} />);

        expect(within(ingredientsSection()).getAllByText(standIns.notLoaded)).toHaveLength(2);
    });

    it('⛔ shows ONE notice for the recipe, not one per line, and its Try again retries', () => {
        const onRetry = vi.fn();
        render(<RecipeDetailView recipe={unreachableRecipe(2)} unreachableRetry={retry({ onRetry })} />);

        const section = within(ingredientsSection());

        expect(section.getAllByText(en.unreachableNoticeMany.replace('{count}', '2')).length).toBeGreaterThan(0);
        expect(section.getAllByRole('button', { name: en.refreshRetry })).toHaveLength(1);
        fireEvent.click(section.getByRole('button', { name: en.refreshRetry }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('uses the singular sentence for one line', () => {
        render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        expect(within(ingredientsSection()).getAllByText(en.unreachableNoticeOne).length).toBeGreaterThan(0);
    });

    it('shows nothing when food answered for every line', () => {
        render(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry()} />);

        expect(screen.queryByText(en.unreachableNoticeOne)).toBeNull();
        expect(screen.queryByRole('button', { name: en.refreshRetry })).toBeNull();
    });

    it('⛔ keeps ONE Try again for one cause: the page-level notice yields to the ingredients notice', () => {
        // Rewritten: the ingredients notice used to hide behind the page-level one, so a retry pressed there that
        // failed at transport unmounted the pressed button and dropped focus. Now the page-level notice yields.
        render(
            <RecipeDetailView
                recipe={unreachableRecipe(1)}
                refreshNotice={pageNotice(true)}
                unreachableRetry={retry()}
            />,
        );

        expect(screen.getAllByRole('button', { name: en.refreshRetry })).toHaveLength(1);
        expect(within(ingredientsSection()).getByRole('button', { name: en.refreshRetry })).toBeTruthy();
        expect(screen.queryAllByText(en.refreshError)).toHaveLength(0);
    });

    it('⛔ keeps focus on Try again when a retry pressed there fails at transport', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);
        const button = within(ingredientsSection()).getByRole('button', { name: en.refreshRetry });

        button.focus();
        rerender(
            <RecipeDetailView
                recipe={unreachableRecipe(1)}
                refreshNotice={pageNotice(true)}
                unreachableRetry={retry()}
            />,
        );

        expect(document.activeElement).toBe(button);
    });

    it('the page-level notice still speaks when no line is unreachable', () => {
        render(
            <RecipeDetailView recipe={loadedRecipe()} refreshNotice={pageNotice(true)} unreachableRetry={retry()} />,
        );

        expect(screen.getAllByText(en.refreshError).length).toBeGreaterThan(0);
    });

    it('⛔ keeps its status region mounted before any line is unreachable, so it announces when one is', () => {
        const { rerender } = render(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry()} />);
        const regionsBefore = within(ingredientsSection()).getAllByRole('status');

        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        const regionsAfter = within(ingredientsSection()).getAllByRole('status');

        expect(regionsAfter[0]).toBe(regionsBefore[0]);
        expect(regionsAfter.some((region) => region.textContent === en.unreachableNoticeOne)).toBe(true);
    });

    it('⛔ moves focus to the Ingredients heading when a retry loads every name, and says so there', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        within(ingredientsSection()).getByRole('button', { name: en.refreshRetry }).focus();
        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);

        const heading = screen.getByRole('heading', { name: en.ingredientsHeading });

        expect(document.activeElement).toBe(heading);
        expect(descriptionOf(heading)).toBe(en.unreachableResolved);
    });

    it('⛔ leaves focus on Try again when the retry loaded only some names — the button is still there', () => {
        // A partial recovery is not counted (`isUnreachableRecovery`), so `recoveries` does not move.
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(2)} unreachableRetry={retry()} />);
        const button = within(ingredientsSection()).getByRole('button', { name: en.refreshRetry });

        button.focus();
        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        expect(document.activeElement).toBe(
            within(ingredientsSection()).getByRole('button', { name: en.refreshRetry }),
        );
        expect(descriptionOf(screen.getByRole('heading', { name: en.ingredientsHeading }))).toBe('');
    });

    it('⛔ moves nothing when a background refetch loads the names — the cook did not ask', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry()} />);

        expect(document.activeElement).toBe(document.body);
    });

    it('⛔ moves nothing when a LATER outage clears by itself, after an earlier retry recovered', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);
        (document.activeElement as HTMLElement | null)?.blur();
        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry({ recoveries: 1 })} />);
        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);

        expect(document.activeElement).toBe(document.body);
    });
});
