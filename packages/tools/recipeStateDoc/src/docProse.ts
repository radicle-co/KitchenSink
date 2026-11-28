/**
 * The document's own words for the cells the module does not hold (docs/architecture/recipeStateModel.md): wire notes,
 * English sentences, guards, "built" notes. They are prose about the model, so they live with the generator and not in
 * recipe-core, which the clients bundle. Each row is keyed by a name or an id of the module, and a test holds the two
 * sets equal in both directions, so an edge or a refusal added without its words fails the build.
 *
 * Edit a cell here and regenerate (`npm run recipeState:generate`); never edit a generated table in the document.
 */

/** One row of table 4.2: a stored type, with its values written from the module when `object` names a value object. */
export type StoredValueRow =
    | {
          readonly type: string;
          readonly storedIn: string;
          readonly object: ValueObjectName;
          readonly suffix: string;
          readonly built: string;
      }
    | { readonly type: string; readonly storedIn: string; readonly prose: string; readonly built: string };

/** The value objects whose values the generator writes into 4.2. */
export type ValueObjectName = 'Lifecycle' | 'Audience' | 'Origin' | 'EvidenceCapture' | 'RewrittenFact';

/** One row of table 4.5. `name` is a key of recipe-core's `REFUSAL`. */
export interface RefusalDocRow {
    readonly name: string;
    readonly computedBy: string;
    readonly wire: string;
    readonly en: string;
    readonly built: string;
}

/** One row of table 4.6. `name` is a key of recipe-core's `Hold`. */
export interface HoldDocRow {
    readonly name: string;
    readonly stored: string;
    readonly enforcement: string;
    readonly setBy: string;
    readonly clearedBy: string;
    readonly ownerLabel: string;
    readonly built: string;
}

/**
 * The cells of one transition table row the module does not hold. `group` is the `group` (or the `id`) of the
 * TRANSITIONS rows the document row covers. `event` is written from the rows unless this gives the document's own words.
 */
export interface EdgeDocRow {
    readonly group: string;
    readonly from: string;
    readonly guard?: string;
    readonly to: string;
    readonly event?: string;
}

/** One row of table 5.4: a hold's edges, in the document's own words. */
export interface HoldEdgeDocRow {
    readonly hold: string;
    readonly from: string;
    readonly event: string;
    readonly actor: string;
    readonly guard: string;
    readonly to: string;
    readonly built: string;
}

/** One row of table 5.7. `id` is an id of recipe-core's `CREATIONS`. */
export interface CreationDocRow {
    readonly id: string;
    readonly creation: string;
    readonly actor: string;
    readonly lifecycleAudience: string;
    readonly origin: string;
    readonly confirmation: string;
    readonly holds: string;
    readonly evidence: string;
    readonly cloneLink: string;
    readonly built: string;
}

export const STORED_VALUE_ROWS: readonly StoredValueRow[] = [
    {
        type: '`Lifecycle`',
        storedIn: '`recipes.status`, `deleted_at`',
        object: 'Lifecycle',
        suffix: '. `LIFECYCLE_DELETED` is `deleted_at IS NOT NULL`',
        built: 'yes',
    },
    {
        type: '`Audience`',
        storedIn: '`recipes.visibility`',
        object: 'Audience',
        suffix: '',
        built: 'yes',
    },
    {
        type: '`Origin`',
        storedIn: '`recipes.origin`, one column (4.2.1)',
        object: 'Origin',
        suffix: '',
        built: 'PR 3. `COMMISE_WRITTEN` is written by 003B',
    },
    {
        type: '`SourceConfirmation`',
        storedIn: '`recipes.source_confirmed_at` (ratchet, mig 0092)',
        prose: '`SOURCE_UNCONFIRMED` (NULL), `SOURCE_CONFIRMED` (set)',
        built: 'yes',
    },
    {
        type: '`EvidenceCapture`',
        storedIn: '`recipe_source_evidence.capture` (append-only)',
        object: 'EvidenceCapture',
        suffix: '',
        built: 'yes',
    },
    {
        type: 'Holds',
        storedIn: 'one stored fact per hold (4.6)',
        prose: '`HOLD_SOURCE_CORRECTED`, `HOLD_HIDDEN_AFTER_REPORT`, `HOLD_REMOVED`',
        built: 'one built',
    },
    {
        type: '`CheckState`, `CheckOutcome`',
        storedIn: '`recipe_source_checks` (020)',
        prose: '4.7',
        built: 'pending: 020',
    },
    {
        type: '`CheckDecisionKind`',
        storedIn: '`recipe_source_decisions.kind` (020)',
        prose: '4.7',
        built: 'pending: 020',
    },
    {
        type: '`StepsCredit`',
        storedIn: 'per version (027)',
        prose: '`STEPS_BY_COOK`, `STEPS_BY_AI`, `STEPS_BY_COMMISE`',
        built: 'pending: 027',
    },
    {
        type: '`RewrittenFact`',
        storedIn: '`rewritten_fact` (P4a)',
        object: 'RewrittenFact',
        suffix: '',
        built: 'package on main, rest P4',
    },
    {
        type: 'Clone link',
        storedIn: '`recipes.cloned_from_id`',
        prose: 'a foreign key, not an enum. Read as a fact',
        built: 'yes',
    },
];

export const REFUSAL_ROWS: readonly RefusalDocRow[] = [
    {
        name: 'REFUSAL_POLICY_WEB_PAGE',
        computedBy: 'both',
        wire: '400 `INVALID_VISIBILITY`, no reason today (reason: PR 2b (wire))',
        en: 'existing key `policyWebPage` ("{line}")',
        built: 'client yes. The server split into three reasons is PR 2b (wire) work, not built (the client derives the three from the stored source until then)',
    },
    {
        name: 'REFUSAL_POLICY_BOOK',
        computedBy: 'both',
        wire: '400 `INVALID_VISIBILITY`, no reason today (reason: PR 2b (wire))',
        en: 'existing key `policyBook`',
        built: 'client yes. The server split into three reasons is PR 2b (wire) work, not built (the client derives the three from the stored source until then)',
    },
    {
        name: 'REFUSAL_POLICY_PAID_SITE',
        computedBy: 'both',
        wire: '400 `INVALID_VISIBILITY`, no reason today (reason: PR 2b (wire))',
        en: 'existing key `policyPaidSite`',
        built: 'client yes. The server split into three reasons is PR 2b (wire) work, not built (the client derives the three from the stored source until then)',
    },
    {
        name: 'REFUSAL_FROM_PERSON',
        computedBy: 'both',
        wire: 'reason `FROM_PERSON_PRIVATE_ONLY`',
        en: 'existing `fromPerson`',
        built: 'yes',
    },
    {
        name: 'REFUSAL_SOURCE_CONFLICT',
        computedBy: 'both',
        wire: 'reason `SOURCE_CONFLICT`',
        en: 'existing `sourceConflict`',
        built: 'yes',
    },
    {
        name: 'REFUSAL_SOURCE_CORRECTED',
        computedBy: 'both',
        wire: 'reason `SOURCE_CORRECTED`',
        en: '{line} (planned in the open source-lock change, #488)',
        built: 'pending: #488, open',
    },
    {
        name: 'REFUSAL_STATEMENT_REQUIRED',
        computedBy: 'both',
        wire: 'reason `STATEMENT_REQUIRED`',
        en: '{line}',
        built: 'new client key',
    },
    {
        name: 'REFUSAL_PUBLIC_CONFIRMATION_REQUIRED',
        computedBy: 'server',
        wire: 'reason `PUBLIC_CONFIRMATION_REQUIRED`',
        en: 'the Publish sheet (4.9)',
        built: 'yes',
    },
    {
        name: 'REFUSAL_API_WRITER_CONFIRMATION',
        computedBy: 'server',
        wire: 'reason `API_WRITER_CONFIRMATION_FORBIDDEN`',
        en: 'none (API only)',
        built: 'yes',
    },
    {
        name: 'REFUSAL_NO_PRIVATE_SLOT',
        computedBy: 'both',
        wire: '403 `PRIVATE_SLOTS_FULL`, no reason (reason: PR 2b (wire))',
        en: 'one key, ICU plural on `{total}` (4.9)',
        built: 'merges A `privateRefused.slots` and E `slotsFull`',
    },
    {
        name: 'REFUSAL_SOURCE_LOCKED',
        computedBy: 'server',
        wire: '403 `FORBIDDEN`, `details.reason` `SOURCE_LOCKED`. The pair maps to the name. In PR 2b (wire) the reason value becomes `REFUSAL_SOURCE_LOCKED` under the same code',
        en: 'the source-lock change (#488, open) adds `lockedRefused`',
        built: 'pending: #488, open',
    },
    {
        name: 'REFUSAL_PRIVATE_FOODS_ON_PUBLIC',
        computedBy: 'server',
        wire: '400 `PRIVATE_FOODS_ON_PUBLIC_RECIPE`',
        en: 'existing editor key',
        built: 'yes',
    },
    {
        name: 'REFUSAL_PUBLISH_REQUIREMENTS',
        computedBy: 'both',
        wire: '422 `PUBLISH_REQUIREMENTS_UNMET`',
        en: 'existing editor keys',
        built: 'yes',
    },
    {
        name: 'REFUSAL_CONTAINED',
        computedBy: 'server',
        wire: '403 `TEST_PRINCIPAL_CONTAINED`, no reason (reason: PR 2b (wire))',
        en: 'none (no cook meets it)',
        built: 'yes',
    },
    {
        name: 'REFUSAL_CONTENT_NOT_APPROVED',
        computedBy: 'server',
        wire: '403 `SOURCE_CHECK_NOT_APPROVED`',
        en: '{line}',
        built: 'pending: 020 (ADR-0074 §3a)',
    },
    {
        name: 'REFUSAL_SAVE_CANNOT_STAY_PUBLIC',
        computedBy: 'server',
        wire: '400 `SOURCE_CONFLICT` for a held source, with `details.cause`; 020 sets the code for its causes',
        en: 'none as a line. The refused-save sheet shows (4.8.2)',
        built: 'pending: P10 (held source), 020 (too close, not approved)',
    },
    {
        name: 'REFUSAL_PUBLIC_VERSION_COPY',
        computedBy: 'both',
        wire: '400 `INVALID_VISIBILITY`, `details.reason` `PUBLIC_VERSION_COPY`',
        en: '`publicRefusal.publicVersionCopy` (planned key)',
        built: 'pending: 003B T405. Stays until 021-FR-005',
    },
    {
        name: 'REFUSAL_UNRECOGNISED',
        computedBy: 'client',
        wire: 'never sent',
        en: 'existing `unrecognised`',
        built: 'yes',
    },
    {
        name: 'REFUSAL_NONE',
        computedBy: 'both',
        wire: 'not a refusal: the result "no refusal"',
        en: 'none',
        built: 'yes (the client value `none`)',
    },
];

export const HOLD_ROWS: readonly HoldDocRow[] = [
    {
        name: 'HOLD_SOURCE_CORRECTED',
        stored: '`recipes.source_correction_hold`',
        enforcement: 'CHECK `recipes_held_is_not_public`. A clone copies the hold at insert, by trigger',
        setBy: 'staff correction (`STAFF_CORRECT`)',
        clearedBy: 'staff, `CLEAR_SOURCE_HOLD`, audited (4.6.1). Never the cook',
        ownerLabel: 'none. `REFUSAL_SOURCE_CORRECTED` carries the copy',
        built: 'set: yes. Clear: PR 5',
    },
    {
        name: 'HOLD_HIDDEN_AFTER_REPORT',
        stored: "020's plan decides (one-way door). 016's restriction kind `version_hidden_report` names it",
        enforcement: 'read-rule hide',
        setBy: 'any signed-in cook, `REPORT`, at once (020-FR-082)',
        clearedBy: 'staff, on a decision',
        ownerLabel:
            '`VIEW_HIDDEN_AFTER_REPORT.owner` "{label:VIEW_HIDDEN_AFTER_REPORT.owner}". Reader: `VIEW_HIDDEN_AFTER_REPORT.reader`',
        built: 'pending: 020, 003B',
    },
    {
        name: 'HOLD_REMOVED',
        stored: "016's plan decides (one-way door)",
        enforcement: 'read-rule hide',
        setBy: 'staff, on a removal decision (016)',
        clearedBy: 'staff, on an appeal decision',
        ownerLabel:
            'Key `HOLD_REMOVED`: Removed from public view. Only you can see it now. (placeholder: 016 owns the final words)',
        built: 'pending: 016',
    },
];

/** Table 5.1. The row order is the document's. */
export const LIFECYCLE_ROWS: readonly EdgeDocRow[] = [
    {
        group: 'MAKE_PUBLIC_DRAFT',
        from: 'DPr',
        guard: '`refusalOf` = none. No slot needed',
        to: 'DPu',
    },
    {
        group: 'MAKE_PRIVATE_DRAFT',
        from: 'DPu',
        guard: 'none',
        to: 'DPr',
    },
    {
        group: 'PUBLISH',
        from: 'DPr / DPu',
        guard: 'requirements. A slot for a private recipe. The cook accepts the Publish sheet. `refusalOf` = none for a public recipe',
        to: 'PPr / PPu',
    },
    {
        group: 'MAKE_PUBLIC_PUBLISHED',
        from: 'PPr',
        guard: '`refusalOf` = none, which includes no `HOLD_SOURCE_CORRECTED`. The cook accepts the Publish sheet',
        to: 'PPu',
    },
    {
        group: 'MAKE_PRIVATE_PUBLISHED',
        from: 'PPu',
        guard: 'a free private slot (ADR-0073). No actor but the cook makes a recipe private (ADR-0105)',
        to: 'PPr',
    },
    {
        group: 'UNPUBLISH',
        from: 'PPu / PPr',
        guard: 'none. Versions continue',
        to: 'DPu / DPr',
    },
    {
        group: 'DELETE',
        from: 'any live state',
        guard: 'none',
        to: 'Del',
    },
    {
        group: 'ERASE_DONATE',
        from: 'DPr, DPu, PPr (PPu stays PPu)',
        guard: 'the cook elected it, no statement owed, not `ORIGIN_PERSON`, no hold. Sets `SOURCE_CONFIRMED`. Never from Del',
        to: 'PPu',
    },
];

/** Table 5.2. */
export const ORIGIN_ROWS: readonly EdgeDocRow[] = [
    {
        group: 'ANSWER',
        from: '`ORIGIN_UNSTATED`, or any origin while `SOURCE_UNCONFIRMED`',
        guard: '`sourceLockOf` = `open` (`open` holds for an unconfirmed answer that is not from a person, stored or attested). Web, book and paid need a link or citation (the wire schema enforces the citation rule, and the guard reads its result), which appends evidence and forces private',
        to: "the answer's origin",
        event: '`ANSWER_*`',
    },
    {
        group: 'PASTE_DETECTED',
        from: '`ORIGIN_UNSTATED`',
        guard: 'sets `content_pasted_at` only',
        to: 'unchanged',
    },
    {
        group: 'CURATOR_DECLARE',
        from: '`ORIGIN_UNSTATED`',
        guard: 'grant `recipes:import:public`',
        to: '`ORIGIN_PUBLIC_DOMAIN`',
    },
    {
        group: 'DOWNGRADE',
        from: '`ORIGIN_OWN` with `SOURCE_CONFIRMED`',
        guard: 'a citation. A slot, for a recipe that is not already private. The result is private',
        to: '`ORIGIN_BOOK` / `ORIGIN_PAID_SITE`',
    },
    {
        group: 'STAFF_CORRECT',
        from: 'any origin with `SOURCE_CONFIRMED`',
        guard: 'ADR-0100 route and grant. Records who, when, old, new, reason. Appends `EVIDENCE_STAFF_CORRECTION`. If the new answer can open Public, it sets `HOLD_SOURCE_CORRECTED`',
        to: "staff's origin. The recipe is private. A correction that sets the hold also holds the owner's clones",
    },
];

/** Table 5.3. */
export const CONFIRMATION_ROWS: readonly EdgeDocRow[] = [
    {
        group: 'CONFIRM_SOURCE',
        from: '`SOURCE_UNCONFIRMED`',
        event: 'the source sheet answer, first publish (private included), Save of a published recipe, erasure donation, staff correction',
        to: '`SOURCE_CONFIRMED`',
    },
];

/** Table 5.4. */
export const HOLD_EDGE_ROWS: readonly HoldEdgeDocRow[] = [
    {
        hold: '`HOLD_SOURCE_CORRECTED`',
        from: 'unset',
        event: '`STAFF_CORRECT` (as in 5.2)',
        actor: 'staff',
        guard: 'the new answer can open Public',
        to: 'set. The correction writer still makes the recipe private until P8h (ADR-0105). The read rule hides it either way',
        built: 'yes',
    },
    {
        hold: '`HOLD_SOURCE_CORRECTED`',
        from: 'set',
        event: '`CLEAR_SOURCE_HOLD`',
        actor: 'staff',
        guard: 'grant `recipes:source:correct`, a reason, a clear record in the same transaction (4.6.1)',
        to: 'unset. Audience unchanged (private)',
        built: 'PLANNED until PR 5',
    },
];

/** Table 5.7. */
export const CREATION_ROWS: readonly CreationDocRow[] = [
    {
        id: 'CREATE_DRAFT',
        creation: '`CREATE_DRAFT`',
        actor: 'cook',
        lifecycleAudience: 'DPr',
        origin: '`ORIGIN_UNSTATED`',
        confirmation: 'unconfirmed',
        holds: 'none',
        evidence: 'none',
        cloneLink: 'none',
        built: 'yes',
    },
    {
        id: 'CREATE_PUBLISHED',
        creation: '`CREATE_PUBLISHED`',
        actor: 'cook',
        lifecycleAudience:
            'PPr or PPu. Requirements, a slot for private, `refusalOf` = none and the Publish sheet for public',
        origin: 'from the sheet answer',
        confirmation: 'confirmed (first publish)',
        holds: 'none',
        evidence: 'per answer',
        cloneLink: 'none',
        built: 'yes',
    },
    {
        id: 'IMPORT_SAVE',
        creation: '`IMPORT_SAVE`',
        actor: 'import',
        lifecycleAudience: "PPr or PPu, the item's choice",
        origin: "from the item's statement, through the codec",
        confirmation: 'confirmed (first publish)',
        holds: 'none',
        evidence: '`EVIDENCE_IMPORT_FILE` or `EVIDENCE_PASTED_PAGE`',
        cloneLink: 'none',
        built: 'yes. 020 checks it once 020 ships',
    },
    {
        id: 'CURATOR_IMPORT',
        creation: '`CURATOR_IMPORT`',
        actor: 'curator',
        lifecycleAudience: 'PPu',
        origin: '`ORIGIN_PUBLIC_DOMAIN`',
        confirmation: 'confirmed',
        holds: 'none',
        evidence: 'none',
        cloneLink: 'none',
        built: 'yes',
    },
    {
        id: 'CLONE',
        creation: '`CLONE`',
        actor: 'another cook',
        lifecycleAudience: 'private, as the clone route sets it (its default reads the hold)',
        origin: "the source's origin, except `ORIGIN_OWN` becomes `ORIGIN_UNSTATED`",
        confirmation: 'as the route sets it',
        holds: 'copies `HOLD_SOURCE_CORRECTED` at insert',
        evidence: "the source's evidence",
        cloneLink: 'set. Shows `VIEW_COPY_OF`',
        built: 'yes. The clone route sets the lifecycle and the visibility (`defaultCloneVisibility`). This row does not state them, and PR 2b checks it against the route',
    },
    {
        id: 'CLONE_OF_PUBLIC_VERSION',
        creation: '`CLONE` of a public version',
        actor: 'another cook',
        lifecycleAudience: 'private draft (003B FR-062a)',
        origin: 'as `CLONE`',
        confirmation: 'as `CLONE`',
        holds: 'as `CLONE`',
        evidence: 'keeps `source_record_id` and `public_credit`',
        cloneLink: 'set. Shows `VIEW_COPY_OF_COMMISE_PAGE`',
        built: 'going public refused by `REFUSAL_PUBLIC_VERSION_COPY`, pending 021-FR-005',
    },
    {
        id: 'PUBLIC_VERSION_PUBLISH',
        creation: '`PUBLIC_VERSION_PUBLISH`',
        actor: "003B job, on the cook's choice",
        lifecycleAudience: 'PPu',
        origin: '`ORIGIN_COMMISE_WRITTEN`',
        confirmation: 'confirmed',
        holds: 'none',
        evidence: 'linked source record',
        cloneLink: 'none',
        built: 'pending: 003B. Needs PR 3',
    },
];

/** Diagram 5.5, a pending 020 machine kept as the document's own text. */
export const CHECK_DIAGRAM =
    "\n```mermaid\nstateDiagram-v2\n    [*] --> CHECK_STATE_CHECKING: content first headed for public view, or any bulk-import save\n    CHECK_STATE_CHECKING --> CHECK_STATE_DECIDED: worker or rule writes the outcome\n    CHECK_STATE_DECIDED --> CHECK_STATE_DECIDED: a person's decision record sets cleared_* or review_ended_at\n```\n";

/** Table 4.8's notes on a heading shape, in the document's own words. */
export const ADAPTED_SHAPE_NOTES: ReadonlyMap<string, string> = new Map([
    ['.heading', ' (over the citation and link)'],
]);
