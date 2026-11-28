/**
 * PLANNED: the edges the recipe state model names that are NOT built (5.8). Nothing at runtime reads this list, and
 * `nextState` and `canTransition` never do. It is a subpath export (`@kitchensink/recipe-core/recipe-state/planned`) that only
 * the doc generator imports, so a runtime module cannot read it by accident (repoGuards holds that). Each row names the work that builds it, and the edge moves into
 * `TRANSITIONS` in the change that enforces it (ADR-0103). The cells are the document's own words, so the generated
 * table (`packages/tools/recipeStateDoc`) reads them straight.
 */

/** The axes a planned edge can be on. */
export type PlannedAxis = 'holds' | 'lifecycleAudience' | 'origin' | 'rewrittenFact' | 'stepsCredit' | 'bulk';

/** One planned edge. The cells are documentation, not state names a guard could read. */
export interface PlannedTransition {
    /** The axis, as a key. `holds` covers every hold, and the rest are the keys of the document's axes. */
    readonly axis: PlannedAxis;
    /** The axis as the document's table words it. */
    readonly axisLabel: string;
    /** The event as a name. Unique within the axis, and never an event of the enforced table on that axis. */
    readonly eventId: string;
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
        axisLabel: 'holds',
        eventId: 'CLEAR_SOURCE_HOLD',
        from: '`HOLD_SOURCE_CORRECTED` set',
        event: '`CLEAR_SOURCE_HOLD`',
        actor: 'staff',
        guard: '5.4',
        to: 'unset. Readable again if the audience is public and nothing else hides it (ADR-0105)',
        pending: 'PR 5',
    },
    {
        axis: 'holds',
        axisLabel: 'holds',
        eventId: 'REPORT',
        from: 'unset, on a public `ORIGIN_COMMISE_WRITTEN` page',
        event: '`REPORT`',
        actor: 'any signed-in cook',
        guard: 'the reporter submits the form. No staff step before the hide',
        to: '`HOLD_HIDDEN_AFTER_REPORT` set, at once',
        pending: '020-FR-082, 003B FR-063',
    },
    {
        axis: 'holds',
        axisLabel: 'holds',
        eventId: 'CLEAR_REPORT_HIDE',
        from: '`HOLD_HIDDEN_AFTER_REPORT` set',
        event: '`CLEAR_REPORT_HIDE`',
        actor: 'staff',
        guard: 'a recorded decision',
        to: 'unset',
        pending: '020',
    },
    {
        axis: 'holds',
        axisLabel: 'holds',
        eventId: 'REMOVE',
        from: 'unset',
        event: '`REMOVE` / `RESTORE_AFTER_APPEAL`',
        actor: 'staff',
        guard: 'removal decision / appeal decision',
        to: '`HOLD_REMOVED` set / unset',
        pending: '016',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'MAKE_PUBLIC_NOT_APPROVED',
        from: 'PPr',
        event: '`MAKE_PUBLIC`',
        actor: 'cook',
        guard: 'refused by `REFUSAL_CONTENT_NOT_APPROVED` for the same content',
        to: 'none',
        pending: '020',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'SAVE_CANNOT_STAY_PUBLIC',
        from: 'PPu, readable',
        event: 'editor `SAVE`',
        actor: 'cook',
        guard: 'the new content cannot stay public: a recorded source holds it, its steps are too close, or it was not approved',
        to: 'refused `REFUSAL_SAVE_CANNOT_STAY_PUBLIC`. Nothing saved. The edit stays on the device. The refused-save sheet',
        pending: 'P10 (held source), 020 (too close, not approved)',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'SAVE_AS_PRIVATE',
        from: 'PPu, readable, refused as above',
        event: '`SAVE_AS_PRIVATE`',
        actor: 'cook',
        guard: 'a private slot is free',
        to: 'PPr, saved',
        pending: 'P10',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'SAVE_AND_HIDE',
        from: 'PPu, readable, refused as above',
        event: '`SAVE_AND_HIDE`',
        actor: 'cook',
        guard: 'no free private slot, and the cook chose it',
        to: 'PPu, saved, hidden by the read rule. Chip `VIEW_HIDDEN`',
        pending: 'P10',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'SAVE_WHILE_HIDDEN',
        from: 'PPu, already held from readers',
        event: 'editor `SAVE`',
        actor: 'cook',
        guard: 'none: the sheet opens as for any save that cannot stay public',
        to: 'refused `REFUSAL_SAVE_CANNOT_STAY_PUBLIC` with a free private slot, so the cook picks a way. With no free private slot only an explicit Save and hide saves it: PPu, saved, still hidden',
        pending: 'P10',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'CREATE_CANNOT_GO_PUBLIC',
        from: 'none (create) or DPu',
        event: '`CREATE` / `PUBLISH` to public',
        actor: 'cook',
        guard: 'the content cannot go public',
        to: 'DPu, saved as a draft. The draft door',
        pending: 'P10, 020',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'PUBLISH_DRAFT_NO_SLOT',
        from: 'DPr',
        event: '`PUBLISH`',
        actor: 'cook',
        guard: 'no free private slot',
        to: 'DPr, unchanged. The draft door',
        pending: 'P10',
    },
    {
        axis: 'holds',
        axisLabel: 'holds',
        eventId: 'HIDE_AFTER_CHECK',
        from: 'unset, PPu',
        event: '`CHECK_FAILS_LATER` / `NOT_APPROVED` / `APPEAL_UPHELD` / `SITE_CLAIM_NOT_CONFIRMED`',
        actor: 'system, staff',
        guard: "ADR-0074's outcome, or the evidence rule, for the current content",
        to: 'hidden by the read rule. Audience unchanged. Notification',
        pending: '020, 016 FR-069',
    },
    {
        axis: 'holds',
        axisLabel: 'holds',
        eventId: 'SOURCE_HOLD_LIFTED_BY_REWRITE',
        from: 'evidence holds the recipe',
        event: '`REWRITE_EARNS_FACT`',
        actor: 'system',
        guard: 'ADR-0097 D3, in order: the P4a check passes, the source re-run passes, 020 allows. Any origin, own and unstated included (G1)',
        to: 'the evidence rule no longer holds it. Readable if nothing else hides it',
        pending: 'P10 (seam, stubbed), P4b, 020',
    },
    {
        axis: 'lifecycleAudience',
        axisLabel: 'lifecycle × audience',
        eventId: 'MAKE_PUBLIC_OF_COPY',
        from: 'a copy of a public version, private',
        event: '`MAKE_PUBLIC`',
        actor: 'cook',
        guard: 'after the check',
        to: 'PPu',
        pending: '021-FR-005',
    },
    {
        axis: 'origin',
        axisLabel: 'origin',
        eventId: 'MOVE_TO_BOOK',
        from: '`ORIGIN_PAID_SITE`',
        event: '`MOVE_TO_BOOK`',
        actor: 'staff, or system for a known cookbook site',
        guard: '`REWRITTEN_BY_COOK`, and the site hosts a cookbook or evidence shows it',
        to: '`ORIGIN_BOOK`',
        pending: 'P4',
    },
    {
        axis: 'rewrittenFact',
        axisLabel: 'rewritten fact',
        eventId: 'COOK_EDIT_PASSES',
        from: '`REWRITTEN_ABSENT`',
        event: '`COOK_EDIT_PASSES` (cook edit passes the difference check)',
        actor: 'system',
        guard: 'third-party origin, or own or unstated with the evidence rule holding it (the unblock of ADR-0097 D3)',
        to: '`REWRITTEN_BY_COOK` (shows `VIEW_ADAPTED_BY_COOK`)',
        pending: 'P4',
    },
    {
        axis: 'rewrittenFact',
        axisLabel: 'rewritten fact',
        eventId: 'KEEP_AI_REWRITE',
        from: '`REWRITTEN_ABSENT`',
        event: '`KEEP_AI_REWRITE` (cook keeps an AI rewrite that passes)',
        actor: 'system',
        guard: 'third-party origin, or own or unstated with the evidence rule holding it (the unblock of ADR-0097 D3)',
        to: '`REWRITTEN_BY_AI` + `STEPS_BY_AI`',
        pending: 'P4',
    },
    {
        axis: 'rewrittenFact',
        axisLabel: 'rewritten fact',
        eventId: 'COOK_REWRITES',
        from: '`REWRITTEN_BY_AI`',
        event: '`COOK_REWRITES` (cook rewrites, passes against the source and the AI text)',
        actor: 'system',
        guard: '',
        to: '`REWRITTEN_BY_COOK` + `STEPS_BY_COOK`',
        pending: 'P4',
    },
    {
        axis: 'stepsCredit',
        axisLabel: 'steps credit',
        eventId: 'KEEP_AI_REWRITE_STEPS',
        from: 'any',
        event: 'cook keeps an AI rewrite (own, person, public domain)',
        actor: 'cook',
        guard: 'none',
        to: '`STEPS_BY_AI`',
        pending: '027',
    },
    {
        axis: 'bulk',
        axisLabel: 'bulk',
        eventId: 'MAKE_THE_REST_PUBLIC',
        from: 'each item of a 003B job',
        event: '`MAKE_THE_REST_PUBLIC`',
        actor: 'cook',
        guard: 'per-item status under `PUBLIC_VERSION_JOB_*`',
        to: 'per item',
        pending: 'P13',
    },
];
