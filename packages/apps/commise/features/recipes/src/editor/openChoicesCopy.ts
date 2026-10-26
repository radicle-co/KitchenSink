/**
 * @module @commise/features-recipes/editor — the words of the sheet that asks before a recipe is published with lines
 * that have no food yet (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, R23). Publishing stays
 * allowed: the sheet names the open lines, says they are saved as written and do not count toward nutrition, names the
 * lines still being checked, and says how many lines count ("4 of 9 counted").
 *
 * The names are joined the way the locale writes a list (`Intl.ListFormat`), never with a hand-written "and". They are
 * shown as the caller gives them: capitalising the first one is the caller's choice, because a locale-blind
 * capitalisation would be wrong in some languages.
 *
 * Pure and platform-agnostic: the web and native sheets render what it returns.
 *
 * @pattern Presentation Model — the sheet's words derived once for both platform leaves
 */
import { fillTemplate } from '../format/fillTemplate.js';
import { pluralOf } from '../format/plural.js';
import type { EditorMessages } from './messages.js';

/** What the sheet is told. */
export interface OpenChoicesFacts {
    /** The foods named by the lines that need a pick, in recipe order. At least one, or the sheet is not shown. */
    readonly openNames: readonly string[];
    /** The foods named by the lines still being checked. */
    readonly checkingNames: readonly string[];
    /** The lines that count toward nutrition. */
    readonly counted: number;
    /** Every ingredient line. */
    readonly total: number;
}

/** The sheet's words. */
export interface OpenChoicesCopy {
    readonly title: string;
    readonly body: string;
    /** Said only while a line is still being checked. */
    readonly checking: string | undefined;
    readonly chooseNow: string;
    readonly publishAnyway: string;
    readonly later: string;
    readonly close: string;
}

/**
 * The sheet's words. Pure.
 *
 * @param facts - The open and checking lines, and the counts.
 * @param copy - The localised editor copy.
 * @param locale - The active locale, for plural forms and the list.
 * @returns The sheet's words.
 */
export const openChoicesCopyOf = (
    facts: OpenChoicesFacts,
    copy: Pick<EditorMessages, 'openChoices'>,
    locale: string,
): OpenChoicesCopy => {
    const t = copy.openChoices;
    const list = new Intl.ListFormat(locale, { type: 'conjunction' });

    return {
        title: pluralOf(t.title, facts.openNames.length, locale),
        body: fillTemplate(pluralOf(t.body, facts.openNames.length, locale), { names: list.format(facts.openNames) }),
        checking:
            facts.checkingNames.length === 0
                ? undefined
                : fillTemplate(pluralOf(t.checking, facts.checkingNames.length, locale), {
                      names: list.format(facts.checkingNames),
                  }),
        chooseNow: t.chooseNow,
        publishAnyway: t.publishAnyway,
        later: fillTemplate(t.later, { counted: facts.counted, total: facts.total }),
        close: t.close,
    };
};
