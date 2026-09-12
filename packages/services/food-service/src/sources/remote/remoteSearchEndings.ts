/**
 * How a remote search ended, and the recorder that publishes it (ADR-0055 point 6). A failed signature is CloudFront's
 * own `403`, which never reaches the search function's alarms, so food's count of its own endings is what sees the
 * search service go dark.
 *
 * `SearchServiceRemoteSearch` decides the outcome; {@link endingOfAnswer} and {@link endingOfFailure} name the branch it
 * took. `__tests__/remoteSearchEndings.test.ts` drives the real adapter through every ending, so a branch that moves
 * without its name fails there.
 *
 * @module
 */
import type { RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { FoodMetrics } from '../../observability/emfMetrics.js';
import { isSourceAccountingError, isSourceBusyError, type SourceBusyReason } from '../foodSource.errors.js';
import type { CacheFirstAnswer } from '../transport/CacheFirstAdmissionTransport.js';
import { isRemoteSearchUnavailableError, type RemoteSearchUnavailableReason } from './remoteSearch.errors.js';
import type { RemoteSourceOutcome } from './remoteSearchPort.js';

/**
 * How one remote search ended. Admission's refusals ({@link SourceBusyReason}) and the answers food cannot trust as
 * this request's ({@link RemoteSearchUnavailableReason}) keep their own names. The adapter's other endings:
 *
 * - `answered`: the source's answer, cached or admitted.
 * - `blockEarned`: the origin answered this request with a source signal that earned the source a block.
 * - `upstreamStatus`: the origin answered this request with a status that is not an answer; its log line has it.
 * - `contractBroken`: a `200` whose body is not the contract's.
 * - `accountingFailed`: our own budget, window or block ledger failed.
 * - `failed`: anything else that threw, such as the network or a body that is not JSON.
 * - `callerLeft`: the cook stopped waiting.
 * - `termNotCanonical`: a term the search service would refuse, so it was never sent.
 */
export type RemoteSearchEnding =
    | 'answered'
    | 'blockEarned'
    | 'upstreamStatus'
    | 'contractBroken'
    | SourceBusyReason
    | RemoteSearchUnavailableReason
    | 'accountingFailed'
    | 'failed'
    | 'callerLeft'
    | 'termNotCanonical';

/** Where the adapter records each search's ending. */
export interface RemoteSearchEndings {
    /**
     * Record one search's ending.
     *
     * @param source - The source searched.
     * @param ending - How it ended.
     * @param outcome - The outcome the adapter returned for it.
     * @sideEffect Publishes the ending.
     */
    record(source: RemoteSearchSource, ending: RemoteSearchEnding, outcome: RemoteSourceOutcome): void;
}

/**
 * The ending of a search the CDN answered, named after the adapter's `outcomeOf` branch. Pure.
 *
 * @param answer - The CDN's answer.
 * @param outcome - The outcome the adapter made of it.
 * @returns The ending.
 */
export function endingOfAnswer(answer: CacheFirstAnswer, outcome: RemoteSourceOutcome): RemoteSearchEnding {
    if (answer.response.status !== 200) {
        return answer.block === undefined ? 'upstreamStatus' : 'blockEarned';
    }

    return outcome.kind === 'answered' ? 'answered' : 'contractBroken';
}

/**
 * The ending of a search that threw, named after the adapter's `failureOutcome` branch, in its order. Pure.
 *
 * @param error - The thrown value.
 * @param callerLeft - The adapter's own answer to whether the failure is the cook leaving.
 * @returns The ending.
 */
export function endingOfFailure(error: unknown, callerLeft: boolean): RemoteSearchEnding {
    if (isSourceBusyError(error)) {
        return error.reason;
    }

    if (callerLeft) {
        return 'callerLeft';
    }

    if (isSourceAccountingError(error)) {
        return 'accountingFailed';
    }

    if (isRemoteSearchUnavailableError(error)) {
        return error.reason;
    }

    return 'failed';
}

/**
 * Publishes one stage's endings: each is counted under its reason, and each but the cook leaving is observed in the
 * unavailable rate. Only an `unavailable` outcome is dark there; `busy` and `limited` are refusals, so they count as
 * available.
 *
 * @pattern Adapter — the remote search adapter's endings onto food's EMF recorder
 */
export class RemoteSearchEndingMetrics implements RemoteSearchEndings {
    /**
     * @param metrics - Food's EMF recorder.
     * @param stage - The stage this process runs at, which every ending is published under.
     */
    public constructor(
        private readonly metrics: Pick<FoodMetrics, 'recordRemoteSearchEnding' | 'recordRemoteSearchAvailability'>,
        private readonly stage: string,
    ) {}

    /**
     * Publish one ending.
     *
     * @param source - The source searched.
     * @param ending - How it ended.
     * @param outcome - The outcome the adapter returned for it.
     * @sideEffect Emits one or two EMF metrics.
     */
    public record(source: RemoteSearchSource, ending: RemoteSearchEnding, outcome: RemoteSourceOutcome): void {
        this.metrics.recordRemoteSearchEnding(this.stage, source, ending);

        if (ending === 'callerLeft') {
            return;
        }

        this.metrics.recordRemoteSearchAvailability(this.stage, outcome.kind === 'unavailable');
    }
}
