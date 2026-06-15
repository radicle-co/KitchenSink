import { CfnOutput, Stack, type StackProps, aws_ec2 as ec2 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface NetworkStackProps extends StackProps {
    readonly stage: string;
}

/**
 * Per-stage VPC CIDRs. Prod stays on the historical 10.0.0.0/16 (so setting it
 * explicitly is a no-op against the deployed VPC — no replacement). Sandbox uses
 * a distinct range so the two VPCs can be peered (VPC peering rejects overlapping
 * CIDRs). Unknown/dev/test stages fall back to a throwaway range rather than
 * throwing, so local synth and the test harness keep working.
 */
const STAGE_CIDRS: Record<string, string> = {
    prod: '10.0.0.0/16',
    sandbox: '10.1.0.0/16',
};

export function cidrForStage(stage: string): string {
    return STAGE_CIDRS[stage] ?? '10.2.0.0/16';
}

/**
 * @implements REQ-050 REQ-IF-007 REQ-CN-007 FR-038 ARCH-031 MOD-031
 */
export class NetworkStack extends Stack {
    public readonly vpc: ec2.Vpc;
    public readonly albSecurityGroup: ec2.SecurityGroup;
    public readonly serviceSecurityGroup: ec2.SecurityGroup;
    public readonly databaseSecurityGroup: ec2.SecurityGroup;
    public readonly lambdaSecurityGroup: ec2.SecurityGroup;

    public constructor(scope: Construct, id: string, props: NetworkStackProps) {
        super(scope, id, props);

        this.vpc = new ec2.Vpc(this, 'IdentityVpc', {
            ipAddresses: ec2.IpAddresses.cidr(cidrForStage(props.stage)),
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: 'private-app',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
                {
                    name: 'private-data',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });

        this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
            vpc: this.vpc,
            description: 'Ingress boundary for identity ALB',
            allowAllOutbound: true,
        });

        this.serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
            vpc: this.vpc,
            description: 'ECS tasks for identity service',
            allowAllOutbound: false,
        });

        this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc: this.vpc,
            description: 'Lambda functions in webhooks boundary',
            allowAllOutbound: false,
        });

        this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
            vpc: this.vpc,
            description: 'RDS PostgreSQL ingress boundary',
            allowAllOutbound: true,
        });

        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP ingress');
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS ingress');

        this.serviceSecurityGroup.addIngressRule(
            this.albSecurityGroup,
            ec2.Port.tcp(3000),
            'Allow ALB to reach identity ECS tasks',
        );

        this.serviceSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Auth0 Management API and AWS endpoints',
        );

        this.lambdaSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Auth0 Management API and AWS endpoints',
        );

        this.databaseSecurityGroup.addIngressRule(
            this.serviceSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow identity ECS tasks to reach PostgreSQL',
        );

        this.databaseSecurityGroup.addIngressRule(
            this.lambdaSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow webhook lambdas to reach PostgreSQL',
        );

        // The app SGs use allowAllOutbound: false, so the DB ingress rules above are not enough —
        // the source SGs also need explicit *egress* to PostgreSQL or the SYN never leaves the ENI
        // (ENI_SG_RULES_MISMATCH / connection timeout). Pair every DB ingress with matching egress.
        this.serviceSecurityGroup.addEgressRule(
            this.databaseSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow identity ECS tasks to reach PostgreSQL',
        );

        this.lambdaSecurityGroup.addEgressRule(
            this.databaseSecurityGroup,
            ec2.Port.tcp(5432),
            'Allow webhook lambdas to reach PostgreSQL',
        );

        const privateSubnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
        const privateDataSubnets = this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds;

        new CfnOutput(this, 'IdentityVpcId', {
            value: this.vpc.vpcId,
            exportName: `${this.stackName}:IdentityVpcId`,
        });
        new CfnOutput(this, 'IdentityPrivateAppSubnetIds', {
            value: privateSubnets.join(','),
            exportName: `${this.stackName}:IdentityPrivateAppSubnetIds`,
        });
        new CfnOutput(this, 'IdentityPrivateDataSubnetIds', {
            value: privateDataSubnets.join(','),
            exportName: `${this.stackName}:IdentityPrivateDataSubnetIds`,
        });
        new CfnOutput(this, 'IdentityAlbSecurityGroupId', {
            value: this.albSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:IdentityAlbSecurityGroupId`,
        });
        new CfnOutput(this, 'IdentityServiceSecurityGroupId', {
            value: this.serviceSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:IdentityServiceSecurityGroupId`,
        });
        new CfnOutput(this, 'IdentityDatabaseSecurityGroupId', {
            value: this.databaseSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:IdentityDatabaseSecurityGroupId`,
        });
        new CfnOutput(this, 'IdentityLambdaSecurityGroupId', {
            value: this.lambdaSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:IdentityLambdaSecurityGroupId`,
        });
    }
}
