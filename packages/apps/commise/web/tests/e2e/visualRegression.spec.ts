import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import {
    ARGOS_SCREENSHOT_DIR,
    DESKTOP_VIEWPORT,
    PHONE_VIEWPORT,
    VISUAL_CONTEXT,
    VISUAL_LAUNCH,
    assertBrandWebfonts,
    captureStable,
    prepareVisualPage,
    settleHomeWidgets,
} from './utils/visualCapture';

/**
 * U10a half 1 — the web app's VISUAL-REGRESSION baselines, captured here and compared by **Argos CI**.
 *
 * ## How the split with Argos works, and why the SDK is not imported
 *
 * This spec's job is to produce a small set of deterministic PNGs under `screenshots/`. Argos's own
 * comparison happens off-box: CI runs `npx @argos-ci/cli upload packages/apps/commise/web/screenshots`, which
 * authenticates with **GitHub OIDC / tokenless** (no `ARGOS_TOKEN` secret, so a FORK pull request — which
 * cannot read repository secrets — still uploads), and Argos diffs each file against the baseline for the
 * target branch, keyed on the FILE NAME. That is Argos's documented "any test framework" integration, and it
 * is the right seam here: the spec stays runnable, debuggable and meaningful with no network and no account,
 * and nothing in the test tree needs a dependency it cannot resolve offline.
 *
 * ## What is asserted LOCALLY, and why that is not redundant with Argos
 *
 * A spec that only writes a PNG can never go red, so it would prove nothing until someone looks at a
 * dashboard. Every capture here is therefore gated on the PRECONDITIONS that make its baseline meaningful,
 * each of which is a real defect if broken:
 *
 *  - **The brand webfonts actually loaded.** Substituted faces rasterize host fonts, so the baseline would
 *    flap between a WSL2 laptop and a `ubuntu-latest` runner for reasons unrelated to the change under
 *    review. It is also a shipped defect class in this repo: an `@import` moved below another rule in
 *    `globals.css` drops every webfont (Playfair → Georgia, Inter → system-ui) and only a real build shows it.
 *  - **The pinned clock reached the render.** `RecipeCard` renders `formatRelativeTime(recipe.updatedAt,
 *    new Date())`, so an unpinned capture of the library says "Created 31w ago" this week and "32w ago" next
 *    week — a brand-new baseline every seven days. The library capture therefore asserts the exact string the
 *    pinned clock must produce against the fixed fixture timestamp; that assertion is the pin's proof.
 *  - **The capture is not blank.** A zero-height or all-white PNG uploads and diffs perfectly happily.
 *
 * ## Home's greeting was MASKED here, and is now PINNED (#144)
 *
 * It used to be the one thing this suite could not pin. `HomeGreeting` computed its bucket during the
 * **server** render and carried `suppressHydrationWarning` — which only silences the mismatch warning; React
 * keeps the server-rendered text — so the two lines showed the Next server's clock and zone, and `page.clock`
 * (browser-side) could not reach them. Both were therefore painted over with a mask.
 *
 * The client clock is now the authority (the SSR pass commits to no bucket and reserves an `aria-hidden`
 * placeholder until hydration), so the pin DOES reach the render and the mask is gone: the Home capture asserts
 * {@link PINNED_GREETING} and {@link PINNED_GREETING_DATE} — the exact strings `VISUAL_CLOCK_ISO` +
 * `VISUAL_TIMEZONE` must produce — before photographing them. That is a stronger guarantee than the mask it
 * replaces, and of the same kind as the card-footer assertion above: it is the greeting's proof that the pinned
 * clock reached the render. Reintroduce the server-clock read and this capture goes red rather than quietly
 * baselining whatever the runner's wall clock said.
 *
 * The two lines are also now IN the baseline rather than flat grey, so this change moves the
 * `home-widget-surface-desktop` baseline once, on purpose.
 *
 * ## Why THESE four surfaces
 *
 * Deliberately small (Argos's free tier is 5,000 screenshots/month, and every extra baseline is a review
 * cost, not a free win). The set covers the signed-in Home surface, the library at both a desktop and a phone
 * width, and the detail view — one capture per distinct page ARCHETYPE, at the two viewports where this app's
 * layout genuinely diverges. Wizards, empty states and error states are covered by the component tier and by
 * the existing role-based e2e specs, which describe them far better than a bitmap can.
 *
 * ## Why the sign-in front door is NOT baselined here
 *
 * It was, and it was removed on evidence. That surface is almost entirely Clerk's remotely-rendered `<SignIn>`
 * widget, and repeated captures produced **two distinct rasters** (one difference was traced to Clerk's Apple
 * and Google provider logos loading late — fixed by settling the raster in `captureStable` — but a second,
 * unexplained variant appeared once in nine captures and could not be reproduced). An intermittently-flapping
 * baseline is worse than no baseline: it trains a reviewer to click "approve" on diffs, which is exactly how a
 * real regression walks through. The front door is not left uncovered — `authPages.spec.ts` and
 * `routeProtection.spec.ts` assert it by role, and `mockupFidelity.spec.ts` still photographs it for review
 * (an artifact with no baseline cannot flake). Reinstate it here only with a stable, narrowly-scoped mask over
 * the third-party widget, proven over consecutive runs.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** The seeded recipe, titled as the wireframes title it so the two passes photograph the same words. */
const RECIPE_ID = 'rec_lamb';
const RECIPE_TITLE = 'Mediterranean Grilled Lamb';

/**
 * The card footer the pinned clock must produce: the fixture's `createdAt` is 2026-01-01 and the pin is
 * 2026-05-31T15:30Z, i.e. 150.6 days → `Math.floor(150.6 / 7)` = 21 whole weeks (`formatRelativeTime` caps its
 * buckets at weeks and floors them). Against the real clock this reads a different number of weeks every seven
 * days, which is exactly the drift that would make a library baseline worthless.
 */
const PINNED_CARD_TIMESTAMP = 'Created 21w ago';

/**
 * The greeting the pinned clock must produce, read from the VIEWER's clock (#144).
 *
 * `VISUAL_CLOCK_ISO` is 15:30 in `VISUAL_TIMEZONE`, which `greetingBucketForHour` buckets as `afternoon` (its
 * boundaries are 05/12/17/22). Exact strings, not the four-bucket alternation this used to mask: a regex that
 * accepts every bucket cannot tell "the client clock decided" from "some clock decided", which is the whole
 * distinction #144 turned on.
 */
const PINNED_GREETING = 'Good afternoon, Chef!';

/**
 * The date subtitle the same pin must produce. 2026-05-31 is a SUNDAY — the wireframe's "Saturday" is fictional
 * copy, and `formatHomeDate` renders the real weekday.
 */
const PINNED_GREETING_DATE = 'Sunday, May 31, 2026';

/** A capture must be more than a trivially small PNG; a blank page still encodes to a valid image. */
const MIN_PNG_BYTES = 5_000;

/**
 * Sign in and seed the intercepted recipe API with one deterministic recipe.
 *
 * @param page - The page to authenticate and intercept.
 * @sideEffect Mints a Clerk sign-in ticket, navigates, and installs route handlers.
 */
async function signInAndSeed(page: Page): Promise<void> {
    await signInWithTicket(page);

    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: RECIPE_TITLE,
                description: 'Marinated lamb with charred vegetables and a herb yoghurt.',
                totalTimeMinutes: 45,
            }),
        ],
    });
}

/**
 * Capture a surface and assert the PNG carries real content.
 *
 * Takes no mask: every region in this suite's four captures is now ours and pinnable (#144 retired the last
 * one). `captureStable` still exposes `mask` — it is the documented seam for reinstating the sign-in baseline
 * over Clerk's remotely-rendered widget — but nothing here needs it.
 *
 * @param page - A settled page.
 * @param name - The Argos screenshot name (also the file name, which is Argos's comparison key).
 * @sideEffect Screenshots the page and writes the file.
 */
async function captureBaseline(page: Page, name: string): Promise<void> {
    const png = await captureStable(page, { path: `${ARGOS_SCREENSHOT_DIR}/web/${name}.png` });

    expect(
        png.byteLength,
        `${name} captured only ${png.byteLength} bytes — the surface is probably blank`,
    ).toBeGreaterThan(MIN_PNG_BYTES);
}

// Browser-level, so it MUST sit at the file top level: Playwright rejects `launchOptions` inside a
// `test.describe` because it is worker-scoped. These are the rasterization-determinism flags.
test.use(VISUAL_LAUNCH);

test.describe('Argos visual-regression baselines — desktop', () => {
    test.use({ ...VISUAL_CONTEXT, viewport: DESKTOP_VIEWPORT });

    test('the signed-in Home widget surface (US-000, FR-046)', async ({ page }) => {
        await prepareVisualPage(page);
        await signInAndSeed(page);
        await page.goto(route('/'));

        await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
        await settleHomeWidgets(page, RECIPE_TITLE);
        await assertBrandWebfonts(page);

        // #144 — the pinned BROWSER clock reached the greeting, which is the proof that the viewer's clock (not
        // the Next server's) decides it: `page.clock` cannot reach the server, so a server-computed bucket
        // could not match these strings except by the runner's coincidence. Exactly one node each, so a
        // duplicated greeting (SSR text left beside the hydrated one) also fails here. `exact` on both, because
        // Playwright's default name/text matching is case-insensitive SUBSTRING — which would accept a greeting
        // that merely contains the pinned one.
        await expect(page.getByRole('heading', { level: 2, name: PINNED_GREETING, exact: true })).toHaveCount(1);
        await expect(page.getByText(PINNED_GREETING_DATE, { exact: true })).toHaveCount(1);

        await captureBaseline(page, 'home-widget-surface-desktop');
    });

    test('the recipe library (FR-006, FR-001c, FR-003a, FR-013a)', async ({ page }) => {
        await prepareVisualPage(page);
        await signInAndSeed(page);
        await page.goto(route('/recipes'));

        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await expect(page.getByRole('button', { name: RECIPE_TITLE })).toBeVisible();
        // The pinned clock reached CLIENT-rendered content: the card footer is computed in the browser from
        // `new Date()` against the fixture's fixed `createdAt`. Unpinned this drifts by one week every week.
        await expect(page.getByText(PINNED_CARD_TIMESTAMP)).toBeVisible();
        await assertBrandWebfonts(page);

        await captureBaseline(page, 'recipe-library-desktop');
    });

    test('the recipe detail view (FR-001b, FR-013, FR-013a)', async ({ page }) => {
        await prepareVisualPage(page);
        await signInAndSeed(page);
        await page.goto(route(`/recipes/${RECIPE_ID}`));

        await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();
        await assertBrandWebfonts(page);

        await captureBaseline(page, 'recipe-detail-desktop');
    });
});

test.describe('Argos visual-regression baselines — phone (FR-044 parity)', () => {
    test.use({ ...VISUAL_CONTEXT, viewport: PHONE_VIEWPORT });

    test('the recipe library at a phone width, with the bottom tab bar', async ({ page }) => {
        await prepareVisualPage(page);
        await signInAndSeed(page);
        await page.goto(route('/recipes'));

        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        // At 390px the desktop sidebar is `display:none`, so the only visible "Main" nav is the bottom tab
        // bar — the phone-specific chrome this baseline exists to hold.
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
        await assertBrandWebfonts(page);

        await captureBaseline(page, 'recipe-library-phone');
    });
});
