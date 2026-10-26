/**
 * @module @commise/features-recipes/import/messages — user-facing copy for bulk import's ingredient matching: the mode
 * choice, the review wizard, its states, Save and leave, the end summary and the lines to check
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md` "Bulk import"; the feature 004 boards
 * ImportModeChoice, WizardStep, WizardStates, WizardLeave, WizardSummary and FlaggedLine). One {@link LocalizedMessages}
 * set read by BOTH the web and the native leaves, so the platforms cannot drift on copy. Templates carry `{token}`
 * placeholders filled with `fillTemplate`; counts are {@link PluralText} filled with `pluralOf`.
 *
 * The top-level groups follow the spec's key groups (`import.mode.*`, `import.wizard.*`, `import.summary.*`,
 * `import.flagged.*`); `leave` is the spec's `import.wizard.leave.*`. The leaf names inside them are this module's own,
 * chosen for what each string does, and do NOT repeat the spec's (it names `import.mode.saveAsWritten.*`, this module
 * `mode.saveAsWrittenTitle`). The words are the boards'.
 *
 * A matched LINE's words — Search for a food, the prompts, Change, "your choice", the late review note — are not here:
 * they are the neutral matched-line copy (`ingredientMatching/messages.ts`), which the editor's paste flow reads too.
 *
 * ⚠️ Every accessible name that differs from its control's visible words STARTS with those words (WCAG 2.5.3, label in
 * name), and names its line, because a list shows several controls with the same words at once.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { PluralText } from '../format/plural.js';

/** Copy for the bulk import's matching surfaces. */
export interface ImportMessages {
    /**
     * The spec's `import.saveAsWritten.*`: the ONE sentence that says what "Save lines as written" does, read by the mode
     * choice (as that mode's hint) and by Save and leave (which saves the rest the same way), so the two cannot differ.
     */
    readonly saveAsWritten: {
        readonly rule: string;
    };
    readonly mode: {
        readonly title: string;
        /** The file's source and size (contains `{source}`; `{count}` recipes). */
        readonly fileSummary: PluralText;
        readonly intro: string;
        /** The radio group's accessible name. */
        readonly groupLabel: string;
        readonly saveAsWrittenTitle: string;
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
    readonly wizard: {
        /** Where the review is (contains `{n}`, `{total}`); the counts below follow it, each after `partSeparator`. */
        readonly progress: string;
        /**
         * `{count}` to choose: default, needsChoice and noMatch lines with nothing bound ("Recipe {n} of {total} ·
         * {choose} to choose · {checking} being checked", commit 7b62777fc).
         */
        readonly toChoose: PluralText;
        /** `{count}` lines still being checked, counted on their own, never as lines to choose. */
        readonly beingChecked: PluralText;
        /** Joins the progress line's parts: a no-break space, so a dot never starts a line, then a middle dot. */
        readonly partSeparator: string;
        /** The progress bar's accessible name; its value is the recipe's place, as the words say. */
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
        /** `{count}` recipes in all; contains `{reviewed}`. */
        readonly reviewed: PluralText;
        /** The recipes saved now (`{count}`). What happens to their lines is `saveAsWritten.rule`. */
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
        /** The stat, whole on its own: `{count}` recipes added; contains `{counted}`. */
        readonly coverage: PluralText;
        /** The caption under the stat, whole on its own: what "counted" means. */
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
        /**
         * The spec's `import.flagged.chooseAnother`: the row's way to another food. It opens the line's options, search
         * first (the sheet below the wide class, the pane at it).
         */
        readonly chooseAnother: string;
        /** Its accessible name, which starts with its visible words (WCAG 2.5.3; contains `{line}`). */
        readonly chooseAnotherName: string;
        /** Contains `{title}`, filled with the title's own plural, so the two always say the same words. */
        readonly footer: string;
        /** The options sheet's close control (house form "Close {thing}"; contains `{line}`). */
        readonly sheetClose: string;
    };
}

/** The bulk import's matching copy, `en` only (the one shipped locale). */
export const importMessages: LocalizedMessages<ImportMessages> = {
    en: {
        saveAsWritten: {
            rule: 'Matched foods and the usual defaults are set, and each default keeps its Default tag. Every other line is saved as written, with no food, for you to choose later.',
        },
        mode: {
            title: 'Bring in your library',
            fileSummary: { one: '{source}\u00A0· {count} recipe', other: '{source}\u00A0· {count} recipes' },
            intro: 'Choose how ingredients are matched to foods. Nutrition comes from the food.',
            groupLabel: 'How to match ingredients',
            saveAsWrittenTitle: 'Save lines as written',
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
        wizard: {
            progress: 'Recipe {n} of {total}',
            toChoose: { one: '{count} to choose', other: '{count} to choose' },
            beingChecked: { one: '{count} being checked', other: '{count} being checked' },
            partSeparator: '\u00A0· ',
            progressLabel: 'Review progress',
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
                skipped: '{recipe}\u00A0· skipped',
                rest: {
                    one: '{count} more needed nothing from you and is already in.',
                    other: '{count} more needed nothing from you and are already in.',
                },
            },
        },
        leave: {
            title: 'Save and leave?',
            reviewed: {
                one: 'You reviewed {reviewed} of {count} recipe.',
                other: 'You reviewed {reviewed} of {count} recipes.',
            },
            rest: { one: 'The other {count} is saved now.', other: 'The other {count} are saved now.' },
            resume: 'They wait under “To review” in My recipes, and you can pick up at recipe {next}.',
            keep: 'Keep reviewing',
            confirm: 'Save and leave',
            close: 'Close and keep reviewing',
        },
        summary: {
            title: 'Your library is in',
            from: 'From {source}, {when}.',
            added: { one: '{count} added', other: '{count} added' },
            breakdown: '{nothing} needed nothing\u00A0· {reviewed} you reviewed\u00A0· {skipped} you skipped',
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
            coverage: { one: '{counted} of {count} recipe', other: '{counted} of {count} recipes' },
            coverageHint: 'Counted means every ingredient has a food.',
        },
        flagged: {
            title: { one: '{count} to check', other: '{count} to check' },
            intro: {
                one: 'Our check doubted {count} of the matches it picked for you. Nothing changes until you choose.',
                other: 'Our check doubted {count} of the matches it picked for you. Nothing changes until you choose.',
            },
            lineContext: '{line}\u00A0· {recipe}',
            doubt: 'Matched to {food}. Our check doubts it.',
            use: 'Use {food}',
            useName: 'Use {food} for {line}',
            chooseAnother: 'Choose another',
            chooseAnotherName: 'Choose another food for {line}',
            footer: 'Each line also has a mark in its recipe. “{title}” stays at the top of My recipes until you are done.',
            sheetClose: 'Close options for {line}',
        },
    },
};
