import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * The author's food page (private foods spec section 5; Playwright is this screen's UI integration test): the cook opens
 * their own private food, asks to make it public, and sees "Waiting for review"; withdraws it through the
 * confirmation; and meets "Food not found" for a food that is not theirs. Food-service is intercepted with the
 * wire shapes the schema package publishes (`ownFoodList`, `publicationRequestDetail`, `foodResponse`); selectors are
 * role/label only. Serial (Clerk-authed).
 *
 * NOT RUN in the session that wrote it (no Playwright runs there): it is the happy path the spec names, and a first run
 * may need its selectors adjusted to the live page.
 */
const FOOD_ID = 'food_e2e_oat';

function foodAs(publicationState: string) {
    return {
        id: FOOD_ID,
        name: 'E2E Oat milk',
        description: null,
        kind: 'generic',
        status: 'RESOLVED',
        nutrients: [
            { nutrient: 'Energy', amount: 120, unit: 'kcal', basis: 'per_100g', source: 'authored' },
            { nutrient: 'Protein', amount: 3, unit: 'g', basis: 'per_100g', source: 'authored' },
            { nutrient: 'Carbohydrate, by difference', amount: 16, unit: 'g', basis: 'per_100g', source: 'authored' },
            { nutrient: 'Total lipid (fat)', amount: 5, unit: 'g', basis: 'per_100g', source: 'authored' },
        ],
        portions: [],
        provenance: {},
        variants: [],
        visibility: 'private',
        publicationState,
    };
}

const PENDING = {
    request: {
        id: 'req_1',
        foodId: FOOD_ID,
        versionNumber: 1,
        status: 'pending',
        declineReason: null,
        createdAt: '2026-11-09T10:00:00.000Z',
        decidedAt: null,
    },
    snapshot: {
        name: 'E2E Oat milk',
        description: null,
        macros: { calories: 120, proteinG: 3, carbsG: 16, fatG: 5 },
        portions: [],
    },
};

/** Food as the author sees it: private until the ask lands, then asked; gone after the withdraw. */
async function mockFood(page: Page): Promise<{ state: () => string }> {
    let state = 'private';

    await page.route(`**/api/v1/foods/${FOOD_ID}`, async (intercepted) => {
        if (intercepted.request().method() === 'DELETE') {
            state = 'withdrawn';

            return intercepted.fulfill({ status: 204 });
        }

        return intercepted.fulfill({ json: foodAs(state) });
    });
    await page.route(`**/api/v1/foods/authored/${FOOD_ID}/publication-request`, async (intercepted) => {
        if (intercepted.request().method() === 'POST') {
            state = 'asked';

            return intercepted.fulfill({ status: 201, json: PENDING });
        }

        return intercepted.fulfill({ json: PENDING });
    });

    return { state: () => state };
}

test.describe('the author’s food page', () => {
    test('asks to make a private food public and shows it waiting for review', async ({ page }) => {
        await signInWithTicket(page);
        await mockFood(page);

        await page.goto(route(`/foods/${FOOD_ID}`));
        await expect(page.getByRole('heading', { name: 'E2E Oat milk' })).toBeVisible();
        await expect(page.getByText('Only you can see this food.', { exact: false })).toBeVisible();

        await page.getByRole('button', { name: 'Ask to make public' }).click();

        await expect(page.getByText('Waiting for review')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Ask to make public' })).toHaveCount(0);
    });

    test('withdraws the food after confirming, and the page says so', async ({ page }) => {
        await signInWithTicket(page);
        await mockFood(page);

        await page.goto(route(`/foods/${FOOD_ID}`));
        await page.getByRole('button', { name: 'Withdraw', exact: true }).click();

        const dialog = page.getByRole('alertdialog', { name: 'Withdraw E2E Oat milk?' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Withdraw food' }).click();

        await expect(page.getByText('You withdrew this food.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
    });

    test('a food that is not the cook’s reads "Food not found" and says nothing about why', async ({ page }) => {
        await signInWithTicket(page);
        await page.route('**/api/v1/foods/food_not_mine', (intercepted) =>
            intercepted.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'No such food' } }),
        );

        await page.goto(route('/foods/food_not_mine'));

        await expect(page.getByText('Food not found')).toBeVisible();
    });

    // Issue #176 and the designer's retake of PR #166: one container rule, 600 px of CONTENT (`@regular/main:`), so at a
    // 390 px window AND at 620 (572 px of content) every action draws full width, Withdraw included, as the phone app does.
    for (const width of [390, 620]) {
        test(`at ${String(width)} px the actions and Withdraw all draw the full content width`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await signInWithTicket(page);
            await mockFood(page);

            await page.goto(route(`/foods/${FOOD_ID}`));
            await expect(page.getByRole('heading', { name: 'E2E Oat milk' })).toBeVisible();

            const boxes = await Promise.all(
                ['Ask to make public', 'Edit', 'Withdraw'].map((name) =>
                    page.getByRole('button', { name, exact: true }).boundingBox(),
                ),
            );
            const widths = boxes.map((box) => Math.round(box?.width ?? 0));

            expect(widths[0]).toBeGreaterThan(300);
            expect(widths[1]).toBe(widths[0]);
            expect(widths[2]).toBe(widths[0]);
        });
    }
});
