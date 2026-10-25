/**
 * @module @commise/features-recipes/import/messages — user-facing copy for bulk import's ingredient matching: the mode
 * choice, the review wizard, its states, Save and leave, the end summary and the lines to check
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md` "Bulk import"; the feature 004 boards
 * ImportModeChoice, WizardStep, WizardStates, WizardLeave, WizardSummary and FlaggedLine). One {@link LocalizedMessages}
 * set read by BOTH the web and the native leaves, so the platforms cannot drift on copy. Templates carry `{token}`
 * placeholders filled with `fillTemplate`; counts are {@link PluralText} filled with `pluralOf`.
 *
 * The spec names keys (`import.mode.*`, `import.wizard.*`, `import.summary.*`, `import.flagged.*`); the groups here
 * mirror them. The words are the boards'.
 *
 * ⚠️ `line` holds the per-line copy the paste flow ALSO shows (`editor.paste.line.*` in the spec: "Search for a food" is
 * one label in paste, the wizard, flagged lines and the picker). The paste flow's copy is being built in parallel, so
 * this group is a known second copy, its leaf names chosen to match the spec's so the merge is a move, not a rewrite.
 *
 * ⚠️ Every accessible name that differs from its control's visible words STARTS with those words (WCAG 2.5.3, label in
 * name), and names its line, because a recipe shows several "Change" and "Use this" controls at once.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { PluralText } from '../editor/messages.js';

/** Copy for one ingredient line in the wizard, the flagged pane and the options sheet. */
export interface ImportLineMessages {
    /** "Search for a food": the first row of every line the cook chooses for (owner ruling I1). */
    readonly search: string;
    /** Its accessible name (contains `{line}`). */
    readonly searchName: string;
    /** The option list's accessible name (contains `{line}`). */
    readonly optionsLabel: string;
    /** The last option: keep the line with no food (contains `{line}`). */
    readonly keepAsWritten: string;
    /** That option's hint. */
    readonly keepHint: string;
    /** The quiet tag on a default food. It never means the food is chosen. */
    readonly defaultTag: string;
    /** The prompt on an open default line (contains `{noun}`, the line's food word: "flour"). Neutral, never amber. */
    readonly defaultPrompt: string;
    /** The prompt on an open line with more than one fitting food. */
    readonly needsChoicePrompt: string;
    /** The prompt on an open line with no food found. */
    readonly noMatchPrompt: string;
    /** A closed line with options waiting ("Choose a food · 5 options"). */
    readonly closedNeed: PluralText;
    /** A closed default line (contains `{noun}`). */
    readonly closedDefault: PluralText;
    /** A closed line with no food found. */
    readonly closedNoMatch: string;
    /** The tag on a line still being checked. */
    readonly checkingTag: string;
    /** Bind a checking line's proposed food. */
    readonly useThis: string;
    /** Its accessible name (contains `{food}`, `{line}`). */
    readonly useThisName: string;
    /** Change a matched or chosen line's food. */
    readonly change: string;
    /** Its accessible name (contains `{line}`). */
    readonly changeName: string;
    /** Marks a food the cook picked. */
    readonly yourChoice: string;
    /** What a line the cook kept with no food says instead of a food. */
    readonly keptAsWritten: string;
    /** A late check result on a cook's pick (contains `{food}`). It never replaces the pick. */
    readonly lateSuggestion: string;
    /** Opens why the check suggested another food. */
    readonly seeWhy: string;
    /** Its accessible name (contains `{food}`, `{line}`). */
    readonly seeWhyName: string;
}

/** Copy for the bulk import's matching surfaces. */
export interface ImportMessages {
    readonly mode: {
        readonly title: string;
        /** The file's source and size (contains `{source}`; `{count}` recipes). */
        readonly fileSummary: PluralText;
        readonly intro: string;
        /** The radio group's accessible name. */
        readonly groupLabel: string;
        readonly saveAsWrittenTitle: string;
        readonly saveAsWrittenHint: string;
        readonly bestTitle: string;
        readonly bestHint: string;
        readonly reviewTitle: string;
        readonly reviewHint: string;
        readonly start: string;
        /** Under Start: says why it is not pressable yet, and that nothing is final. */
        readonly startHint: string;
        /** The wide layout's reassurance beside the choice. */
        readonly promise: string;
    };
    readonly line: ImportLineMessages;
    readonly wizard: {
        /** `{count}` lines to choose; contains `{n}`, `{total}`. */
        readonly progress: PluralText;
        /** A recipe with nothing to choose (contains `{n}`, `{total}`). */
        readonly progressNothing: string;
        /** The progress bar's accessible name. */
        readonly progressLabel: string;
        readonly back: string;
        /** Back's accessible name (contains `{n}`, the recipe it returns to). */
        readonly backName: string;
        readonly skip: string;
        readonly next: string;
        readonly saveLeave: string;
        /** The bottom bar's accessible name. */
        readonly actionsLabel: string;
        /** A recipe whose every line is matched (`{count}` ingredients). */
        readonly nothingToFix: PluralText;
        /** The loading caption (contains `{n}`, `{total}`). */
        readonly loading: string;
        /** The load failure's title (contains `{recipe}`). */
        readonly errorTitle: string;
        readonly errorBody: string;
        readonly retry: string;
        readonly skipRecipe: string;
        /** Offline: two sentences, the second saying the review resumes by itself. */
        readonly offline: string;
        readonly rail: {
            /** The rail's accessible name. */
            readonly label: string;
            /** `{count}` recipes to review. */
            readonly title: PluralText;
            /** A skipped recipe's row (contains `{recipe}`). */
            readonly skipped: string;
            /** The recipes added without a step (`{count}`). */
            readonly rest: PluralText;
        };
    };
    readonly leave: {
        readonly title: string;
        /** Contains `{reviewed}`, `{total}`. */
        readonly reviewed: string;
        /** The recipes saved now (`{count}`). */
        readonly rest: PluralText;
        /** Where they wait and where the review resumes (contains `{next}`). */
        readonly resume: string;
        readonly keep: string;
        readonly confirm: string;
        /** The sheet's close control (house form "Close {thing}"). Closing keeps reviewing, and the name says so. */
        readonly close: string;
    };
    readonly summary: {
        readonly title: string;
        /** Contains `{source}`, `{when}` (already formatted by the host). */
        readonly from: string;
        /** `{count}` added. */
        readonly added: PluralText;
        /** Contains `{nothing}`, `{reviewed}`, `{skipped}`. */
        readonly breakdown: string;
        readonly seeThem: string;
        /** `{count}` already here. */
        readonly alreadyHere: PluralText;
        readonly alreadyHereHint: string;
        /** `{count}` could not be read. */
        readonly unreadable: PluralText;
        readonly fix: string;
        /** `{count}` lines kept as written; contains `{recipes}`, filled from `asWrittenRecipes`. */
        readonly asWrittenLines: PluralText;
        /** `{count}` recipes, inside `asWrittenLines`. */
        readonly asWrittenRecipes: PluralText;
        readonly chooseFoods: string;
        readonly coverageTitle: string;
        /** Contains `{counted}`, `{total}`. */
        readonly coverage: string;
        readonly coverageHint: string;
    };
    readonly flagged: {
        /** `{count}` to check. */
        readonly title: PluralText;
        /** `{count}` doubted. */
        readonly intro: PluralText;
        /** A row's line and its recipe (contains `{line}`, `{recipe}`). */
        readonly lineContext: string;
        /** Contains `{food}`, the doubted match. */
        readonly doubt: string;
        /** The row's one action (contains `{food}`). */
        readonly use: string;
        /** Its accessible name (contains `{food}`, `{line}`). */
        readonly useName: string;
        /** The labelled Search button. */
        readonly search: string;
        /** Its accessible name (contains `{line}`). */
        readonly searchName: string;
        /** Contains `{count}`. */
        readonly footer: string;
        /** The options sheet's close control (house form "Close {thing}"; contains `{line}`). */
        readonly sheetClose: string;
    };
}

/** The bulk import's matching copy, `en` only (the one shipped locale). */
export const importMessages: LocalizedMessages<ImportMessages> = {
    en: {
        mode: {
            title: 'Bring in your library',
            fileSummary: { one: '{source} · {count} recipe', other: '{source} · {count} recipes' },
            intro: 'Choose how ingredients are matched to foods. Nutrition comes from the food.',
            groupLabel: 'How to match ingredients',
            saveAsWrittenTitle: 'Save lines as written',
            saveAsWrittenHint:
                'Matched foods and the usual defaults are set. Every other line is saved as written, with no food, for you to choose later.',
            bestTitle: 'Pick the best match for me',
            bestHint:
                'Every line takes its best match. A check runs on each one after saving, and lists any it doubts for you to look at.',
            reviewTitle: 'Let me review each recipe',
            reviewHint: 'Go through the recipes one at a time and choose foods. You can save and leave at any time.',
            start: 'Start the import',
            startHint: 'Choose one to start. You can change any food later.',
            promise:
                'Whatever you choose, nothing is ever matched to a food you did not mean without you being able to see and change it.',
        },
        line: {
            search: 'Search for a food',
            searchName: 'Search for a food for {line}',
            optionsLabel: 'Food for {line}',
            keepAsWritten: 'Keep “{line}” as written',
            keepHint: 'No nutrition for this line',
            defaultTag: 'Default',
            defaultPrompt: 'Choose the {noun} you use',
            needsChoicePrompt: 'More than one food fits. Nothing is chosen for you.',
            noMatchPrompt: 'No food found for this',
            closedNeed: { one: 'Choose a food · {count} option', other: 'Choose a food · {count} options' },
            closedDefault: {
                one: 'Choose the {noun} you use · {count} option',
                other: 'Choose the {noun} you use · {count} options',
            },
            closedNoMatch: 'No food found · search or keep as written',
            checkingTag: 'Checking',
            useThis: 'Use this',
            useThisName: 'Use this: {food} for {line}',
            change: 'Change',
            changeName: 'Change the food for {line}',
            yourChoice: 'your choice',
            keptAsWritten: 'Kept as written',
            lateSuggestion: 'Our check suggested {food}. Your choice stays.',
            seeWhy: 'See why',
            seeWhyName: 'See why our check suggested {food} for {line}',
        },
        wizard: {
            progress: {
                one: 'Recipe {n} of {total} · {count} line to choose',
                other: 'Recipe {n} of {total} · {count} lines to choose',
            },
            progressNothing: 'Recipe {n} of {total}',
            progressLabel: 'Recipes reviewed',
            back: 'Back',
            backName: 'Back to recipe {n}',
            skip: 'Skip',
            next: 'Next recipe',
            saveLeave: 'Save and leave',
            actionsLabel: 'Review',
            nothingToFix: {
                one: 'The ingredient is matched. You can change it.',
                other: 'All {count} ingredients are matched. You can change any of them.',
            },
            loading: 'Reading recipe {n} of {total}…',
            errorTitle: 'We couldn’t load {recipe}',
            errorBody: 'Your choices so far are saved.',
            retry: 'Try again',
            skipRecipe: 'Skip this recipe',
            offline:
                'You’re offline. Your choices are saved on this device. The review picks up here when you’re back online. Recipes you have not reviewed wait.',
            rail: {
                label: 'Recipes to review',
                title: { one: '{count} recipe to review', other: '{count} recipes to review' },
                skipped: '{recipe} · skipped',
                rest: {
                    one: '{count} more needed nothing from you and is already in.',
                    other: '{count} more needed nothing from you and are already in.',
                },
            },
        },
        leave: {
            title: 'Save and leave?',
            reviewed: 'You reviewed {reviewed} of {total} recipes.',
            rest: {
                one: 'The other {count} is saved now. Matched foods and the usual defaults are set, with a Default tag. Every other line is kept as written.',
                other: 'The other {count} are saved now. Matched foods and the usual defaults are set, with a Default tag. Every other line is kept as written.',
            },
            resume: 'They wait under “To review” in My recipes, and you can pick up at recipe {next}.',
            keep: 'Keep reviewing',
            confirm: 'Save and leave',
            close: 'Close and keep reviewing',
        },
        summary: {
            title: 'Your library is in',
            from: 'From {source}, {when}.',
            added: { one: '{count} added', other: '{count} added' },
            breakdown: '{nothing} needed nothing · {reviewed} you reviewed · {skipped} you skipped',
            seeThem: 'See them',
            alreadyHere: { one: '{count} already here', other: '{count} already here' },
            alreadyHereHint: 'Matched to recipes you have',
            unreadable: { one: '{count} could not be read', other: '{count} could not be read' },
            fix: 'Fix',
            asWrittenLines: {
                one: '{count} line in {recipes} is kept as written, so it doesn’t count toward nutrition yet.',
                other: '{count} lines in {recipes} are kept as written, so they don’t count toward nutrition yet.',
            },
            asWrittenRecipes: { one: '{count} recipe', other: '{count} recipes' },
            chooseFoods: 'Choose foods',
            coverageTitle: 'Nutrition coverage',
            coverage: '{counted} of {total} recipes',
            coverageHint: 'have every ingredient counted.',
        },
        flagged: {
            title: { one: '{count} to check', other: '{count} to check' },
            intro: {
                one: 'Our check doubted {count} of the matches it picked for you. Nothing changes until you choose.',
                other: 'Our check doubted {count} of the matches it picked for you. Nothing changes until you choose.',
            },
            lineContext: '{line} · {recipe}',
            doubt: 'Matched to {food}. Our check doubts it.',
            use: 'Use {food}',
            useName: 'Use {food} for {line}',
            search: 'Search',
            searchName: 'Search for a food for {line}',
            footer: 'Each line also has a mark in its recipe. “{count} to check” stays at the top of My recipes until you are done.',
            sheetClose: 'Close options for {line}',
        },
    },
};
