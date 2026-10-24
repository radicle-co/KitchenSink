/**
 * @module @commise/features-recipes — the web recipe page's layout classes, shared by the page and its loading skeleton
 * so the skeleton lays out exactly as the page does (D3, `buildSpec.md` §6.7: "no layout shift").
 *
 * ⛔ Every class that uses the 720/960 container variants is written out IN FULL: Tailwind generates only the class names
 * it finds whole in the source, so a variant prefix concatenated at run time produces no CSS at all and the page silently
 * stays one column. The page is `@container/detail`; the 720 px body is `@min-[45rem]/detail:` and the 960 px body
 * `@min-[60rem]/detail:`.
 */

/** The page's frame: its own container, the detail width, no gutter (`<main>` owns it) and no centring (§1.3). */
export const DETAIL_ARTICLE = '@container/detail flex w-full max-w-detail flex-col gap-6 pb-10';

/** The top block: the hero and the header, side by side from a 960 px body. */
export const DETAIL_TOP_GRID =
    'flex flex-col gap-4 @min-[60rem]/detail:grid @min-[60rem]/detail:grid-cols-12 @min-[60rem]/detail:gap-x-8';

/**
 * The top block from a 960 px body (§6.1): the photo at the END (7/12) with the header beside it. With NO photo the hero is
 * the 96 px monogram band — a strip, not a picture — so it takes the whole row with the header under it, instead of
 * leaving a large empty block under a band in a 7/12 column (P1).
 */
export const HERO_PHOTO_CELL =
    '@min-[60rem]/detail:col-span-7 @min-[60rem]/detail:col-start-6 @min-[60rem]/detail:row-start-1';
export const HEADER_BESIDE_PHOTO =
    '@min-[60rem]/detail:col-span-5 @min-[60rem]/detail:col-start-1 @min-[60rem]/detail:row-start-1';
export const HERO_BAND_CELL = '@min-[60rem]/detail:col-span-12 @min-[60rem]/detail:row-start-1';
export const HEADER_UNDER_BAND = '@min-[60rem]/detail:col-span-12 @min-[60rem]/detail:row-start-2';

/** The body: one column, two from a 720 px body. */
export const BODY_GRID =
    'flex flex-col gap-10 @min-[45rem]/detail:grid @min-[45rem]/detail:grid-cols-12 @min-[45rem]/detail:gap-8';

/** The ingredients: 5/12 from a 720 px body, sticky under the chrome with a scroll of their own. */
export const INGREDIENTS_COLUMN =
    'flex flex-col gap-3 @min-[45rem]/detail:sticky @min-[45rem]/detail:top-20 @min-[45rem]/detail:col-span-5 ' +
    '@min-[45rem]/detail:max-h-[calc(100dvh-6rem)] @min-[45rem]/detail:self-start @min-[45rem]/detail:overflow-y-auto';

/** The steps, nutrition, rating and footer facts: 7/12 from a 720 px body. */
export const STEPS_COLUMN = 'flex min-w-0 flex-col gap-10 @min-[45rem]/detail:col-span-7';
