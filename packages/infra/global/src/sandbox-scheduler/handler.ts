/**
 * Lambda adapter for the sandbox scheduler (ADR-0007, ADR-0060, ADR-0061).
 *
 * This is a thin, mechanical adapter: it constructs the AWS SDK v3 clients (RDS/ECS/EC2/SSM/EventBridge/Step
 * Functions, loaded lazily — provided by the Node 22 Lambda runtime, so they are marked `external` at bundle time and are NOT package
 * dependencies), adapts them to the injected client interfaces in `lib/sandbox-scheduler/scheduler` through
 * `./awsAdapters`, and reports a failed nightly stop. ALL the sandbox-only selection + stop/start decision logic lives
 * in the `lib/` module it delegates to (and is unit-tested).
 *
 * It is deliberately located under `src/` (outside the infra `tsconfig` `bin`/`lib` include) because
 * it depends on the runtime-provided SDK rather than an installed package; esbuild bundles it via
 * `esbuild.mjs`. The type-checked, tested logic is entirely in the `lib/` module it delegates to.
 *
 * @sideEffect Stops/starts sandbox RDS, ECS services and the NAT EC2 instance, enables/disables scheduled rules, starts
 *   the midnight reclaim loop, and reports a failed stop to Sentry.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { ECSClient } from '@aws-sdk/client-ecs';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { RDSClient } from '@aws-sdk/client-rds';
import { SSMClient } from '@aws-sdk/client-ssm';

import {
    assertRunSucceeded,
    parseSchedulerRequest,
    runSchedulerAction,
    type SchedulerClients,
    type SchedulerRequest,
    type SchedulerSummary,
} from '../../lib/sandbox-scheduler/scheduler.js';
import { announceSilentNoOp } from '../observability/silentNoOp.js';
import { createEc2Api, createEcsApi, createEventsApi, createRdsApi, createSsmApi } from './awsAdapters.js';
import { createReclaimStarter } from './reclaimStarter.js';

const rdsClient = new RDSClient({});
const ecsClient = new ECSClient({});
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});
// ⚠️ Adaptive retry, because every parallel deploy in Sandbox Up runs `sync` at once and each reads one tag set per
// rule: EventBridge's control plane throttles that burst, and the default three attempts failed a deploy on it.
const eventBridgeClient = new EventBridgeClient({ retryMode: 'adaptive', maxAttempts: 10 });

/**
 * Build the clients for one invocation.
 *
 * The reclaim state machine's ARN is read per invocation, so a missing value fails the stop's reclaim start loudly
 * (and is announced) instead of failing the function at import, which would stop nothing from stopping.
 *
 * @returns The injected clients. Reads `RECLAIM_STATE_MACHINE_ARN`.
 */
function buildClients(): SchedulerClients {
    return {
        rds: createRdsApi(rdsClient),
        ecs: createEcsApi(ecsClient),
        ec2: createEc2Api(ec2Client),
        ssm: createSsmApi(ssmClient),
        events: createEventsApi(eventBridgeClient),
        reclaim: createReclaimStarter(process.env['RECLAIM_STATE_MACHINE_ARN']),
    };
}

/**
 * Report a failed nightly stop as a Sentry issue.
 *
 * ⛔ THE SANDBOX ALARM TOPIC HAS NO SUBSCRIBER, so the failed-run alarm reaches nobody; this issue is the channel. Only
 * a `stop` announces: a failed `start` or `sync` fails a workflow, which is already watching. The sentence that
 * reaches Sentry is fixed text; the errors go in the context, which reaches the log drain only.
 *
 * @param errors - What went wrong, for the drain.
 * @sideEffect Issues at most one HTTP POST. Never throws.
 */
async function announceFailedStop(errors: readonly string[]): Promise<void> {
    try {
        await announceSilentNoOp(
            {
                service: 'sandbox-scheduler',
                stage: 'sandbox',
                condition: 'nightly-stop-failed',
                detail: 'The nightly sandbox stop recorded a failure. The scheduler log group names the step.',
            },
            { errors: errors.join('; ') },
        );
    } catch {
        // ⛔ A failed report must never replace the failure it reports.
    }
}

/**
 * Run one command, announcing a stop that fails by returning an error OR by crashing.
 *
 * @param request - The parsed command.
 * @returns The run summary.
 */
async function run(request: SchedulerRequest): Promise<SchedulerSummary> {
    let summary: SchedulerSummary;

    try {
        summary = await runSchedulerAction(request, buildClients());
    } catch (error) {
        if (request.action === 'stop') {
            await announceFailedStop([error instanceof Error ? error.message : String(error)]);
        }

        throw error;
    }

    if (request.action === 'stop' && summary.errors.length > 0) {
        await announceFailedStop(summary.errors);
    }

    return summary;
}

/**
 * Lambda entrypoint. Parses the event into one scheduler command and runs it.
 *
 * @param event - `{ action: 'stop', scheduledTime }` from the midnight schedule, `{ action: 'start', stage: 'pr-<N>' }`
 *   from Sandbox Up, or `{ action: 'sync' }` from any workflow that changed what is up.
 * @returns The structured run summary (also logged).
 * @throws {InvalidSchedulerRequestError} When the event is not exactly one of the three commands — never defaulted.
 * @throws {SchedulerRunFailedError} When any resource or rule failed its transition, after every step has run.
 */
export const handler = async (event: unknown): Promise<SchedulerSummary> => {
    const request = parseSchedulerRequest(event);
    const summary = await run(request);

    console.log(JSON.stringify({ message: 'sandbox-scheduler run complete', ...summary }));
    assertRunSucceeded(summary);

    return summary;
};
