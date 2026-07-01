import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { DataStack } from './data-stack.js';
import { DomainStack } from './domain-stack.js';
import { NetworkStack } from './network-stack.js';
import { SandboxSchedulerStack } from './sandbox-scheduler-stack.js';
import { SharedAlbStack } from './shared-alb-stack.js';

export interface GlobalStackProps extends StackProps {
    readonly stage: string;
    readonly domainName: string;
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
            network: this.network,
            stage,
        });

        this.domain = new DomainStack(this, `Domain-${stage}`, {
            env: props.env,
            stackName: `kitchensink-domain-${stage}`,
            domainName,
        });

        this.alb = new SharedAlbStack(this, `SharedAlb-${stage}`, {
            env: props.env,
            stackName: `kitchensink-alb-${stage}`,
            network: this.network,
            domain: this.domain,
            stage,
        });

        // ADR-0007: the nightly stop/start scheduler exists ONLY for the sandbox stage. Guarding the
        // instantiation (not just the schedule expressions) means prod/dev synthesize NOTHING here, so
        // the prod template is unchanged (ADR-0002 no-prod-diff discipline).
        if (stage === 'sandbox') {
            this.sandboxScheduler = new SandboxSchedulerStack(this, `SandboxScheduler-${stage}`, {
                env: props.env,
                stackName: `kitchensink-sandbox-scheduler-${stage}`,
                stage,
            });
        }
    }
}
