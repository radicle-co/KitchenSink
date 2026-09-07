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
 * The facets a recipe-workers metric may be grouped BY, BEYOND the `Stage` every metric carries.
 *
 * ⛔ A CLOSED UNION, and that is the point. In EMF every distinct combination of dimension VALUES is a
 * separately billed custom metric (~$0.30/month, 15-month retention), so an open `Record<string, string>` is a
 * cost bomb: `identity-webhooks` shipped one at eight call sites and it costed out at ≈$3,000/month at 10k
 * users, for series that each held one datapoint and aggregated to nothing chartable. Naming the facets makes
 * that not compile rather than merely discouraged; the repo-wide AST gate
 * (`packages/infra/global/__tests__/emfIdentifierDimensionRepoGate.test.ts`) is the second line, and it
 * requires a new key to be admitted there with its cardinality BOUND stated.
 *
 * `CallSite` qualifies because its value space is the consumers of ADR-0024's single spend pool — declared in
 * code (this gate, and the parse leg and capture tiers that will join it), bounded by releases rather than by
 * traffic.
 */
export type RecipeMetricDimension = 'CallSite';

/** A dimension bag: allowlisted facet → value. Partial, because most metrics here carry no extra facet. */
export type RecipeMetricDimensions = Readonly<Partial<Record<RecipeMetricDimension, string>>>;

/**
 * One CloudWatch metric emitted via the Embedded Metric Format (EMF).
 *
 * @property namespace - The CloudWatch namespace (e.g. `Commise/RecipeArchive`).
 * @property name - The metric name the alarm watches (e.g. `PendingArchiveBacklog`).
 * @property unit - The metric's unit.
 * @property stage - The deploy stage; the dimension every metric here carries.
 * @property value - The measured value for this tick.
 * @property dimensions - Optional extra facets, published ALONGSIDE the `Stage`-only series (see
 *   {@link emitMetric}). A facet with an `undefined` value is dropped.
 */
export type EmfMetric = {
    readonly namespace: string;
    readonly name: string;
    readonly unit: MetricUnit;
    readonly stage: string;
    readonly value: number;
    readonly dimensions?: RecipeMetricDimensions;
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
 * knowledge with a single reason to change (the spec), so it lives here once. Every metric carries the
 * `Stage` dimension, so callers passing the same namespace share an alarm dimension. The
 * emitted JSON — key order and all — is contractual: the alarms extract by exact namespace, dimension,
 * and metric name, so this output must not drift.
 *
 * ## ⛔ TWO DIMENSION SETS, not one set with two keys (U36)
 *
 * EMF publishes **only** the dimension sets its directive lists — there is no dimensionless rollup underneath
 * them. Appending a facet to the single `['Stage']` set therefore DELETES the `Stage`-only series, and every
 * alarm selecting `Stage` alone (which is all of them here, including ADR-0024's ceiling alarm) drops to zero
 * datapoints and reports a permanent, confident `OK` under `treatMissingData: NOT_BREACHING`. That exact
 * failure has shipped in this repo twice — see `serviceInfraWiringInvariants.test.ts` W4.
 *
 * So a faceted metric publishes BOTH: `[['Stage'], ['Stage', …facets]]`. The first set is the aggregate the
 * ceiling alarms on; the second is the breakdown that answers "who spent it". Attribution WITHOUT
 * partitioning — which is what ADR-0024's single global pool needs (KTD-17).
 *
 * A facet present with an `undefined` value is DROPPED rather than declared: `JSON.stringify` omits an
 * `undefined` field, so declaring the key anyway would ship a directive naming a dimension the line does not
 * carry — which CloudWatch rejects, discarding the whole record. Silently losing a metric is the worst failure
 * an emitter can have.
 *
 * @param metric - The namespace, name, unit, stage, value, and optional facets for this metric.
 * @sideEffect Writes one EMF line to stdout.
 */
export function emitMetric(metric: EmfMetric): void {
    const { namespace, name, unit, stage, value } = metric;
    // ⚠️ `metric.dimensions`, NOT the destructured binding above, and deliberately so:
    // `emfIdentifierDimensionRepoGate.test.ts` traces caller-supplied dimension keys back to a NAMED parameter,
    // and a destructured binding pattern is not one. Reading it off the parameter is what keeps the repo-wide
    // cardinality gate able to see this emitter at all — it reports an untraceable emitter as BLIND, which is
    // a failure, not a pass.
    const facets = Object.entries(metric.dimensions ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
    );
    const facetKeys = facets.map(([key]) => key);
    // The FACETED set, present only when there is a facet. Kept out of the `Dimensions` array as a computed
    // value on purpose: `serviceInfraWiringInvariants.test.ts` W4 reads the LITERAL keys of this directive to
    // decide which dimensions EVERY alarm must select, and `Stage` — the one key common to every set below —
    // is the only correct answer. A second literal set naming `CallSite` would make W4 demand it of the
    // sweeper alarms, whose series never carry it.
    const facetedSet = facetKeys.length === 0 ? [] : [['Stage', ...facetKeys]];

    console.log(
        JSON.stringify({
            _aws: {
                Timestamp: Date.now(),
                CloudWatchMetrics: [
                    {
                        Namespace: namespace,
                        Dimensions: [['Stage'], ...facetedSet],
                        Metrics: [{ Name: name, Unit: unit }],
                    },
                ],
            },
            Stage: stage,
            ...Object.fromEntries(facets),
            [name]: value,
        }),
    );
}
