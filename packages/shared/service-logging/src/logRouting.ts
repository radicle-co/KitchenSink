/**
 * WHERE A LOG LINE GOES — the one rule, as a value.
 *
 * ⛔ WHY THE REPOSITORY NEEDS THIS TO BE ONE THING. Under ADR-0042 every runtime's stdout is forwarded to
 * the single `kitchensink-log-drain` Sentry project by a CloudWatch subscription filter. A line written to
 * stdout AND sent through the SDK is therefore ONE failure recorded TWICE, in two different projects, which
 * Sentry's alerting counts separately. So the question "does this level go to stdout, to Sentry, or both"
 * has exactly one correct answer per level — and it had TWO answers in this tree, which disagreed:
 *
 * - `recipe-workers/src/common/observability.ts:9-13` — "`logger.error` goes to Sentry's logger INSTEAD of
 *   stdout. `info` and `warn` stay on stdout, because CloudWatch is the durable record and neither creates
 *   an issue." Written with ADR-0042 in hand. This table is that rule.
 * - `identity/src/observability/sentryLogging.ts` — "nothing is written to stdout". Because
 *   `Sentry.logger.*` returns before emitting when no client is initialised, that rule DELETED every line
 *   on every run without a DSN: local runs, the whole integration tier, and any stage whose SSM parameter
 *   is unwritten. A `pr-{N}` operator running `aws logs tail` saw an empty stream, indistinguishable from a
 *   task that never started — and ADR-0042 had just registered a subscription filter on that group, so the
 *   coverage the ADR asserts was vacuous for the one service that serves real users.
 *
 * ⚠️ THE FLIP CONDITION, recorded so the next person does not have to re-derive it: if a Sentry alert is
 * ever configured on `warn`-level LOGS in a per-service project, `warn` joins the divert set and this table
 * is the single line that changes. Until then diverting `warn` buys no alerting and costs volume on an org
 * already shedding events to rate limits.
 */

/** Every level this repository's services log at. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/** A level a service may log at. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Where one record is written. Exactly one of these is true — see the tests for both halves. */
export interface LogDestination {
    /** Send through `Sentry.logger`, into the service's own project. */
    readonly sentry: boolean;
    /** Write a JSON line to stdout/stderr, which ADR-0042's drain forwards. */
    readonly stdout: boolean;
}

const TO_SENTRY: LogDestination = { sentry: true, stdout: false };
const TO_STDOUT: LogDestination = { sentry: false, stdout: true };

/**
 * THE TABLE. Which levels are worth an entry in the service's own Sentry project.
 *
 * ⛔ A TYPED `Record` OVER THE UNION, not a switch, and not an `if (level === 'error')`. Adding a level to
 * {@link LOG_LEVELS} without deciding its destination is then a COMPILE error rather than a silent default
 * — the same reason `packages/infra/alb`'s base priorities are a `Record` over its service union. It is
 * also literally the decision table, so the ruling and the code are the same object.
 *
 * ⚠️ `debug` is `false` under every branch, and that agrees with a rule already in force one layer down:
 * `scrubLog` returns `null` for a debug log, so the SDK would discard it anyway. Diverting it would be
 * paying quota to throw the line away.
 */
const DIVERTS_TO_SENTRY: Readonly<Record<LogLevel, boolean>> = {
    error: true,
    warn: false,
    info: false,
    debug: false,
};

/**
 * Decide where a record goes.
 *
 * @param level - The level the caller logged at.
 * @param sentryClientPresent - Whether `Sentry.init` has run in this process. NOT "whether a DSN is
 *   configured": a second `@sentry/core` on the module graph gives a second version-keyed carrier, so
 *   `getClient()` answers `undefined` even with a DSN — which is why the fallback must be a real sink
 *   rather than a silent drop.
 * @returns The single destination. Pure.
 */
export function routeLogRecord(level: LogLevel, sentryClientPresent: boolean): LogDestination {
    return DIVERTS_TO_SENTRY[level] && sentryClientPresent ? TO_SENTRY : TO_STDOUT;
}
