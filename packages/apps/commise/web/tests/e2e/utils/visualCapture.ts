/**
 * @module tests/e2e/utils/visualCapture — the determinism contract every visual capture in this suite runs
 * under, plus the two capture primitives built on it (U10a).
 *
 * ## Why a shared module and not `page.screenshot()` at each call site
 *
 * A screenshot is only evidence if an UNCHANGED app produces the SAME bytes. Three things in this app make
 * that false by default, and every one of them is invisible until a baseline starts flapping:
 *
 *  1. **The clock.** `HomeGreeting` renders `new Date()` — the time-of-day greeting bucket AND today's long
 *     date — and `RecipeCard` renders `formatRelativeTime(recipe.updatedAt, new Date())`. Unpinned, the same
 *     commit screenshots differently every hour and every day. {@link VISUAL_CLOCK_ISO} pins it, and pins it
 *     to the instant the WIREFRAMES depict ("Good afternoon, Chef!" over "Saturday, May 31, 2026"), so the
 *     mockup-fidelity pass compares like with like instead of comparing against whenever CI happened to run.
 *  2. **The timezone.** Those reads are LOCAL-time reads (`getHours()`, and `formatHomeDate` deliberately does
 *     not pin a zone — the greeting must reflect where the viewer is). A developer machine and a UTC runner
 *     therefore disagree on the greeting bucket and can disagree on the calendar day. {@link VISUAL_TIMEZONE}
 *     removes that axis.
 *  3. **The fonts.** The brand faces are webfonts. When they load, the glyphs come from a fixed downloaded
 *     file and the raster is machine-independent; when they DON'T, text falls back to whatever the host has
 *     installed (DejaVu on this runner, something else on yours) and the baseline is worthless. So the
 *     webfont load is asserted as a PRECONDITION of capturing, not hoped for — see {@link assertBrandWebfonts}.
 *
 * ## `document.fonts.check()` is not the font assertion — verified, not assumed
 *
 * `FontFaceSet.check('700 36px "Playfair Display"')` returns **`true` on a document with zero webfonts
 * loaded** — it answers "can this be rendered", and a fallback face satisfies it. Measured directly against
 * `docs/mockups/screens/screen-home.html`, which loads no webfonts at all (its Google-Fonts `@import` sits
 * below other rules and is dropped as invalid CSS): `fonts.check` said `true` while `[...document.fonts]` was
 * empty. So this module inspects the FontFaceSet's ENTRIES and their `status`, which is the only reading that
 * distinguishes "loaded" from "substituted".
 *
 * ## Stabilization is Playwright's, not hand-rolled
 *
 * `animations: 'disabled'`, `caret: 'hide'` and `scale: 'css'` are native `page.screenshot` options that
 * finish CSS animations/transitions at their end state, hide the text caret, and pin the raster to CSS pixels
 * regardless of `deviceScaleFactor`. Injecting a `* { animation: none !important }` stylesheet instead would
 * reimplement that badly (it cannot rewind an in-flight animation to a defined frame).
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AnchorObservation } from './mockupFidelity.js';

/**
 * The instant every visual capture pins the browser clock to.
 *
 * Not arbitrary: `screen-home.html` depicts "Good afternoon, Chef!" over "Saturday, May 31, 2026", so this is
 * that Saturday at 15:30 UTC — inside the `afternoon` greeting bucket (`greetingBucketForHour`). Pinning to
 * the wireframe's own moment is what lets the fidelity pass compare the greeting text as a real anchor rather
 * than writing it off as "the mockup was captured on a different day".
 */
export const VISUAL_CLOCK_ISO = '2026-05-31T15:30:00.000Z';

/** The zone every capture runs in, so `getHours()`-derived copy cannot differ between a laptop and CI. */
export const VISUAL_TIMEZONE = 'UTC';

/** The locale every capture runs in, so `Intl`-formatted dates and numbers cannot differ between machines. */
export const VISUAL_LOCALE = 'en-US';

/** The desktop capture viewport — the width the wireframes are drawn at (their `md:` sidebar is visible). */
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

/** The phone capture viewport — a common modern handset, and the width the responsive suite already uses. */
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * The brand webfont families whose presence a capture depends on, per `src/app/globals.css`.
 *
 * `JetBrains Mono` is deliberately absent: it is only used for code/data and no captured surface renders it,
 * so requiring it would fail a capture for a font the image does not contain.
 */
export const BRAND_WEBFONTS: readonly string[] = ['Inter', 'Playfair Display'];

/**
 * Chromium launch flags that remove the RASTERIZATION variance between a developer machine and a CI runner.
 *
 * The same DOM at the same size can still encode to different bytes when the engine is free to hint glyphs,
 * position subpixels, sub-tile the raster, or pick a colour profile from the host — which is precisely the
 * WSL2-versus-`ubuntu-latest` axis that makes naive visual baselines flap. Each flag closes one of those:
 *
 *  - `--font-render-hinting=none` / `--disable-font-subpixel-positioning` — glyph outlines are snapped
 *    identically everywhere instead of to the host's hinting configuration.
 *  - `--disable-lcd-text` — greyscale antialiasing, so no RGB subpixel order enters the pixels.
 *  - `--force-color-profile=srgb` — the display profile cannot shift the encoded colours.
 *  - `--disable-partial-raster` / `--disable-skia-runtime-opts` — the compositor cannot reuse a partial tile
 *    or select CPU-specific Skia paths, both of which vary by machine.
 *  - `--hide-scrollbars` — a scrollbar that appears on one run and not the next shifts the whole layout.
 *
 * Scoped to the visual specs via `test.use({ launchOptions })` rather than set globally in
 * `playwright.config.ts`: the rest of the suite asserts roles and geometry, where these flags buy nothing, and
 * one existing spec carries a committed `toHaveScreenshot` baseline that a global change would invalidate.
 */
export const DETERMINISTIC_CHROMIUM_ARGS: readonly string[] = [
    '--font-render-hinting=none',
    '--disable-font-subpixel-positioning',
    '--disable-lcd-text',
    '--force-color-profile=srgb',
    '--disable-partial-raster',
    '--disable-skia-runtime-opts',
    '--hide-scrollbars',
];

/**
 * The BROWSER-level options, applied with a FILE-TOP-LEVEL `test.use(VISUAL_LAUNCH)`.
 *
 * Kept separate from {@link VISUAL_CONTEXT} because Playwright rejects `launchOptions` inside a
 * `test.describe` — it is worker-scoped, and changing it per group would force a new worker mid-file. Context
 * options (viewport, timezone, locale) have no such restriction, which is why the two are split rather than one
 * convenient blob. Deliberately NOT `as const`: `launchOptions.args` is a mutable `string[]` in Playwright's
 * types, so a frozen literal fails to typecheck; copying the arg list is what keeps this constant immutable.
 */
export const VISUAL_LAUNCH = { launchOptions: { args: [...DETERMINISTIC_CHROMIUM_ARGS] } };

/** The CONTEXT options every visual spec must run under. Spread into a `test.use({ ... })` beside a viewport. */
export const VISUAL_CONTEXT = { timezoneId: VISUAL_TIMEZONE, locale: VISUAL_LOCALE } as const;

/** Where the Argos visual-regression PNGs are written, relative to the web package root. */
export const ARGOS_SCREENSHOT_DIR = 'screenshots';

/** Where the mockup-fidelity artifacts (image pairs + report) are written, relative to the web package root. */
export const FIDELITY_OUTPUT_DIR = 'mockup-fidelity';

/**
 * `docs/mockups/screens`, resolved from THIS FILE (seven levels up: `utils` → `e2e` → `tests` → `web` →
 * `commise` → `apps` → `packages` → repo root) rather than from the working directory, so a Playwright run, a
 * Turbo task and an editor run all agree. The single owner of this path — the fidelity spec imports it rather
 * than re-deriving its own relative walk, which is how the first version of this landed one level short.
 */
export const MOCKUP_SCREENS_DIR = resolve(import.meta.dirname, '../../../../../../../docs/mockups/screens');

/**
 * Pin the page's clock and disable motion — the two things that must be in place BEFORE the first navigation.
 *
 * @param page - The page about to be navigated.
 * @sideEffect Installs a fake clock and overrides the page's `prefers-reduced-motion`.
 */
export async function prepareVisualPage(page: Page): Promise<void> {
    // Pinning (not ticking): `setFixedTime` freezes `Date.now()`/`new Date()` while leaving timers running, so
    // React effects, data fetches and Clerk's own polling still progress. `install()` + a ticking clock would
    // stall anything that awaits a timer, which is a hang, not a stabilization.
    await page.clock.setFixedTime(new Date(VISUAL_CLOCK_ISO));
    // The repo's motion contract: every animated surface is gated behind `motion-safe:`, so under `reduce`
    // there is no transform/opacity animation to catch mid-flight. This asserts nothing on its own — it is
    // the state the capture is defined in.
    await page.emulateMedia({ reducedMotion: 'reduce' });
}

/**
 * Assert the brand webfonts really loaded, and fail loudly naming the missing family if not.
 *
 * This is a PRECONDITION, not a nicety. A capture taken with the brand faces substituted is
 * machine-dependent, so accepting one would produce a baseline that flaps between a developer machine and CI
 * for reasons that have nothing to do with the change under review. It also catches a defect class this repo
 * has actually shipped: an `@import` for the Google Fonts stylesheet placed below another rule in
 * `globals.css` is dropped by CSS, and the whole app silently degrades to Georgia/system-ui.
 *
 * @param page - A navigated page.
 * @param families - The families that must be loaded (defaults to {@link BRAND_WEBFONTS}).
 * @sideEffect Awaits font loading in the page and polls its FontFaceSet.
 */
export async function assertBrandWebfonts(page: Page, families: readonly string[] = BRAND_WEBFONTS): Promise<void> {
    await page.evaluate(() => document.fonts.ready);

    // Polled rather than read once: `fonts.ready` settles for the faces known at that moment, and a face
    // referenced by a stylesheet Next streams in later starts loading after it resolves.
    await expect
        .poll(async () => loadedWebfontFamilies(page), {
            message:
                `the brand webfonts (${families.join(', ')}) must be LOADED before a visual capture — a ` +
                'capture taken with them substituted rasterizes host fonts and cannot be a stable baseline. ' +
                'If this fails on the app, check that the Google-Fonts `@import` is still the FIRST rule in ' +
                'src/app/globals.css: CSS drops an @import that follows any other rule.',
        })
        .toEqual(expect.arrayContaining([...families]));
}

/**
 * The webfont families the page has actually LOADED, deduplicated and sorted.
 *
 * Reads the FontFaceSet's entries and their `status` — never `fonts.check()`, which returns `true` for a
 * family it can only approximate with a fallback (measured; see the module JSDoc).
 *
 * @param page - A navigated page.
 * @returns The loaded families.
 * @sideEffect Evaluates in the page.
 */
export async function loadedWebfontFamilies(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const families = new Set<string>();

        document.fonts.forEach((face) => {
            if (face.status === 'loaded') {
                // Family names arrive quoted when they contain a space (`"Playfair Display"`).
                families.add(face.family.replace(/^["']|["']$/g, ''));
            }
        });

        return [...families].sort();
    });
}

/** Options for {@link captureStable}. */
export interface CaptureOptions {
    /** Path relative to the web package root, including the `.png` suffix. */
    readonly path: string;
    /** Capture the whole scrollable document rather than just the viewport. */
    readonly fullPage?: boolean;
    /**
     * Regions to paint over with a flat colour — for content this suite does not own and cannot pin (the
     * remotely-rendered Clerk widget). Masking keeps the surrounding chrome, which IS ours, in the baseline.
     */
    readonly mask?: readonly Locator[];
}

/**
 * How long a capture waits for the page's fonts and images to finish before giving up.
 *
 * Bounded and FATAL rather than best-effort: a capture taken over a half-loaded raster is exactly the
 * intermittent baseline this module exists to prevent, so timing out must fail the spec loudly instead of
 * quietly writing a different picture.
 */
const RASTER_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Screenshot the page under the suite's determinism contract.
 *
 * Raster settling happens HERE rather than at each call site, because a call site can forget it and the
 * symptom is invisible: measured, two consecutive unchanged runs of the sign-in capture differed by 331 pixels
 * — Clerk's Apple and Google provider logos are remote images, absent in the first capture and present in the
 * second. Folding the wait into the one primitive every capture goes through is what makes that unrepeatable.
 *
 * @param page - A navigated, settled page.
 * @param options - Where to write, and what to mask.
 * @returns The PNG bytes, so a caller can assert the capture is not blank.
 * @sideEffect Awaits font/image loading, screenshots the page, and writes the file.
 */
export async function captureStable(page: Page, options: CaptureOptions): Promise<Buffer> {
    const path = resolve(process.cwd(), options.path);

    await settleRaster(page);
    await mkdir(dirname(path), { recursive: true });

    return page.screenshot({
        path,
        fullPage: options.fullPage ?? false,
        // Playwright's own stabilization: finish CSS animations/transitions at their end state, hide the text
        // caret, and rasterize in CSS pixels so `deviceScaleFactor` cannot change the bytes.
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        ...(options.mask === undefined ? {} : { mask: [...options.mask], maskColor: '#B2BEC3' }),
    });
}

/**
 * How long a Home capture waits for the widget surface to resolve.
 *
 * Far above the 5s `expect` default, and that is the point: Home's widgets arrive through a `next/dynamic`
 * loader behind Suspense, so the FIRST visit in a run pays Next dev's on-demand chunk compilation. Measured
 * with the default budget, a run taken right after a source edit (cold `.next`) photographed a Home whose
 * widget region held nothing but its "See all recipes" footer link, while a warm run photographed the resolved
 * widgets — two different pictures of the same commit, which is precisely the flapping baseline this module
 * exists to prevent. Waiting is the fix; capturing early and hoping is not.
 */
const HOME_WIDGET_TIMEOUT_MS = 30_000;

/**
 * Block until Home's widget surface has actually PAINTED its content.
 *
 * Waits on the live recent-recipes widget (its own titled region, plus the seeded recipe's card — content, not
 * just chrome) and on the last roadmap placeholder, which together mean every slot has resolved.
 *
 * @param page - A page showing Home.
 * @param seededRecipeTitle - The title of a recipe seeded into the intercepted API, so the wait is on real
 *   content rather than on a container that renders whether or not the data arrived.
 * @sideEffect Polls the page.
 */
export async function settleHomeWidgets(page: Page, seededRecipeTitle: string): Promise<void> {
    const widget = page.getByRole('region', { name: 'Recent recipes' });

    await expect(widget).toBeVisible({ timeout: HOME_WIDGET_TIMEOUT_MS });
    await expect(widget.getByRole('button', { name: seededRecipeTitle })).toBeVisible({
        timeout: HOME_WIDGET_TIMEOUT_MS,
    });
    await expect(page.getByRole('heading', { name: /^this week.s meals$/i })).toBeVisible({
        timeout: HOME_WIDGET_TIMEOUT_MS,
    });
}

/**
 * Block until every raster input the screenshot depends on has resolved: fonts, then images.
 *
 * @param page - A navigated page.
 * @sideEffect Awaits font loading and polls image completion in the page.
 */
export async function settleRaster(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
    await expect
        .poll(
            () =>
                page.evaluate(() =>
                    [...document.images].filter((image) => !image.complete).map((image) => image.currentSrc),
                ),
            {
                timeout: RASTER_SETTLE_TIMEOUT_MS,
                message:
                    'images were still loading when the capture was taken, which makes the baseline depend on ' +
                    'network timing. Either wait for the content by role first, or the listed URLs are ' +
                    'unreachable from this environment',
            },
        )
        .toEqual([]);
}

/**
 * Open an archived wireframe, OFFLINE, and settle it.
 *
 * Three deliberate choices, each verified against the archive rather than assumed:
 *
 *  - **`file://`, not a local HTTP server.** The screens carry their markup pre-rendered inside `#container`
 *    and reference their images relatively (`../_assets/…`), so every asset resolves from disk. The Figma
 *    Sites runtime they also reference is an ABSOLUTE `/_runtimes/…` path, which under `file://` resolves to
 *    the filesystem root and simply fails — leaving exactly the pre-rendered markup we want to photograph.
 *    Serving over HTTP would instead load that runtime and let it re-render the page over the network.
 *  - **All HTTP(S) aborted.** Belt-and-braces against any absolute URL in the archive (Figma's reporting
 *    domain, Google Fonts) reaching the network mid-capture.
 *  - **No webfont assertion.** These documents load NO webfonts: their `@import`s for Playfair/Inter sit
 *    below other rules and CSS drops them. That is a REPORTED finding, not something to work around, so the
 *    wireframe side of a pair is compared for layout/colour/copy and its typeface is read from the report's
 *    `fontFamily` delta rather than from the raster.
 *
 * @param page - A fresh page (already through {@link prepareVisualPage}).
 * @param screenFile - A file name under `docs/mockups/screens`, e.g. `screen-home.html`.
 * @sideEffect Installs route handlers and navigates the page.
 */
export async function openMockup(page: Page, screenFile: string): Promise<void> {
    await page.route('http://**', (route) => route.abort());
    await page.route('https://**', (route) => route.abort());
    await page.goto(pathToFileURL(resolve(MOCKUP_SCREENS_DIR, screenFile)).href, { waitUntil: 'load' });

    // The pre-rendered markup is the whole point of loading these offline: if the runtime HAD taken over (or
    // the archive were re-exported without server-side markup) the document would be an empty shell, and a
    // blank wireframe silently "matching" nothing is the worst outcome this pass could produce.
    await expect(
        page.getByRole('heading'),
        `${screenFile} rendered no headings — the archived screen must carry pre-rendered markup inside ` +
            '#container. A re-export that renders only client-side would need this pass rethought.',
    ).not.toHaveCount(0);
}

/**
 * Probe one element's rendered presentation.
 *
 * An absent (or zero-count) locator returns the ABSENT observation rather than throwing: "the wireframe
 * specifies this and the implementation has no such element" is a finding the report exists to carry, and a
 * thrown error would replace that finding with a red spec and no artifact at all.
 *
 * @param locator - A role/label locator, on either document.
 * @returns The observation; `{ text: null, style: null }` when the element is not there.
 * @sideEffect Evaluates in the page.
 */
export async function probeAnchor(locator: Locator): Promise<AnchorObservation> {
    if ((await locator.count()) === 0) {
        return { text: null, style: null };
    }

    const first = locator.first();

    if (!(await first.isVisible())) {
        return { text: null, style: null };
    }

    return first.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return {
            text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
            style: {
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                color: style.color,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderRadius: style.borderTopLeftRadius,
                width: rect.width,
                height: rect.height,
            },
        };
    });
}

/**
 * Probe the document's own painted surface — the page background and the body type everything inherits.
 *
 * Read via `getComputedStyle` rather than through a locator: the page surface carries no ARIA role to select
 * by, and inventing a `data-testid` for it is banned by repo policy.
 *
 * Finding the background is the interesting part, and the naive reading is wrong. The wireframes leave both
 * `<html>` and `<body>` fully transparent and paint `--gradient-beach-glow` on a FULL-BLEED wrapper `<div>`
 * inside — so reading `body.backgroundColor` reports `rgba(0, 0, 0, 0)` on one side and the app's flat
 * `--color-background` on the other, and the report would claim a drift that is really just "the two documents
 * attach the surface at different depths". So this walks outward-in: `<html>`, then `<body>`, then the first
 * FULL-BLEED descendant (covering ≥ 90% of the viewport width) that actually paints something. That rule finds
 * the real surface in both documents, which is what makes a gradient-vs-flat finding trustworthy.
 *
 * @param page - A navigated page.
 * @returns The document-surface observation (no text — a surface has none).
 * @sideEffect Evaluates in the page.
 */
export async function probeDocumentSurface(page: Page): Promise<AnchorObservation> {
    return page.evaluate(() => {
        const TRANSPARENT = 'rgba(0, 0, 0, 0)';
        const FULL_BLEED_RATIO = 0.9;
        const viewportWidth = document.documentElement.clientWidth;
        const paints = (style: CSSStyleDeclaration): boolean =>
            style.backgroundColor !== TRANSPARENT || style.backgroundImage !== 'none';

        const candidates: Element[] = [document.documentElement, document.body];

        for (const element of document.body.querySelectorAll('*')) {
            if (element.getBoundingClientRect().width >= viewportWidth * FULL_BLEED_RATIO) {
                candidates.push(element);
            }
        }

        const body = getComputedStyle(document.body);
        const surface = candidates.map((element) => getComputedStyle(element)).find(paints) ?? body;

        return {
            text: null,
            style: {
                fontFamily: body.fontFamily,
                fontSize: body.fontSize,
                fontWeight: body.fontWeight,
                lineHeight: body.lineHeight,
                color: body.color,
                backgroundColor: surface.backgroundColor,
                backgroundImage: surface.backgroundImage,
                borderRadius: body.borderTopLeftRadius,
                width: viewportWidth,
                height: document.documentElement.clientHeight,
            },
        };
    });
}
