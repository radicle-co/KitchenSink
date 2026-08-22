/**
 * The CloudWatch unit for a metric. Constrained to the units the recipe-workers Lambdas actually
 * publish — a database age (seconds), a database count, and `None` — so a typo cannot silently mis-label a
 * metric the alarms depend on. Widen only when a new metric needs a new unit.
 *
 * ⚠️ `None` exists for the verification gate's DOLLAR metric (ADR-0024 layer 4), and it is not laziness:
 * **CloudWatch has no currency unit.** Its unit enumeration covers bytes, bits, seconds, percent, counts and
 * their rates, and nothing else — so a dollar-denominated metric is published as `None` and the dimension is
 * carried in the metric NAME (`VerificationSpendMicros`). Do not "fix" it to `Count`: that would make a
 * dashboard read $0.000116 as a count of 116, and it would make the alarm's threshold read as a call volume.
 */
export type MetricUnit = 'Seconds' | 'Count' | 'None';

/**
 * One CloudWatch metric emitted via the Embedded Metric Format (EMF).
 *
 * @property namespace - The CloudWatch namespace (e.g. `Commise/RecipeArchive`).
 * @property name - The metric name the alarm watches (e.g. `PendingArchiveBacklog`).
 * @property unit - The metric's unit.
 * @property stage - The deploy stage; the metric's only dimension.
 * @property value - The measured value for this tick.
 */
export type EmfMetric = {
    readonly namespace: string;
    readonly name: string;
    readonly unit: MetricUnit;
    readonly stage: string;
    readonly value: number;
};

/**
 * Publish a single metric to CloudWatch via the Embedded Metric Format — the ONE authoritative EMF
 * envelope for every recipe-workers sweeper.
 *
 * EMF (a structured log line CloudWatch parses out of the Lambda's log group) rather than
 * `PutMetricData`: it needs no extra SDK client, no `cloudwatch:PutMetricData` grant on the sweeper's
 * role, and costs one log line. The sweeper metrics are database facts (a row count, a row age),
 * invisible to CloudWatch otherwise — without this line the alarms would have no data and sit
 * permanently in INSUFFICIENT_DATA.
 *
 * The envelope's shape is fixed by the AWS EMF spec, not by any one sweeper — it is a single piece of
 * knowledge with a single reason to change (the spec), so it lives here once. Every metric uses the
 * same single `Stage` dimension, so callers passing the same namespace share an alarm dimension. The
 * emitted JSON — key order and all — is contractual: the alarms extract by exact namespace, dimension,
 * and metric name, so this output must not drift.
 *
 * @param metric - The namespace, name, unit, stage, and value for this metric.
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitMetric({ namespace, name, unit, stage, value }: EmfMetric): void {
    console.log(
        JSON.stringify({
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [
                    {
                        Namespace: namespace,
                        Dimensions: [['Stage']],
                        Metrics: [{ Name: name, Unit: unit }],
                    },
                ],
            },
            Stage: stage,
            [name]: value,
        }),
    );
}
