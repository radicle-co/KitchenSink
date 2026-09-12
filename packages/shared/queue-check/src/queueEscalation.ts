/**
 * THE ONE BINDING between a backstop's finding and Sentry (plan U12/U13).
 *
 * ⛔ THIS WAS THREE COPIES, AND THE REASON GIVEN FOR THAT WAS FALSE. Each copy's header claimed the SDK was
 * what differed — `@sentry/aws-serverless` in the two Lambda packages, `@sentry/nestjs` in food's worker — so
 * a shared module would have to depend on one of them. Measured: `captureMessage`, `withScope` and
 * `captureCheckIn` are the SAME FUNCTION OBJECTS in all three packages, re-exported from `@sentry/core`
 * (`aws.captureMessage === core.captureMessage === nest.captureMessage`). Nothing SDK-specific was ever in
 * those files, and by the time the claim was checked two of the three headers described the wrong file and
 * one service derived its interval while the other two wrote the same literal twice.
 *
 * ⛔ SO THE SDK IS A PORT, not a dependency. Each service passes its own three functions; this package takes
 * none of them, which is the property the copies were trying to protect and did not need to duplicate to get.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT SHARED: initialisation. Each runtime's `Sentry.init` happens before anything
 * else loads, for reasons specific to that runtime (`@sentry/nestjs` patches modules as they load, so food's
 * `instrument.ts` must run under `node --import`). A factory that also initialised would either be a no-op or
 * would replace a correctly-configured client with one built from whatever it happened to read.
 */
import {
    checksIn,
    monitorSlug,
    MONITOR_FAILURES_BEFORE_ISSUE,
    MONITOR_MARGIN_MINUTES,
    MONITOR_RECOVERY_THRESHOLD,
} from './cronMonitor.js';
import { escalationFingerprint } from './escalationFingerprint.js';
import { escalationLevel, escalationTitle, type EscalationPayload } from './escalationPayload.js';

/** The part of a Sentry scope an escalation sets. Structural, so the real `Scope` satisfies it. */
export interface EscalationScope {
    setFingerprint: (fingerprint: string[]) => void;
    setLevel: (level: 'error' | 'warning') => void;
    setContext: (name: string, context: Record<string, unknown>) => void;
    setTags: (tags: Record<string, string>) => void;
}

/** The monitor configuration a check-in upserts. Structural, matching the SDK's `MonitorConfig`. */
export interface UpsertMonitorConfig {
    readonly schedule: { readonly type: 'interval'; readonly value: number; readonly unit: 'minute' };
    readonly checkinMargin: number;
    readonly failureIssueThreshold: number;
    readonly recoveryThreshold: number;
}

/**
 * The three Sentry functions a backstop needs.
 *
 * ⚠️ Passed in rather than imported, so this package depends on no SDK. Every runtime hands over the exact
 * functions its own `Sentry` namespace exposes — which are, measurably, the same objects.
 */
export interface SentryPort {
    readonly withScope: (callback: (scope: EscalationScope) => void) => void;
    readonly captureMessage: (message: string, level: 'error' | 'warning') => void;
    readonly captureCheckIn: (
        checkIn: { readonly monitorSlug: string; readonly status: 'ok' },
        config: UpsertMonitorConfig,
    ) => void;
}

/** What a service is, for reporting. */
export interface BackstopIdentity {
    /** The service identifier every escalation and check-in carries. */
    readonly service: string;
    /**
     * How often this service's check runs, in minutes.
     *
     * ⛔ It must match the cadence the check ACTUALLY runs on — its EventBridge rate, or food's reaper tick.
     * A monitor expecting a check-in more often than the check fires reports a miss every interval, which is
     * a permanently-failing monitor for a check running exactly as designed.
     */
    readonly intervalMinutes: number;
}

/** A backstop's two Sentry operations, bound to one service. */
export interface QueueEscalation {
    /** Raise one escalation. */
    readonly escalate: (payload: EscalationPayload) => void;
    /** Report that a run completed, on a stage that checks in. */
    readonly checkInQueueCheck: (stage: string) => void;
}

/**
 * Bind a service's backstop to its Sentry client.
 *
 * @param sentry - The runtime's own three functions.
 * @param identity - Which service this is, and how often its check runs.
 * @returns The two operations, closed over that identity.
 */
export function createQueueEscalation(sentry: SentryPort, identity: BackstopIdentity): QueueEscalation {
    return {
        /**
         * ⛔ THE FINGERPRINT IS EXPLICIT. Sentry groups by stack trace when nothing else is given, and every
         * escalation now comes from THIS line of THIS file — so left alone, every finding from every service
         * would be one issue and all but the first would be hidden as duplicates. Derived from the payload,
         * so it moves when the finding does.
         *
         * ⛔ AND IT CARRIES NO TEXT. The payload has nowhere to put any; see `escalationPayload.ts` for why a
         * Sentry event is a place a user's words must never reach.
         *
         * @param payload - The escalation. Identifiers and counts only.
         * @sideEffect Emits a Sentry event when a client is configured; otherwise does nothing.
         */
        escalate: (payload: EscalationPayload): void => {
            const level = escalationLevel(payload);

            sentry.withScope((scope) => {
                scope.setFingerprint([...escalationFingerprint(payload)]);
                scope.setLevel(level);
                scope.setContext('owed_work', { ...payload });
                scope.setTags({
                    service: payload.service,
                    stage: payload.stage,
                    queue: payload.queueName,
                    condition: payload.condition,
                });

                sentry.captureMessage(escalationTitle(payload), level);
            });
        },

        /**
         * ⛔ THE MONITOR IS CREATED BY THE CHECK-IN, not by hand in the Sentry UI. One somebody has to
         * remember to create does not exist for the first stage nobody remembered — and from the outside,
         * "never set up" and "running fine" look identical.
         *
         * @param stage - The deploy stage.
         * @sideEffect Emits a Sentry check-in on a checking-in stage; otherwise does nothing.
         */
        checkInQueueCheck: (stage: string): void => {
            if (!checksIn(stage)) {
                return;
            }

            sentry.captureCheckIn(
                { monitorSlug: monitorSlug(identity.service, stage), status: 'ok' },
                {
                    schedule: { type: 'interval', value: identity.intervalMinutes, unit: 'minute' },
                    checkinMargin: MONITOR_MARGIN_MINUTES,
                    failureIssueThreshold: MONITOR_FAILURES_BEFORE_ISSUE,
                    recoveryThreshold: MONITOR_RECOVERY_THRESHOLD,
                },
            );
        },
    };
}
