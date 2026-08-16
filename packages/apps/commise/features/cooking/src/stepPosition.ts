import type { Locale } from '@commise/i18n';

/**
 * The ONE authority for how a step-position string ("Step 3 of 8") is rendered.
 *
 * Extracted 2026-08-09. `stepDisplayModel` and `stepNavigationModel` had each grown their own
 * `formatStepPosition`, and the two disagreed: the display formatter ran the numbers through
 * `Intl.NumberFormat`, the navigation one through `String()`. In any locale whose numbering system is
 * not Latin (`ar`, `fa`, `hi`…) the same screen would have shown the position twice, in two different
 * scripts. Formatting a step position is one piece of knowledge, so it gets one representation.
 */

/** A 1-based step position. */
export interface StepPosition {
    /** The step being displayed, 1-based. */
    current: number;
    /** How many steps the recipe has in total. */
    total: number;
}

/**
 * Fills a `{current}` / `{total}` template with locale-formatted numerals.
 *
 * @param template - The localized template, e.g. `'Step {current} of {total}'`.
 * @param position - The 1-based position to render.
 * @param locale - The active locale, which selects the numbering system.
 * @returns The formatted position string.
 */
export function formatStepPosition(template: string, position: StepPosition, locale: Locale): string {
    const format = new Intl.NumberFormat(locale);

    return template
        .replace('{current}', format.format(position.current))
        .replace('{total}', format.format(position.total));
}
