/**
 * THE ONE CloudWatch Embedded Metric Format envelope this service emits.
 *
 * DESIGN PATTERN: **Builder** for a wire format — a pure rendering function, so the shape the alarms extract
 * by is a value a test can read rather than a side effect it has to intercept. Emitters compose it; they do
 * not re-implement it.
 *
 * EMF (a structured stdout line CloudWatch auto-extracts from the Fargate log group) rather than
 * `PutMetricData`: no extra SDK client, no `cloudwatch:PutMetricData` grant on the task role, one log line.
 *
 * ## ⛔ WHY THIS IS SHARED, WHEN THE EMITTERS AROUND IT ARE NOT
 *
 * The envelope's shape is fixed by the AWS EMF spec, not by any one metric — a single piece of knowledge with
 * a single reason to change, which is exactly why `recipe-workers` (`common/metrics.ts`) and `food-service`
 * (`observability/emfMetrics.ts`) each own one copy and no more. This service had TWO
 * (`account/erasureMetrics.ts`, `ingredients/resolution/mappingPromotionAudit.ts`) and a third was drafted
 * against them; they are consolidated here, and `common/__tests__/emfEnvelopeSingleSource.test.ts` walks the
 * whole of `src/` with the TypeScript AST so the count cannot climb again.
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* SHARED. The namespace and metric NAME are an alarm contract, and each emitter's
 * payload names different facts. A shared emitter parameterised by the things that differ would put an alarm
 * contract behind an argument, so each emitter keeps its own constants, its own input type and its own log
 * line. Only the envelope and the stage resolution live here. It is also NOT shared with `recipe-workers` or
 * `food-service`: their emitters answer different questions (two dimension sets for ADR-0024's call-site
 * attribution; several metrics per line), `recipe-workers` exports `./infra` alone, and both of the repo-wide
 * AST gates — `emfIdentifierDimensionRepoGate.test.ts` and `serviceInfraWiringInvariants.test.ts` W4 — read
 * each SERVICE's own runtime sources for the directive, so an envelope that left the package would take this
 * service's dimension set out of their view.
 *
 * ## ⛔ `Stage` ALONE, and context goes in a FIELD
 *
 * In EMF every distinct combination of dimension VALUES is a separately billed custom metric (~$0.30/month,
 * 15-month retention), so a dimension keyed by user or phrase has cardinality equal to the user base and
 * aggregates to nothing chartable. The dimension set is therefore a literal here and takes no parameter.
 * Context that helps an operator triage rides {@link StageCountMetric.properties} instead — an unbilled field.
 *
 * ⚠️ A field is not a free pass for an identifier. The EMF line is written straight to stdout, which bypasses
 * the Sentry log facade and therefore `sentryScrubbers.ts` — so a RAW EXTERNAL identifier (a Clerk `sub`)
 * sits unscrubbed in CloudWatch for 15 months. An app ULID is already this repo's pseudonymous form and is
 * fine; anything else belongs on the scrubbed structured log line beside the metric.
 * `packages/infra/global/__tests__/emfIdentifierDimensionRepoGate.test.ts` carries the full argument, and
 * cannot see properties — only a reader can.
 */

/** The line's reserved fields, which a caller-supplied property may not displace. */
interface ReservedFields {
    readonly Stage: string;
    readonly [metricName: string]: string | number;
}

/** One occurrence to publish, dimensioned by deploy stage alone. */
export interface StageCountMetric {
    /** The CloudWatch namespace — half of the alarm contract (e.g. `Commise/RecipeAccount`). */
    readonly namespace: string;
    /** The metric name the alarm watches — the other half. */
    readonly metricName: string;
    /** The deploy-stage dimension value. */
    readonly stage: string;
    /**
     * Unbilled context fields written beside the metric, never as dimensions.
     *
     * ⚠️ Read the module docstring before putting an identifier here: a field fixes the COST hazard and
     * leaves the privacy one intact.
     */
    readonly properties?: Readonly<Record<string, string>>;
}

/**
 * Render one occurrence as a single EMF line.
 *
 * The emitted JSON is contractual — CloudWatch extracts by exact namespace, dimension set and metric name, and
 * a record whose directive names a dimension the line does not carry is DISCARDED rather than degraded. So the
 * reserved fields are written AFTER the caller's properties: a property named `Stage` (or named for the
 * metric) then cannot displace the value the alarm reads, which would silently lose the metric.
 *
 * @param metric - The namespace, metric name, stage, and any context fields.
 * @returns One line of JSON, with no embedded newline.
 */
export function buildStageCountMetricLine(metric: StageCountMetric): string {
    const reserved: ReservedFields = { Stage: metric.stage, [metric.metricName]: 1 };

    return JSON.stringify({
        _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
                {
                    Namespace: metric.namespace,
                    Dimensions: [['Stage']],
                    Metrics: [{ Name: metric.metricName, Unit: 'Count' }],
                },
            ],
        },
        ...metric.properties,
        ...reserved,
    });
}

/**
 * Resolve the deploy stage a metric is dimensioned by.
 *
 * A metric with a missing stage is still emitted rather than dropped — alarms fail toward firing, and a line
 * with no `Stage` field under a directive that declares the dimension is discarded outright.
 *
 * @param env - The environment to read (defaults to `process.env`). Pure given its argument.
 * @returns The stage label; `unknown` when neither `STAGE` nor `NODE_ENV` is set.
 */
export function resolveMetricStage(env: NodeJS.ProcessEnv = process.env): string {
    return env['STAGE'] ?? env['NODE_ENV'] ?? 'unknown';
}
