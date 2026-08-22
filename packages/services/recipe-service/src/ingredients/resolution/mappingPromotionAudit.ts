/**
 * The promotion audit signal — emitted every time two independent authors' agreement binds an ingredient
 * phrase for the whole installation (plan U10 / R20).
 *
 * ## ⚠️ THIS IS THE ALERTING HALF. THE DURABLE RECORD IS THE ROW.
 *
 * The plan asks a promotion to "emit a signal carrying the mapping id, both corroborating author ids, and the
 * normalized key", and notes that ADR-0023 pairs its grant-based global write with exactly this kind of
 * ENUMERABILITY. A log line cannot deliver enumerability: it is a string in a retention window, and a
 * reviewer asking "which phrases were bound by corroboration, and by whom?" six months from now has nothing
 * to query. So the audit record is the `origin = 'corroboration'` ROW, which cites both agreeing mappings
 * (`corroborated_a` / `corroborated_b`) and lives as long as the table does. This emitter exists so a BURST
 * of promotions is visible without anyone running that query — which is what an operator needs, and what a
 * `SELECT` cannot provide on its own.
 *
 * ## ⛔ Why the signal is SPLIT across two sinks
 *
 * `emfIdentifierDimensionRepoGate` forbids a per-user or per-request identifier in any EMF dimension, for two
 * reasons with different scopes. **Cost:** every distinct combination of dimension VALUES is a separately
 * billed custom metric (~$0.30/month each, 15-month retention), so a dimension keyed by author or by phrase
 * has cardinality equal to the user base or the vocabulary — thousands of one-datapoint "metrics" that
 * aggregate to nothing chartable. **Privacy:** the EMF line is written straight to stdout for CloudWatch to
 * extract, which bypasses the Sentry log facade and therefore `sentryScrubbers.ts`, the one place user
 * identifiers are pseudonymised so an erased user cannot be re-identified from log copies (GDPR Art. 17).
 *
 * ⚠️ Which is why the identifiers are NOT merely demoted from a dimension to an unbilled EMF property — that
 * would fix the bill and leave the privacy hazard fully intact, and it is precisely the "optimisation" that
 * gate is written to pre-empt. They go on the SCRUBBED structured log line instead, beside the metric,
 * searchable per user and pseudonymised on the way out.
 *
 * So: the METRIC is a count dimensioned by stage alone, and the IDENTIFIERS are a structured log context.
 */

/** CloudWatch namespace every mapping-promotion metric is published under. */
export const MAPPING_PROMOTION_NAMESPACE = 'Commise/RecipeResolution';

/**
 * The metric name an alarm watches.
 *
 * A promotion binds a phrase for every user of the installation on the strength of two accounts agreeing, and
 * two accounts held by one person clear a distinct-author check. Nothing prevents that; what this makes
 * possible is NOTICING it — a burst (SUM over a short window above a small threshold) is the shape a
 * sock-puppet campaign takes, and it is reviewable from the rows once the alarm points at them.
 */
export const MAPPING_PROMOTION_METRIC = 'mapping-promoted-to-global';

/** What one promotion records. */
export interface MappingPromotionAuditInput {
    /** The corroboration binding's row id — the handle a reviewer uses to pull the full record. */
    readonly mappingId: string;
    /** Every distinct author whose agreement produced the promotion. */
    readonly corroboratingAuthorIds: readonly string[];
    /** The phrase now bound for every user. */
    readonly normalizedKey: string;
}

/** The structured-log sink: a message plus a context object, matching Nest's `Logger.log` shape. */
export type AuditLogSink = (message: string, context: Record<string, unknown>) => void;

/**
 * Resolve the deploy stage the metric is dimensioned by. Reads `STAGE`, falling back to `NODE_ENV` and then a
 * literal — a metric with a missing stage is still emitted (alarms fail toward firing) rather than dropped.
 *
 * @returns The stage label.
 * @sideEffect Reads `process.env`.
 */
function resolveStage(): string {
    return process.env['STAGE'] ?? process.env['NODE_ENV'] ?? 'unknown';
}

export class MappingPromotionAudit {
    /**
     * @param stage - The deploy-stage dimension value (defaults to the resolved `STAGE`/`NODE_ENV`).
     * @param metricSink - The EMF line sink (defaults to `console.log` — stdout, which CloudWatch extracts).
     * @param logSink - The structured-log sink carrying the identifiers (injected from Nest's `Logger`).
     */
    public constructor(
        private readonly stage: string = resolveStage(),
        private readonly metricSink: (line: string) => void = console.log,
        private readonly logSink: AuditLogSink = () => undefined,
    ) {}

    /**
     * Record one promotion: a count on the metric, the identifiers on the scrubbed log line.
     *
     * @param input - The binding's id, its corroborating authors, and the phrase now bound globally.
     * @sideEffect Writes one EMF line to stdout and one structured log line.
     */
    public recordPromotion(input: MappingPromotionAuditInput): void {
        this.metricSink(
            JSON.stringify({
                _aws: {
                    Timestamp: Date.now(),
                    CloudWatchMetrics: [
                        {
                            Namespace: MAPPING_PROMOTION_NAMESPACE,
                            // ⛔ Stage ALONE. See the module docstring: an author or phrase dimension has
                            // cardinality equal to the user base and buys nothing chartable.
                            Dimensions: [['Stage']],
                            Metrics: [{ Name: MAPPING_PROMOTION_METRIC, Unit: 'Count' }],
                        },
                    ],
                },
                Stage: this.stage,
                [MAPPING_PROMOTION_METRIC]: 1,
            }),
        );

        this.logSink('Ingredient mapping promoted to global scope by corroboration.', {
            mappingId: input.mappingId,
            corroboratingAuthorIds: input.corroboratingAuthorIds,
            normalizedKey: input.normalizedKey,
        });
    }
}
