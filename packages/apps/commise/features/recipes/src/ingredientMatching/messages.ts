/**
 * @module @commise/features-recipes/ingredientMatching/messages — the words ONE matched ingredient line says, wherever a
 * cook chooses its food: after Paste a list in the editor, in a bulk import's review wizard, and for a flagged line
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). One
 * {@link LocalizedMessages} set read by the web and the native leaves of both flows, so neither the platforms nor the
 * flows can word a line differently.
 *
 * The spec names these keys `editor.paste.line.*` (and `editor.foodSearch.defaultTag` for the tag); the spec says
 * "Search for a food" is "one label in paste, wizard, flagged lines and the picker", which is why the set lives here and
 * not in either flow's copy. Leaf names follow the spec's where it gives one; the words are the signed-off boards'.
 *
 * ⚠️ Every accessible name that differs from its control's visible words STARTS with those words (WCAG 2.5.3, label in
 * name) and names its line, because many lines show the same control at once (2.4.6).
 *
 * ⚠️ A middle dot that joins two parts of one line is preceded by a no-break space (U+00A0), so the dot never starts a
 * wrapped line: the rule `@commise/ui`'s `PART_SEPARATOR` holds for a variant's parts.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { PluralText } from '../format/plural.js';

/** The copy of one matched ingredient line. */
export interface MatchLineMessages {
    /** The quiet tag on a default food. It never means the food is chosen. */
    readonly defaultTag: string;
    /** A default food's accessible name: its name, then the tag (`{food}`, `{tag}`), so the name says what is seen. */
    readonly defaultOptionName: string;
    /** The muted sentence over an open line's options. Neutral, never amber: a choice is not a failure. */
    readonly prompt: {
        /** Contains `{noun}`, the line's food word ("milk"). */
        readonly default: string;
        readonly needsChoice: string;
        readonly noMatch: string;
    };
    /** What a collapsed open line says it needs. */
    readonly closedNeed: {
        /** `{count}` options; contains `{noun}`. */
        readonly default: PluralText;
        /** `{count}` options. */
        readonly needsChoice: PluralText;
        readonly noMatch: string;
    };
    /** The tag on a line still being checked, and on one whose check waits for the network. */
    readonly checking: { readonly tag: string; readonly paused: string };
    /** Bind a checking line's proposed food. */
    readonly useThis: string;
    /** Its accessible name (contains `{food}`, `{line}`). */
    readonly useThisName: string;
    /** "Search for a food": first on every line the cook chooses for (owner ruling I1). */
    readonly search: string;
    /** Its accessible name (contains `{line}`). */
    readonly searchName: string;
    /** What stands where search was, offline. */
    readonly searchNeedsNetwork: string;
    /** The accessible name of a line's group of options (contains `{line}`). */
    readonly optionsName: string;
    /** The last row of a line's options: keep the line with no food (contains `{line}`). Its name is its label. */
    readonly keepAsWritten: string;
    /** That row's hint. */
    readonly keepHint: string;
    /** The short form, as an action on a checking or failed line. */
    readonly keepAsWrittenShort: string;
    /** The short form's accessible name: its visible words first, then the line (contains `{line}`). */
    readonly keepAsWrittenName: string;
    /** Change a bound line's food. */
    readonly change: string;
    /** Its accessible name (contains `{line}`). */
    readonly changeName: string;
    /** A food the cook picked, said whole as one sentence (contains `{food}`). */
    readonly chosenStatus: string;
    /** The option a reopened line already holds: its name, then this (contains `{food}`). */
    readonly chosenName: string;
    /** A line kept as written, by the cook, the daily limit or a bulk import. */
    readonly keptAsWritten: string;
    /** A review result that finished after the cook's pick (contains `{food}`). It never replaces the pick. */
    readonly lateSuggestion: string;
    /** Opens why the review suggested another food. */
    readonly seeWhy: string;
    /** Its accessible name (contains `{food}`, `{line}`). */
    readonly seeWhyName: string;
    /** A line whose options did not load. The one amber sentence. */
    readonly optionsError: string;
    readonly retry: string;
    /** Its accessible name (contains `{line}`). */
    readonly retryName: string;
}

/** The copy of one matched ingredient line, `en` only (the one shipped locale). */
export const matchLineMessages: LocalizedMessages<MatchLineMessages> = {
    en: {
        defaultTag: 'Default',
        defaultOptionName: '{food}, {tag}',
        prompt: {
            default: 'Choose the {noun} you use',
            needsChoice: 'More than one food fits. Nothing is chosen for you.',
            noMatch: 'No food found for this',
        },
        closedNeed: {
            default: {
                one: 'Choose the {noun} you use\u00A0· {count} option',
                other: 'Choose the {noun} you use\u00A0· {count} options',
            },
            needsChoice: { one: 'Choose a food\u00A0· {count} option', other: 'Choose a food\u00A0· {count} options' },
            noMatch: 'No food found\u00A0· search or keep as written',
        },
        checking: { tag: 'Checking', paused: 'Check paused' },
        useThis: 'Use this',
        useThisName: 'Use this: {food} for {line}',
        search: 'Search for a food',
        searchName: 'Search for a food for {line}',
        searchNeedsNetwork: 'Search needs the network',
        optionsName: 'Food for {line}',
        keepAsWritten: 'Keep “{line}” as written',
        keepHint: 'No nutrition for this line',
        keepAsWrittenShort: 'Keep as written',
        keepAsWrittenName: 'Keep as written: {line}',
        change: 'Change',
        changeName: 'Change the food for {line}',
        chosenStatus: '{food}\u00A0· your choice',
        chosenName: '{food}, chosen',
        keptAsWritten: 'Kept as written\u00A0· no nutrition yet',
        lateSuggestion: 'Our check suggested {food}. Your choice stays.',
        seeWhy: 'See why',
        seeWhyName: 'See why our check suggested {food} for {line}',
        optionsError: 'We couldn’t load the options for this line.',
        retry: 'Try again',
        retryName: 'Try again to load the options for {line}',
    },
};
