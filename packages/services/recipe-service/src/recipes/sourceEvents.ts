/**
 * The three log events of the source lock (plan everyAnswerSourceLock KTD-11, ADR-0100), each written as one CloudWatch EMF line
 * so the house `Stage` dimension rule holds (DD29). The envelope is `common/emfMetricLine.ts`'s. What is written here is the
 * alarm contract (the namespace and the metric names) and the choice of fields.
 *
 * ⛔ No event carries an answer, a citation, a link or a reason: the lines are kept 15 months and are not scrubbed. The input
 * types name every field, and the builders copy those fields by name, so an extra property a caller casts in never reaches the line.
 *
 * @pattern Observer — fire-and-forget metric lines
 */
import { buildStageCountMetricLine, resolveMetricStage } from '../common/emfMetricLine.js';

/** The namespace every source-lock metric is published under. */
export const SOURCE_EVENT_NAMESPACE = 'Commise/RecipeSource';

/** The metric the correction volume alarm watches (ADR-0100 runbook: more than 10 in a day is a leaked scope or a runaway script). */
export const SOURCE_CORRECTED_METRIC = 'source.corrected';

/** The routes by which a cook's write can meet the lock. */
export type LockedRoute = 'update' | 'setVisibility' | 'create';

/** Where a line goes: stdout in production, a spy in a test. */
type Sink = (line: string) => void;

/**
 * @param route - The cook's route that was refused.
 * @param stage - The deploy stage.
 * @param sink - The line sink.
 * @sideEffect Writes one EMF line.
 */
export function recordSourceLockRefused(
    input: { readonly route: LockedRoute },
    stage: string = resolveMetricStage(),
    sink: Sink = console.log,
): void {
    sink(
        buildStageCountMetricLine({
            namespace: SOURCE_EVENT_NAMESPACE,
            metricName: 'source.lockRefused',
            stage,
            properties: { event: 'source.lockRefused', route: input.route },
        }),
    );
}

/**
 * @param input - The ground and the old and new answer kind.
 * @param stage - The deploy stage.
 * @param sink - The line sink.
 * @sideEffect Writes one EMF line.
 */
export function recordSourceCorrected(
    input: { readonly ground: string; readonly oldKind: string; readonly newKind: string },
    stage: string = resolveMetricStage(),
    sink: Sink = console.log,
): void {
    sink(
        buildStageCountMetricLine({
            namespace: SOURCE_EVENT_NAMESPACE,
            metricName: SOURCE_CORRECTED_METRIC,
            stage,
            properties: {
                event: 'source.corrected',
                ground: input.ground,
                oldKind: input.oldKind,
                newKind: input.newKind,
            },
        }),
    );
}

/**
 * @param input - The kind of refusal and the caller's account id (an app ULID).
 * @param stage - The deploy stage.
 * @param sink - The line sink.
 * @sideEffect Writes one EMF line.
 */
export function recordSourceCorrectionRefused(
    input: { readonly refusal: string; readonly callerId: string },
    stage: string = resolveMetricStage(),
    sink: Sink = console.log,
): void {
    sink(
        buildStageCountMetricLine({
            namespace: SOURCE_EVENT_NAMESPACE,
            metricName: 'source.correctionRefused',
            stage,
            properties: { event: 'source.correctionRefused', refusal: input.refusal, callerId: input.callerId },
        }),
    );
}
