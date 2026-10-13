/**
 * The Sentry envelope for one relayed alarm message (ADR-0062).
 *
 * ⛔ THE FINGERPRINT IS THE CONTRACT, and each is built from identifiers only: the stage and one name. Sentry groups by
 * it, so it decides whether a recurring alarm is one issue with a history or a new issue every time. It is derived from
 * NAMES and never from the message text, because the text carries the datapoint values and changes on every
 * transition; and it carries the STAGE because the same alarm name at two stages is two operational problems. Changing a
 * fingerprint splits issue history, so `alarmEnvelope.test.ts` pins each one exactly.
 *
 * ⛔ A MESSAGE EVENT, NOT AN EXCEPTION, because nothing threw: an alarm is a measured condition. `level: 'error'`
 * because the project's issue alert is on high-priority issues, and a lower level is filed and never read. The
 * `environment` is the stage, which is what that alert is filtered on.
 *
 * ⚠️ No raw topic body leaves in an `unrecognised` report: the type carries only the topic's name, so what cannot be
 * read cannot be forwarded.
 *
 * @pattern Builder — a pure rendering function, so the shape Sentry groups by is a value a test reads, not a side effect
 */
import type { RelayedMessage } from '../alarmRelay/message.js';

/** The longest report text, so one runaway reason cannot push an envelope past what Sentry accepts. */
export const MAX_REPORT_CHARACTERS = 2_000;

/** The reported event's text, cut to {@link MAX_REPORT_CHARACTERS}. Pure. */
const bounded = (text: string): string =>
    text.length <= MAX_REPORT_CHARACTERS ? text : `${text.slice(0, MAX_REPORT_CHARACTERS - 1)}…`;

/**
 * What an event says, its fingerprint and its tags, per message kind.
 *
 * ⚠️ An EXHAUSTIVE switch over the discriminated union: a new kind is a compile error here, which is the Visitor intent
 * without the machinery.
 */
function describe(
    message: RelayedMessage,
    stage: string,
): { text: string; fingerprint: readonly string[]; tags: Record<string, string> } {
    switch (message.kind) {
        case 'cloudwatch-alarm': {
            const detail = message.description === undefined ? '' : ` (${message.description})`;

            return {
                text: `${message.alarmName}${detail} is ${message.newState}: ${message.reason}`,
                fingerprint: ['cloudwatch-alarm', stage, message.alarmName],
                tags: {
                    alarm: message.alarmName,
                    topic: message.topicName,
                    ...(message.namespace === undefined ? {} : { namespace: message.namespace }),
                },
            };
        }

        case 'ecs-task-state': {
            const code = message.stopCode === undefined ? '' : ` [${message.stopCode}]`;
            const reason = message.stoppedReason === undefined ? '' : `: ${message.stoppedReason}`;

            return {
                text: `ECS task of ${message.group} is ${message.lastStatus}${code}${reason}`,
                fingerprint: ['ecs-task-failed-to-start', stage, message.group],
                tags: { topic: message.topicName, group: message.group },
            };
        }

        case 'unrecognised':
            return {
                text: `Alarm topic ${message.topicName} delivered a message the relay could not read`,
                fingerprint: ['alarm-topic-unrecognised', stage, message.topicName],
                tags: { topic: message.topicName },
            };
    }
}

/**
 * Build the Sentry envelope for one alarm message.
 *
 * @param message - What the topic delivered.
 * @param stage - The deploy stage; becomes the Sentry `environment` and part of the fingerprint.
 * @param now - The clock. ⚠️ INJECTED, because the envelope header carries `sent_at` and a function that reads the wall
 *   clock is not pure however it is documented.
 * @returns The envelope body. Pure.
 */
export function buildAlarmEnvelope(message: RelayedMessage, stage: string, now: () => Date = () => new Date()): string {
    const { text, fingerprint, tags } = describe(message, stage);
    const header = JSON.stringify({ sent_at: now().toISOString() });
    const itemHeader = JSON.stringify({ type: 'event' });
    const event = JSON.stringify({
        level: 'error',
        platform: 'node',
        environment: stage,
        fingerprint,
        tags,
        message: { formatted: bounded(text) },
    });

    return `${header}\n${itemHeader}\n${event}\n`;
}
