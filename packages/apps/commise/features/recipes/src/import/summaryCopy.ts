/**
 * @module @commise/features-recipes/import — the words of the import summary (board WizardSummary), read by both
 * `ImportSummary` leaves so they cannot drift. A row whose count is zero is left out, never drawn as "0 could not be
 * read".
 */
import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { ImportMessages } from './messages.js';
import type { ImportSummaryProps } from './props.js';

/** The counts the summary states. */
export type SummaryCounts = Omit<ImportSummaryProps, 'onSeeAdded' | 'onFixUnreadable' | 'onChooseFoods'>;

/** The summary's words; a row the summary leaves out is `undefined`. */
export interface SummaryCopy {
    readonly from: string;
    readonly added: string;
    readonly breakdown: string;
    readonly alreadyHere: string | undefined;
    readonly unreadable: { readonly title: string; readonly titles: string } | undefined;
    readonly asWritten: string | undefined;
    readonly coverage: string;
}

/**
 * The summary's words. Pure.
 *
 * @param counts - What the import did.
 * @param messages - The summary copy.
 * @param locale - The reader's locale, for plurals and the list of titles.
 * @returns The words, with each empty row `undefined`.
 */
export function summaryCopyOf(counts: SummaryCounts, messages: ImportMessages['summary'], locale: string): SummaryCopy {
    // `unit`/`short` joins with commas and no conjunction ("A, B, C"), as the board lists them, in the reader's locale.
    const titles = new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(counts.unreadable);

    return {
        from: fillTemplate(messages.from, { source: counts.sourceName, when: counts.finishedWhen }),
        added: pluralOf(messages.added, counts.added, locale),
        breakdown: fillTemplate(messages.breakdown, {
            nothing: counts.neededNothing,
            reviewed: counts.reviewed,
            skipped: counts.skipped,
        }),
        alreadyHere: counts.alreadyHere > 0 ? pluralOf(messages.alreadyHere, counts.alreadyHere, locale) : undefined,
        unreadable:
            counts.unreadable.length > 0
                ? { title: pluralOf(messages.unreadable, counts.unreadable.length, locale), titles }
                : undefined,
        asWritten:
            counts.asWrittenLines > 0
                ? fillTemplate(pluralOf(messages.asWrittenLines, counts.asWrittenLines, locale), {
                      recipes: pluralOf(messages.asWrittenRecipes, counts.asWrittenRecipes, locale),
                  })
                : undefined,
        coverage: fillTemplate(messages.coverage, { counted: counts.countedRecipes, total: counts.added }),
    };
}
