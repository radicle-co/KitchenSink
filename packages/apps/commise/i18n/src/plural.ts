/**
 * @module @commise/i18n — how the apps say a count: a `{ one, other }` pair chosen by the locale's plural rule. Its own
 * module beside `fillTemplate`, so copy anywhere says a count without reaching into another feature's messages.
 *
 * Pure and platform-agnostic.
 */

/** A count's two English forms, each holding `{count}`. */
export interface PluralText {
    readonly one: string;
    readonly other: string;
}

/**
 * A count's localized text: the `one` or `other` form, with `{count}` filled in. Other tokens are left for
 * `fillTemplate`. Pure.
 *
 * @param text - The two forms.
 * @param count - The count.
 * @param locale - The active locale.
 * @returns The text.
 */
export function pluralOf(text: PluralText, count: number, locale: string): string {
    const form = new Intl.PluralRules(locale).select(count) === 'one' ? text.one : text.other;

    return form.replaceAll('{count}', String(count));
}
