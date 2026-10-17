/**
 * THE ALARM RELAY (ADR-0062): every alarm topic's transitions, delivered to Sentry.
 *
 * Sentry has no integration that ingests an SNS topic or a CloudWatch alarm, so this Lambda is the missing piece: each
 * alarm topic subscribes it, and it turns an ALARM, an ECS task event or a message nobody planned for into a
 * fingerprinted Sentry issue. An OK is a structured log line, not an issue: closing issues would need an org token, and
 * Sentry's project auto-resolve does that without a stored credential.
 *
 * ⛔ IT MUST NOT DROP AN ALARM, so a failed delivery is a failed INVOCATION. Lambda retries an asynchronous invocation
 * twice and then parks the event in the failure queue whose depth is alarmed. `announceSilentNoOp` is deliberately NOT
 * reused: it swallows a failed report because a failed report must not fail a deploy, and here that same behaviour would
 * lose the only notice of a production fault.
 *
 * ⚠️ Every record is attempted even when an earlier one fails, and the failure is thrown once at the end: a poison
 * record must not stop the rest of the batch reaching Sentry. A retry re-posts the records that did land, which costs
 * nothing, because the fingerprint folds them into the issue they already opened.
 *
 * ⛔ NOT in a VPC (ADR-0004 unchanged): it reaches Sentry over the public internet, so attaching it would put a new
 * consumer on the NAT instance for no reason.
 *
 * @pattern Adapter — an SNS record onto a Sentry envelope POST
 */
import type { SNSEvent } from 'aws-lambda';

import { buildAlarmEnvelope } from '../observability/alarmEnvelope.js';
import { parseDsn, postEnvelope } from '../observability/sentryEnvelope.js';
import { parseTopicMessage, type RelayedMessage } from './message.js';

/** How long one POST to Sentry may take. Well inside the function's own timeout, with room for several records. */
export const RELAY_POST_DEADLINE_MS = 5_000;

/** Raised when an alarm could not be delivered to Sentry, so the invocation fails and Lambda retries it. */
export class AlarmRelayDeliveryError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'AlarmRelayDeliveryError';
        Object.setPrototypeOf(this, AlarmRelayDeliveryError.prototype);
    }
}

/**
 * Whether a value is an {@link AlarmRelayDeliveryError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is one. Pure.
 */
export function isAlarmRelayDeliveryError(error: unknown): error is AlarmRelayDeliveryError {
    return error instanceof AlarmRelayDeliveryError;
}

/** What the relay needs from its environment, injectable so the failure policy is testable without a network. */
export interface RelayDependencies {
    /** The Sentry DSN; empty or malformed means there is nowhere to deliver. */
    readonly dsn: string;
    /** The stage the relay serves; becomes the Sentry `environment`. */
    readonly stage: string;
    readonly now: () => Date;
    /** Where the one structured line per record goes (the drained log group). */
    readonly log: (line: string) => void;
    readonly postEnvelope: typeof postEnvelope;
}

/**
 * Whether a message opens a Sentry issue. An OK (and an INSUFFICIENT_DATA, which no alarm here is wired to send) is
 * only logged.
 *
 * @param message - The parsed message.
 * @returns Whether to report it. Pure.
 */
function isReportable(message: RelayedMessage): boolean {
    return message.kind !== 'cloudwatch-alarm' || message.newState === 'ALARM';
}

/** The structured line for one record: identifiers and states, no free-form body. Pure. */
function logLine(message: RelayedMessage, stage: string, reported: boolean): string {
    switch (message.kind) {
        case 'cloudwatch-alarm':
            return JSON.stringify({
                message: 'alarm transition',
                kind: message.kind,
                stage,
                topic: message.topicName,
                alarmName: message.alarmName,
                newState: message.newState,
                oldState: message.oldState,
                reason: message.reason,
                reported,
            });
        case 'ecs-task-state':
            return JSON.stringify({
                message: 'ecs task state change',
                kind: message.kind,
                stage,
                topic: message.topicName,
                group: message.group,
                lastStatus: message.lastStatus,
                ...(message.stopCode === undefined ? {} : { stopCode: message.stopCode }),
                reported,
            });
        case 'unrecognised':
            return JSON.stringify({
                message: 'alarm topic delivered an unreadable message',
                kind: message.kind,
                stage,
                topic: message.topicName,
                reported,
            });
    }
}

/**
 * Relay every record of one SNS invocation.
 *
 * @param event - The SNS event.
 * @param dependencies - Where to deliver, as what stage, and how.
 * @throws {AlarmRelayDeliveryError} when a report was needed and could not be delivered.
 * @sideEffect Writes one log line per record and issues one HTTP POST per reportable record.
 */
export async function relayAlarmMessages(event: SNSEvent, dependencies: RelayDependencies): Promise<void> {
    const target = parseDsn(dependencies.dsn);
    let reportable = 0;
    let lost = 0;

    for (const record of event.Records) {
        const message = parseTopicMessage(record.Sns.Message, record.Sns.TopicArn);
        const report = isReportable(message);

        dependencies.log(logLine(message, dependencies.stage, report));

        if (!report) {
            continue;
        }

        reportable += 1;

        if (target === undefined) {
            lost += 1;
            continue;
        }

        const delivered = await dependencies
            .postEnvelope(
                target,
                buildAlarmEnvelope(message, dependencies.stage, dependencies.now),
                RELAY_POST_DEADLINE_MS,
            )
            .catch(() => false);

        if (!delivered) {
            lost += 1;
        }
    }

    if (target === undefined && reportable > 0) {
        throw new AlarmRelayDeliveryError(
            `SENTRY_DSN is absent or malformed, so ${String(lost)} of ${String(event.Records.length)} alarm messages ` +
                'could not be delivered to Sentry',
        );
    }

    if (lost > 0) {
        throw new AlarmRelayDeliveryError(
            `${String(lost)} of ${String(event.Records.length)} alarm messages could not be delivered to Sentry`,
        );
    }
}

/**
 * The Lambda entry point.
 *
 * @param event - The SNS event.
 * @sideEffect Reads `SENTRY_DSN` and `STAGE`; see {@link relayAlarmMessages}.
 */
export const handler = (event: SNSEvent): Promise<void> =>
    relayAlarmMessages(event, {
        dsn: process.env['SENTRY_DSN'] ?? '',
        stage: process.env['STAGE'] ?? 'unknown',
        now: () => new Date(),
        log: (line) => {
            console.log(line);
        },
        postEnvelope,
    });
