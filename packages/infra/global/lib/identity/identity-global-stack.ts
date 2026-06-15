import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { DataStack } from './data-stack.js';
import { DomainStack } from './domain-stack.js';
import { NetworkStack } from './network-stack.js';

export interface IdentityGlobalStackProps extends StackProps {
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
export class IdentityGlobalStack extends Stack {
    public readonly network: NetworkStack;
    public readonly data: DataStack;
    public readonly domain: DomainStack;
    public readonly stage: string;

    public constructor(scope: Construct, id: string, props: IdentityGlobalStackProps) {
        super(scope, id, props);

        const { stage, domainName } = props;

        this.stage = stage;

        this.network = new NetworkStack(this, `IdentityNetwork-${stage}`, {
            env: props.env,
            stackName: `kitchensink-identity-network-${stage}`,
            stage,
        });

        this.data = new DataStack(this, `IdentityData-${stage}`, {
            env: props.env,
            stackName: `kitchensink-identity-data-${stage}`,
            network: this.network,
            stage,
        });

        this.domain = new DomainStack(this, `IdentityDomain-${stage}`, {
            env: props.env,
            stackName: `kitchensink-identity-domain-${stage}`,
            domainName,
        });
    }
}
