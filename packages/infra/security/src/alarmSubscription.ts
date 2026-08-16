/**
 * THE rule for getting an alarm to a human (R3.2, plan U11) — one helper, every alarm topic.
 *
 * ## Why this is a shared rule and not two lines per stack
 *
 * Every service stack owns an SNS alarm topic, and every one of them had **zero subscriptions**. An alarm
 * would fire, publish to a topic nobody was listening to, and resolve — leaving a CloudWatch history nobody
 * reads and no notification at all. Plan U1 measured the same class of failure from the other direction: the
 * production erasure alarm shipped action-less AND dimensionless, so it could not have fired even with
 * perfect data.
 *
 * The rule itself is what must not drift: **subscribe the configured address; tolerate its absence
 * gracefully.** A stack that forgot the second half would fail synth in an account with no address
 * configured, which is every fork and every local `cdk synth`.
 *
 * ## Why the address is a PROP and never a literal
 *
 * This repository is public. Committing an address into a template publishes it, so the recipient arrives as
 * per-stage configuration (`COST_ALERT_EMAIL` / the `costAlertEmail` context), exactly as
 * `CostGuardrailsStack` already did. This reverses the older convention — subscriptions were managed
 * out-of-band precisely so no address sat in a committed file — and the prop is what lets it be reversed
 * without putting one there.
 *
 * @module
 */

import { aws_sns as sns, aws_sns_subscriptions as subscriptions } from 'aws-cdk-lib';

/**
 * Subscribe the configured alert address to an alarm topic, if one is configured. Idempotent per topic.
 *
 * @param topic - The alarm topic every alarm in the stack publishes to.
 * @param alertEmail - The per-stage recipient; `undefined` in an account that has not configured one.
 * @returns True when a subscription was added, false when no address was configured.
 * @sideEffect Adds an SNS email subscription to `topic`.
 */
export function subscribeAlarmEmail(topic: sns.ITopic, alertEmail: string | undefined): boolean {
    // An empty string is treated as absent, not as an address: an unset shell variable expands to `''` in
    // CI, and `new EmailSubscription('')` synthesizes a subscription that can never confirm.
    if (alertEmail === undefined || alertEmail.trim() === '') {
        return false;
    }

    topic.addSubscription(new subscriptions.EmailSubscription(alertEmail.trim()));

    return true;
}
