/**
 * THE DEAD-MAN SWITCH (plan U12/U13, R37) — who promises to keep running, and under what name.
 *
 * ⛔ EVERY OTHER PART OF A BACKSTOP REPORTS WHAT IT FOUND; a backstop that stops running finds nothing and is
 * indistinguishable from a healthy system. That is the exact failure the backstop exists to remove,
 * reintroduced one level up — and the only way out is to invert the signal, so that SILENCE alarms. A Sentry
 * cron monitor does that: the check promises a check-in on a schedule, and a missed one is the alert.
 *
 * ⚠️ The promise is not free, which is why it is not made everywhere. A monitor outlives the stage that
 * created it, so a `pr-{N}` preview would leave a permanently-missing monitor behind when its stack is torn
 * down (ADR-0005) — one per PR, until the live monitors were unreadable among the dead ones. A preview
 * therefore escalates what it finds and promises nothing.
 */

/** The stages whose continued silence is worth alarming on. */
const CHECKING_IN_STAGES: ReadonlySet<string> = new Set(['prod', 'sandbox']);

/**
 * Whether a stage's backstop promises to keep reporting.
 *
 * ⛔ Membership, never a prefix or a negation of `pr-`. "Not a preview" would enrol `dev`, `test`, `local` and
 * every future stage name by default — including a developer's laptop, whose silence means nothing at all.
 *
 * @param stage - The deploy stage.
 * @returns `true` when this stage checks in to a cron monitor. Pure.
 */
export function checksIn(stage: string): boolean {
    return CHECKING_IN_STAGES.has(stage);
}

/**
 * The cron monitor a service's backstop checks in to.
 *
 * ⛔ THE STAGE IS PART OF THE NAME. A monitor shared between prod and sandbox is checked in by whichever
 * stage is still healthy, so a dead prod check reads green for as long as sandbox keeps running — the monitor
 * would report success for precisely the outage it was installed to catch.
 *
 * @param service - The service's deploy identifier, e.g. `recipe-workers`.
 * @param stage - The deploy stage.
 * @returns The Sentry monitor slug. Pure.
 */
export function monitorSlug(service: string, stage: string): string {
    return `${service}-queue-check-${stage}`.toLowerCase();
}

/**
 * Minutes a check-in may be late before the monitor counts it missed.
 *
 * ⚠️ Generous on purpose. A scheduled function waits on a cold start, a VPC ENI and a database connection;
 * the food check waits on whatever the drainer is doing. A margin tight enough to catch a death promptly is
 * also tight enough to fire on an ordinary slow morning, and a monitor that cries wolf is a monitor whose
 * first real alert is ignored. Detection speed comes from {@link MONITOR_FAILURES_BEFORE_ISSUE} instead,
 * which requires the misses to be CONSECUTIVE — noise does not accumulate, a death does.
 */
export const MONITOR_MARGIN_MINUTES = 5;

/**
 * Consecutive missed check-ins before the monitor raises an issue.
 *
 * ⛔ NOT ONE. Every deploy of these services replaces the thing that checks in — a Lambda version cut over,
 * an ECS task drained and restarted — so a single miss is the NORMAL shape of a release. Two consecutive
 * misses cannot be explained that way.
 */
export const MONITOR_FAILURES_BEFORE_ISSUE = 2;

/** Consecutive successful check-ins before the monitor resolves. One: the job ran, it is back. */
export const MONITOR_RECOVERY_THRESHOLD = 1;
