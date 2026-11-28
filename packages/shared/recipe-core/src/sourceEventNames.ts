/**
 * THE identity of the source-lock metric the staff correction alarm watches (ADR-0100, plan everyAnswerSourceLock KTD-11).
 *
 * One declaration read by both sides of the infra boundary: the service writes the EMF line (`recipe-service/src/recipes/sourceEvents.ts`)
 * and `RecipeServiceStack` alarms on it. Two copies would let a rename on one side leave the alarm watching a metric nobody writes,
 * which under `treatMissingData: NOT_BREACHING` is a permanent, confident `OK`. It lives in `@kitchensink/recipe-core` for the reason
 * `recipeQueueNames.ts` does: the infra app may not import service source.
 */

/** The CloudWatch namespace every source-lock metric is published under. */
export const SOURCE_EVENT_NAMESPACE = 'Commise/RecipeSource';

/** The metric the correction volume alarm watches: more than 10 in a day is a leaked scope or a runaway script. */
export const SOURCE_CORRECTED_METRIC = 'source.corrected';

/**
 * The metric the hold-clear volume alarm watches (ADR-0106). Its VALUE is the number of holds cleared, so a clear that releases
 * two clones counts three. More than `SOURCE_HOLD_CLEARED_DAILY_THRESHOLD` in a day is a leaked scope or a runaway script.
 */
export const SOURCE_HOLD_CLEARED_METRIC = 'source.holdCleared';

/** An alarm fires when MORE than this many holds are cleared in a day (owner-approved, 2026-11-28). */
export const SOURCE_HOLD_CLEARED_DAILY_THRESHOLD = 10;
