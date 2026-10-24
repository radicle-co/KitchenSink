/**
 * Lambda adapter for the midnight reclaim (ADR-0061).
 *
 * A Step Functions loop calls this once a minute with `{ kind: 'step', iteration, maxIterations }`, and once with
 * `{ kind: 'report', error }` when a step crashed after its retries. It builds the SDK clients, adapts them through
 * `./awsAdapters`, and delegates every decision to `lib/sandbox-scheduler/reclaim`. What it adds is the one thing the
 * pure module must not do: tell a human.
 *
 * ⛔ THE SANDBOX ALARM TOPIC HAS NO SUBSCRIBER, so a reclaim that ends in `Fail` without an announcement is silent.
 * Three paths announce, and each fires at most once per execution:
 *
 *   - a `step` that ends with work left (`failed`) announces `stacks-left-behind`;
 *   - a `step` that ends the run (`complete`) with refused stacks announces `stacks-refused` (a stack the reclaim left in
 *     place because its tag did not match is otherwise a leak in silence);
 *   - a `report` (the state machine's Catch, after a step threw and its retries ran out) announces `reclaim-crashed`.
 *
 * A step that throws (an unobservable tier, an AWS outage) does NOT announce itself — the Catch sends it to `report`.
 * The sentence that reaches Sentry is fixed text; what went wrong goes in the context, which reaches the log drain only.
 *
 * It sits under `src/` because it imports the runtime-provided SDK, which the bundle leaves `external`.
 *
 * @sideEffect Deletes ECS services and CloudFormation stacks, stops tasks, and reports to Sentry.
 */
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { RDSClient } from '@aws-sdk/client-rds';

import {
    parseReclaimRequest,
    runReclaimStep,
    type ReclaimPorts,
    type ReclaimStepResult,
} from '../../lib/sandbox-scheduler/reclaim.js';
import { announceSilentNoOp } from '../observability/silentNoOp.js';
import { createEc2Api, createRdsApi } from './awsAdapters.js';
import { createReclaimCloudFormationApi, createReclaimEcsApi } from './reclaimAdapters.js';

const ports: ReclaimPorts = {
    rds: createRdsApi(new RDSClient({})),
    ec2: createEc2Api(new EC2Client({})),
    cloudFormation: createReclaimCloudFormationApi(new CloudFormationClient({})),
    ecs: createReclaimEcsApi(new ECSClient({})),
};

/** What a `report` returns: the state machine goes on to `Fail`, so the answer only needs to say it was reported. */
export interface ReclaimReportResult {
    /** Always `true`: the report ran. Whether Sentry accepted it is on the drain. */
    readonly reported: true;
}

/**
 * A value from the state machine's error object, as text for the drain.
 *
 * @param value - The `Error` or `Cause` field, which Step Functions fills with strings.
 * @param fallback - The text for a missing field.
 * @returns The text. Pure.
 */
function asText(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
        return value;
    }

    return value === undefined ? fallback : JSON.stringify(value);
}

/**
 * Announce, and never let the announcement replace the outcome.
 *
 * @param condition - The closed vocabulary of this module.
 * @param detail - A fixed sentence.
 * @param context - Identifiers for the DRAIN only.
 * @sideEffect Issues at most one HTTP POST. Never throws.
 */
async function announce(
    condition: 'stacks-left-behind' | 'stacks-refused' | 'reclaim-crashed',
    detail: string,
    context: Readonly<Record<string, string>>,
): Promise<void> {
    try {
        await announceSilentNoOp({ service: 'sandbox-reclaim', stage: 'sandbox', condition, detail }, context);
    } catch {
        // ⛔ A failed report must never replace the outcome it reports.
    }
}

/**
 * Lambda entrypoint.
 *
 * @param event - `{ kind: 'step', iteration, maxIterations }` or `{ kind: 'report', error }`.
 * @returns The step's result, which the state machine's Choice reads; or `{ reported: true }`.
 * @throws {InvalidReclaimRequestError} When the event is neither — never defaulted.
 * @throws {ReclaimTierUnobservableError} When the sandbox database or NAT cannot be found (routed to `report` by the Catch).
 */
export const handler = async (event: unknown): Promise<ReclaimStepResult | ReclaimReportResult> => {
    const request = parseReclaimRequest(event);

    if (request.kind === 'report') {
        const error = (request.error ?? {}) as { Error?: unknown; Cause?: unknown };

        console.error(JSON.stringify({ message: 'sandbox-reclaim crashed', error: request.error }));
        await announce('reclaim-crashed', 'The sandbox reclaim loop crashed. The reclaim log group holds the cause.', {
            error: asText(error.Error, 'unknown'),
            cause: asText(error.Cause, ''),
        });

        return { reported: true };
    }

    const result = await runReclaimStep(ports, request.iteration, request.maxIterations);

    console.log(JSON.stringify({ message: 'sandbox-reclaim step complete', ...result }));

    if (result.failed) {
        await announce(
            'stacks-left-behind',
            'The sandbox reclaim ended with stacks still to delete. The reclaim log group lists them.',
            { pending: result.pending.join(', '), errors: result.errors.join('; ') },
        );
    }

    // ⛔ A REFUSAL IS ANNOUNCED WHEN THE RUN ENDS, not on every step: the planner repeats the same warning each minute, and
    // an announcement per step would be a hundred issues for one stack. `complete` is true exactly once per execution.
    // A refused stack is left in place and the run still ends in a clean success, so without this a mis-tagged stack
    // leaks in silence for as long as it exists.
    if (result.complete && result.warnings.length > 0) {
        await announce(
            'stacks-refused',
            'The sandbox reclaim left stacks in place because their tags did not match. The reclaim log group lists them.',
            { refused: result.warnings.join('; ') },
        );
    }

    return result;
};
