import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Home "Recent recipes" — the mockup card GRID with real navigation (mockup-parity sweep; the widget used to
 * stack its rows in a single column and none of them was tappable, so the widget was a dead end). Driven
 * through the real web UI (Next dev server + Clerk session + `next/dynamic` widget load + Suspense + the App
 * Router) with the recipe/identity HTTP contract intercepted (`utils/recipeApi`).
 *
 * What only this tier can prove — and what the component tests deliberately cannot:
 *  - the card grid is reached at all: the widget arrives through the descriptor's `next/dynamic` loader seam
 *    and suspends on a promise the SLOT starts, so a broken loader/promise wiring shows up here and nowhere
 *    else;
 *  - activating a card actually routes: `RecipeWidgetSlot` fulfils the `onSelectRecipe` seam with
 *    `router.push('/{locale}/recipes/{id}')`. This spec activates the SECOND card and pins BOTH the resulting
 *    URL id and the detail's `h1`, so an index/closure mix-up (every card pushing the first recipe) fails
 *    instead of passing by luck;
 *  - the EMPTY viewer gets the dedicated empty state rather than an empty grid — the orchestration layer's
 *    component SELECTION, observed on the real surface.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
const WIDGET_TITLE = 'Recent recipes';

test.describe('Home recent-recipes card grid', () => {
    test('renders a card per recent recipe and activating one opens THAT recipe', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            tier: 'free',
            recipes: [
                makeRecipeDetail({ id: 'rec_first', ownerId: viewerId, title: 'Charred Broccolini' }),
                makeRecipeDetail({ id: 'rec_second', ownerId: viewerId, title: 'Miso Butter Cod' }),
                makeRecipeDetail({ id: 'rec_third', ownerId: viewerId, title: 'Saffron Risotto' }),
            ],
        });

        // Reload Home so the widget fetches against the mock (the landing after sign-in fired before
        // interception was installed).
        await page.goto(route('/'));

        // The widget renders as its own titled region, and every recent recipe is an ACTIONABLE card whose
        // accessible name is the recipe title (the mockup's `cursor-pointer` cards — not inert tiles).
        const widget = page.getByRole('region', { name: WIDGET_TITLE });
        await expect(widget).toBeVisible();

        for (const title of ['Charred Broccolini', 'Miso Butter Cod', 'Saffron Risotto']) {
            await expect(widget.getByRole('button', { name: title })).toBeVisible();
        }

        // The cards are a GRID, not the single stacked column the widget used to render: the mockup lays them
        // out `grid-cols-2` at phone width and `md:grid-cols-4` from tablet up. At this desktop viewport the
        // grid must therefore resolve to FOUR tracks — a stack would report one.
        const trackCount = await widget.getByRole('list').evaluate((element) => {
            const columns = getComputedStyle(element).gridTemplateColumns;

            return columns.split(' ').filter(Boolean).length;
        });
        expect(trackCount).toBe(4);

        // Activate the SECOND card by its accessible name. Pinning a non-first card is the point: if the
        // navigation seam closed over the wrong recipe (or the slot pushed a fixed id), this lands on
        // `rec_first` and the assertions below fail.
        await widget.getByRole('button', { name: 'Miso Butter Cod' }).click();

        await expect(page).toHaveURL(/\/recipes\/rec_second$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Miso Butter Cod' })).toBeVisible();
    });

    test('a viewer with no recipes gets the empty state, not an empty grid', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        // An explicitly EMPTY library (not the mock's default seed) — the state most new viewers land in.
        await mockRecipeApi(page, { viewerId, tier: 'free', recipes: [] });

        await page.goto(route('/'));

        const widget = page.getByRole('region', { name: WIDGET_TITLE });
        await expect(widget).toBeVisible();

        // The dedicated empty state — a stated next step, not a silent blank.
        await expect(widget.getByText('No recipes yet. Create your first recipe to see it here.')).toBeVisible();

        // …and it REPLACES the grid: no card list and no card at all is rendered. (The Suspense skeleton is
        // `aria-hidden`, so it can never satisfy either of these while the promise is still pending.)
        await expect(widget.getByRole('list')).toHaveCount(0);
        await expect(widget.getByRole('button')).toHaveCount(0);
    });
});
