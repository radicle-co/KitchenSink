/**
 * Reading what an alarm topic delivers (ADR-0062).
 *
 * An alarm topic carries three kinds of thing: a CloudWatch alarm state-change notification, the raw EventBridge event
 * the food task-start rule publishes (it is not an alarm and has no state machine), and — the day somebody points a new
 * source at a topic — something nobody planned for. All three become a {@link RelayedMessage}, and the third is a
 * VALUE rather than an error: an alarm channel that throws on a message it does not understand is a channel that goes
 * quiet exactly when it has something new to say.
 *
 * ⛔ TOTAL. {@link parseTopicMessage} never throws and never returns nothing. Bad JSON, valid JSON of another shape and
 * a known shape with an unusable field are all `unrecognised`, which the handler reports.
 *
 * ⚠️ zod strips fields the schema does not name, so an AWS addition to the notification is ignored rather than fatal;
 * the fields that ARE named are the ones the report needs, and a notification missing one of them is `unrecognised`
 * rather than a half-filled issue.
 *
 * @pattern Parse, don't validate — a raw SNS string becomes a discriminated union the handler switches over
 */
import { z } from 'zod';

/** A CloudWatch alarm's state, as the notification names it. */
const alarmStateSchema = z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']);

/** The CloudWatch alarm notification, reduced to the fields the relay reads. */
const cloudwatchAlarmSchema = z.object({
    AlarmName: z.string().min(1),
    AlarmDescription: z.string().nullish(),
    NewStateValue: alarmStateSchema,
    OldStateValue: z.string(),
    NewStateReason: z.string(),
    StateChangeTime: z.string(),
    // A metric-math alarm's trigger has `Metrics` and no single namespace or metric name.
    Trigger: z
        .object({
            Namespace: z.string().optional(),
            MetricName: z.string().optional(),
        })
        .optional(),
});

/** The EventBridge `ECS Task State Change` event the food task-start rule publishes. */
const ecsTaskStateSchema = z.object({
    source: z.literal('aws.ecs'),
    'detail-type': z.literal('ECS Task State Change'),
    time: z.string(),
    detail: z.object({
        group: z.string().min(1),
        lastStatus: z.string(),
        stopCode: z.string().optional(),
        stoppedReason: z.string().optional(),
    }),
});

/** A CloudWatch alarm changed state. */
export interface CloudwatchAlarmMessage {
    readonly kind: 'cloudwatch-alarm';
    readonly topicName: string;
    readonly alarmName: string;
    readonly description?: string;
    readonly newState: z.infer<typeof alarmStateSchema>;
    readonly oldState: string;
    readonly reason: string;
    readonly stateChangeTime: string;
    /** Absent for a metric-math alarm. */
    readonly namespace?: string;
    /** Absent for a metric-math alarm. */
    readonly metricName?: string;
}

/** An ECS task changed state (the task-start rule publishes only `STOPPED` ones that failed to start). */
export interface EcsTaskStateMessage {
    readonly kind: 'ecs-task-state';
    readonly topicName: string;
    /** `service:<name>` or `family:<task definition>` — what the task belonged to. */
    readonly group: string;
    readonly lastStatus: string;
    readonly stopCode?: string;
    readonly stoppedReason?: string;
    readonly time: string;
}

/** Something a topic delivered that the relay does not understand. */
export interface UnrecognisedMessage {
    readonly kind: 'unrecognised';
    readonly topicName: string;
}

/** Everything an alarm topic can deliver, as the handler's exhaustive switch sees it. */
export type RelayedMessage = CloudwatchAlarmMessage | EcsTaskStateMessage | UnrecognisedMessage;

/**
 * The topic's name: the last `:` segment of its ARN. `unknown` for an empty ARN, so a report always names something.
 *
 * @param topicArn - The SNS topic ARN of the record.
 * @returns The topic name. Pure.
 */
function topicNameOf(topicArn: string): string {
    return topicArn.split(':').at(-1)?.trim() || 'unknown';
}

/**
 * Parse one SNS record's message.
 *
 * @param raw - The record's `Sns.Message` string.
 * @param topicArn - The record's `Sns.TopicArn`.
 * @returns The message as a {@link RelayedMessage}; never throws. Pure.
 */
export function parseTopicMessage(raw: string, topicArn: string): RelayedMessage {
    const topicName = topicNameOf(topicArn);
    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch {
        return { kind: 'unrecognised', topicName };
    }

    const alarm = cloudwatchAlarmSchema.safeParse(json);

    if (alarm.success) {
        const { data } = alarm;

        return {
            kind: 'cloudwatch-alarm',
            topicName,
            alarmName: data.AlarmName,
            ...(data.AlarmDescription ? { description: data.AlarmDescription } : {}),
            newState: data.NewStateValue,
            oldState: data.OldStateValue,
            reason: data.NewStateReason,
            stateChangeTime: data.StateChangeTime,
            ...(data.Trigger?.Namespace === undefined ? {} : { namespace: data.Trigger.Namespace }),
            ...(data.Trigger?.MetricName === undefined ? {} : { metricName: data.Trigger.MetricName }),
        };
    }

    const ecs = ecsTaskStateSchema.safeParse(json);

    if (ecs.success) {
        const { data } = ecs;

        return {
            kind: 'ecs-task-state',
            topicName,
            group: data.detail.group,
            lastStatus: data.detail.lastStatus,
            ...(data.detail.stopCode === undefined ? {} : { stopCode: data.detail.stopCode }),
            ...(data.detail.stoppedReason === undefined ? {} : { stoppedReason: data.detail.stoppedReason }),
            time: data.time,
        };
    }

    return { kind: 'unrecognised', topicName };
}
