/**
 * The recipe state model's stored values (docs/architecture/recipeStateModel.md 4.2 and 4.3): one `as const` object per
 * axis, each key an internal name and each value the string a column stores. The document's tables are generated from
 * this file (ADR-0103), so a value is written here and nowhere else.
 *
 * A type whose column is built later (020, 027) or whose stored form is a NULL, a flag or a row's existence has the
 * internal name as its value: nothing stores that string today, and the owning feature fixes it in its own plan.
 *
 * @pattern Registry — `as const` value objects, one per axis. TypeScript's `keyof`/`typeof` unions make a missing key a build failure.
 */
import { RecipeStatus, RecipeVisibility } from '../recipe.types.js';
import type { SourceLock } from '../sourceRules.js';

/** `recipes.status`. A deleted recipe is `deleted_at IS NOT NULL` and has no stored value here. */
export const Lifecycle = {
    LIFECYCLE_DRAFT: RecipeStatus.DRAFT,
    LIFECYCLE_PUBLISHED: RecipeStatus.PUBLISHED,
} as const;

/** `recipes.visibility`. */
export const Audience = {
    AUDIENCE_PRIVATE: RecipeVisibility.PRIVATE,
    AUDIENCE_PUBLIC: RecipeVisibility.PUBLIC,
} as const;

/** `recipes.origin`, the one origin column of ADR-0104 (written by PR 3). */
export const Origin = {
    ORIGIN_UNSTATED: 'unstated',
    ORIGIN_OWN: 'own',
    ORIGIN_WEB_PAGE: 'webPage',
    ORIGIN_BOOK: 'book',
    ORIGIN_PAID_SITE: 'paidSite',
    ORIGIN_PERSON: 'person',
    ORIGIN_PUBLIC_DOMAIN: 'publicDomain',
    ORIGIN_COMMISE_WRITTEN: 'commiseWritten',
} as const;

/** `recipes.source_confirmed_at`: NULL is unconfirmed, a set time is confirmed (a ratchet, migration 0092). */
export const SourceConfirmation = {
    SOURCE_UNCONFIRMED: 'SOURCE_UNCONFIRMED',
    SOURCE_CONFIRMED: 'SOURCE_CONFIRMED',
} as const;

/** `recipe_source_evidence.capture` (append-only). */
export const EvidenceCapture = {
    EVIDENCE_PASTED_PAGE: 'pastedPage',
    EVIDENCE_EDITOR_LINK: 'editorLink',
    EVIDENCE_EDITOR_CITATION: 'editorCitation',
    EVIDENCE_IMPORT_FILE: 'importFile',
    EVIDENCE_STAFF_CORRECTION: 'staffCorrection',
} as const;

/** A hold is one stored fact each (4.6). A hold's stored form is its owner's: a column, or a row in a decision table. */
export const Hold = {
    HOLD_SOURCE_CORRECTED: 'HOLD_SOURCE_CORRECTED',
    HOLD_HIDDEN_AFTER_REPORT: 'HOLD_HIDDEN_AFTER_REPORT',
    HOLD_REMOVED: 'HOLD_REMOVED',
} as const;

/** `recipe_source_checks.state` (020, pending). */
export const CheckState = {
    CHECK_STATE_CHECKING: 'CHECK_STATE_CHECKING',
    CHECK_STATE_DECIDED: 'CHECK_STATE_DECIDED',
} as const;

/** `recipe_source_checks.outcome` (020, pending). */
export const CheckOutcome = {
    CHECK_OUTCOME_CLEAR: 'CHECK_OUTCOME_CLEAR',
    CHECK_OUTCOME_POSSIBLE: 'CHECK_OUTCOME_POSSIBLE',
    CHECK_OUTCOME_DETECTED: 'CHECK_OUTCOME_DETECTED',
    CHECK_OUTCOME_UNCHECKED: 'CHECK_OUTCOME_UNCHECKED',
} as const;

/** `recipe_source_decisions.kind` (020, pending). */
export const CheckDecisionKind = {
    CHECK_DECISION_AUTOMATED_HOLD: 'automatedHold',
    CHECK_DECISION_REFERRAL_CLEARED: 'referralCleared',
    CHECK_DECISION_REFERRAL_NOT_APPROVED: 'referralNotApproved',
    CHECK_DECISION_APPEAL_OVERTURNED: 'appealOverturned',
    CHECK_DECISION_APPEAL_UPHELD: 'appealUpheld',
    CHECK_DECISION_AUDIT_RESTRICTION: 'auditRestriction',
} as const;

/** Who wrote a version's steps (027, pending). */
export const StepsCredit = {
    STEPS_BY_COOK: 'STEPS_BY_COOK',
    STEPS_BY_AI: 'STEPS_BY_AI',
    STEPS_BY_COMMISE: 'STEPS_BY_COMMISE',
} as const;

/** `rewritten_fact` (P4a). */
export const RewrittenFact = {
    REWRITTEN_ABSENT: 'absent',
    REWRITTEN_BY_COOK: 'earnedByCook',
    REWRITTEN_BY_AI: 'earnedByAi',
} as const;

/** What `sourceLockOf` answers (4.3), derived and never stored. The strings are the ones `sourceLockOf` returns today. */
export const SOURCE_LOCK = {
    SOURCE_LOCK_OPEN: 'open',
    SOURCE_LOCK_DOWNGRADE_ONLY: 'downgradeOnly',
    SOURCE_LOCK_LOCKED: 'locked',
} as const satisfies Record<string, SourceLock>;

/**
 * The lifecycle and audience pair a recipe is in (5.1), under the document's short ids, each side named by its internal
 * name. Deleted has no audience, and is not a stored value: it is `deleted_at`.
 */
export const LIFECYCLE_AUDIENCE_STATES = {
    DPr: { lifecycle: 'LIFECYCLE_DRAFT', audience: 'AUDIENCE_PRIVATE' },
    DPu: { lifecycle: 'LIFECYCLE_DRAFT', audience: 'AUDIENCE_PUBLIC' },
    PPr: { lifecycle: 'LIFECYCLE_PUBLISHED', audience: 'AUDIENCE_PRIVATE' },
    PPu: { lifecycle: 'LIFECYCLE_PUBLISHED', audience: 'AUDIENCE_PUBLIC' },
    Del: { lifecycle: 'LIFECYCLE_DELETED', audience: null },
} as const satisfies Record<
    string,
    {
        readonly lifecycle: keyof typeof Lifecycle | 'LIFECYCLE_DELETED';
        readonly audience: keyof typeof Audience | null;
    }
>;

/** One state of the lifecycle by audience axis. */
export type LifecycleAudienceState = keyof typeof LIFECYCLE_AUDIENCE_STATES;

/** Who may take an edge. */
export const ACTORS = ['cook', 'system', 'staff', 'curator', 'import', 'erasure'] as const;

/** One actor. */
export type Actor = (typeof ACTORS)[number];

/** The names of one value object's keys. */
export type NameOf<T> = keyof T & string;

/** An origin name. */
export type OriginName = NameOf<typeof Origin>;

/** A source-confirmation name. */
export type SourceConfirmationName = NameOf<typeof SourceConfirmation>;

/** One correction hold is set or unset. */
export type HoldState = 'unset' | 'set';

/** What a name of a stored axis can be, for the axes that have transitions. */
export interface AxisStates {
    readonly lifecycleAudience: LifecycleAudienceState;
    readonly origin: OriginName;
    readonly sourceConfirmation: SourceConfirmationName;
    readonly holdSourceCorrected: HoldState;
}

/** An axis that has transitions. */
export type Axis = keyof AxisStates;
