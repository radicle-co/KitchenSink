/**
 * THE SCORING — the arithmetic that turns a pile of trials into the three numbers the report leads with.
 *
 * DESIGN PATTERN: **pure reducer**, the sibling of `verification/bakeOff.ts`. No I/O, no model, no clock.
 * The runner does the calling; this decides what the calls MEAN, so an arithmetic error is a truth-table
 * failure rather than a discovery made after the money is spent.
 *
 * ## ⛔ EVERY RATE CARRIES ITS DENOMINATOR, AND THE DENOMINATORS ARE DIFFERENT ON PURPOSE
 *
 *  - **Contract compliance** is denominated in every RESPONSE THAT ARRIVED. A wrapped answer, a truncated
 *    answer and a wrong shape all count against the model — the consumer is a program and each of them is a
 *    line that got no usable answer — but a call that never arrived does not, because our own concurrency
 *    setting would otherwise depress a model's headline figure.
 *  - **CRF agreement** is denominated in the trials that were COMPARED — a response that produced no parse
 *    cannot agree or disagree with anything, and scoring it as a disagreement would fold measurement 1 into
 *    measurement 3 and report one defect twice.
 *  - **Divergence** is denominated in the pairs where BOTH passes were readable, for the same reason.
 *
 * ⚠️ Read `callsFailed` and the stop-reason census FIRST. `maxAttempts: 1` is pinned in the transport, so a
 * throttled call arrives here as a `callFailed` trial named by its exception. If that count is not ~0 the
 * run is degraded, and its rates are about the throttling rather than about the models.
 *
 * ⛔ There is deliberately no single "accuracy" or "quality" figure, for the same reason `bakeOff.ts` has
 * none: there is no ground truth here, so any composite would be an average of things that mean different
 * things, and it is exactly what would let a model with a 13% unreadable-response rate win on the strength
 * of its agreement rate over the 87% that were readable.
 */
import { divergentResponses, type AgreementKind, type ParseAgreement, type ParseField } from './parseAgreement.js';
import type { LineOrigin } from './parseCorpus.js';
import { PARSE_RESPONSE_KINDS, type ParseResponseKind } from './parseResponse.js';

/** Every corpus half, so a breakdown cannot silently omit one. */
const LINE_ORIGINS: readonly LineOrigin[] = ['ingredient', 'dropped'];

/**
 * A call that never arrived.
 *
 * ⛔ NOT a sixth contract bucket. The five buckets classify a RESPONSE; this classifies the absence of one,
 * and the difference decides a denominator: a throttled call says nothing about the model's contract
 * compliance, so counting it as a non-compliant response would let our own concurrency setting depress a
 * model's headline figure. It is still counted as an ATTEMPT, so a run degraded by throttling cannot read
 * as a clean one.
 */
export const CALL_FAILED = 'callFailed';

/**
 * A response arrived that the CLIENT could not read.
 *
 * ⛔ ALSO not a contract bucket, and for the same reason as {@link CALL_FAILED}. `ConverseOutcome`'s
 * `unusable` covers three causes and only one is about the model: the envelope shape drifted, there was no
 * assistant text block, or the token counts could not be read — and in that last case the model may have
 * returned a byte-perfect document. Filing all three under `malformedJson` ("not JSON at all… the content
 * is gone") would blame the model for our transport and depress its headline figure.
 */
export const UNUSABLE_RESPONSE = 'unusable';

export type ParseTrialOutcome = ParseResponseKind | typeof CALL_FAILED | typeof UNUSABLE_RESPONSE;

/** One line, sent to one model, once. */
export interface ParseTrial {
    /** The BARE model id — the one the rate table keys on, never an inference-profile id. */
    readonly modelId: string;
    readonly lineId: string;
    readonly outcome: ParseTrialOutcome;
    /** Passed through as Bedrock gave it, or the exception name of a call that never arrived. */
    readonly stopReason: string;
    readonly costMicros: number;
    /**
     * A conformant parse was recoverable although the response was not compliant.
     *
     * ⚠️ Its own fact, kept apart from `outcome`: "wraps a perfect answer in a markdown fence" and "wraps
     * nonsense in a markdown fence" are the same bucket and completely different recommendations, because
     * the first is undone by a three-line change to the reader and the second is not.
     */
    readonly recovered: boolean;
    /** Which half of the corpus this line came from. Every figure is reported per half. */
    readonly origin: LineOrigin;
    /**
     * Which part of the declared shape the response failed on, for a `wrongShape` trial.
     *
     * ⚠️ Load-bearing, not diagnostic colour: it is the difference between "this model breaks the contract
     * 20% of the time in twenty different ways" and "this model always writes `null` where the shape says
     * string" — the same rate, and completely different recommendations.
     */
    readonly shapeDetail: string | undefined;
    /** Present only when this trial was COMPLIANT and the CRF produced a reading of the same line. */
    readonly agreement: ParseAgreement | undefined;
}

/** The figures that are meaningful for one half of the corpus on its own. */
export interface OriginBreakdown {
    readonly responses: number;
    readonly contractComplianceRate: number;
    readonly crfCompared: number;
    readonly crfAgreementRate: number;
}

/**
 * Unit and quantity agreement, counted apart.
 *
 * ⛔ `judgeMeasure` reaches the quantity comparison only once the units already agree, so a line that
 * disagrees about BOTH is tallied `unitDiffers` and its quantity disagreement is invisible. For a nutrition
 * pipeline the number is the field with the largest downstream consequence, so the observable denominator is
 * published rather than the composite verdict alone.
 */
export interface MeasureSplit {
    readonly unitAgreed: number;
    readonly quantityAgreed: number;
    /** Trials on which the quantity comparison happened at all — i.e. the units agreed. */
    readonly quantityObservable: number;
}

/** What one model scored. */
export interface ParseComparisonReport {
    readonly modelId: string;
    /** Calls attempted, whether or not they arrived. */
    readonly trials: number;
    /** Calls that never arrived. Read this before any rate below it. */
    readonly callsFailed: number;
    /** Responses that arrived but the client could not read. Also excluded from the contract denominator. */
    readonly unusableResponses: number;
    /** Responses that arrived — the denominator of every contract figure. */
    readonly responses: number;
    /** Every bucket, always all five, so a census cannot silently omit one. */
    readonly contract: Readonly<Record<ParseResponseKind, number>>;
    /** ⛔ THE HEADLINE. Bare documents of the declared shape, over every response that arrived. */
    readonly contractComplianceRate: number;
    /** Non-compliant responses from which a conformant parse could still be recovered. */
    readonly recoveredFromWrapper: number;
    /** What compliance WOULD be if the reader unwrapped. Reported beside the headline, never instead of it. */
    readonly complianceAfterUnwrapRate: number;
    readonly stopReasons: Readonly<Record<string, number>>;
    readonly totalCostMicros: number;
    readonly meanCostMicros: number;
    /** Trials on which both parsers produced a reading — the denominator of the agreement figures. */
    readonly crfCompared: number;
    readonly crfAgreementRate: number;
    /** Only the DISAGREEMENT shapes; `agree` is not a disagreement and is deliberately absent. */
    readonly disagreementKinds: Readonly<Partial<Record<AgreementKind, number>>>;
    /** Each field's own agreement rate, because the three fail for different reasons. */
    readonly fieldAgreementRates: { readonly measure: number; readonly names: number; readonly prep: number };
    readonly measureSplit: MeasureSplit;
    /** How each shape failure failed. See {@link ParseTrial.shapeDetail}. */
    readonly wrongShapeReasons: Readonly<Record<string, number>>;
    /** ⛔ The two halves of the corpus, never blended — see `parseCorpus.ts`. */
    readonly byOrigin: Readonly<Record<LineOrigin, OriginBreakdown>>;
}

/** Both passes over one line by one model. */
export interface DeterminismPair {
    readonly modelId: string;
    readonly lineId: string;
    readonly firstText: string;
    readonly secondText: string;
    /**
     * Both passes stated a readable parse.
     *
     * ⚠️ A pair where one pass was unreadable is a pair on which stability was NOT measured. Counting it as
     * a divergence would report the contract failure twice; counting it as agreement would credit a
     * consistency the model never demonstrated.
     */
    readonly comparable: boolean;
    /**
     * Both passes produced a RESPONSE — a weaker condition than {@link comparable}, and the one byte
     * identity needs.
     *
     * ⛔ Without it, two calls that both failed give `'' === ''` and score as the strictest possible
     * determinism. The reducer that carefully keeps transport failures out of every other denominator would
     * otherwise let them INFLATE this one.
     */
    readonly responded: boolean;
    /** What `divergentFields` made of the two parses. Empty when the two readings say the same thing. */
    readonly divergentFields: readonly ParseField[];
}

/** What one model's repeat pass showed. */
export interface DeterminismReport {
    readonly modelId: string;
    readonly pairs: number;
    /** Pairs where both passes produced a response — the denominator of {@link byteIdenticalRate}. */
    readonly respondedPairs: number;
    /** Pairs where both passes stated a readable parse — the denominator of {@link divergentRate}. */
    readonly comparablePairs: number;
    /** The two responses were byte-identical. The strictest reading of "deterministic". */
    readonly byteIdenticalRate: number;
    /** The two readable answers SAID something different. The reading that matters to a consumer. */
    readonly divergentRate: number;
    readonly divergentFieldCounts: Readonly<Partial<Record<ParseField, number>>>;
}

/**
 * Score every model's trials.
 *
 * ⚠️ Driven by the ROSTER, not by the trials: a model that was asked for and produced nothing appears with
 * `trials: 0` rather than vanishing from the table. A model missing from a report is indistinguishable
 * from a model that was never in the roster, and that is how a run that half-failed gets read as a clean
 * comparison.
 *
 * @param trials - Every trial, from every model, in any order.
 * @param roster - The models the run asked for, in report order.
 * @returns One report per roster entry. Pure.
 */
export function summarizeParseComparison(
    trials: readonly ParseTrial[],
    roster: readonly string[],
): readonly ParseComparisonReport[] {
    return roster.map((modelId) =>
        scoreOne(
            modelId,
            trials.filter((trial) => trial.modelId === modelId),
        ),
    );
}

function scoreOne(modelId: string, own: readonly ParseTrial[]): ParseComparisonReport {
    const contract = Object.fromEntries(PARSE_RESPONSE_KINDS.map((kind) => [kind, 0])) as Record<
        ParseResponseKind,
        number
    >;
    const stopReasons: Record<string, number> = {};
    const wrongShapeReasons: Record<string, number> = {};
    const disagreementKinds: Partial<Record<AgreementKind, number>> = {};
    const compared: ParseAgreement[] = [];
    let totalCostMicros = 0;
    let callsFailed = 0;
    let unreadable = 0;
    let recoveredFromWrapper = 0;

    for (const trial of own) {
        stopReasons[trial.stopReason] = (stopReasons[trial.stopReason] ?? 0) + 1;
        totalCostMicros += trial.costMicros;

        if (trial.outcome === CALL_FAILED || trial.outcome === UNUSABLE_RESPONSE) {
            unreadable += 1;

            if (trial.outcome === CALL_FAILED) {
                callsFailed += 1;
            }
        } else {
            contract[trial.outcome] += 1;

            if (trial.outcome !== 'valid' && trial.recovered) {
                recoveredFromWrapper += 1;
            }

            if (trial.outcome === 'wrongShape' && trial.shapeDetail !== undefined) {
                wrongShapeReasons[trial.shapeDetail] = (wrongShapeReasons[trial.shapeDetail] ?? 0) + 1;
            }
        }

        if (trial.agreement !== undefined) {
            compared.push(trial.agreement);

            if (!trial.agreement.agrees) {
                disagreementKinds[trial.agreement.kind] = (disagreementKinds[trial.agreement.kind] ?? 0) + 1;
            }
        }
    }

    const responses = own.length - unreadable;
    const unitAgreed = compared.filter(unitsAgree).length;

    return {
        modelId,
        trials: own.length,
        callsFailed,
        unusableResponses: unreadable - callsFailed,
        responses,
        contract,
        contractComplianceRate: rate(contract.valid, responses),
        recoveredFromWrapper,
        complianceAfterUnwrapRate: rate(contract.valid + recoveredFromWrapper, responses),
        stopReasons,
        totalCostMicros,
        meanCostMicros: own.length === 0 ? 0 : totalCostMicros / own.length,
        crfCompared: compared.length,
        crfAgreementRate: rate(compared.filter((agreement) => agreement.agrees).length, compared.length),
        disagreementKinds,
        fieldAgreementRates: {
            measure: rate(compared.filter((agreement) => agreement.measure === 'agree').length, compared.length),
            names: rate(compared.filter((agreement) => agreement.names === 'agree').length, compared.length),
            prep: rate(compared.filter((agreement) => agreement.prep === 'agree').length, compared.length),
        },
        measureSplit: {
            unitAgreed,
            quantityAgreed: compared.filter((agreement) => agreement.measure === 'agree').length,
            quantityObservable: unitAgreed,
        },
        wrongShapeReasons,
        byOrigin: Object.fromEntries(
            LINE_ORIGINS.map((origin) => [origin, breakdownFor(own.filter((trial) => trial.origin === origin))]),
        ) as Record<LineOrigin, OriginBreakdown>,
    };
}

/**
 * The units agreed, which is the ONLY condition under which the quantities were compared at all.
 *
 * `judgeMeasure` returns `agree` or `quantityDiffers` exactly when the two units matched, so those two
 * verdicts are the observable denominator for quantity agreement and every other verdict is a unit
 * disagreement that hid whatever the quantities did.
 */
function unitsAgree(agreement: ParseAgreement): boolean {
    return agreement.measure === 'agree' || agreement.measure === 'quantityDiffers';
}

function breakdownFor(own: readonly ParseTrial[]): OriginBreakdown {
    const responses = own.filter((trial) => trial.outcome !== CALL_FAILED && trial.outcome !== UNUSABLE_RESPONSE);
    const compared = own.filter((trial) => trial.agreement !== undefined);

    return {
        responses: responses.length,
        contractComplianceRate: rate(responses.filter((trial) => trial.outcome === 'valid').length, responses.length),
        crfCompared: compared.length,
        crfAgreementRate: rate(compared.filter((trial) => trial.agreement?.agrees === true).length, compared.length),
    };
}

/** One pass of one line by one model, as the runner records it. */
export interface DeterminismPass {
    readonly lineId: string;
    /** A response arrived. `false` for a call that never did. */
    readonly responded: boolean;
    /** The response verbatim. Empty when none arrived. */
    readonly responseText: string;
}

/**
 * Pair a line's two passes.
 *
 * ⛔ Extracted from the runner rather than left inline, because it makes two MEASUREMENT decisions and a
 * measurement decision in untested orchestration is how a report acquires a number nobody checked: whether
 * the pair is comparable at all, and whether byte identity is even meaningful for it. Two calls that both
 * failed produce `'' === ''`, which would otherwise score as the strictest possible determinism.
 *
 * @param modelId - The bare model id.
 * @param first - The first pass.
 * @param second - The second pass over the same line.
 * @returns The pair, with both gates decided. Pure.
 */
export function pairDeterminism(modelId: string, first: DeterminismPass, second: DeterminismPass): DeterminismPair {
    const responded = first.responded && second.responded;
    const divergence = responded
        ? divergentResponses(first.responseText, second.responseText)
        : ({ kind: 'incomparable' } as const);

    return {
        modelId,
        lineId: second.lineId,
        firstText: first.responseText,
        secondText: second.responseText,
        responded,
        comparable: divergence.kind === 'comparable',
        divergentFields: divergence.kind === 'comparable' ? divergence.fields : [],
    };
}

/**
 * Score every model's repeat pass.
 *
 * @param pairs - Every pair, from every model, in any order.
 * @param roster - The models the run asked for, in report order.
 * @returns One report per roster entry. Pure.
 */
export function summarizeDeterminism(
    pairs: readonly DeterminismPair[],
    roster: readonly string[],
): readonly DeterminismReport[] {
    return roster.map((modelId) => {
        const own = pairs.filter((pair) => pair.modelId === modelId);
        const responded = own.filter((pair) => pair.responded);
        const comparable = own.filter((pair) => pair.comparable);
        const divergentFieldCounts: Partial<Record<ParseField, number>> = {};

        for (const pair of comparable) {
            for (const field of pair.divergentFields) {
                divergentFieldCounts[field] = (divergentFieldCounts[field] ?? 0) + 1;
            }
        }

        return {
            modelId,
            pairs: own.length,
            respondedPairs: responded.length,
            comparablePairs: comparable.length,
            byteIdenticalRate: rate(
                responded.filter((pair) => pair.firstText === pair.secondText).length,
                responded.length,
            ),
            divergentRate: rate(comparable.filter((pair) => pair.divergentFields.length > 0).length, comparable.length),
            divergentFieldCounts,
        };
    });
}

/** Zero for an empty denominator — a rate over nothing is not one, and `NaN` would print as a number. */
function rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}
