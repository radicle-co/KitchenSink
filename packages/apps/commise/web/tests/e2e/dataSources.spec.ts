import { expect, test } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { mockRecipeApi } from './utils/recipeApi';

/**
 * Curated plan R55 (U25), through the real web app: a signed-in cook opens the Data sources page from Profile, at
 * `/{locale}/legal/sources`, and finds USDA and Ciqual with their licence links. The food-service read
 * (`GET /api/v1/foods/sources`) and the shell's reads (`mockRecipeApi`, which also files this spec in the mocked
 * tier) are intercepted, so this proves the page's wiring and states in a real browser, never a deploy.
 *
 * The page reads food-service from the browser (plan 002 S5, `NEXT_PUBLIC_FOOD_API_URL`), so the interception sees
 * the read. Selectors are role and label only.
 */

/** Two sources as the endpoint sends them: USDA unconverted, Ciqual converted, with a French credit. */
const SOURCES = {
    sources: [
        {
            id: 'usda',
            shortName: 'USDA',
            name: 'FoodData Central',
            publisher: 'U.S. Department of Agriculture, Agricultural Research Service',
            edition: 'SR Legacy 2018-04, Foundation 2026-04-30, FNDDS 2021-2023, Branded 2026-04-30',
            licenceName: 'CC0 1.0 Universal',
            licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
            attribution:
                'U.S. Department of Agriculture, Agricultural Research Service, Beltsville Human Nutrition Research Center. FoodData Central.',
            attributionLanguage: 'en',
            homepage: 'https://fdc.nal.usda.gov/',
            converted: false,
        },
        {
            id: 'ciqual',
            shortName: 'Ciqual',
            name: 'Ciqual French food composition table',
            publisher: 'Anses',
            edition: '2025',
            licenceName: 'Licence Ouverte / Open Licence 2.0',
            licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
            attribution: 'Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.',
            attributionLanguage: 'fr',
            homepage: 'https://ciqual.anses.fr/',
            converted: true,
        },
    ],
};

test.describe('the Data sources page (curated plan R55)', () => {
    test('Profile opens it, and it lists USDA and Ciqual with their licence links', async ({ page }) => {
        await signInWithTicket(page);
        // The shell's identity and recipe reads; the food route below is registered later, so it wins.
        await mockRecipeApi(page);
        await page.route('**/api/v1/foods/sources', (request) => request.fulfill({ json: SOURCES }));

        await page.goto(route('/profile'));
        await page.getByRole('link', { name: /Food data sources/ }).click();

        await expect(page).toHaveURL(/\/legal\/sources$/u);
        await expect(page.getByRole('heading', { level: 1, name: 'Data sources' })).toBeVisible();

        // §9.2: each card is headed by its PUBLISHER.
        const usda = page.getByRole('region', {
            name: 'U.S. Department of Agriculture, Agricultural Research Service',
        });
        await expect(
            usda.getByRole('link', { name: 'CC0 1.0 Universal, license for USDA (opens in a new tab)' }),
        ).toHaveAttribute('href', 'https://creativecommons.org/publicdomain/zero/1.0/');
        await expect(usda).not.toContainText('We converted some of its values');

        const ciqual = page.getByRole('region', { name: 'Anses' });
        await expect(
            ciqual.getByRole('link', {
                name: 'Licence Ouverte / Open Licence 2.0, license for Ciqual (opens in a new tab)',
            }),
        ).toHaveAttribute('href', 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/');
        await expect(ciqual).toContainText('Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.');
        await expect(ciqual).toContainText('We converted some of its values to the units this app uses.');
    });

    test('at 320 px the page never scrolls sideways, even for a source named in one long word', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await signInWithTicket(page);
        // The shell's identity and recipe reads; the food route below is registered later, so it wins.
        await mockRecipeApi(page);
        const longWord = {
            ...SOURCES.sources[1],
            id: 'livsmedelsverket',
            shortName: 'Livsmedelsdatabasen',
            name: 'Bundeslebensmittelschlüssel Livsmedelsdatabasen Matvaretabellen',
        };
        await page.route('**/api/v1/foods/sources', (request) =>
            request.fulfill({ json: { sources: [SOURCES.sources[0], longWord] } }),
        );

        await page.goto(route('/legal/sources'));
        await expect(page.getByRole('region', { name: 'Anses' })).toBeVisible();

        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });

    test('a failed read offers Try again, which reads again', async ({ page }) => {
        await signInWithTicket(page);
        // The shell's identity and recipe reads; the food route below is registered later, so it wins.
        await mockRecipeApi(page);
        // Every read fails until Try again is pressed: the food read retries a 5xx on its own
        // (`shouldRetryFoodServiceFailure`), so failing only the first request would never reach the error state.
        let failing = true;
        await page.route('**/api/v1/foods/sources', (request) =>
            failing ? request.fulfill({ status: 503 }) : request.fulfill({ json: SOURCES }),
        );

        await page.goto(route('/legal/sources'));
        const main = page.getByRole('main');

        await expect(main.getByRole('alert')).toContainText('We couldn’t load the data sources.', { timeout: 15_000 });

        failing = false;
        await main.getByRole('button', { name: 'Try again' }).click();

        await expect(
            main.getByRole('region', { name: 'U.S. Department of Agriculture, Agricultural Research Service' }),
        ).toBeVisible();
    });

    test('Try again keeps focus while it reads again, a second failure is announced again, and success focuses the heading', async ({
        page,
    }) => {
        // WCAG 2.2 SC 2.4.3 and 4.1.3 (`docs/design/readSurfacesEvaluation.md` D3, design §S16 "States": "Focus stays
        // where it is, and the alert announces itself"). A 404 is not retried by the read, so each attempt settles at
        // once; the retried request is held, so the in-flight state can be observed.
        await signInWithTicket(page);
        // The shell's identity and recipe reads; the food route below is registered later, so it wins.
        await mockRecipeApi(page);
        let attempts = 0;
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route('**/api/v1/foods/sources', async (request) => {
            attempts += 1;

            if (attempts === 2) {
                await held;
            }

            await request.fulfill({ status: 404 });
        });

        await page.goto(route('/legal/sources'));
        const main = page.getByRole('main');
        const tryAgain = main.getByRole('button', { name: 'Try again' });

        await expect(main.getByRole('alert')).toContainText('We couldn’t load the data sources.');
        const firstAlert = await main.getByRole('alert').elementHandle();

        await tryAgain.focus();
        await page.keyboard.press('Enter');

        // In flight: the same control, still focused, marked busy.
        await expect(tryAgain).toHaveAttribute('aria-busy', 'true');
        await expect(tryAgain).toBeFocused();

        release();

        // Settled as a failure again: focus never left Try again, and the alert is a new node, which is what makes a
        // screen reader speak the same words a second time.
        await expect(tryAgain).not.toHaveAttribute('aria-busy', 'true');
        await expect(tryAgain).toBeFocused();
        await expect(main.getByRole('alert')).toContainText('We couldn’t load the data sources.');
        expect(await firstAlert?.evaluate((node) => node.isConnected)).toBe(false);

        // A retry that succeeds takes Try again away; focus goes to the page's heading, not to the page.
        await page.unroute('**/api/v1/foods/sources');
        await page.route('**/api/v1/foods/sources', (request) => request.fulfill({ json: SOURCES }));
        await page.keyboard.press('Enter');

        await expect(
            main.getByRole('region', { name: 'U.S. Department of Agriculture, Agricultural Research Service' }),
        ).toBeVisible();
        await expect(main.getByRole('heading', { level: 1, name: 'Data sources' })).toBeFocused();
    });
});
