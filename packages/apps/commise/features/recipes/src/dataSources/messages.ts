/**
 * @module @commise/features-recipes/dataSources/messages — the Data sources page's copy (plan R55, design §S16, §S19).
 *
 * Platform-neutral strings consumed by BOTH the web `*.tsx` and native `*.native.tsx` leaves via `useMessages`, so the
 * two platforms cannot drift on what they tell a cook about where the numbers come from.
 *
 * ⛔ A source's own words are NOT here and never will be: its name, its publisher, its edition, its licence's title and
 * its credit come from the food service, word for word. The credit is a licence term, so it is never translated
 * (§S16). Only the surrounding copy is localized.
 *
 * The `en` copy says "License" (US), as the rest of the picker's new copy does (§S19); a licence's own title keeps its
 * publisher's spelling.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the Data sources page and its two ways in. */
export interface DataSourcesMessages {
    /** The page's heading (web `h1`, native sheet title), and the text of every link to it. */
    readonly title: string;
    /** Accessible name of the native sheet's Close control. */
    readonly close: string;
    /** The first intro sentence. */
    readonly intro: string;
    /** The second intro sentence: the rule for a food no database lists exactly (§S17). */
    readonly closeMatchNote: string;
    /** The term before a source's edition. */
    readonly editionLabel: string;
    /** The term before a source's licence. */
    readonly licenceLabel: string;
    /** Accessible name of a licence link (contains `{licence}` and `{source}`). */
    readonly licenceLinkName: string;
    /** The term before a source's credit. */
    readonly creditLabel: string;
    /** Shown on a source some of whose values were converted to this app's units (R54, CC BY 4.0 §3(a)(1)(B)). */
    readonly convertedNote: string;
    /** Visible text of a source's website link. */
    readonly homepageLink: string;
    /** Accessible name of a source's website link (contains `{source}`). */
    readonly homepageLinkName: string;
    /** Said after the name of a web link that opens a new tab (SC 3.2.5): "(opens in a new tab)". */
    readonly opensInNewTab: string;
    /** The loading region's caption. */
    readonly loading: string;
    /** Shown when the sources could not be read. */
    readonly loadFailed: string;
    /** The retry control after a failed read. */
    readonly retry: string;
    /** Shown when no stored value cites any source. A deployed stage cannot reach it, so it is never blank. */
    readonly empty: string;
}

export const dataSourcesMessages: LocalizedMessages<DataSourcesMessages> = {
    en: {
        title: 'Data sources',
        close: 'Close data sources',
        intro: 'The nutrition figures in this app come from these public food databases.',
        closeMatchNote: 'When no database lists a food exactly, we use the figures for a similar or more general food.',
        editionLabel: 'Edition',
        licenceLabel: 'License',
        licenceLinkName: '{licence}, license for {source}',
        creditLabel: 'Credit',
        convertedNote: 'We converted some of its values to the units this app uses.',
        homepageLink: 'Source website',
        homepageLinkName: 'Source website, {source}',
        opensInNewTab: '(opens in a new tab)',
        loading: 'Loading data sources…',
        loadFailed: 'We couldn’t load the data sources.',
        retry: 'Try again',
        empty: 'No data sources to show yet.',
    },
};
