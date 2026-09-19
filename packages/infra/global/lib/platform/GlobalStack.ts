import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { DataStack } from './DataStack.js';
import { DomainStack } from './DomainStack.js';
import { MessageSubstrateStack } from './MessageSubstrateStack.js';
import { NetworkStack } from './NetworkStack.js';
import { SandboxSchedulerStack } from './SandboxSchedulerStack.js';
import { ServiceLogsStack } from './ServiceLogsStack.js';
import { SharedAlbStack } from './SharedAlbStack.js';

export interface GlobalStackProps extends StackProps {
    readonly stage: string;
    readonly domainName: string;
    /** Email that receives platform alarms (R3.2 / plan U11); per-stage config, never a committed literal. */
    readonly alertEmail?: string;
    /**
     * Whether the stacks below create their CloudWatch alarms. Resolved at SYNTH time from `ALARMS_ENABLED`,
     * which the deploy pipeline reads from `/kitchensink/{stage}/observability/alarms-enabled`; default OFF.
     *
     * ⛔ REQUIRED, and passed straight through — this stack owns no alarm of its own, so its only job here is
     * to refuse to construct a child that would decide the question for itself. Enforced by
     * `packages/infra/global/__tests__/alarmFeatureFlag.test.ts`.
     */
    readonly alarmsEnabled: boolean;
    /**
     * The log forwarder's ARN, resolved in CI from the webhooks app's export.
     *
     * ⛔ A PROP, NOT AN `Fn.importValue`, AND THAT BREAKS A REAL CYCLE. ADR-0042 has each log-group owner
     * attach its own subscription filter and lets the forwarder's ARN travel as a CloudFormation export.
     * For stacks in THIS app that made the dependency circular: `WebhooksStack` imports
     * `kitchensink-data-{stage}:HandleSyncTopicArn` from `DataStack`, while `DataStack` and
     * `SandboxSchedulerStack` imported `kitchensink-identity-webhooks-{stage}:LogForwarderArn` back. Neither
     * app could go first, and the deploy failed with "No export named … LogForwarderArn found" — which is
     * exactly what it did, on sandbox, for the ingredient-parser, the scheduler and the whole global app.
     *
     * ⚠️ ABSENT IS TOLERATED, and it is how the cycle converges: the filters are simply not created and
     * the synth says so. A hard failure here would leave a fresh account with no way to bootstrap either
     * app — and it would protect nothing, since a global deploy that ABORTS attaches no filters either.
     *
     * ⛔ THE ATTACHMENT IS BOUNDED BY THE NEXT DEPLOY OF THIS APP, NOT THE NEXT RUN. No workflow arms
     * `deploy_global` on the export appearing — it is armed by a `workflow_dispatch`, a change under
     * `packages/infra/global/**`, or (sandbox only) an absent platform stack. `logDrainRegister.test.ts`
     * asserts both postures against the TEMPLATE; that a DEPLOYED stage has them is ADR-0042's stated
     * residual.
     *
     * ⚠️ Resolved in CI rather than in CDK, which is this repository's stated convention for a value that
     * crosses `cdk deploy` invocations — the same one `infra-package`'s "Resolve platform inputs from
     * CloudFormation exports" step exists for.
     */
    readonly logForwarderArn?: string;
}

/**
 * Orchestrates shared identity infrastructure: VPC, subnets, security groups,
 * RDS PostgreSQL, S3 buckets, SQS queues, SSL certificates, and Route53.
 *
 * Deployed once per environment. Service-specific stacks reference the
 * CloudFormation exports produced by child stacks instead of duplicating resources.
 */
export class GlobalStack extends Stack {
    public readonly network: NetworkStack;
    public readonly data: DataStack;
    public readonly domain: DomainStack;
    public readonly alb: SharedAlbStack;
    /** The message substrate — BASE stages only; a `pr-{N}` table lives in the producer's own stack (U5). */
    public readonly messaging: MessageSubstrateStack;
    /** Log groups that outlive the reclaimable stacks writing to them (ADR-0028, 2026-08-30). */
    public readonly serviceLogs: ServiceLogsStack;
    /** The sandbox nightly-shutdown scheduler — created ONLY for `stage === 'sandbox'` (ADR-0007). */
    public readonly sandboxScheduler?: SandboxSchedulerStack;
    public readonly stage: string;

    public constructor(scope: Construct, id: string, props: GlobalStackProps) {
        super(scope, id, props);

        const { stage, domainName } = props;

        this.stage = stage;

        this.network = new NetworkStack(this, `Network-${stage}`, {
            env: props.env,
            stackName: `kitchensink-network-${stage}`,
            stage,
        });

        this.data = new DataStack(this, `Data-${stage}`, {
            env: props.env,
            stackName: `kitchensink-data-${stage}`,
            logForwarderArn: props.logForwarderArn,
            network: this.network,
            stage,
        });

        this.domain = new DomainStack(this, `Domain-${stage}`, {
            env: props.env,
            stackName: `kitchensink-domain-${stage}`,
            domainName,
            stage,
        });

        this.alb = new SharedAlbStack(this, `SharedAlb-${stage}`, {
            env: props.env,
            stackName: `kitchensink-alb-${stage}`,
            network: this.network,
            domain: this.domain,
            stage,
        });

        // ADR-0028 (2026-08-30): the identity service's ECS log group lives HERE, not in the identity
        // service stack, because that stack is now reclaimable and `WebhooksStack` — which must survive —
        // drains this group. A persistent stack may not import from a reclaimable one; CloudFormation
        // refuses the delete outright. Asserted by `reclaimableStackImports.test.ts`.
        this.serviceLogs = new ServiceLogsStack(this, `ServiceLogs-${stage}`, {
            env: props.env,
            stackName: `kitchensink-service-logs-${stage}`,
            stage,
        });

        // The durable per-group message substrate (R1, plan U5). This app only ever deploys BASE stages
        // (`prod`/`sandbox`) — `bin/app.ts` tags the whole app with its persistent TIER and sandbox-deploy
        // never runs it with `stage=pr-{N}` — so a per-PR table is created in the PRODUCER's stack instead,
        // where it is already tagged `Environment=pr-{N}-sandbox` and torn down with the preview.
        this.messaging = new MessageSubstrateStack(this, `Messaging-${stage}`, {
            env: props.env,
            stackName: `kitchensink-messaging-${stage}`,
            stage,
            alertEmail: props.alertEmail,
            alarmsEnabled: props.alarmsEnabled,
        });

        // ADR-0007: the nightly stop/start scheduler exists ONLY for the sandbox stage. Guarding the
        // instantiation (not just the schedule expressions) means prod/dev synthesize NOTHING here, so
        // the prod template is unchanged (ADR-0002 no-prod-diff discipline).
        if (stage === 'sandbox') {
            this.sandboxScheduler = new SandboxSchedulerStack(this, `SandboxScheduler-${stage}`, {
                env: props.env,
                stackName: `kitchensink-sandbox-scheduler-${stage}`,
                logForwarderArn: props.logForwarderArn,
                stage,
            });
        }
    }
}
