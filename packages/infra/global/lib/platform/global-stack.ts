import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { DataStack } from './data-stack.js';
import { DomainStack } from './domain-stack.js';
import { NetworkStack } from './network-stack.js';

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
    }
}
