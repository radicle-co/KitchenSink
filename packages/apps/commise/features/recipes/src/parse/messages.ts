/**
 * @module @commise/features-recipes/parse/messages — user-facing copy for the paste-and-review ingredient
 * parse surface (plan U9, origin D9/R13).
 *
 * Platform-neutral strings consumed by BOTH the web and native leaves via `useMessages`, so the two
 * platforms cannot drift on what they tell a cook about a job. Mirrors the shape of the feature's sibling
 * message sets; the `en` set is required and adding a locale is another key.
 *
 * ## ⛔ `reviewReasons` IS A LOOKUP WITH A FALLBACK, and both halves are load-bearing
 *
 * The wire types `reviewReasons` as `string[]` deliberately: the taxonomy (`IngredientReviewReason`) lives
 * in `@kitchensink/recipe-import-core`, which the schema package may not import, and enumerating it on the
 * wire would make a second authority that drifts the moment the pipeline adds a reason. The published
 * contract's instruction to clients is exact — "treat reasons as opaque display keys with a fallback" — so
 * this map is PARTIAL BY CONSTRUCTION and {@link RecipeParseMessages.reasonUnknown} is what a key this build
 * has never seen renders as. A deployed pipeline emitting a new reason must degrade to a vague-but-true
 * sentence, never to a blank chip and never to a raw snake_case key shown to a cook.
 *
 * ⚠️ Two reasons in that taxonomy are deliberately ABSENT rather than forgotten: `empty_input` and
 * `multiline_input` cannot reach this surface, because `splitParseJobLines` drops blank lines and splits on
 * newlines before a job is ever created. Copy for a state that cannot occur is dead weight a reader has to
 * reason about, and the fallback covers them if that ever changes.
 *
 * ## ⚠️ The "settling" sentence must not read as a failure
 *
 * A `partial` job self-heals: an enqueue failure marks lines whose messages DID send, and each of those
 * lands and flips itself to `parsed` with no retry pressed. So the copy says the lines "may still finish on
 * their own" and offers the retry as an option rather than an instruction. A flat "10 lines failed" would
 * be false for most of the window it is on screen.
 */
import type { LocalizedMessages } from '@commise/i18n';

/**
 * Singular/plural templates for the paste form's line count.
 *
 * ⚠️ THE ORIGINAL NOTE HERE WAS WRONG ON ITS FACTS and is corrected rather than quietly deleted, because it
 * would have been cited as precedent. It claimed this was "a SECOND occurrence" of the
 * `Intl.PluralRules`-select-then-`fillTemplate` shape and invoked the wait-for-the-third rule. Counted:
 * `list/model.ts`, `rating/model.ts`, `card/model.ts` and `filters/model.ts` already carry it — so the rule
 * had fired three occurrences earlier, not later.
 *
 * ⛔ Reusing `formatRecipeCount` is still refused, and for the reason that survives the recount: its name
 * would lie at this call site. What changed is the SITE — the helper now lives once in `parse/model.ts`
 * rather than as a private copy inside each platform leaf, which is exactly the drift the one-contract-
 * two-renderers shape exists to make impossible.
 */
export interface ParseLineCountLabels {
    readonly one: string;
    readonly other: string;
}

/** Copy for the paste form, the progress surface, and every state a parse job can be in. */
export interface RecipeParseMessages {
    /** Heading of the paste surface. */
    readonly pasteHeading: string;
    /** One sentence explaining what pasting does. */
    readonly pasteIntro: string;
    /** Label of the multi-line paste field. */
    readonly pasteLabel: string;
    /** Placeholder shown in the empty paste field — an example block, so the expected shape is obvious. */
    readonly pastePlaceholder: string;
    /** Label of the submit control. */
    readonly pasteSubmit: string;
    /** Announced while the job is being created. */
    readonly pasteSubmitting: string;
    /** The create request itself failed. The paste is preserved; the cook may try again. */
    readonly pasteFailed: string;
    /**
     * Live count of admissible lines in the field — the SPLITTER's count, so it matches what the job will
     * store. Singular/plural templates, each containing `{count}`, selected by `Intl.PluralRules`.
     */
    readonly pasteLineCount: ParseLineCountLabels;
    /** A line is past the per-line character cap. Contains `{line}` (1-based) and `{max}`. */
    readonly refusalLineTooLong: string;
    /** The paste carries more lines than one job may hold. Contains `{max}`. */
    readonly refusalTooManyLines: string;
    /** The paste has no non-empty lines at all. */
    readonly refusalNoLines: string;

    /** Heading of the review surface. */
    readonly reviewHeading: string;
    /** Accessible label for the job's progress region. */
    readonly progressLabel: string;
    /** Progress readout. Contains `{settled}` and `{total}`. */
    readonly progressCount: string;
    /** Announced while the first view of a job is loading. */
    readonly loading: string;
    /** Shown while lines are still being parsed. */
    readonly running: string;
    /** The job has been running far longer than expected — see `PARSE_JOB_STALL_BOUND_MS`. */
    readonly stalled: string;
    /** ⚠️ Some lines did not go through, and may yet finish on their own. NEVER phrased as a flat failure. */
    readonly settling: string;
    /** Every line has settled. */
    readonly ready: string;
    /** The job passed its 24-hour review deadline. The remedy is a fresh paste, never a retry. */
    readonly expired: string;
    /** The job does not exist, or belongs to someone else — one sentence, because it is one answer. */
    readonly missing: string;
    /** The job could not be loaded at all. */
    readonly failed: string;
    /** Label of the control that re-drives the lines that did not go through. */
    readonly retryAction: string;
    /** Label of the control that abandons this job and returns to the paste form. */
    readonly startOverAction: string;
    /**
     * ⛔ Label of the control that LEAVES the parse surface entirely.
     *
     * Required on both leaves and rendered in EVERY state, including the ones that offer nothing else.
     * Web hosts these routes inside `AppShell`, whose nav is always an exit; mobile's stack has no chrome
     * at all behind a pushed surface, so without this a cook on the paste screen — or on a review that is
     * still `running` — had no way out but to kill the app. Keeping it in the SHARED contract rather than
     * in the mobile host is what stops that drift reopening.
     */
    readonly backAction: string;
    /** Announced while a retry is in flight. */
    readonly retrying: string;
    /** The retry was refused because the job had already expired. */
    readonly retryExpired: string;
    /** The retry failed for any other reason. */
    readonly retryFailed: string;

    /** Accessible label for one line's row. Contains `{line}` (1-based). */
    readonly lineLabel: string;
    /** Status word for a line whose parse has not landed yet. */
    readonly linePending: string;
    /** Status word for a line that parsed. */
    readonly lineParsed: string;
    /** Status word for a line the pipeline could not read — TERMINAL, so no retry is offered for it. */
    readonly lineUnparseable: string;
    /** Status word for a line that did not go through and can be re-driven. */
    readonly lineRetryable: string;
    /** Shown in place of the measure when the source stated no amount and no unit (R40 — never a `0`). */
    readonly lineNoMeasure: string;
    /** Shown in place of the food list when the line named none (a heading is a fact, not a failure). */
    readonly lineNoFoods: string;
    /** Label of the control that edits one line's text. Contains `{line}` (1-based). */
    readonly lineEditAction: string;
    /** Label of the field holding a line's replacement text. */
    readonly lineEditLabel: string;
    /** Label of the control that submits a line edit. */
    readonly lineEditSubmit: string;
    /** Label of the control that abandons a line edit. */
    readonly lineEditCancel: string;
    /** The line edit was refused because the job had already expired. */
    readonly lineEditExpired: string;
    /** The line edit failed for any other reason. */
    readonly lineEditFailed: string;
    /** Accessible label for a line's review-reason list. */
    readonly reasonsLabel: string;
    /** Accessible label for the list of submitted lines — one `list` role among several on this surface. */
    readonly lineListLabel: string;
    /** Accessible label for one line's proposed-food list. */
    readonly lineFoodsLabel: string;

    /**
     * Why a line still wants a human's eye, keyed by the wire's opaque reason key.
     *
     * ⛔ PARTIAL ON PURPOSE — see the module docstring. A key absent here renders
     * {@link RecipeParseMessages.reasonUnknown}.
     */
    readonly reasons: Readonly<Record<string, string>>;
    /** ⛔ The REQUIRED fallback for a reason key this build has never seen. Vague, but true. */
    readonly reasonUnknown: string;
}

/** The paste-and-review copy. */
export const recipeParseMessages: LocalizedMessages<RecipeParseMessages> = {
    en: {
        pasteHeading: 'Paste your ingredients',
        pasteIntro: 'Paste an ingredient list — one ingredient per line — and we’ll read it for you.',
        pasteLabel: 'Ingredient lines',
        pastePlaceholder: '2 cups flour\n1 tsp salt\n3 large eggs, beaten',
        pasteSubmit: 'Read my ingredients',
        pasteSubmitting: 'Sending your ingredients…',
        pasteFailed: 'We couldn’t start reading that. Your text is still here — try again.',
        pasteLineCount: { one: '{count} line ready', other: '{count} lines ready' },
        refusalLineTooLong: 'Line {line} is longer than {max} characters. Shorten it and try again.',
        refusalTooManyLines: 'That’s more than {max} lines. Paste them in smaller batches.',
        refusalNoLines: 'There’s nothing to read yet — paste an ingredient list above.',

        reviewHeading: 'Your ingredients',
        progressLabel: 'Parsing progress',
        progressCount: '{settled} of {total} lines read',
        loading: 'Loading your ingredients…',
        running: 'Reading your ingredients…',
        stalled: 'This is taking longer than usual. You can wait, try the unfinished lines again, or start over.',
        settling: 'Some lines haven’t come back yet. They may still finish on their own — or you can try them again.',
        ready: 'All done. Check anything marked below.',
        expired: 'This list expired after 24 hours. Paste it again to pick up where you left off.',
        missing: 'We couldn’t find that list.',
        failed: 'We couldn’t load that list.',
        retryAction: 'Try the unfinished lines again',
        startOverAction: 'Start over',
        backAction: 'Back to recipes',
        retrying: 'Trying those lines again…',
        retryExpired: 'This list expired while you were away. Paste it again to carry on.',
        retryFailed: 'That didn’t go through. Try again in a moment.',

        lineLabel: 'Line {line}',
        linePending: 'Reading…',
        lineParsed: 'Read',
        lineUnparseable: 'Couldn’t read',
        lineRetryable: 'Didn’t go through',
        lineNoMeasure: 'No amount given',
        lineNoFoods: 'No ingredient found on this line',
        lineEditAction: 'Edit line {line}',
        lineEditLabel: 'Corrected line',
        lineEditSubmit: 'Save and re-read',
        lineEditCancel: 'Cancel',
        lineEditExpired: 'This list expired while you were away. Paste it again to carry on.',
        lineEditFailed: 'We couldn’t save that line. Try again in a moment.',
        reasonsLabel: 'Worth checking',
        lineListLabel: 'Your ingredient lines',
        lineFoodsLabel: 'Ingredients found on this line',

        reasons: {
            no_quantity: 'No amount given',
            quantity_out_of_storage_range: 'That amount looks out of range',
            quantity_bounds_inverted: 'The two amounts on this line disagree',
            group_header: 'This looks like a heading, not an ingredient',
            name_too_long: 'That ingredient name is unusually long',
            measurement_in_name: 'The measurement may have run into the name',
            additional_foods_dropped: 'This line named more than one ingredient',
            instruction_text_dropped: 'We left out some instruction text',
            not_a_food: 'We couldn’t find an ingredient on this line',
            measurement_unverified: 'Double-check the amount on this line',
        },
        reasonUnknown: 'Worth a look',
    },
};
