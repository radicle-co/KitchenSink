import { CfnOutput, Stack, type StackProps, Tags, aws_ec2 as ec2 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { albHttpsIngressPrefixListFor } from '@kitchensink/infra-alb';
import { AcceptedNagFindings, acceptNagFindings } from '@kitchensink/infra-security';

export interface NetworkStackProps extends StackProps {
    readonly stage: string;
}

/**
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md
 *
 * Per-stage VPC CIDRs. Prod stays on the historical 10.0.0.0/16 (so setting it
 * explicitly is a no-op against the deployed VPC — no replacement). Sandbox uses
 * a distinct range so the two VPCs can be peered (VPC peering rejects overlapping
 * CIDRs). Unknown/dev/test stages fall back to a throwaway range rather than
 * throwing, so local synth and the test harness keep working.
 *
 * Do NOT change the prod value: replacing the prod VPC replaces the prod RDS
 * (removalPolicy DESTROY, no snapshot). Gate any change on an empty `cdk diff`
 * for the whole prod network + data stacks.
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

        // Cost: a managed NAT *Gateway* is ~$32/mo/stage + data; a NAT *instance* (t4g.nano) is ~$3-4/mo
        // for the same job at this scale. The single remaining NAT consumer is the DB-bound webhook
        // lambda set (they must be VPC-attached to reach the private RDS, then need Secrets/Logs/SQS/
        // Clerk egress); everything else (Fargate services, log-forwarder) egresses via the IGW and
        // does not touch the NAT. Single-AZ instance is an accepted SPOF/throughput trade for a lean
        // stage. OUTBOUND_ONLY by default; inbound is opened only to the VPC CIDR below.
        const natProvider = ec2.NatProvider.instanceV2({
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
            defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
        });

        this.vpc = new ec2.Vpc(this, 'Vpc', {
            ipAddresses: ec2.IpAddresses.cidr(cidrForStage(props.stage)),
            maxAzs: 2,
            natGateways: 1,
            natGatewayProvider: natProvider,
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

        // The NAT instance defaults to OUTBOUND_ONLY; open inbound only to the VPC CIDR so the
        // private subnets can route their egress through it (and nothing on the public internet can).
        natProvider.connections.allowFrom(
            ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
            ec2.Port.allTraffic(),
            'Allow VPC private subnets to route egress through the NAT instance',
        );

        // Platform-wide VPC name (shared across services) — overrides the CDK
        // path-derived Name tag. Scoped to the VPC resource only (not its subnets/
        // route tables, which keep their distinct names). Tag-only change; no replacement.
        Tags.of(this.vpc.node.defaultChild as ec2.CfnVPC).add('Name', `KitchenSink-${props.stage}`);

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

        // ⛔ ALL ALB ingress is owned HERE, and nowhere else. `SharedAlbStack` passes `open: false` to its
        // listeners for exactly this reason: `open: true` calls `allowDefaultPortFrom(anyIpv4())` on THIS
        // security-group construct, which is invisible while the rules happen to be identical and silently
        // re-opens `:443` in a DIFFERENT stack's template the moment this one narrows. See the U17 lockdown
        // block in `SharedAlbStack.test.ts` for the assertion that catches it.
        //
        // `:80` stays open to the internet on every stage. It only redirects to `:443`, so it protects
        // nothing — and a second managed-prefix-list rule would cost another 55 against the 60-rule quota
        // and fail the deploy outright (see CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT).
        this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP ingress');

        // Prod's ALB answers only to CloudFront (ADR-0020 / U17). Every other stage has no distribution and
        // must keep reaching its own ALB directly, so `undefined` — the absence of a prefix list — is the
        // prod gate rather than a second stage comparison written out here.
        const httpsIngressPrefixList = albHttpsIngressPrefixListFor(props.stage);

        if (httpsIngressPrefixList === undefined) {
            this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Public HTTPS ingress');
        } else {
            this.albSecurityGroup.addIngressRule(
                ec2.Peer.prefixList(httpsIngressPrefixList),
                ec2.Port.tcp(443),
                'CloudFront origin-facing only (ADR-0020 / U17)',
            );
        }

        // AwsSolutions-EC23 accepted: this SG fronts the shared INTERNET-FACING ALB (ADR-0003), so public
        // ingress here is the resource doing its job. Justification in @kitchensink/infra-security.
        acceptNagFindings(this.albSecurityGroup, AcceptedNagFindings.PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY);

        this.serviceSecurityGroup.addIngressRule(
            this.albSecurityGroup,
            ec2.Port.tcp(3000),
            'Allow ALB to reach identity ECS tasks',
        );

        this.serviceSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Clerk API and AWS endpoints',
        );

        this.lambdaSecurityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(443),
            'Controlled egress for Clerk API and AWS endpoints',
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

        new CfnOutput(this, 'VpcId', {
            value: this.vpc.vpcId,
            exportName: `${this.stackName}:VpcId`,
        });
        new CfnOutput(this, 'PrivateAppSubnetIds', {
            value: privateSubnets.join(','),
            exportName: `${this.stackName}:PrivateAppSubnetIds`,
        });
        new CfnOutput(this, 'PrivateDataSubnetIds', {
            value: privateDataSubnets.join(','),
            exportName: `${this.stackName}:PrivateDataSubnetIds`,
        });
        new CfnOutput(this, 'AlbSecurityGroupId', {
            value: this.albSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:AlbSecurityGroupId`,
        });
        new CfnOutput(this, 'ServiceSecurityGroupId', {
            value: this.serviceSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:ServiceSecurityGroupId`,
        });
        new CfnOutput(this, 'DatabaseSecurityGroupId', {
            value: this.databaseSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:DatabaseSecurityGroupId`,
        });
        new CfnOutput(this, 'LambdaSecurityGroupId', {
            value: this.lambdaSecurityGroup.securityGroupId,
            exportName: `${this.stackName}:LambdaSecurityGroupId`,
        });
    }
}
