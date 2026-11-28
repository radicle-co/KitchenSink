/**
 * RETIRED_NAMES: the words the model replaced (6). The retired-names ratchet (PR 4) counts each `old` in production
 * source, specs, boards and messages, and the count only falls. The cells are the document's own words.
 */

/** Which of the document's three retired tables a row belongs to. */
export type RetiredGroup = 'audience' | 'originAndCopies' | 'checkAndRefusals';

/** One retired name and what replaces it. */
export interface RetiredName {
    readonly group: RetiredGroup;
    readonly old: string;
    readonly replacement: string;
    readonly note: string;
}

export const RETIRED_NAMES: readonly RetiredName[] = [
    {
        group: 'audience',
        old: '"Publish privately" (label of answer `publishPrivately`)',
        replacement:
            '`ANSWER_UNSTATED_PRIVATE`: label "I’m not sure yet", hint "It stays private. You can say where it’s from later." The answer value and the flow stay',
        note: 'E `publishPrivate` "Publish as private" is a button, not a label, and stays',
    },
    {
        group: 'audience',
        old: '"private draft"',
        replacement: '`LIFECYCLE_DRAFT` + `AUDIENCE_PRIVATE`',
        note: 'The slots line becomes "Drafts don’t count toward your {total} private recipes."',
    },
    {
        group: 'audience',
        old: '"private slots" (cook-facing)',
        replacement: '"private recipes"',
        note: 'canvases, `privateRefused.slots`. Own task, after #488 merges',
    },
    {
        group: 'audience',
        old: '`importChoice.both`',
        replacement: '`IMPORT_CHOICE_BOTH`',
        note: 'moved off the recipe',
    },
    {
        group: 'originAndCopies',
        old: '"Copied from a public web page", "From a public web page", "Saved from" (as a label)',
        replacement: '`ORIGIN_WEB_PAGE`',
        note: '"Saved from {site}…" stays as `CREDIT_SAVED_FROM`. The guard matches it only as a label',
    },
    { group: 'originAndCopies', old: '"From a paid site"', replacement: '`ORIGIN_PAID_SITE`', note: '' },
    {
        group: 'originAndCopies',
        old: '"Commise version", "public version" (as a label), "Steps written by Commise" (as a page label)',
        replacement: '`ORIGIN_COMMISE_WRITTEN` "Written by Commise"',
        note: 'The AI line "Steps written by Commise with AI, …" and 027\'s credit lines are not labels and stay',
    },
    {
        group: 'originAndCopies',
        old: '"Adapted in my own words", 016 label 2',
        replacement: '`VIEW_ADAPTED_BY_COOK`',
        note: '',
    },
    {
        group: 'originAndCopies',
        old: '"Adapted from" (source heading)',
        replacement: '`SOURCE_HEADING` "Source"',
        note: '',
    },
    {
        group: 'originAndCopies',
        old: '"Adapted from" (copy line), "Cloned from", the hard-coded "Copied from @…" form',
        replacement: '`VIEW_COPY_OF` "Copied from {name}"',
        note: '',
    },
    {
        group: 'originAndCopies',
        old: '"Written by AI", "AI, edited by you"',
        replacement: '`STEPS_BY_AI` credit line',
        note: 'stale boards',
    },
    {
        group: 'originAndCopies',
        old: '`public_web`, `imported_public`, `imported_physical`, `imported_paid`, `user_created`, `source_type`, `source_kind`, `statement_kind` (on `recipes`)',
        replacement: '`recipes.origin` and the `ORIGIN_*` names',
        note: 'PR 3. The evidence `source_kind` and the import item `statement_kind` stay',
    },
    {
        group: 'checkAndRefusals',
        old: '"Not approved" (bare, as a chip)',
        replacement: '`VIEW_NOT_APPROVED`, a line under Private',
        note: '',
    },
    {
        group: 'checkAndRefusals',
        old: '"A public version is being checked"',
        replacement: '`VIEW_IN_REVIEW`',
        note: '',
    },
    {
        group: 'checkAndRefusals',
        old: '"Checking" / "Checking…" (ingredient tag)',
        replacement: '"Matching…"',
        note: '',
    },
    { group: 'checkAndRefusals', old: '"Unsaved changes"', replacement: '`VIEW_CHANGES_ON_DEVICE`', note: '' },
    {
        group: 'checkAndRefusals',
        old: 'the `details.reason` values `FROM_PERSON_PRIVATE_ONLY`, `SOURCE_CONFLICT`, `SOURCE_CORRECTED`, `STATEMENT_REQUIRED`, `PUBLIC_CONFIRMATION_REQUIRED`, `API_WRITER_CONFIRMATION_FORBIDDEN`, and the code names `privateSlots`, `policy`',
        replacement: 'the `REFUSAL_*` names',
        note: 'PR 2b (wire). Top-level error codes stay',
    },
    {
        group: 'checkAndRefusals',
        old: '`source_correction_hold` (as a concept name)',
        replacement: '`HOLD_SOURCE_CORRECTED`',
        note: 'the column stays',
    },
    {
        group: 'checkAndRefusals',
        old: '`RESTRICTION_*`, `REFUSAL_ADAPTATION_TOO_CLOSE`',
        replacement: '`HOLD_*`, `REFUSAL_DETECTED_NO_PRIVATE_SLOT`',
        note: 'names never used in code',
    },
];
