import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The signed-in top bar's GEOMETRY, measured in a real browser (US-000 / FR-046).
 *
 * ## Why this spec exists — a jsdom test could not have caught the defect it is named after
 *
 * The avatar once painted at **64px** inside a **56px** bar, bursting out of its own chrome, while the
 * component suite stayed green. That suite asserted pixels too — but jsdom computes no layout, so it
 * RE-IMPLEMENTED the CSS box model in JavaScript (`STEP_PX = 4`, `max(min-size, size)`) and then checked
 * the code against its own model. The model was wrong in exactly the way production was: the design system
 * had emitted its own ramp into Tailwind's `--spacing-*` namespace, so `size-8` resolved to 4rem/64px while
 * `h-14` still resolved through the default base. A simulator can only ever confirm its own assumptions, so
 * it is guaranteed to miss the NEXT theme-level defect too — which is why the simulation was deleted rather
 * than corrected once `themeCss` freed the namespace (commit 21932fd2).
 *
 * Everything here is a REAL `boundingBox()` from a real engine with the real stylesheet. The component suite
 * keeps what jsdom is actually authoritative about: structure, roles, accessible names, and class strings.
 *
 * ## Bounded ranges, never bare floors
 *
 * Every box is asserted between a minimum AND a maximum. A `>= 44` touch-target assertion is satisfied by
 * every inflation — 44, 64, 200 — so a suite full of floors measured the real browser and still let a 2×
 * sizing error through. Where the design fixes a size (the 32px disc, the 56px bar, the 40px desktop icon
 * control), the maximum is as meaningful as the minimum, so both are asserted.
 *
 * And the containment the old test claimed to check but could not: the painted disc must sit wholly INSIDE
 * the bar, with breathing room above and below. That is a relationship between two laid-out boxes; jsdom has
 * neither.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** `h-14` — the sticky bar's fixed height. */
const BAR_HEIGHT_PX = 56;

/** `size-8` — the mockup's painted avatar disc (`screen-home`), and the same 32px the native leaf paints. */
const DISC_PX = 32;

/** `min-h-11` / `min-w-11` — the mobile touch-target floor, released at `md:`. */
const TOUCH_FLOOR_PX = 44;

/** `p-2` + a `size-6` glyph — the mockup's icon-button density, which `md:` restores. */
const ICON_CONTROL_PX = 40;

/** Sub-pixel slack for fractional layout; large enough for rounding, far too small to hide an inflation. */
const SLACK_PX = 1;

/** The minimum bar left above AND below the disc (56 − 32 = 24, i.e. 12 each side). */
const MIN_BREATHING_PX = 8;

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * A locator's real layout box.
 *
 * @param locator - The element to measure.
 * @param what - Human-readable name, for the failure message.
 * @returns Its bounding box.
 * @throws Error When the element has no layout box (not rendered / display:none).
 */
async function boxOf(locator: Locator, what: string): Promise<Box> {
    const box = await locator.boundingBox();

    if (box === null) {
        throw new Error(`${what} has no layout box — it is not rendered`);
    }

    return box;
}

/**
 * Assert a measured length sits within an inclusive range.
 *
 * @param actual - The measured px.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @param what - Human-readable name, for the failure message.
 */
function expectPxWithin(actual: number, min: number, max: number, what: string): void {
    expect(actual, `${what} should be within [${min}, ${max}]px but was ${actual}px`).toBeGreaterThanOrEqual(min);
    expect(actual, `${what} should be within [${min}, ${max}]px but was ${actual}px`).toBeLessThanOrEqual(max);
}

/** Sign in and land on a Home whose widgets read from an intercepted (empty) recipe API. */
async function landOnHome(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, tier: 'free', recipes: [] });
    await page.goto(route('/'));
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
}

/**
 * The bar, the account control, and the element that PAINTS the avatar disc.
 *
 * The disc is presentational — correctly absent from the accessibility tree, since the control it sits in
 * already carries the accessible name — so it is reached structurally from the role-anchored control. That
 * is deliberate: adding a test id to make it selectable would put a test-only attribute on production chrome
 * for something the role query already unambiguously scopes.
 *
 * @param page - The page under test.
 * @returns Locators for the banner, the account link, and the painted disc.
 */
function topBarParts(page: Page): { bar: Locator; control: Locator; disc: Locator } {
    const bar = page.getByRole('banner');
    // 'Account' when the viewer has a display name, 'Your account' when they do not — both are this control.
    const control = bar.getByRole('link', { name: /account/iu });

    return { bar, control, disc: control.locator('span').first() };
}

/**
 * Assert the painted disc is the design's 32px circle and sits wholly inside the bar.
 *
 * This is the assertion the deleted jsdom suite described and could not perform: containment is a
 * relationship between two laid-out boxes, and the 64px regression was precisely a disc taller than the bar
 * that contained it.
 *
 * @param page - The page under test.
 */
async function expectDiscPaintedInsideTheBar(page: Page): Promise<void> {
    const { bar, disc } = topBarParts(page);
    const barBox = await boxOf(bar, 'the top bar');
    const discBox = await boxOf(disc, 'the painted avatar disc');

    expectPxWithin(barBox.height, BAR_HEIGHT_PX - SLACK_PX, BAR_HEIGHT_PX + SLACK_PX, 'the h-14 top bar height');

    // Bounded on BOTH sides: 44 (the touch floor leaking onto the painted box) and 64 (the `--spacing-*`
    // namespace regression) are the two ways this has actually broken, and a floor-only assertion misses both.
    expectPxWithin(discBox.height, DISC_PX - SLACK_PX, DISC_PX + SLACK_PX, 'the painted disc height');
    expectPxWithin(discBox.width, DISC_PX - SLACK_PX, DISC_PX + SLACK_PX, 'the painted disc width');
    // A circle, not a pill: flooring one axis only yields a 32×44 ellipse under `rounded-full`.
    expect(Math.abs(discBox.width - discBox.height), 'the disc must be square').toBeLessThanOrEqual(SLACK_PX);

    // Fully inside the bar, top and bottom.
    expect(discBox.y, 'the disc must not sit above the bar').toBeGreaterThanOrEqual(barBox.y - SLACK_PX);
    expect(discBox.y + discBox.height, 'the disc must not overflow the bottom of the bar').toBeLessThanOrEqual(
        barBox.y + barBox.height + SLACK_PX,
    );

    // …with room to breathe. A disc that merely fits still reads as bursting out of its chrome.
    expect(discBox.y - barBox.y, 'clearance above the disc').toBeGreaterThanOrEqual(MIN_BREATHING_PX);
    expect(barBox.y + barBox.height - (discBox.y + discBox.height), 'clearance below the disc').toBeGreaterThanOrEqual(
        MIN_BREATHING_PX,
    );
}

test.describe('Home top bar geometry — 375px phone', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('paints a 32px disc wholly inside the 56px bar', async ({ page }) => {
        await landOnHome(page);

        await expectDiscPaintedInsideTheBar(page);
    });

    test('keeps the 44px touch target on the CONTROL while the disc stays 32px', async ({ page }) => {
        await landOnHome(page);

        const { bar, control, disc } = topBarParts(page);
        const controlBox = await boxOf(control, 'the account control');
        const discBox = await boxOf(disc, 'the painted avatar disc');
        const barBox = await boxOf(bar, 'the top bar');

        // Separating paint from hit area must not cost the tap target — and must not inflate it either: the
        // control is exactly the 44px floor, so an upper bound catches a floor that grew with the theme.
        expectPxWithin(
            controlBox.height,
            TOUCH_FLOOR_PX,
            TOUCH_FLOOR_PX + SLACK_PX,
            'the account control height at 375px',
        );
        expectPxWithin(
            controlBox.width,
            TOUCH_FLOOR_PX,
            TOUCH_FLOOR_PX + SLACK_PX,
            'the account control width at 375px',
        );

        // The hit area is genuinely LARGER than the paint — that is the whole point of the split.
        expect(controlBox.height, 'the control must be larger than the disc it wraps').toBeGreaterThan(discBox.height);

        // Even the enlarged control stays inside the bar.
        expect(controlBox.y).toBeGreaterThanOrEqual(barBox.y - SLACK_PX);
        expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(barBox.y + barBox.height + SLACK_PX);
    });

    test('floors the icon controls to 44px without letting them outgrow the bar', async ({ page }) => {
        await landOnHome(page);

        const bar = page.getByRole('banner');
        const barBox = await boxOf(bar, 'the top bar');

        for (const name of ['Open navigation', 'Search', 'Notifications']) {
            const control = bar.getByRole('button', { name });
            const box = await boxOf(control, `the ${name} control`);

            expectPxWithin(box.height, TOUCH_FLOOR_PX, TOUCH_FLOOR_PX + SLACK_PX, `the ${name} control height`);
            expectPxWithin(box.width, TOUCH_FLOOR_PX, TOUCH_FLOOR_PX + SLACK_PX, `the ${name} control width`);
            expect(box.y, `${name} must not overflow the top of the bar`).toBeGreaterThanOrEqual(barBox.y - SLACK_PX);
            expect(box.y + box.height, `${name} must not overflow the bottom of the bar`).toBeLessThanOrEqual(
                barBox.y + barBox.height + SLACK_PX,
            );
        }
    });
});

test.describe('Home top bar geometry — 1280px desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('paints the same 32px disc wholly inside the 56px bar', async ({ page }) => {
        await landOnHome(page);

        await expectDiscPaintedInsideTheBar(page);
    });

    test('releases the mobile touch floor at md+ without changing the paint', async ({ page }) => {
        await landOnHome(page);

        const { control, disc } = topBarParts(page);
        const controlBox = await boxOf(control, 'the account control');
        const discBox = await boxOf(disc, 'the painted avatar disc');

        // `md:min-h-0 md:min-w-0` collapses the account control onto the disc it wraps: desktop density is
        // the mockup's, not the phone's. Bounded above by the icon-button box so a floor that failed to
        // reset (44px) fails here.
        expectPxWithin(
            controlBox.height,
            discBox.height - SLACK_PX,
            ICON_CONTROL_PX,
            'the account control height at 1280px',
        );

        // The icon buttons return to the mockup's 40px (`p-2` + a 24px glyph) — the exact value the touch
        // floor overrides on a phone. Asserted as a range so 44px (floor not reset) and 48px (an inflated
        // spacing ramp) both fail.
        for (const name of ['Search', 'Notifications']) {
            const box = await boxOf(page.getByRole('banner').getByRole('button', { name }), `the ${name} control`);

            expectPxWithin(
                box.height,
                ICON_CONTROL_PX - SLACK_PX,
                ICON_CONTROL_PX + SLACK_PX,
                `the ${name} control height at 1280px`,
            );
            expectPxWithin(
                box.width,
                ICON_CONTROL_PX - SLACK_PX,
                ICON_CONTROL_PX + SLACK_PX,
                `the ${name} control width at 1280px`,
            );
        }
    });
});
