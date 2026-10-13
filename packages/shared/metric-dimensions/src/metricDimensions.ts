/**
 * THE PUBLISHED LANGUAGE OF A CUSTOM METRIC'S STAGE (ADR-0062).
 *
 * Every custom-namespace metric this repository emits carries ONE dimension, `Stage`, and every alarm and dashboard
 * on such a metric selects `Stage=<its stage>`. The dimension's NAME, the way a runtime learns its stage, and the
 * map an alarm selects with are one piece of knowledge with two ends: the emitters write it (food, identity-webhooks,
 * recipe-workers, recipe-service) and the infrastructure reads it (the alarms and dashboards). Before this module
 * each end spelled it itself, and the spellings had already split — food's remote-search metrics wrote a lowercase
 * `stage` while the rest wrote `Stage`, and four food alarms and the webhook alarms selected no stage at all, so
 * prod's alarm read a series every pr-N preview also published into.
 *
 * ⛔ CDK-FREE, ON PURPOSE. Runtime emitters import this, and a Lambda bundle or a pruned service image must not
 * acquire `aws-cdk-lib` to learn how a dimension is spelled. The infrastructure imports it the other way, which
 * costs nothing.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT HERE: the EMF envelope. Each emitter keeps its own envelope builder and its own
 * namespace and metric names, because those are an alarm contract that differs per metric; only the dimension
 * that EVERY one of them shares is published here.
 *
 * @pattern Published Language — the one vocabulary two bounded contexts (emitter, alarm) agree on
 */

/**
 * The CloudWatch dimension name every custom metric carries. Capitalised: CloudWatch dimension names are
 * case-sensitive, and a lowercase `stage` is a different dimension and therefore a different, silent series.
 */
export const METRIC_STAGE_DIMENSION = 'Stage' as const;

/** What a metric with no stage reports as, so the line is emitted rather than discarded. */
const UNKNOWN_STAGE = 'unknown';

/**
 * Read the deploy stage a metric is dimensioned by.
 *
 * A metric with a missing stage is still emitted rather than dropped — alarms fail toward firing, and a line with no
 * `Stage` field under a directive that declares the dimension is discarded outright. A blank value is treated as
 * missing for the same reason: CloudWatch rejects an empty dimension value.
 *
 * ⚠️ `NODE_ENV` is not consulted. It names a runtime mode (`production`), not a deploy stage (`prod`, `pr-91`), and
 * a metric keyed by it would never match the stage an alarm selects.
 *
 * @param env - The environment to read (defaults to `process.env`). Pure given its argument.
 * @returns The stage label; `unknown` when `STAGE` is absent or blank.
 */
export function metricStage(env: Readonly<Record<string, string | undefined>> = process.env): string {
    const stage = env['STAGE']?.trim();

    return stage === undefined || stage === '' ? UNKNOWN_STAGE : stage;
}

/**
 * The dimension map an alarm or dashboard selects one stage's series with (`dimensionsMap` on a CDK `Metric`).
 *
 * @param stage - The deploy stage the alarm serves.
 * @returns `{ Stage: stage }`. Pure.
 */
export function stageDimensions(stage: string): Readonly<Record<typeof METRIC_STAGE_DIMENSION, string>> {
    return { [METRIC_STAGE_DIMENSION]: stage };
}
