import { CfnOutput, Stack, type StackProps, aws_certificatemanager as acm, aws_route53 as route53 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface DomainStackProps extends StackProps {
    readonly domainName: string;
}

export class DomainStack extends Stack {
    public readonly hostedZone: route53.IHostedZone;
    public readonly certificate: acm.Certificate;

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
