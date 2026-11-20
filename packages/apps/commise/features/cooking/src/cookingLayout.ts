/**
 * @module cookingLayout — the widths and heights of the cooking surface, written once with the complete Tailwind class
 * each one drives. Tailwind builds only class text it can find, so a class is written whole here next to its number. A
 * test pins that each class contains its number.
 */

/** The centred column every cooking screen uses at 600 and wider, with its complete web class. */
export const COOKING_COLUMN = { maxPx: 680, webClassName: 'max-w-[680px]' } as const;

/** The ingredients column at L2 and L3, pinned on the left of the step column, with its complete web class. */
export const INGREDIENTS_COLUMN = { px: 300, webClassName: 'w-[300px]' } as const;

/** The narrower centred column of the notice screens (load error, no steps, gone), with its complete web class. */
export const NOTICE_COLUMN = { maxPx: 480, webClassName: 'max-w-[480px]' } as const;

/**
 * Under 360 the place drops to its own full-width row and the Back and Next chevrons hide, so the labels keep their
 * width. Web writes the width in rem, 22.5 at 16 px a rem, so the rule also fires when the cook enlarges the text.
 * Native reads `maxPx`. The container-query classes are written whole, each holding its number. The top bar's
 * Ingredients button sits after the place when wide (`order-1`) and at the end of its row when narrow (`ml-auto`), in
 * one tree.
 */
export const NARROW_ROW = {
    maxPx: 360,
    maxRem: 22.5,
    placeWebClassName: '@max-[22.5rem]:basis-full',
    navWebClassName: '@max-[22.5rem]:[&_svg]:hidden',
    ingredientsWebClassName: '@min-[22.5rem]:order-1 @max-[22.5rem]:ml-auto',
} as const;

/**
 * Under 700 tall, the scroll budget, the pinned Next preview shows one line, ending in an ellipsis. The clamp is visual
 * only: the whole line stays in the text a screen reader reads. Native reads `maxHeightPx`. Web asks the HEIGHT OF THE
 * COOKING FRAME (a size container), in rem, so the rule also fires when the cook enlarges the text; the class is written
 * whole and holds its number.
 */
export const SHORT_SCREEN = {
    maxHeightPx: 700,
    maxHeightRem: 43.75,
    previewWebClassName: '[@container(height<43.75rem)]:line-clamp-1',
} as const;

/**
 * Under 40 rem tall, the Next preview leaves the pinned foot and becomes the last item of the scrolling step, so Back and
 * Next keep the room. Web asks the HEIGHT OF THE COOKING FRAME (a size container), in rem, so the rule also fires when
 * the cook enlarges the text. It draws the preview in both places and the container query shows one, so the server HTML
 * and the first client render agree and no script reads a size. Each class is written whole and holds its number.
 * Native reads `maxHeightPx` against the window height divided by the text scale. The preview is moved whole, never cut.
 */
export const PREVIEW_IN_BODY = {
    maxHeightPx: 640,
    maxHeightRem: 40,
    footWebClassName: '[@container(height<40rem)]:hidden',
    bodyWebClassName: 'hidden [@container(height<40rem)]:flex',
} as const;
