/**
 * PLANNED: the edges the recipe state model names that are NOT built (5.8). Nothing at runtime reads this list, and
 * `nextState` and `canTransition` never do. Each row names the work that builds it, and the edge moves into
 * `TRANSITIONS` in the change that enforces it (ADR-0103). The cells are the document's own words, so the generated
 * table (`packages/tools/recipeStateDoc`) reads them straight.
 */

/** One planned edge. The cells are documentation, not state names a guard could read. */
export interface PlannedTransition {
    readonly axis: string;
    readonly from: string;
    readonly event: string;
    readonly actor: string;
    readonly guard: string;
    readonly to: string;
    /** The work that builds it. Never empty. */
    readonly pending: string;
}

export const PLANNED: readonly PlannedTransition[] = [
    {
        axis: 'holds',
        from: '`HOLD_SOURCE_CORRECTED` set',
        event: '`CLEAR_SOURCE_HOLD`',
        actor: 'staff',
        guard: '5.4',
        to: 'unset',
        pending: 'PR 5',
    },
    {
        axis: 'holds',
        from: 'unset, on a public `ORIGIN_COMMISE_WRITTEN` page',
        event: '`REPORT`',
        actor: 'any signed-in cook',
        guard: 'the reporter submits the form. No staff step before the hide',
        to: '`HOLD_HIDDEN_AFTER_REPORT` set, at once',
        pending: '020-FR-082, 003B FR-063',
    },
    {
        axis: 'holds',
        from: '`HOLD_HIDDEN_AFTER_REPORT` set',
        event: '`CLEAR_REPORT_HIDE`',
        actor: 'staff',
        guard: 'a recorded decision',
        to: 'unset',
        pending: '020',
    },
    {
        axis: 'holds',
        from: 'unset',
        event: '`REMOVE` / `RESTORE_AFTER_APPEAL`',
        actor: 'staff',
        guard: 'removal decision / appeal decision',
        to: '`HOLD_REMOVED` set / unset',
        pending: '016',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPu (third-party origin, `ORIGIN_COMMISE_WRITTEN` included)',
        event: '`SAVE`',
        actor: 'cook',
        guard: 'the sync check finds the wording too close (`detected` in the save), and a private slot is free',
        to: 'PPr, saved, with `VIEW_TOO_CLOSE_SAVED_PRIVATE`',
        pending: '020 (ADR-0074 §3a), P4',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPu (same)',
        event: '`SAVE`',
        actor: 'cook',
        guard: 'too close, and no free private slot',
        to: 'refused `REFUSAL_DETECTED_NO_PRIVATE_SLOT`. Nothing saved. `VIEW_TOO_CLOSE_NO_SLOT`',
        pending: '020, P4',
    },
    {
        axis: 'lifecycle × audience',
        from: 'DPr, DPu, PPr (same origins)',
        event: '`MAKE_PUBLIC` / `PUBLISH` to public',
        actor: 'cook',
        guard: 'too close',
        to: 'the recipe is saved private (a slot as for any private recipe), with `VIEW_TOO_CLOSE_SAVED_PRIVATE`. No slot: as the row above',
        pending: '020, P4',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPu',
        event: '`REVIEW_FOUND_TOO_CLOSE`',
        actor: 'system',
        guard: 'the async review of a public recipe',
        to: 'PPr at once, as ADR-0074 §3a says. Owner notified, `VIEW_TOO_CLOSE_AFTER_REVIEW`. With no free private slot it still goes private, over the limit (`FORCE_PRIVATE`, ADR-0073). The box offers editing to make it public again',
        pending: 'the review feature',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPu, PPr in review',
        event: '`FORCE_PRIVATE`',
        actor: 'system, staff',
        guard: 'review ended without approval (ADR-0074 §3a)',
        to: 'PPr',
        pending: '020',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPr',
        event: '`MAKE_PUBLIC`',
        actor: 'cook',
        guard: 'refused by `REFUSAL_CONTENT_NOT_APPROVED` for the same content',
        to: 'none',
        pending: '020',
    },
    {
        axis: 'lifecycle × audience',
        from: 'PPu, with the source evidence holding it off Public (`publicNeedsCheck`)',
        event: 'editor `SAVE`',
        actor: 'cook',
        guard: 'the cook saves an edit. The recipe stays public and the check reruns on the new text (owner ruling, 2026-11-27). Today the editor sends it private (#412), which this replaces',
        to: 'PPu, with the check rerun',
        pending: 'pending: P10 (#412)',
    },
    {
        axis: 'lifecycle × audience',
        from: 'same',
        event: '`RERUN_CHECK_FAILS_IN_SAVE`',
        actor: 'system',
        guard: 'the check on the new text fails',
        to: 'PPr, with `VIEW_SOURCE_HOLD_SAVED_PRIVATE`',
        pending: 'pending: P10 (#412)',
    },
    {
        axis: 'lifecycle × audience',
        from: 'same',
        event: '`RERUN_CHECK_FAILS_LATER`',
        actor: 'system',
        guard: 'the check fails after the cook left the editor. With no free private slot it still goes private, over the limit (`FORCE_PRIVATE`, ADR-0073), and is not refused',
        to: 'PPr, with `VIEW_SOURCE_HOLD_AFTER_CHECK`',
        pending: 'pending: P10 (#412)',
    },
    {
        axis: 'lifecycle × audience',
        from: 'same',
        event: '`SITE_CLAIM_NOT_CONFIRMED` (once 016 FR-069 site claims exist)',
        actor: 'system',
        guard: 'the claim to the site is not confirmed',
        to: 'PPr, with the box line "We couldn’t confirm that {site} is your site, so this recipe can’t be public."',
        pending: 'pending: 016 FR-069',
    },
    {
        axis: 'lifecycle × audience',
        from: 'a copy of a public version, private',
        event: '`MAKE_PUBLIC`',
        actor: 'cook',
        guard: 'after the check',
        to: 'PPu',
        pending: '021-FR-005',
    },
    {
        axis: 'origin',
        from: '`ORIGIN_PAID_SITE`',
        event: '`MOVE_TO_BOOK`',
        actor: 'staff, or system for a known cookbook site',
        guard: '`REWRITTEN_BY_COOK`, and the site hosts a cookbook or evidence shows it',
        to: '`ORIGIN_BOOK`',
        pending: 'P4',
    },
    {
        axis: 'rewritten fact',
        from: '`REWRITTEN_ABSENT`',
        event: '`COOK_EDIT_PASSES` (cook edit passes the difference check)',
        actor: 'system',
        guard: 'third-party origin',
        to: '`REWRITTEN_BY_COOK` (shows `VIEW_ADAPTED_BY_COOK`)',
        pending: 'P4',
    },
    {
        axis: 'rewritten fact',
        from: '`REWRITTEN_ABSENT`',
        event: '`KEEP_AI_REWRITE` (cook keeps an AI rewrite that passes)',
        actor: 'system',
        guard: 'third-party origin',
        to: '`REWRITTEN_BY_AI` + `STEPS_BY_AI`',
        pending: 'P4',
    },
    {
        axis: 'rewritten fact',
        from: '`REWRITTEN_BY_AI`',
        event: '`COOK_REWRITES` (cook rewrites, passes against the source and the AI text)',
        actor: 'system',
        guard: '',
        to: '`REWRITTEN_BY_COOK` + `STEPS_BY_COOK`',
        pending: 'P4',
    },
    {
        axis: 'steps credit',
        from: 'any',
        event: 'cook keeps an AI rewrite (own, person, public domain)',
        actor: 'cook',
        guard: 'none',
        to: '`STEPS_BY_AI`',
        pending: '027',
    },
    {
        axis: 'bulk',
        from: 'each item of a 003B job',
        event: '`MAKE_THE_REST_PUBLIC`',
        actor: 'cook',
        guard: 'per-item status under `PUBLIC_VERSION_JOB_*`',
        to: 'per item',
        pending: 'P13',
    },
];
