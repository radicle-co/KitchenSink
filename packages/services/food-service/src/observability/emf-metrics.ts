/**
 * CloudWatch Embedded Metric Format (EMF) emitter for the food service (T-181; extended to the API by T-199b
 * for the SC-004/SC-005 local-store serve rate). One EMF JSON line per metric to stdout; CloudWatch
 * auto-extracts it from the Fargate log group with NO extra IAM (no `cloudwatch:PutMetricData` call, no SDK).
 *
 * ⚠️ {@link FOOD_METRIC} IS NOT THE ONLY COPY. There are THREE independent declarations — here, in
 * `infra/lib/food-service-stack.ts`, and in `infra/__tests__/food-service-stack.test.ts` — none importing
 * another, because the infra tsconfig's `rootDir` forbids reaching across the `src`↔`infra` boundary (TS6059),
 * and NO test compares this block to either of the others. Do not add a claim that one does.
 *
 * What DOES protect the contract is `packages/infra/global/__tests__/service-infra-wiring-invariants.test.ts`
 * W3, repo-wide: an alarm on a custom metric must watch a name that appears as a string literal in the
 * service's runtime sources. Rename one here and the alarm watching the old name reds. Coarse but unfakeable,
 * and it is the guard to keep working.
 *
 * @implements SC-002 SC-006 US-10
 */

export const FOOD_METRIC_NAMESPACE = 'Commise/Food';

/**
 * Canonical EMF metric names (the worker ↔ dashboard/alarm contract). The CDK re-declares these exact literals
 * for its dashboard widgets and alarms — see the module docstring for why, and for what stops them drifting.
 *
 * ⛔ TWO OF THESE ARE DECLARED BUT EMITTED BY NOTHING — `sourceApiSuccessRate` and `auth401Rate`. A constant
 * here is a NAME, not an implementation: `__tests__/emf-metrics.test.ts` measures the emitted set and pins the
 * gap, with the spec references.
 */
export const FOOD_METRIC = {
    /** Pending `fetch_queue` depth (FR-046 backpressure alarm at > 10,000). */
    fetchQueueDepth: 'food-fetch-queue-depth',
    /** End-to-end per-row resolution latency in seconds (SC-002). */
    resolutionLatencySeconds: 'food-resolution-latency-seconds',
    /** Per-source rolling-60-min windowed call count (dimension: `source`). */
    sourceRollingWindowCount: 'source-rolling-window-count',
    /** ⛔ NOT EMITTED. Per-source API success rate as a percentage (dimension: `source`) — US-10. */
    sourceApiSuccessRate: 'source-api-success-rate',
    /** Count of foods awaiting human disambiguation (UNRESOLVED). */
    unresolvedBacklog: 'food-unresolved-backlog',
    /** Count of tombstone (NOT_FOUND/FAILED) queue rows (alarm at > 0). */
    tombstoneCount: 'food-tombstone-count',
    /** Share of reads served from the local store with no source call, as a percentage (SC-005). */
    localStoreServeRate: 'food-local-store-serve-rate',
    /** ⛔ NOT EMITTED. Share of API requests rejected `401` — FR-052, and the misconfigured-key signal. */
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

/**
 * The facets a food metric may be grouped BY — a CLOSED set, and that is the point.
 *
 * ⚠️ An arbitrary dimension bag (`Record<string, string>`, which this used to be) is a cost bomb: in EMF every
 * distinct combination of dimension VALUES is a separately billed custom metric (~$0.30/month, 15-month
 * retention), so one `dimensions: { userId }` turns this namespace into one billed series per user — the defect
 * `identity-webhooks` shipped at eight call sites (`06107d97`: ≈ $3,000/month at 10k users, for series that each
 * hold one datapoint and aggregate to nothing chartable). Naming the facets makes that not compile rather than
 * merely discouraged; the repo-wide AST gate
 * (`packages/infra/global/__tests__/emf-identifier-dimension-repo-gate.test.ts`) is the second line for every
 * service, and its docstring carries the full arithmetic plus the PRIVACY reason an identifier does not belong
 * in an unbilled EMF property either.
 *
 * ⛔ Widening this union is a deliberate decision, not a formality. A new facet multiplies the billed series
 * count by its own cardinality, so state the bound; and if the emitter starts attaching it UNCONDITIONALLY,
 * `service-infra-wiring-invariants.test.ts`'s W4 will require every `Commise/Food` alarm to select it, because
 * EMF publishes only the dimension sets the directive lists — there is no dimensionless rollup to fall back on.
 *
 * `source` qualifies because its value space is the registered source adapters (`usda`, …), bounded by code
 * rather than by traffic.
 */
export type FoodMetricDimension = 'source';

/**
 * A dimension bag: allowlisted facet → value. Partial, because most food metrics carry no dimension at all —
 * see {@link buildEmf} for why an explicitly `undefined` value is dropped rather than declared.
 */
export type FoodMetricDimensions = Readonly<Partial<Record<FoodMetricDimension, string>>>;

/** One metric value to embed in an EMF record. */
export interface MetricDatum {
    /** The metric name (use a {@link FOOD_METRIC} value). */
    readonly name: string;
    readonly value: number;
    readonly unit: MetricUnit;
}

/** Input to {@link buildEmf}. */
export interface EmfInput {
    /** The metrics published in this record (all share the dimension set + timestamp). */
    readonly metrics: readonly MetricDatum[];
    /** Optional dimensions (e.g. `{ source: 'usda' }`); each key becomes a CloudWatch dimension. */
    readonly dimensions?: FoodMetricDimensions;
    /** Namespace override (defaults to {@link FOOD_METRIC_NAMESPACE}). */
    readonly namespace?: string;
    /** Epoch-millis timestamp (defaults to `Date.now()`). */
    readonly timestamp?: number;
}

/** The CloudWatch metric-directive block embedded under `_aws`. */
export interface EmfMetricDirective {
    readonly Namespace: string;
    /** Dimension sets — a single set of the provided dimension keys (`[[]]` when none). */
    readonly Dimensions: readonly (readonly string[])[];
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
 * Build a CloudWatch EMF record from a set of metrics + optional dimensions. Pure given its `timestamp`
 * (defaults to `Date.now()`, the only impurity).
 *
 * A facet present with an `undefined` value is DROPPED rather than declared: `JSON.stringify` omits an
 * `undefined` field, so declaring the key anyway would ship a directive naming a dimension the line does not
 * carry, which CloudWatch rejects — discarding the whole record. Silently losing a metric is the worst failure
 * an emitter can have.
 *
 * @param input - The metrics, optional dimensions, namespace, and timestamp.
 * @returns The serializable EMF payload.
 */
export function buildEmf(input: EmfInput): EmfPayload {
    const namespace = input.namespace ?? FOOD_METRIC_NAMESPACE;
    const timestamp = input.timestamp ?? Date.now();
    const dimensions = Object.fromEntries(
        Object.entries(input.dimensions ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
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
 * The default line sink: stdout via `console.log`, resolved on EVERY call rather than captured once. The late
 * binding is deliberate — a default of `console.log` itself freezes the reference at definition time, which
 * would bypass any `console` interception installed later in the process (the Sentry log forwarder, a test spy).
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
     * Record ONE local-store read outcome for the serve-rate metric (SC-004/SC-005): `100` when the local store
     * answered the read with no source call, `0` when it did not.
     *
     * A per-request OBSERVATION rather than a pre-computed ratio: SC-004 spans a rolling 24-hour window no
     * single API task can see, so CloudWatch does the aggregation — `Average` over any period IS the serve-rate
     * percentage (the SC-004 bar reads directly as `> 80`), `SampleCount` is total reads, and `Sum / 100` is the
     * served-read count SC-005 is written in. `Percent` with a 100/0 value keeps that `Average` honest; a
     * `Count` of 1/0 would not — its average is a fraction and its `Sum` a count named `-rate`.
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
