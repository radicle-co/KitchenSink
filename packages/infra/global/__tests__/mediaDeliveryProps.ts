/**
 * @module __tests__/mediaDeliveryProps — the media-delivery inputs `DataStack` requires, for suites that build one.
 *
 * `DataStack` takes the apex certificate, the hosted zone and the upload origins as REQUIRED props (ADR-0064): a
 * default would let a stack synthesize with no CDN and no bucket CORS, which is the defect this exists to close.
 * Suites that only care about the database therefore need *some* valid value; this is the one place that supplies it.
 *
 * The certificate and the zone are imported by literal identifiers, so they live in their own stack and add no
 * cross-stack reference to the stack under test.
 *
 * @pattern Factory Method — one construction point for the props, so a new required prop is one edit, not ten
 */
import { Stack, aws_certificatemanager as acm, aws_route53 as route53 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DataStackProps } from '../lib/platform/DataStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

let sequence = 0;

/** The origins a test synth admits to the media bucket's CORS rule. */
export const TEST_UPLOAD_ORIGINS: readonly string[] = ['https://commise.app'];

/**
 * The media-delivery props for a `DataStack`.
 *
 * @param scope - The app the `DataStack` is built in.
 * @param overrides - Props to replace, e.g. an empty `uploadOrigins` for the refusal test.
 * @returns The props to spread into `new DataStack(...)`. Pure apart from the fixture stack it adds to `scope`.
 */
export function mediaDeliveryProps(
    scope: Construct,
    overrides: Partial<Pick<DataStackProps, 'domainName' | 'uploadOrigins'>> = {},
): Pick<DataStackProps, 'certificate' | 'domainName' | 'hostedZone' | 'uploadOrigins'> {
    sequence += 1;

    const fixture = new Stack(scope, `MediaFixture${sequence}`, { env });
    const domainName = overrides.domainName ?? 'commise.app';

    return {
        certificate: acm.Certificate.fromCertificateArn(
            fixture,
            'Certificate',
            'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000',
        ),
        domainName,
        hostedZone: route53.HostedZone.fromHostedZoneAttributes(fixture, 'Zone', {
            hostedZoneId: 'Z00000000000000000000',
            zoneName: domainName,
        }),
        uploadOrigins: overrides.uploadOrigins ?? TEST_UPLOAD_ORIGINS,
    };
}
