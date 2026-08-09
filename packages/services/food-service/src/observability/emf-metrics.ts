/**
 * CloudWatch Embedded Metric Format (EMF) emitter for the food service (T-181; extended to the API by
 * T-199b for the SC-004/SC-005 local-store serve rate). The emitter
 * writes a single EMF JSON line to stdout per metric; CloudWatch auto-extracts the metric from the
 * Fargate log group with NO extra IAM (no `cloudwatch:PutMetricData` call, no SDK). The metric-name
 * constants exported here are the single source of truth for the worker emission AND the CDK dashboard
 * (T-182) + alarms (T-183) — keep both sides referencing {@link FOOD_METRIC} so the emitted name and
 * the alarmed/charted name can never drift.
 *
 * @implements SC-002 SC-006 US-10
 */

/** CloudWatch namespace every food worker metric is published under. */
export const FOOD_METRIC_NAMESPACE = 'Commise/Food';

/**
 * Canonical EMF metric names (the worker ↔ dashboard/alarm contract). The CDK references these exact
 * literals for the dashboard widgets and the food-specific alarms.
 */
export const FOOD_METRIC = {
    /** Pending `fetch_queue` depth (FR-046 backpressure alarm at > 10,000). */
    fetchQueueDepth: 'food-fetch-queue-depth',
    /** End-to-end per-row resolution latency in seconds (SC-002). */
    resolutionLatencySeconds: 'food-resolution-latency-seconds',
    /** Per-source rolling-60-min windowed call count (dimension: `source`). */
    sourceRollingWindowCount: 'source-rolling-window-count',
    /** Per-source API success rate as a percentage (dimension: `source`). */
    sourceApiSuccessRate: 'source-api-success-rate',
    /** Count of foods awaiting human disambiguation (UNRESOLVED). */
    unresolvedBacklog: 'food-unresolved-backlog',
    /** Count of tombstone (NOT_FOUND/FAILED) queue rows (alarm at > 0). */
    tombstoneCount: 'food-tombstone-count',
    /** Share of reads served from the local store with no source call, as a percentage (SC-005). */
    localStoreServeRate: 'food-local-store-serve-rate',
    /** Share of API requests rejected `401`, as a percentage. */
    auth401Rate: 'auth-401-rate',
    /** Age in seconds of the OLDEST pending `fetch_queue` row (freshness alarm at > 5 min). */
    pendingAgeSeconds: 'food-fetch-pending-age-seconds',
    /** Currently-leased (`in_flight`) `fetch_queue` row count (dashboard saturation signal). */
    inFlightLeases: 'food-in-flight-leases',
    /** Count of rows that hit a real worker/source error this pass (dashboard worker-error signal). */
    workerErrorCount: 'food-worker-error-count',
} as const;

/** A CloudWatch metric unit (the subset the food worker emits). */
export type MetricUnit = 'Count' | 'Seconds' | 'Milliseconds' | 'Percent' | 'None';

/** One metric value to embed in an EMF record. */
export interface MetricDatum {
    /** The metric name (use a {@link FOOD_METRIC} value). */
    readonly name: string;
    /** The metric value. */
    readonly value: number;
    /** The CloudWatch unit. */
    readonly unit: MetricUnit;
}

/** Input to {@link buildEmf}. */
export interface EmfInput {
    /** The metrics published in this record (all share the dimension set + timestamp). */
    readonly metrics: readonly MetricDatum[];
    /** Optional dimensions (e.g. `{ source: 'usda' }`); each key becomes a CloudWatch dimension. */
    readonly dimensions?: Readonly<Record<string, string>>;
    /** Namespace override (defaults to {@link FOOD_METRIC_NAMESPACE}). */
    readonly namespace?: string;
    /** Epoch-millis timestamp (defaults to `Date.now()`). */
    readonly timestamp?: number;
}

/** The CloudWatch metric-directive block embedded under `_aws`. */
export interface EmfMetricDirective {
    /** CloudWatch namespace. */
    readonly Namespace: string;
    /** Dimension sets — a single set of the provided dimension keys (`[[]]` when none). */
    readonly Dimensions: readonly (readonly string[])[];
    /** The metric definitions (name + unit). */
    readonly Metrics: ReadonlyArray<{ readonly Name: string; readonly Unit: MetricUnit }>;
}

/** A serializable EMF record: the `_aws` directive plus the dimension + metric value fields. */
export interface EmfPayload {
    /** The EMF metadata envelope CloudWatch parses. */
    readonly _aws: {
        /** Epoch-millis timestamp. */
        readonly Timestamp: number;
        /** The metric directives (a single directive for the food worker). */
        readonly CloudWatchMetrics: readonly EmfMetricDirective[];
    };
    /** Dimension values and metric values are flattened as top-level fields. */
    readonly [key: string]: unknown;
}

/**
 * Build a CloudWatch EMF record from a set of metrics + optional dimensions. Pure given its
 * `timestamp` (defaults to `Date.now()`, the only impurity).
 *
 * @param input - The metrics, optional dimensions, namespace, and timestamp.
 * @returns The serializable EMF payload.
 */
export function buildEmf(input: EmfInput): EmfPayload {
    const namespace = input.namespace ?? FOOD_METRIC_NAMESPACE;
    const timestamp = input.timestamp ?? Date.now();
    const dimensions = input.dimensions ?? {};
    const dimensionKeys = Object.keys(dimensions);

    const payload: Record<string, unknown> = {
        _aws: {
            Timestamp: timestamp,
            CloudWatchMetrics: [
                {
                    Namespace: namespace,
                    Dimensions: [dimensionKeys],
                    Metrics: input.metrics.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
                },
            ],
        },
    };

    for (const [key, value] of Object.entries(dimensions)) {
        payload[key] = value;
    }

    for (const metric of input.metrics) {
        payload[metric.name] = metric.value;
    }

    return payload as EmfPayload;
}

/**
 * The default line sink: stdout via `console.log`, resolved on EVERY call rather than captured once.
 * The late binding is deliberate — a default of `console.log` itself freezes the reference at definition
 * time, which would bypass any `console` interception installed later in the process (the Sentry log
 * forwarder, a test spy). Same observable behaviour, one fewer footgun.
 *
 * @param line - The line to write.
 * @sideEffect Writes one line to stdout.
 */
function writeLine(line: string): void {
    console.log(line);
}

/**
 * Emit one EMF record as a single JSON line for CloudWatch to auto-extract.
 *
 * @param input - The metrics + optional dimensions.
 * @param sink - The line sink (defaults to stdout; injected in tests).
 * @sideEffect Writes one line to the sink (stdout in production).
 */
export function emitMetric(input: EmfInput, sink: (line: string) => void = writeLine): void {
    sink(JSON.stringify(buildEmf(input)));
}

/**
 * Typed recorder over an EMF sink — the service's single seam for publishing operational metrics. Each
 * method emits exactly one EMF line using a {@link FOOD_METRIC} name so the emitted metric matches the
 * CDK dashboard/alarm reference.
 */
export class FoodMetrics {
    /** @param sink - The line sink (defaults to stdout via {@link writeLine}; injected in tests). */
    public constructor(private readonly sink: (line: string) => void = writeLine) {}

    /**
     * Record an end-to-end per-row resolution latency (SC-002).
     *
     * @param seconds - The elapsed seconds from lease to terminal disposition.
     * @sideEffect Emits one EMF line.
     */
    public recordResolutionLatencySeconds(seconds: number): void {
        emitMetric(
            { metrics: [{ name: FOOD_METRIC.resolutionLatencySeconds, value: seconds, unit: 'Seconds' }] },
            this.sink,
        );
    }

    /**
     * Record the current pending `fetch_queue` depth (FR-046).
     *
     * @param depth - The pending row count.
     * @sideEffect Emits one EMF line.
     */
    public recordQueueDepth(depth: number): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.fetchQueueDepth, value: depth, unit: 'Count' }] }, this.sink);
    }

    /**
     * Record the UNRESOLVED disambiguation backlog.
     *
     * @param count - The UNRESOLVED food count.
     * @sideEffect Emits one EMF line.
     */
    public recordUnresolvedBacklog(count: number): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.unresolvedBacklog, value: count, unit: 'Count' }] }, this.sink);
    }

    /**
     * Record the tombstone (NOT_FOUND/FAILED) queue-row count (alarmed at > 0).
     *
     * @param count - The tombstone row count.
     * @sideEffect Emits one EMF line.
     */
    public recordTombstoneCount(count: number): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.tombstoneCount, value: count, unit: 'Count' }] }, this.sink);
    }

    /**
     * Record the age of the OLDEST pending queue row (freshness alarm at > 5 min).
     *
     * @param seconds - The oldest-pending age in seconds (0 when none pending).
     * @sideEffect Emits one EMF line.
     */
    public recordPendingAgeSeconds(seconds: number): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.pendingAgeSeconds, value: seconds, unit: 'Seconds' }] }, this.sink);
    }

    /**
     * Record the currently-leased (`in_flight`) queue-row count (dashboard saturation signal).
     *
     * @param count - The in-flight row count.
     * @sideEffect Emits one EMF line.
     */
    public recordInFlightLeases(count: number): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.inFlightLeases, value: count, unit: 'Count' }] }, this.sink);
    }

    /**
     * Record a worker error occurrence (a real source/processing failure this pass).
     *
     * @param count - The error count to add (typically 1).
     * @sideEffect Emits one EMF line.
     */
    public recordWorkerError(count: number = 1): void {
        emitMetric({ metrics: [{ name: FOOD_METRIC.workerErrorCount, value: count, unit: 'Count' }] }, this.sink);
    }

    /**
     * Record ONE local-store read outcome for the serve-rate metric (SC-004/SC-005): `100` when the read
     * was answered from the local store with no source call, `0` when it was not.
     *
     * Emitted as a per-request OBSERVATION rather than a pre-computed ratio. SC-004 is defined over a
     * rolling 24-hour window that no single API task can see, and a horizontally scaled service would
     * otherwise publish one private ratio per task — so CloudWatch does the aggregation: `Average` over any
     * period IS the serve-rate percentage (the SC-004 bar reads directly as `> 80`), `SampleCount` is the
     * total reads, and `Sum / 100` is the served-read count SC-005 is written in. `Percent` with a 100/0
     * value keeps the unit honest for that `Average`, which a `Count` of 1/0 would not (its average is a
     * fraction, and its `Sum` would be a count wearing a name that ends in `-rate`).
     *
     * @param served - Whether the local store answered the read (no source call).
     * @sideEffect Emits one EMF line.
     */
    public recordLocalStoreServe(served: boolean): void {
        emitMetric(
            { metrics: [{ name: FOOD_METRIC.localStoreServeRate, value: served ? 100 : 0, unit: 'Percent' }] },
            this.sink,
        );
    }

    /**
     * Record a per-source rolling-60-min windowed call count under a `source` dimension.
     *
     * @param source - The source name (the dimension value).
     * @param count - The windowed call count.
     * @sideEffect Emits one EMF line.
     */
    public recordSourceWindowCount(source: string, count: number): void {
        emitMetric(
            {
                metrics: [{ name: FOOD_METRIC.sourceRollingWindowCount, value: count, unit: 'Count' }],
                dimensions: { source },
            },
            this.sink,
        );
    }
}
