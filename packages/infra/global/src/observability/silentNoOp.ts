/**
 * A SILENT NO-OP BECOMES AN ISSUE (plan U18).
 *
 * ⛔ THE FAILURE THIS EXISTS FOR IS THE ONE THAT REPORTS SUCCESS. `db-bootstrap` and `db-reaper` both have a
 * documented path where they run to completion, return normally, and have done nothing they were there to do
 * — the bootstrap's master-login rollback releases the master from the owner role the reaper inherits, and
 * from that moment the reaper reclaims nothing while every abandoned preview keeps billing. `bootstrapPass.ts`
 * says so in its own comment, and names the precedent: ADR-0005's tag sweep that matched nothing and reported
 * success.
 *
 * ⛔ A LOG LINE IS NOT ENOUGH, and that is not a rhetorical point. Both functions' groups are on the drain
 * (ADR-0042), so these paths already produce a line in Sentry. A forwarded log line does not group, carries
 * no fingerprint, and nothing alerts on it — which is exactly the state that let the original no-op run
 * unnoticed. Errors and logs are different products and only one of them pages anybody.
 *
 * ⛔ AND IT NEVER FAILS ITS CALLER. `db-bootstrap` is a CloudFormation custom resource: a throw here fails the
 * resource, which fails the stack, which is a deploy outage caused by telemetry. Every path is swallowed and
 * every report is bounded.
 *
 * ⛔ HANDLERS CALL {@link announceSilentNoOp}, NOT {@link reportSilentNoOp}. The second is exported for the
 * suite and for the first to build on; called directly from a handler it discards the reporter's answer,
 * which is a silent failure to report a silent failure — the branch this module was extended to close. If a
 * third handler ever needs this, it calls the announcing form.
 */
import { parseDsn } from './sentryEnvelope.js';

/** How long a report may take before it is abandoned. Well inside a custom resource's own timeout. */
export const SILENT_NOOP_DEADLINE_MS = 2_000;

/**
 * What ran and did nothing.
 *
 * ⛔ IDENTIFIERS AND A FIXED REASON. This is the shape that reaches SENTRY, and a Sentry event sits outside
 * every erasure path — so no database name, no secret, no free text assembled from a caller's data.
 */
export interface SilentNoOp {
    /** The function reporting, from a closed set. */
    readonly service: 'db-bootstrap' | 'db-reaper';
    /** The deploy stage. */
    readonly stage: string;
    /** The condition, from this module's own vocabulary — the fingerprint is built from it. */
    readonly condition: string;
    /** A fixed sentence explaining the condition. ⛔ Written here, never interpolated from a caller's data. */
    readonly detail: string;
}

/**
 * Build the Sentry envelope for one silent no-op.
 *
 * ⛔ A MESSAGE EVENT, NOT AN EXCEPTION, because nothing threw — the function completed and did nothing, which
 * is the whole finding. Reporting it as an exception would manufacture a stack trace pointing at the reporter
 * rather than at the condition.
 *
 * ⛔ WITH AN EXPLICIT FINGERPRINT. Sentry groups a message by its text, so two platform functions reporting
 * two different no-ops would land in one issue and the second would be filed as a duplicate of the first and
 * never read. The fingerprint is derived from the service and the condition, so it moves when the finding
 * does and stays put when the wording does.
 *
 * @param noOp - What ran and did nothing.
 * @param now - The clock. ⚠️ INJECTED, because the envelope header carries `sent_at` and a function that
 *   reads the wall clock is not pure however it is documented — this one claimed to be.
 * @returns The envelope body. Pure.
 */
export function buildSilentNoOpEnvelope(noOp: SilentNoOp, now: () => Date = () => new Date()): string {
    const header = JSON.stringify({ sent_at: now().toISOString() });
    const itemHeader = JSON.stringify({ type: 'event' });
    const event = JSON.stringify({
        // ⛔ ERROR, not warning. A reclamation that has silently stopped bills for every abandoned preview
        // until somebody notices, and the reason this report exists is that nobody was going to. A warning is
        // a thing a reader scrolls past.
        level: 'error',
        platform: 'node',
        environment: noOp.stage,
        fingerprint: ['silent-no-op', noOp.service, noOp.condition],
        tags: { service: noOp.service, condition: noOp.condition },
        message: { formatted: `${noOp.service}: ${noOp.condition} — ${noOp.detail}` },
    });

    return `${header}\n${itemHeader}\n${event}\n`;
}

/**
 * Report a silent no-op, best-effort and bounded.
 *
 * ⛔ NO DSN IS NOT AN ERROR. These functions run in stages that may have no Sentry parameter, and in every
 * local test. A reporter that threw would turn "observability is not configured" into "the database bootstrap
 * failed" — the more damaging of the two by a wide margin.
 *
 * @param noOp - What ran and did nothing.
 * @param dsn - The Sentry DSN; defaults to `SENTRY_DSN`.
 * @returns Whether an envelope was sent.
 * @sideEffect Issues at most one HTTP POST; reads `SENTRY_DSN`.
 */
export async function reportSilentNoOp(
    noOp: SilentNoOp,
    dsn: string = process.env['SENTRY_DSN'] ?? '',
): Promise<boolean> {
    const target = parseDsn(dsn);

    if (target === undefined) {
        return false;
    }

    try {
        const response = await fetch(target.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-sentry-envelope',
                'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.key}`,
            },
            body: buildSilentNoOpEnvelope(noOp),
            signal: AbortSignal.timeout(SILENT_NOOP_DEADLINE_MS),
        });

        // ⛔ THE RESPONSE IS CHECKED. This returned `true` for a 401, a 413 or a 429 — claiming a delivery it
        // never verified, in the module whose entire subject is a success that is not one. `fetch` rejects
        // only on a transport failure, so an expired DSN key would have reported "sent" forever.
        return response.ok;
    } catch {
        // ⛔ SWALLOWED, always. See the module docstring: a failed report must never fail a deploy.
        return false;
    }
}

/**
 * Report a silent no-op, and say so on the drain when the report itself did not land.
 *
 * ⛔ THE REPORTER'S ANSWER IS NOT DISCARDABLE. `reportSilentNoOp` returns whether Sentry accepted the
 * envelope; ignoring it leaves an expired DSN key producing NO operator-visible signal at all — a silent
 * failure to report a silent failure, in the module whose whole subject is a success that is not one. The
 * fallback is a log line, which reaches Sentry by the drain (ADR-0042) and so survives the DSN being wrong.
 *
 * ⚠️ IT EXISTS AS A FUNCTION so the fallback can be TESTED. Inline at each handler, the branch is reachable
 * only by standing up a database and forcing a rollback — so it shipped at two call sites with no test at any
 * tier, which is the one branch least affordable to leave unproven. Here, an empty DSN drives it with no
 * network and no database.
 *
 * ⛔ `context` REACHES THE DRAIN AND NEVER THE ENVELOPE, and the asymmetry is the point. The closed
 * {@link SilentNoOp} governs what leaves for Sentry; a CloudWatch log group is a different sink with a
 * different rule, and losing the one fact an operator needs first — WHICH database was being bootstrapped —
 * made the fallback line markedly less actionable than the report it stands in for. A per-PR database name
 * is neither a secret nor personal data. It is a separate parameter so that distinction is impossible to
 * blur by adding a field to the payload.
 *
 * @param noOp - What ran and did nothing. Reaches Sentry.
 * @param context - Extra identifiers for the DRAIN only. ⛔ Never sent to Sentry.
 * @param log - Where the fallback goes. Defaults to `console.error`.
 * @param dsn - The Sentry DSN; defaults to `SENTRY_DSN`.
 * @returns Whether the Sentry report landed.
 * @sideEffect Issues at most one HTTP POST; may write one log line.
 */
export async function announceSilentNoOp(
    noOp: SilentNoOp,
    context: Readonly<Record<string, string>> = {},
    log: (line: string) => void = (line) => {
        console.error(line);
    },
    dsn: string = process.env['SENTRY_DSN'] ?? '',
): Promise<boolean> {
    const reported = await reportSilentNoOp(noOp, dsn);

    if (!reported) {
        // ⛔ `context` SPREADS FIRST, so it cannot shadow a reported field. Spread last, a context key named
        // `service`, `stage`, `condition` or `detail` silently overwrites what was reported to Sentry — in
        // the one module whose whole design is that the two sets must not blur. The drain line and the
        // envelope would then disagree about the same run, and the drain is what an operator reads when the
        // envelope did not land.
        log(
            JSON.stringify({
                ...context,
                ...noOp,
                // ⛔ `message` LAST, not first. Putting `noOp` after `context` protects the four fields it
                // carries — and `message` is not one of them, so spread first it was still shadowable by a
                // context key of the same name, which would overwrite the drain line's own label. All three
                // precedence levels are now explicit: caller context, then what was reported, then the label.
                message: 'silent no-op detected AND its Sentry report failed',
            }),
        );
    }

    return reported;
}
