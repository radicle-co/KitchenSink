/**
 * The WITHDRAWN-FOOD surface on the NATIVE recipe detail (owner rulings 3 + 4, 2026-09-07), rendered via
 * react-native-web under jsdom.
 *
 * ⛔ A DELIBERATE MIRROR of `removedFoodSurface.test.tsx`, case for case. The cross-platform rule (§14) is
 * that a user-facing feature ships to BOTH platforms in the same release, and the only thing that actually
 * enforces it is two suites asserting the same behaviour — a shared model renders nothing.
 *
 * ⚠️ The native leaf reaches `role="note"` through the ARIA-shaped `role` prop, NOT `accessibilityRole`:
 * React Native's `AccessibilityRole` union predates ARIA and has no `note` member. That is why these
 * assertions can use `getByRole` at all, and why the leaf must not be "fixed" onto the other prop.
 *
 * A cook opens a recipe they saved and one of its ingredients no longer has a food behind it, because the
 * person who authored that food deleted it. The recipe still cooks — the line's own name, quantity and unit
 * belong to the RECIPE and are untouched — but its macros stop counting.
 *
 * ## ⛔ What this file pins that the model tests cannot
 *
 * - **Placement.** The tile sits at the head of the Ingredients section, not above the recipe title and not
 *   in the Nutrition section. The first would be a permanent caveat over a cook's own recipe on every
 *   visit; the second would explain the effect nowhere near the cause.
 * - **`role="note"`, never a live region.** SC 4.1.3 governs content appearing WITHOUT a change of context.
 *   This is present on the initial render of a freshly loaded page, where an `aria-live` region either
 *   announces nothing or duplicates content already reached in document order.
 * - **Badge suppression when every line is removed** — a badge on every row is wallpaper, not signal.
 * - **Tone.** Charcoal on a warning TINT, never `warning` as a foreground: `colors.ts` records that
 *   #F5B041 is a light fill taking a charcoal label and is far under 4.5:1 as text on near-white.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDetailView } from '../RecipeDetailView.native.js';
import { resetServingScale } from '../servingScale.js';
import { recipeMessages } from '../../messages.js';

const en = recipeMessages.en.detail;

afterEach(() => {
    cleanup();
    resetServingScale();
});

const removedLine = (id: string, name = 'Gran’s pie filling') =>
    makeIngredientView({ ingredientId: id, name, resolutionStatus: FoodResolutionStatus.FOOD_REMOVED });

describe('RecipeDetailView (native) — one ingredient whose food was withdrawn', () => {
    const oneRemoved = () =>
        makeRecipeDetail({
            ingredients: [removedLine('gone'), makeIngredientView({ ingredientId: 'ok', name: 'Salt' })],
        });

    it('badges the affected LINE, so a cook sees WHICH ingredient it is', () => {
        render(<RecipeDetailView recipe={oneRemoved()} />);

        expect(screen.getByText(en.removedFoodBadge)).toBeTruthy();
    });

    it('⛔ NAMES the ingredient in the tile — a complete answer with no scanning', () => {
        render(<RecipeDetailView recipe={oneRemoved()} />);

        expect(screen.getByRole('note').textContent).toContain('Gran’s pie filling');
    });

    it('⛔ carries the reassurance — the answer to "is my recipe broken?"', () => {
        render(<RecipeDetailView recipe={oneRemoved()} />);

        expect(screen.getByRole('note').textContent).toMatch(/unchanged/iu);
    });

    it('⛔ is a `note`, NOT a live region — this is present on first render, not an update', () => {
        render(<RecipeDetailView recipe={oneRemoved()} />);

        const note = screen.getByRole('note');

        expect(note.getAttribute('aria-live')).toBeNull();
        expect(note.getAttribute('role')).toBe('note');
    });

    it('⛔ sits AFTER the Ingredients heading and BEFORE the recipe title is left behind', () => {
        // The native leaf has no labelled <section> to nest inside — it is a flat scroll of headings and
        // views — so placement is asserted by DOCUMENT ORDER instead: the tile follows the Ingredients
        // heading, which is what puts it in front of a reader working down the list.
        render(<RecipeDetailView recipe={oneRemoved()} />);

        const heading = screen.getByText(en.ingredientsHeading);
        const note = screen.getByRole('note');

        expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('RecipeDetailView (native) — several removed, but not all', () => {
    const someRemoved = () =>
        makeRecipeDetail({
            ingredients: [
                removedLine('a', 'Gran’s pie filling'),
                removedLine('b', 'House stock'),
                makeIngredientView({ ingredientId: 'c', name: 'Salt' }),
            ],
        });

    it('COUNTS them rather than naming one and implying that is the whole story', () => {
        render(<RecipeDetailView recipe={someRemoved()} />);

        const note = screen.getByRole('note').textContent ?? '';

        expect(note).toContain('2');
        expect(note).not.toContain('Gran’s pie filling');
    });

    it('marks EACH of them in the list, which is what the tile points at', () => {
        render(<RecipeDetailView recipe={someRemoved()} />);

        expect(screen.getAllByText(en.removedFoodBadge)).toHaveLength(2);
    });
});

describe('RecipeDetailView (native) — every ingredient removed', () => {
    const allRemoved = () => makeRecipeDetail({ ingredients: [removedLine('a'), removedLine('b'), removedLine('c')] });

    it('uses its own sentence, which does not point at badges', () => {
        render(<RecipeDetailView recipe={allRemoved()} />);

        expect(screen.getByRole('note').textContent).toBe(en.removedFoodNoticeAll);
    });

    it('⛔ SUPPRESSES the per-line badges — a badge on every row is wallpaper, not signal', () => {
        render(<RecipeDetailView recipe={allRemoved()} />);

        expect(screen.queryByText(en.removedFoodBadge)).toBeNull();
    });
});

describe('RecipeDetailView (native) — the states that must stay silent', () => {
    it('says nothing for an ordinary recipe', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [makeIngredientView()] })} />);

        expect(screen.queryByText(en.removedFoodBadge)).toBeNull();
        expect(screen.queryByRole('note')).toBeNull();
    });

    it('says nothing for a recipe with NO ingredients — the empty list is not "all removed"', () => {
        render(<RecipeDetailView recipe={makeRecipeDetail({ ingredients: [] })} />);

        expect(screen.queryByRole('note')).toBeNull();
    });

    it('⛔ says nothing for a line that is merely UNAVAILABLE to this viewer', () => {
        // The neighbour it must never absorb: that food EXISTS and is another author's private one. Telling
        // this viewer it was "removed" would be false, and would leak a claim about a catalog row they have
        // no entitlement to.
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({
                            ingredientId: 'a',
                            resolutionStatus: FoodResolutionStatus.RESOLVED_UNAVAILABLE,
                        }),
                    ],
                })}
            />,
        );

        expect(screen.queryByText(en.removedFoodBadge)).toBeNull();
        expect(screen.getByText(en.unavailableBadge)).toBeTruthy();
    });

    it('⛔ says nothing for a terminal NOT_FOUND line — a food no source ever had', () => {
        render(
            <RecipeDetailView
                recipe={makeRecipeDetail({
                    ingredients: [
                        makeIngredientView({ ingredientId: 'a', resolutionStatus: FoodResolutionStatus.NOT_FOUND }),
                    ],
                })}
            />,
        );

        expect(screen.queryByText(en.removedFoodBadge)).toBeNull();
    });
});
