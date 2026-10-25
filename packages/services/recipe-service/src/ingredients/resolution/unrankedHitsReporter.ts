/**
 * The lexical tier's report of catalog NAME hits that arrived with no rung (ADR-0070).
 *
 * An absent rung below the crosswalk score means food sent none (it is older than this service) or sent one the food
 * client cannot read. The lexical tier keeps working either way: it still stores the shortlist and margin and still
 * runs the synonym retry. What it loses is the band key. This report makes that visible. Each resolution that saw such
 * hits writes one EMF count, and a warning reaches the log at most once a minute, because this path runs on every
 * name lookup.
 *
 * @pattern Observer — the lexical tier's `LexicalTierObserver`, implemented over an EMF sink and a log sink
 */
import { buildStageCountMetricLine, resolveMetricStage } from '../../common/emfMetricLine.js';
import type { LexicalTierObserver } from './lexicalTier.js';
import { MAPPING_PROMOTION_NAMESPACE } from './mappingPromotionAudit.js';

/** The metric an operator alarms or graphs on. One count per resolution that saw rung-less name hits. */
export const UNRANKED_HITS_METRIC = 'lexical-hits-without-rung';

/** Minimum gap between two warnings. The metric counts every occurrence; the log only says it is happening. */
const WARN_INTERVAL_MS = 60_000;

export class UnrankedHitsReporter implements LexicalTierObserver {
    /** When the last warning was written, in epoch ms; `undefined` before the first. */
    private lastWarnAt: number | undefined;

    /**
     * @param stage - The deploy-stage dimension value.
     * @param metricSink - Where the EMF line goes (stdout by default, which CloudWatch extracts).
     * @param warn - Where the rate-limited warning goes.
     * @param now - The clock, in epoch ms.
     */
    public constructor(
        private readonly stage: string = resolveMetricStage(),
        private readonly metricSink: (line: string) => void = console.log,
        private readonly warn: (message: string) => void = () => undefined,
        private readonly now: () => number = Date.now,
    ) {}

    /**
     * Report one resolution's rung-less hits.
     *
     * @param count - How many name hits arrived with no rung.
     * @sideEffect Writes one EMF line, and at most one warning per interval.
     */
    public readonly onUnrankedHits = (count: number): void => {
        this.metricSink(
            buildStageCountMetricLine({
                namespace: MAPPING_PROMOTION_NAMESPACE,
                metricName: UNRANKED_HITS_METRIC,
                stage: this.stage,
                properties: { unrankedHits: String(count) },
            }),
        );

        const at = this.now();

        if (this.lastWarnAt === undefined || at - this.lastWarnAt > WARN_INTERVAL_MS) {
            this.lastWarnAt = at;
            this.warn(
                `Food catalog name hits arrived with no rung (${String(count)} in this lookup); ` +
                    'bands cannot key these resolutions. Is food older than recipe, or sending a rung this build cannot read?',
            );
        }
    };
}
