/**
 * CloudWatch EMF emitter for **service-principal-attributed account erasures** (CR-002 / U4a —
 * least-privilege DETECTION).
 *
 * The service-erasure capability is event-bound (one target `ownerId` per verified single-target token),
 * so a leaked signing key cannot erase arbitrary accounts at will. What it CAN'T prevent on its own is a
 * compromised signer quietly erasing many DIFFERENT accounts one token at a time — the signature of which
 * is a burst of service-attributed erasures across distinct owners. This emitter is the detective half of
 * that control: it writes one CloudWatch Embedded Metric Format (EMF) line per service-triggered erasure
 * job, which a volume alarm watches (the CDK alarm is a noted seam — see the module docstring on the
 * controller/service).
 *
 * The ENVELOPE is not written here — `common/emfMetricLine.ts` owns it, because its shape is the AWS EMF
 * spec's and not this metric's. What stays here is what is genuinely this metric's: the namespace and name
 * (the alarm contract, so they are exported constants the CDK alarm references) and the decision to carry the
 * `ownerId` as a field rather than a dimension.
 */
import { buildStageCountMetricLine, resolveMetricStage } from '../common/emfMetricLine.js';

/** CloudWatch namespace every service-principal erasure metric is published under. */
export const SERVICE_PRINCIPAL_ERASURE_NAMESPACE = 'Commise/RecipeAccount';

/**
 * The metric name a volume alarm watches. A burst (SUM over a short window exceeding a small threshold) of
 * service-attributed erasures across distinct owners is an incident — the alarm fires on that volume.
 */
export const SERVICE_PRINCIPAL_ERASURE_METRIC = 'service-principal-erasure';

/** Context recorded alongside one service-principal erasure metric. */
export interface ServicePrincipalErasureMetricInput {
    /** The bound target owner ULID this erasure was attributed to (for distinct-owner triage, not a dimension). */
    readonly ownerId: string;
}

/**
 * Emits the service-principal erasure volume metric. Injected into `ErasureService`,
 * with the line sink defaulting to `console.log` (overridden in tests).
 */
export class ServicePrincipalErasureMetrics {
    /**
     * @param stage - The deploy-stage dimension value (defaults to the resolved `STAGE`/`NODE_ENV`).
     * @param sink - The line sink (defaults to `console.log`; injected in tests).
     */
    public constructor(
        private readonly stage: string = resolveMetricStage(),
        private readonly sink: (line: string) => void = console.log,
    ) {}

    /**
     * Record one service-principal-attributed erasure as a single EMF line. The `ownerId` is written as a
     * plain structured field, NOT a metric dimension: dimensioning by owner would explode CloudWatch metric
     * cardinality, whereas the alarm only needs the aggregate count and an operator triaging a burst can
     * enumerate distinct owners from the logs.
     *
     * @param input - The target owner of this erasure.
     * @sideEffect Writes one EMF line to the sink (stdout in production).
     */
    public recordServicePrincipalErasure(input: ServicePrincipalErasureMetricInput): void {
        this.sink(
            buildStageCountMetricLine({
                namespace: SERVICE_PRINCIPAL_ERASURE_NAMESPACE,
                metricName: SERVICE_PRINCIPAL_ERASURE_METRIC,
                stage: this.stage,
                properties: { ownerId: input.ownerId },
            }),
        );
    }
}
