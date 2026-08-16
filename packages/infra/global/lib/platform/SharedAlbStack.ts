import { CfnOutput, Stack, type StackProps, aws_ec2 as ec2, aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DomainStack } from './DomainStack.js';
import type { NetworkStack } from './NetworkStack.js';

export interface SharedAlbStackProps extends StackProps {
    readonly network: NetworkStack;
    readonly domain: DomainStack;
    readonly stage?: string;
}

/**
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0003-shared-alb-per-stage.md
 *
 * One shared internet-facing Application Load Balancer per stage, owned by the global infra.
 * Backend services (identity, food, …) do NOT create their own ALB — each imports this ALB's
 * HTTPS listener and attaches a host-based {@link elbv2.ApplicationListenerRule} (unique priority
 * per service) routing its subdomain to its own target group. Unmatched hosts hit the listener's
 * default fixed-response 404.
 *
 * This is a cost decision (one ~$16/mo ALB base per stage instead of one per service while traffic
 * is small); revisit to per-service ALBs when LCU/traffic or blast-radius isolation warrants.
 */
export class SharedAlbStack extends Stack {
    public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    public readonly httpsListener: elbv2.ApplicationListener;

    public constructor(scope: Construct, id: string, props: SharedAlbStackProps) {
        super(scope, id, props);

        const { network, domain } = props;

        this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'SharedAlb', {
            vpc: network.vpc,
            internetFacing: true,
            securityGroup: network.albSecurityGroup,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
        });

        // Services attach host-based rules; any host that matches no rule gets a 404 (not a default
        // route to some arbitrary service).
        this.httpsListener = this.loadBalancer.addListener('SharedHttpsListener', {
            port: 443,
            // ADR-0020 / plan U15: the apex cert plus, in prod, the additive `*.internal.{domain}` one
            // the CloudFront origins present. `internalCertificate` is `undefined` outside prod by
            // design (no distributions there), so absence is normal and must not throw — CDK keeps the
            // first cert inline on the listener and emits the rest as ListenerCertificate resources.
            certificates: [domain.certificate, ...(domain.internalCertificate ? [domain.internalCertificate] : [])],
            open: true,
            defaultAction: elbv2.ListenerAction.fixedResponse(404, {
                contentType: 'text/plain',
                messageBody: 'Not Found',
            }),
        });

        const httpListener = this.loadBalancer.addListener('SharedHttpListener', {
            port: 80,
            open: true,
        });
        httpListener.addAction('HttpRedirect', {
            action: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
                permanent: true,
            }),
        });

        new CfnOutput(this, 'SharedAlbArn', {
            value: this.loadBalancer.loadBalancerArn,
            exportName: `${this.stackName}:SharedAlbArn`,
        });
        new CfnOutput(this, 'SharedAlbDnsName', {
            value: this.loadBalancer.loadBalancerDnsName,
            exportName: `${this.stackName}:SharedAlbDnsName`,
        });
        new CfnOutput(this, 'SharedAlbCanonicalHostedZoneId', {
            value: this.loadBalancer.loadBalancerCanonicalHostedZoneId,
            exportName: `${this.stackName}:SharedAlbCanonicalHostedZoneId`,
        });
        new CfnOutput(this, 'SharedAlbHttpsListenerArn', {
            value: this.httpsListener.listenerArn,
            exportName: `${this.stackName}:SharedAlbHttpsListenerArn`,
        });
    }
}
