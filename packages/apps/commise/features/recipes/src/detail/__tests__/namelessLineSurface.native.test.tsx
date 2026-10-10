/**
 * Recipe lines with no name, on the NATIVE recipe detail — the mirror of `namelessLineSurface.test.tsx`, rendered
 * through react-native-web. Focus is the screen-reader cursor here, asserted as the accessibility event it sends,
 * because React Native cannot read where that cursor is.
 *
 * The web suite's header carries what each case pins. On the web recipe detail (plan 002 R2, R9, R36; `docs/design/namelessLineCopy.md`).
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderUnscoped, screen, within } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { RecipeIngredientView } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail, idleUnreachableRetry } from '../../__fixtures__/index.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';
import type { ReactElement } from 'react';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';

/** Every detail renders inside the session’s cook-marks scope, as each app root mounts it. */
const render = (ui: ReactElement): ReturnType<typeof renderUnscoped> =>
    renderUnscoped(ui, { wrapper: CookMarksTestProvider });

const en = recipeMessages.en.detail;
const standIns = recipeMessages.en.ingredientLineName;

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

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

// The native leaf has no section element; the list lives in the card after the Ingredients heading. The whole view is
// the scope, and each case names what it expects to find.
const ingredientsSection = () => document.body;
const politeText = (text: string) =>
    [...document.querySelectorAll('[aria-live="polite"]')].some((region) => region.textContent === text);

describe('RecipeDetailView (native) — a line whose food is private to another cook', () => {
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

describe('RecipeDetailView (native) — a removed food that took its name with it', () => {
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

describe('RecipeDetailView (native) — lines food could not be asked about', () => {
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
        // Rewritten with the web suite: the page-level notice now yields, so a failed retry keeps its button.
        render(
            <RecipeDetailView
                recipe={unreachableRecipe(1)}
                refreshNotice={pageNotice(true)}
                unreachableRetry={retry()}
            />,
        );

        expect(screen.getAllByRole('button', { name: en.refreshRetry })).toHaveLength(1);
        expect(screen.queryAllByText(en.refreshError)).toHaveLength(0);
        expect(screen.getAllByText(en.unreachableNoticeOne).length).toBeGreaterThan(0);
    });

    it('the page-level notice still speaks when no line is unreachable', () => {
        render(
            <RecipeDetailView recipe={loadedRecipe()} refreshNotice={pageNotice(true)} unreachableRetry={retry()} />,
        );

        expect(screen.getAllByText(en.refreshError).length).toBeGreaterThan(0);
    });

    it('⛔ keeps its status region mounted before any line is unreachable, so it announces when one is', () => {
        const { rerender } = render(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry()} />);
        const regionsBefore = [...document.querySelectorAll('[aria-live="polite"]')];

        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        const regionsAfter = [...document.querySelectorAll('[aria-live="polite"]')];

        expect(regionsAfter).toStrictEqual(regionsBefore);
        expect(politeText(en.unreachableNoticeOne)).toBe(true);
    });

    it('⛔ moves the cursor to the Ingredients heading when a retry loads every name, and says so there', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);

        const heading = screen.getByRole('heading', { name: en.ingredientsHeading });

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(heading, 'focus');
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    });

    it('⛔ leaves the cursor alone when the retry loaded only some names — the button is still there', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(2)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: en.refreshRetry })).toBeTruthy();
    });

    it('⛔ moves nothing when a background refetch loads the names — the cook did not ask', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry()} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });

    it('⛔ moves nothing when a LATER outage clears by itself, after an earlier retry recovered', () => {
        const { rerender } = render(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry()} />);

        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);
        rerender(<RecipeDetailView recipe={unreachableRecipe(1)} unreachableRetry={retry({ recoveries: 1 })} />);
        rerender(<RecipeDetailView recipe={loadedRecipe()} unreachableRetry={retry({ recoveries: 1 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    });
});
