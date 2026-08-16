import { CfnOutput, Stack, type StackProps, aws_certificatemanager as acm, aws_route53 as route53 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface DomainStackProps extends StackProps {
    readonly domainName: string;
    /**
     * Deployment stage. REQUIRED rather than defaulted: it gates the internal-origin certificate below,
     * and a silent default would let prod synthesize without the one cert the edge cannot work without.
     */
    readonly stage: string;
}

export class DomainStack extends Stack {
    public readonly hostedZone: route53.IHostedZone;
    public readonly certificate: acm.Certificate;
    /**
     * The additive `*.internal.{domain}` certificate — present in prod ONLY, `undefined` elsewhere.
     * Consumers must treat absence as normal (see `SharedAlbStack`), not as a misconfiguration.
     */
    public readonly internalCertificate: acm.Certificate | undefined;

    public constructor(scope: Construct, id: string, props: DomainStackProps) {
        super(scope, id, props);

        const domainName = props.domainName;

        this.hostedZone = route53.HostedZone.fromLookup(this, 'KitchenSinkHostedZone', {
            domainName,
        });

        this.certificate = new acm.Certificate(this, 'KitchenSinkCertificate', {
            domainName,
            subjectAlternativeNames: [`*.${domainName}`, `*.sandbox.${domainName}`],
            validation: acm.CertificateValidation.fromDns(this.hostedZone),
        });

        // ADR-0020 / plan U15 — the origin-side certificate for the CloudFront edge.
        //
        // ⛔ A SECOND certificate, never a SAN on the one above. `KitchenSinkCertificate`'s ARN is
        // exported as `${stackName}:CertificateArn` and imported by SharedAlbStack, identity, webhooks,
        // food and the web router. Adding a SAN REPLACES that resource and mints a new ARN, and ADR-0002
        // records the consequence: "CloudFormation refuses to change an export while another stack
        // imports it … A naive deploy deadlocks on export-in-use." Additive costs nothing and cannot
        // deadlock. Pinned by DomainStack.test.ts's "leaves the original certificate untouched".
        //
        // Why a 3-label wildcard is needed at all: the cert above covers SINGLE-label wildcards only
        // (`*.commise.app`, `*.sandbox.commise.app` — verified against the live account 2026-08-15), so
        // an origin host like `food.internal.commise.app` matches nothing and fails the TLS handshake.
        // This is the same trap documented at FoodServiceStack's `food-pr-7` vs `food.pr-7` note.
        //
        // Prod only: KTD-7 scopes CloudFront to prod, so no other stage has an origin to present this at.
        if (props.stage === 'prod') {
            this.internalCertificate = new acm.Certificate(this, 'KitchenSinkInternalCertificate', {
                domainName: `*.internal.${domainName}`,
                validation: acm.CertificateValidation.fromDns(this.hostedZone),
            });

            new CfnOutput(this, 'InternalCertificateArn', {
                value: this.internalCertificate.certificateArn,
                exportName: `${this.stackName}:InternalCertificateArn`,
            });
        }

        new CfnOutput(this, 'HostedZoneId', {
            value: this.hostedZone.hostedZoneId,
            exportName: `${this.stackName}:HostedZoneId`,
        });

        new CfnOutput(this, 'CertificateArn', {
            value: this.certificate.certificateArn,
            exportName: `${this.stackName}:CertificateArn`,
        });
    }
}
