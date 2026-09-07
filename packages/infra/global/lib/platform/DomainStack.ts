import {
    CfnOutput,
    Stack,
    type StackProps,
    aws_certificatemanager as acm,
    aws_route53 as route53,
    aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import { EDGE_ORIGIN_HEADER_VALUE_LENGTH, edgeOriginHeaderFor } from '@kitchensink/infra-alb';
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

        // ADR-0020 trap 5 / plan U17 — the shared secret that proves an origin request came from OUR
        // CloudFront. The prefix-list restriction on prod's ALB authorizes CloudFront, not ours: the origin
        // hostnames are published in the PUBLIC zone, so anyone may point their own distribution at one.
        //
        // ⛔ No `exportName`, deliberately. The three service stacks and EdgeStack read this back by NAME,
        // through a `{{resolve:secretsmanager:…}}` dynamic reference resolved at deploy time — not by a
        // CloudFormation export. An export would put this stack in ADR-0002's export-in-use position with
        // four importers, for a value that never appears in a template.
        //
        // ⛔ `excludePunctuation` is load-bearing, not hygiene: ALB reads `*` and `?` in a listener-rule
        // condition value as WILDCARDS, so a generated value containing either turns the exact-match
        // condition into a pattern admitting values nobody generated — with nothing about the deploy
        // looking wrong. What remains is 62 alphanumeric characters, and 64 of them is ~381 bits, inside
        // ALB's 128-character cap on a condition value.
        const originHeader = edgeOriginHeaderFor(props.stage);

        if (originHeader !== undefined) {
            // ⚠️ An EXPLICIT name is required (the reference is keyed on it) and that makes this secret
            // effectively permanent: Secrets Manager schedules a deletion with a recovery window rather than
            // deleting immediately, and re-creating the same name inside that window fails with "a secret
            // with this name is already scheduled for deletion". Rotating the VALUE is the supported
            // operation; see ADR-0020's rotation runbook for the four-step, two-VALUE sequence (two values on
            // one condition, because ALB ANDs separate conditions and ORs values within one).
            new secretsmanager.Secret(this, 'EdgeOriginHeaderSecret', {
                secretName: originHeader.secretName,
                description: `Shared secret proving an origin request came from the ${props.stage} CloudFront edge (ADR-0020)`,
                generateSecretString: {
                    // JSON, so the dynamic reference can name a field — and so a rotation can add a second
                    // field to this same secret rather than needing a second one.
                    secretStringTemplate: JSON.stringify({}),
                    generateStringKey: 'value',
                    passwordLength: EDGE_ORIGIN_HEADER_VALUE_LENGTH,
                    excludePunctuation: true,
                },
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
