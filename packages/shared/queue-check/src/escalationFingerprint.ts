/**
 * The escalation FINGERPRINT (plan U11, R31) — what makes two runs of the same problem one Sentry issue.
 *
 * ⛔ WHY IT IS EXPLICIT. Sentry groups by stack trace when nothing else is supplied, and every escalation
 * this backstop raises comes from the SAME line of the same file — so left alone, "the parse queue is stuck
 * in prod" and "identity owes forty closures in sandbox" would be one issue, and the second would be hidden
 * as a duplicate of the first. The fingerprint is therefore derived from WHAT is wrong, never from where the
 * code noticed.
 *
 * ⚠️ It deliberately excludes every MEASURE. A check that ran twice ten minutes apart sees different counts
 * and a different oldest-age; folding those in would open a new issue on every run, which is the same
 * unusable outcome as grouping everything together, reached from the other side. The stable facts are the
 * service, the stage, the queue and the condition — exactly the things an operator would name when saying
 * what is wrong.
 */
import type { EscalationPayload } from './escalationPayload.js';

/**
 * The grouping key for one escalation.
 *
 * @param payload - The escalation.
 * @returns Sentry fingerprint components, most general first. Pure.
 */
export function escalationFingerprint(payload: EscalationPayload): readonly string[] {
    return ['queue-check', payload.service, payload.stage, payload.queueName, payload.condition];
}
