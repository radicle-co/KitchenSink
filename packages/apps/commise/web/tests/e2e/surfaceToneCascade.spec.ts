import { expect, test } from '@playwright/test';

import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import {
    canonicalHex,
    expectedFor,
    mountFixtures,
    NAMES,
    readFocusGap,
    readPressFill,
    rgb,
    unmountFixtures,
    type Scheme,
} from './utils/surfaceToneCascade';
import { SURFACE_TONE_NAMES } from '@commise/ui/surface-tone';

/**
 * THE SURFACE TONE, IN A REAL BROWSER (`docs/design/uiRefreshWorkshop5/redesignCanvas/componentFixes.md` §10, §10a).
 *
 * A surface states itself once as inheriting custom properties; a control reads them. Whether that works is a CASCADE
 * question (`@property` would silently stop inheritance; a missing fallback paints the page's colour on a sheet), and
 * only a browser answers it: jsdom has no stylesheet. So this injects, into a page that loads the app's real stylesheet,
 * fixtures built from the very class literals the apps ship, and reads what the browser computes:
 *
 *  - after KEYBOARD focus, the focus-ring gap (`--tw-ring-offset-color`, and the offset band in `box-shadow`) is the fill
 *    of the surface the control sits on;
 *  - while the mouse HOLDS the control down (`:hover` and `:active`), its background is that surface's press fill;
 *  - a control outside every surface reads the canvas row; the innermost surface wins; a container that states nothing
 *    hands its parent's tone down; and a popup root at `<body>` states its own tone, whatever opened it.
 *
 * Both themes, through `colorScheme`. The expected colours come from the token table and the derivation the apps read.
 * This spec stubs the recipe API (`mockRecipeApi`) so it runs in the stubbed-API tier and is dropped from a deployed run.
 */
const SCHEMES: readonly Scheme[] = ['light', 'dark'];

for (const scheme of SCHEMES) {
    test.describe(`the surface tone cascade, ${scheme} theme`, () => {
        test.use({ colorScheme: scheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [] });
            await page.goto(route('/recipes'));
            await mountFixtures(page);
        });

        test.afterEach(async ({ page }) => {
            await unmountFixtures(page);
        });

        test('a control outside every surface rings in the canvas and presses to the canvas row', async ({ page }) => {
            const control = page.getByRole('button', { name: NAMES.bare });
            const { gap, press } = expectedFor(scheme, 'canvas');
            const focus = await readFocusGap(page, control);

            expect(focus.focusVisible, 'keyboard focus matches :focus-visible').toBe(true);
            expect(focus.offsetColor).toBe(canonicalHex(gap));
            expect(await readPressFill(page, control)).toBe(rgb(press));
        });

        for (const tone of SURFACE_TONE_NAMES) {
            test(`a control on ${tone} rings in ${tone}'s fill and presses to ${tone}'s row`, async ({ page }) => {
                const control = page.getByRole('button', { name: NAMES.tone(tone) });
                const { gap, press } = expectedFor(scheme, tone);
                const focus = await readFocusGap(page, control);

                expect(focus.focusVisible, 'keyboard focus matches :focus-visible').toBe(true);
                expect(focus.offsetColor).toBe(canonicalHex(gap));
                // The band the browser paints between the control and its ring: 2px, in the surface's colour.
                expect(focus.boxShadow).toContain(`${rgb(gap)} 0px 0px 0px 2px`);
                expect(await readPressFill(page, control)).toBe(rgb(press));
            });
        }

        test('the innermost surface wins, and a container that states nothing inherits its parent’s tone', async ({
            page,
        }) => {
            const nested = page.getByRole('button', { name: NAMES.nestedInner });
            const after = page.getByRole('button', { name: NAMES.nestedOuter });
            const inherits = page.getByRole('button', { name: NAMES.inherits });

            expect((await readFocusGap(page, nested)).offsetColor).toBe(canonicalHex(expectedFor(scheme, 'muted').gap));
            expect(await readPressFill(page, nested)).toBe(rgb(expectedFor(scheme, 'muted').press));

            expect((await readFocusGap(page, after)).offsetColor).toBe(canonicalHex(expectedFor(scheme, 'paper').gap));
            expect(await readPressFill(page, after)).toBe(rgb(expectedFor(scheme, 'paper').press));

            expect((await readFocusGap(page, inherits)).offsetColor).toBe(
                canonicalHex(expectedFor(scheme, 'paper').gap),
            );
            expect(await readPressFill(page, inherits)).toBe(rgb(expectedFor(scheme, 'paper').press));
        });

        test('a popup root at <body> states its own tone: it reads paperOverlay, not what opened it', async ({
            page,
        }) => {
            const control = page.getByRole('button', { name: NAMES.portal });
            const { gap, press } = expectedFor(scheme, 'paperOverlay');

            expect((await readFocusGap(page, control)).offsetColor).toBe(canonicalHex(gap));
            expect(await readPressFill(page, control)).toBe(rgb(press));
            expect(gap).not.toBe(expectedFor(scheme, 'muted').gap);
        });
    });
}
