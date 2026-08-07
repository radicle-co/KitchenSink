import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { palette, semantic } from '@commise/ui/colors';
import { elevation, fontFamily, fontSize, fontWeight, lineHeightRatio, radius, spacing } from '@commise/ui/scale';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import {
    buildFidelityReport,
    renderFidelityHtml,
    tokenRgbStrings,
    type AnchorInput,
    type FidelityPairInput,
    type UnpairedScreen,
} from './utils/mockupFidelity.js';
import {
    DESKTOP_VIEWPORT,
    FIDELITY_OUTPUT_DIR,
    MOCKUP_SCREENS_DIR,
    VISUAL_CLOCK_ISO,
    VISUAL_CONTEXT,
    VISUAL_LAUNCH,
    VISUAL_LOCALE,
    VISUAL_TIMEZONE,
    captureStable,
    openMockup,
    prepareVisualPage,
    probeAnchor,
    probeDocumentSurface,
    settleHomeWidgets,
} from './utils/visualCapture';

/**
 * U10a half 2 — **mockup fidelity**, built rather than bought: photograph each archived wireframe and the live
 * route it specifies **in the same browser, at the same viewport, under the same pinned clock and locale**, and
 * emit the pair plus a structured record of what the two documents actually computed.
 *
 * ## Why the output is an image PAIR and a table of numbers, not a diff score
 *
 * A pixel-diff answers "how many pixels moved", which is not a question anyone has. 3% could be a font
 * fallback shrugging or the whole palette regressing, and no threshold separates them — which is why this pass
 * has no threshold. What it emits instead is reviewable by a human or an LLM: the two images side by side, the
 * `@commise/ui` token scale, and, per anchor, exactly which computed properties differ and by how much. "The
 * wireframe's page heading is 36px Playfair and the implementation's is 30px, and the scale says
 * `typography.display.lg` is 36px" is a sentence a reviewer can act on. "0.031" is not.
 *
 * Token/contrast PARITY at the value level is already owned by `tests/mockupContrast.test.ts`; this pass never
 * re-asserts it. It asserts what only a real engine can see — that the implementation PAINTS the tokens — and
 * reports everything comparative.
 *
 * ## Requirement traceability is mandatory, not decorative
 *
 * Every pair names the `FR-*` ids its surface implements, and {@link buildFidelityReport} throws on a pair that
 * names none. A fidelity complaint that cannot be traced to a requirement is a matter of taste, and tastes are
 * not build artifacts. Where the owning requirement lives in a different spec (the profile surface is
 * `002-user-auth`'s), the id is prefixed with that spec.
 *
 * ## Known asymmetries, stated so a reviewer is not misled by the images
 *
 *  1. **The wireframes render with NO webfonts.** Their Google-Fonts `@import`s sit below other rules and CSS
 *     drops them (measured: zero network requests, an empty `document.fonts`). So their headings fall back to
 *     a host serif while the app renders real Playfair Display. Read the typeface from the `fontFamily` delta,
 *     never from the raster.
 *  2. **`screen-profile.html` is one page; the app splits it across three routes** (`/profile` views,
 *     `/account` edits + closes, `/settings` holds security). This pass pairs it with `/profile`, the surface
 *     `002-user-auth` FR-018 describes; the wireframe's Notifications and Subscription sections have no
 *     implementation anywhere and surface as `mockup-only` anchors.
 *  3. **Four wireframes have no implementation at all** — cooking, meal plan, grocery, nutrition. They are
 *     recorded as `unpaired` against the spec that owns each, so the gap is traceable scope rather than a
 *     fidelity defect, and {@link test} below fails if a NEW wireframe is added to the archive without being
 *     classified either way.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** The seeded recipe, titled as `screen-recipe-detail.html` titles it so the two sides carry the same words. */
const RECIPE_ID = 'rec_lamb';
const RECIPE_TITLE = 'Mediterranean Grilled Lamb';

/** Home's greeting heading, on either document — the wireframe's is `afternoon`, the app's is server-derived. */
const GREETING_HEADING = /^(Good (morning|afternoon|evening), Chef!|Still up, Chef\?)$/;

/** A captured surface must carry real content; a blank page still encodes to a valid PNG. */
const MIN_PNG_BYTES = 5_000;

/** The wireframes with no implementation, and the spec that owns each unbuilt surface. */
const UNPAIRED: readonly UnpairedScreen[] = [
    { mockupFile: 'screen-cooking.html', owningSpec: '008-cooking-mode' },
    { mockupFile: 'screen-grocery.html', owningSpec: '007-grocery-lists' },
    { mockupFile: 'screen-mealplan.html', owningSpec: '006-meal-planning' },
    { mockupFile: 'screen-nutrition.html', owningSpec: '009-nutrition-planning' },
];

/** One element to probe on both documents. The two locator recipes may differ — the copy often does. */
interface AnchorSpec {
    readonly anchor: string;
    readonly mockup: (page: Page) => Locator;
    readonly implementation: (page: Page) => Locator;
}

/** A wireframe, the route that implements it, and how to compare them. */
interface PairSpec {
    readonly slug: string;
    readonly mockupFile: string;
    /** App-relative path, run through {@link route} (so it carries the locale segment). */
    readonly route: string;
    readonly requirementIds: readonly string[];
    /** What a reviewer must know before trusting this pair's images; `[]` when there is nothing. */
    readonly caveats: readonly string[];
    /** True when the implementation must be photographed SIGNED OUT (the sign-in front door). */
    readonly signedOut?: boolean;
    /** Resolves once the implementation has rendered enough to photograph. */
    readonly settle: (page: Page) => Promise<void>;
    readonly anchors: readonly AnchorSpec[];
}

const PAIRS: readonly PairSpec[] = [
    {
        slug: 'auth',
        mockupFile: 'screen-auth.html',
        route: '/sign-in',
        // FR-045a is the one that matters here: the wireframe's "Get Started / Already have an account?" hero
        // was DELETED on purpose, so the biggest delta on this pair is a decision, not a defect.
        requirementIds: ['FR-044', 'FR-045', 'FR-045a'],
        signedOut: true,
        caveats: [
            'FR-045a DELETED the wireframe\u2019s branded "Get Started / Already have an account?" hero on ' +
                'purpose, so the largest deltas on this pair are an accepted decision, not drift.',
            'The implementation side is the remotely-rendered Clerk <SignIn> widget, so its internal type ramp ' +
                'and control sizes are Clerk\u2019s, not @commise/ui\u2019s.',
        ],
        settle: async (page) => {
            await expect(page.getByRole('heading', { name: 'Sign in to Commise' })).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
        },
        anchors: [
            {
                anchor: 'brandHeading',
                mockup: (page) => page.getByRole('heading', { name: 'Commise', exact: true }),
                implementation: (page) => page.getByRole('heading', { level: 1 }),
            },
            {
                anchor: 'primaryAction',
                mockup: (page) => page.getByRole('button', { name: 'Get Started' }),
                implementation: (page) => page.getByRole('button', { name: /continue/i }),
            },
            {
                anchor: 'signUpAffordance',
                mockup: (page) => page.getByRole('button', { name: /already have an account/i }),
                implementation: (page) => page.getByRole('link', { name: /sign up/i }),
            },
        ],
    },
    {
        slug: 'home',
        mockupFile: 'screen-home.html',
        route: '/',
        requirementIds: ['FR-044', 'FR-046'],
        caveats: [
            'The greeting and its date line are SERVER-rendered (HomeGreeting carries suppressHydration' +
                'Warning, and React never patches a suppressed text mismatch), so the pinned browser clock ' +
                'cannot reach them and they show the Next server\u2019s clock and zone.',
            'Home v1 implements ONE live widget (recent recipes) by design \u2014 FR-046; the nutrition, ' +
                'meal-plan and resume-cooking slots are deliberate "coming soon" roadmap placeholders.',
        ],
        settle: async (page) => {
            await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
            await settleHomeWidgets(page, RECIPE_TITLE);
        },
        anchors: [
            {
                anchor: 'greeting',
                mockup: (page) => page.getByRole('heading', { level: 2, name: GREETING_HEADING }),
                implementation: (page) => page.getByRole('heading', { level: 2, name: GREETING_HEADING }),
            },
            {
                // Matched case-INSENSITIVELY on both sides on purpose: the wireframe says "Recent Recipes" and
                // the app says "Recent recipes". Matching loosely is what lets the report show that as a TEXT
                // delta instead of hiding it as a missing element.
                anchor: 'recentRecipesHeading',
                mockup: (page) => page.getByRole('heading', { name: /^recent recipes$/i }),
                implementation: (page) => page.getByRole('heading', { name: /^recent recipes$/i }),
            },
            {
                anchor: 'nutritionWidgetHeading',
                mockup: (page) => page.getByRole('heading', { name: /^today.s nutrition$/i }),
                implementation: (page) => page.getByRole('heading', { name: /^today.s nutrition$/i }),
            },
            {
                anchor: 'mealPlanWidgetHeading',
                mockup: (page) => page.getByRole('heading', { name: /^this week.s meals$/i }),
                implementation: (page) => page.getByRole('heading', { name: /^this week.s meals$/i }),
            },
        ],
    },
    {
        slug: 'recipes',
        mockupFile: 'screen-recipes.html',
        route: '/recipes',
        requirementIds: ['FR-001c', 'FR-003a', 'FR-004', 'FR-006', 'FR-013a'],
        caveats: [
            'The wireframe\u2019s quick-filter chip row (All / Recent / Favorites / AI Generated) has no ' +
                'counterpart here: the implementation renders its chip group only when the list resolves ' +
                'available facets, and this hermetic seed resolves none. Not compared rather than mis-compared.',
            'The wireframe\u2019s surface title lives in the TOP BAR as an <h2>; the implementation puts an ' +
                '<h1> in the page content and plain text in the bar, so pageHeading compares two different ' +
                'document-outline roles.',
        ],
        settle: async (page) => {
            await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
            await expect(page.getByRole('button', { name: RECIPE_TITLE })).toBeVisible();
        },
        anchors: [
            {
                anchor: 'pageHeading',
                mockup: (page) => page.getByRole('heading', { name: 'Recipes', exact: true }),
                implementation: (page) => page.getByRole('heading', { name: 'Recipes', exact: true }),
            },
            {
                // `searchbox` matches BOTH (`<input type="search">`), which is the only role-based selector that
                // can: the wireframe's field is labelled by a PLACEHOLDER alone, so `getByLabel` finds nothing
                // on it. That asymmetry is itself the finding — the implementation supplies a real `aria-label`
                // (`Search recipes`) and the wireframe would have shipped a WCAG 3.3.2 violation.
                anchor: 'searchField',
                mockup: (page) => page.getByRole('searchbox'),
                implementation: (page) => page.getByRole('searchbox'),
            },
            {
                // The card's own <h3>, on both sides — NOT the app's card <button>, whose accessible name
                // concatenates every metadata chip ("\u2026 45 min 4 Public Created 21w ago Not yet rated") and
                // would compare a title against a paragraph.
                anchor: 'recipeCardTitle',
                mockup: (page) => page.getByRole('heading', { name: RECIPE_TITLE }),
                implementation: (page) => page.getByRole('button', { name: RECIPE_TITLE }).first().getByRole('heading'),
            },
        ],
    },
    {
        slug: 'recipe-detail',
        mockupFile: 'screen-recipe-detail.html',
        route: `/recipes/${RECIPE_ID}`,
        requirementIds: ['FR-001b', 'FR-005', 'FR-013', 'FR-013a'],
        caveats: [
            'The seed carries no cover photo, so the implementation renders its no-cover hero fallback while ' +
                'the wireframe shows a full-bleed food photograph.',
        ],
        settle: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();
        },
        anchors: [
            {
                // Comparable because the fixture is seeded with the wireframe's own recipe title, so any text
                // delta on this anchor is real drift rather than "the mock used different words".
                anchor: 'recipeTitle',
                mockup: (page) => page.getByRole('heading', { level: 1, name: RECIPE_TITLE }),
                implementation: (page) => page.getByRole('heading', { level: 1, name: RECIPE_TITLE }),
            },
            {
                anchor: 'ingredientsHeading',
                mockup: (page) => page.getByRole('heading', { name: 'Ingredients', exact: true }),
                implementation: (page) => page.getByRole('heading', { name: 'Ingredients', exact: true }),
            },
            {
                anchor: 'instructionsHeading',
                mockup: (page) => page.getByRole('heading', { name: 'Instructions', exact: true }),
                implementation: (page) => page.getByRole('heading', { name: 'Instructions', exact: true }),
            },
            {
                anchor: 'nutritionHeading',
                mockup: (page) => page.getByRole('heading', { name: /^nutrition/i }),
                implementation: (page) => page.getByRole('heading', { name: /^nutrition/i }),
            },
        ],
    },
    {
        slug: 'profile',
        mockupFile: 'screen-profile.html',
        route: '/profile',
        // The profile surface is 002-user-auth's, not 001's — cited with its spec so the trace does not dead-end
        // looking for an FR-018 in `specs/001-commise-recipe-app/spec.md`.
        requirementIds: ['002:FR-018', '002:FR-019', 'FR-013b'],
        caveats: [
            'The implementation side is the DEGRADE state ("We couldn\u2019t load your profile right now"): the ' +
                'identity service is not reachable from this hermetic suite and the profile read happens in ' +
                'SSR, which page.route() cannot intercept. The chrome, background and heading type are still ' +
                'comparable; the field rows are not present to compare.',
            'The wireframe is ONE page; the implementation splits it across /profile (view), /account (edit, ' +
                'close, erase) and /settings (security). Notifications and Subscription & Billing have no ' +
                'implementation on any route.',
        ],
        settle: async (page) => {
            await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
        },
        anchors: [
            {
                anchor: 'pageHeading',
                mockup: (page) => page.getByRole('heading', { level: 1 }),
                implementation: (page) => page.getByRole('heading', { level: 1 }),
            },
            {
                anchor: 'personalInfoHeading',
                mockup: (page) => page.getByRole('heading', { name: /^personal information$/i }),
                implementation: (page) => page.getByRole('heading', { name: /^your information$/i }),
            },
            {
                anchor: 'notificationsHeading',
                mockup: (page) => page.getByRole('heading', { name: /^notifications$/i }),
                implementation: (page) => page.getByRole('heading', { name: /^notifications$/i }),
            },
            {
                anchor: 'subscriptionHeading',
                mockup: (page) => page.getByRole('heading', { name: /^subscription/i }),
                implementation: (page) => page.getByRole('heading', { name: /^subscription/i }),
            },
        ],
    },
];

/**
 * The `@commise/ui` scale the report embeds as the reviewer's frame of reference.
 *
 * Imported from the SOURCE of truth (`tokens/scale.ts`, `tokens/colors.ts`) rather than restated, so the
 * report can never quote a stale ramp — and so a token change moves the report's frame of reference with it.
 * `fontSize`/`spacing`/`radius` are unit-neutral pixels there; the report's own values are the browser's
 * resolved CSS strings, which is the comparison a reviewer wants (16px vs the `4` step, not rem vs rem).
 */
const TOKEN_SCALE = {
    palette,
    semantic,
    spacing,
    radius,
    fontFamily,
    fontSize,
    fontWeight,
    lineHeightRatio,
    elevation,
};

// Browser-level, so it MUST sit at the file top level: Playwright rejects `launchOptions` inside a
// `test.describe` because it is worker-scoped. These are the rasterization-determinism flags.
test.use(VISUAL_LAUNCH);

test.describe('mockup fidelity — wireframe vs implementation (U10a)', () => {
    test.use({ ...VISUAL_CONTEXT, viewport: DESKTOP_VIEWPORT });

    // Five wireframes and five routes in one browser, plus a Clerk sign-in: comfortably past the default
    // budget, and splitting it per pair would trade a coherent artifact for five partial ones.
    test.slow();

    test('captures every wireframe beside its implementation and emits the fidelity report', async ({
        browser,
        page,
    }) => {
        await expect(
            await archivedScreens(),
            'every archived wireframe must be either PAIRED with a route or explicitly listed as unpaired — a ' +
                'new screen added to docs/mockups/screens must be classified, not silently ignored',
        ).toEqual([...PAIRS.map((pair) => pair.mockupFile), ...UNPAIRED.map((screen) => screen.mockupFile)].sort());

        const mockupContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, ...VISUAL_CONTEXT });
        const mockupPage = await mockupContext.newPage();
        await prepareVisualPage(mockupPage);

        // The front door must be photographed SIGNED OUT, and `page` holds a live Clerk session for the other
        // four routes — so the signed-out pair gets its own context rather than signing out mid-walk.
        const signedOutContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, ...VISUAL_CONTEXT });
        const signedOutPage = await signedOutContext.newPage();
        await prepareVisualPage(signedOutPage);
        await setupClerkTestingToken({ page: signedOutPage });

        await prepareVisualPage(page);
        await signInAndSeed(page);

        const pairs: FidelityPairInput[] = [];

        for (const spec of PAIRS) {
            const implementationPage = spec.signedOut === true ? signedOutPage : page;

            await openMockup(mockupPage, spec.mockupFile);
            const mockupPng = await captureStable(mockupPage, {
                path: `${FIDELITY_OUTPUT_DIR}/${spec.slug}/mockup.png`,
                fullPage: true,
            });

            await implementationPage.goto(route(spec.route));
            await spec.settle(implementationPage);
            const implementationPng = await captureStable(implementationPage, {
                path: `${FIDELITY_OUTPUT_DIR}/${spec.slug}/implementation.png`,
                fullPage: true,
            });

            expect(
                mockupPng.byteLength,
                `${spec.mockupFile} captured only ${mockupPng.byteLength} bytes — the wireframe rendered blank`,
            ).toBeGreaterThan(MIN_PNG_BYTES);
            expect(
                implementationPng.byteLength,
                `${spec.route} captured only ${implementationPng.byteLength} bytes — the route rendered blank`,
            ).toBeGreaterThan(MIN_PNG_BYTES);

            const anchors: AnchorInput[] = [
                {
                    anchor: 'documentSurface',
                    mockup: await probeDocumentSurface(mockupPage),
                    implementation: await probeDocumentSurface(implementationPage),
                },
            ];

            for (const anchor of spec.anchors) {
                anchors.push({
                    anchor: anchor.anchor,
                    mockup: await probeAnchor(anchor.mockup(mockupPage)),
                    implementation: await probeAnchor(anchor.implementation(implementationPage)),
                });
            }

            pairs.push({
                slug: spec.slug,
                mockupFile: spec.mockupFile,
                route: route(spec.route),
                requirementIds: spec.requirementIds,
                caveats: spec.caveats,
                images: { mockup: `${spec.slug}/mockup.png`, implementation: `${spec.slug}/implementation.png` },
                anchors,
            });
        }

        const report = buildFidelityReport({
            environment: {
                browser: browser.browserType().name(),
                viewport: DESKTOP_VIEWPORT,
                clockIso: VISUAL_CLOCK_ISO,
                timezone: VISUAL_TIMEZONE,
                locale: VISUAL_LOCALE,
            },
            tokens: TOKEN_SCALE,
            pairs,
            unpaired: UNPAIRED,
        });

        await writeFile(
            resolve(process.cwd(), FIDELITY_OUTPUT_DIR, 'report.json'),
            `${JSON.stringify(report, null, 4)}\n`,
            'utf8',
        );
        await writeFile(
            resolve(process.cwd(), FIDELITY_OUTPUT_DIR, 'index.html'),
            `${renderFidelityHtml(report)}\n`,
            'utf8',
        );

        // Every pair was compared on more than its document surface — an anchor list that silently collapsed to
        // the surface probe would still emit a plausible-looking report saying nothing.
        for (const pair of report.pairs) {
            expect(pair.anchors.length, `pair ${pair.slug} compared too few anchors`).toBeGreaterThan(1);
        }

        // The ONE substantive fidelity assertion this pass makes: every compared surface's page background is
        // still DRIVEN BY the `semantic.background` token, not by a hardcoded colour. Not "matches the
        // wireframe" — the wireframe's own drifts are reported, not asserted — but "what the compositor
        // actually painted is what the token says". Only a browser can check that: the component tier sees
        // class strings and `tests/mockupContrast.test.ts` sees the token file, and neither can say what was
        // painted. The regression it catches is a real and easy one — someone writes `bg-[#FFFFFF]` on the page
        // shell and every token-level guard in the repo stays green.
        //
        // Two failure modes were established by seeding them, and the distinction matters:
        //
        //  - A COHERENT retheme does NOT fail, and must not. Seeding `semantic.background = '#F7F1E8'`
        //    re-rendered the running app in `rgb(247, 241, 232)`: the dev CSS pipeline regenerates the theme
        //    from the same token source this spec imports, so both sides move together. That is a legitimate
        //    design-system change, not a defect, and a guard that reddened on it would just be noise.
        //  - A DIVERGENCE does fail, in both directions. Hardcoding the surface (`background-color: #ffffff` in
        //    `globals.css`, in place of `var(--color-background)`) reddens it — that is the regression this
        //    exists to prevent, since every class-string and token-file guard in the repo stays green through
        //    it. So does a STALE build: restoring the seeded token while a `.next` cache still held CSS
        //    generated from the old value reddened it too, naming both numbers. That was not a planned case —
        //    it happened — which is the most convincing evidence the assertion has teeth.
        //
        // Asserted against the SPECIFIC `semantic.background` token, not against "any colour in the palette".
        // The looser version was written first and the hardcoding regression walked straight through it: white
        // is `palette.white`, so a surface painted `#FFFFFF` is still "on palette" while the ROLE it is meant to
        // express has been abandoned. Set membership over a 20-colour palette is nearly always satisfiable by
        // accident; the role-specific check is not.
        const expectedSurface = tokenRgbStrings({ background: semantic.background });

        for (const pair of report.pairs) {
            const surface = pair.anchors.find((anchor) => anchor.anchor === 'documentSurface');
            const painted = surface?.implementation.style?.backgroundColor ?? '<no surface probed>';

            expect(
                expectedSurface.has(painted),
                `${pair.route} paints its page surface ${painted}, but @commise/ui's semantic.background token ` +
                    `is ${semantic.background} (${[...expectedSurface].join('')}). Either the surface drifted ` +
                    "off the token, or the token moved without regenerating @commise/ui's theme.css.",
            ).toBe(true);
        }

        // The artifact IS the deliverable, so it is read back from disk: a run that captured everything and then
        // wrote a truncated or unparseable report has failed, and only re-reading catches that.
        const written: unknown = JSON.parse(
            await readFile(resolve(process.cwd(), FIDELITY_OUTPUT_DIR, 'report.json'), 'utf8'),
        );

        expect(written).toMatchObject({
            summary: { pairs: PAIRS.length, unpaired: UNPAIRED.length },
            environment: { clockIso: VISUAL_CLOCK_ISO, timezone: VISUAL_TIMEZONE, locale: VISUAL_LOCALE },
            tokens: { palette: { seafoam: palette.seafoam } },
        });

        await mockupContext.close();
        await signedOutContext.close();
    });
});

/**
 * The archived wireframes, sorted — the set this pass must account for in full.
 *
 * @returns The `screen-*.html` file names.
 * @sideEffect Reads `docs/mockups/screens`.
 */
async function archivedScreens(): Promise<string[]> {
    const entries = await readdir(MOCKUP_SCREENS_DIR);

    return entries.filter((name) => name.endsWith('.html')).sort();
}

/**
 * Sign in and seed the intercepted recipe API with the wireframe's own recipe.
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
