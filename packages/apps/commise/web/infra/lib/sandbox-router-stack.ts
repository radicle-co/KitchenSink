import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    Fn,
    Stack,
    type StackProps,
    aws_certificatemanager as acm,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_route53 as route53,
    aws_route53_targets as route53Targets,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface SandboxRouterStackProps extends StackProps {
    /** Deploy stage — `sandbox` (the shared sandbox env owns this singleton). */
    readonly stage: string;
    /** Apex domain, e.g. `commise.app`. The router serves `sandbox.<domainName>`. */
    readonly domainName: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// esbuild bundles router/src/router.cff.js (with resolve.ts inlined, `cloudfront` external) here.
const FUNCTION_BUNDLE = path.join(here, '../../router/dist/router.cff.js');

/**
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0001-sandbox-front-end-addressing.md
 *
 * Singleton single-origin sandbox router: one CloudFront distribution at `sandbox.commise.app` whose
 * viewer-request CloudFront Function (runtime 2.0) host-swaps `/pr-{N}/*` to that PR's app, reading
 * the per-PR host + the Vercel bypass secret from an attached KeyValueStore. Caching is disabled so
 * the origin is re-selected per request. Deployed ONCE (persistent), never via the per-PR teardown.
 * Do not move to per-PR subdomains or a prefix-stripping proxy without reading the ADR.
 */
export class SandboxRouterStack extends Stack {
    public constructor(scope: Construct, id: string, props: SandboxRouterStackProps) {
        super(scope, id, props);

        const { stage, domainName } = props;
        const serviceDomain = `sandbox.${domainName}`;

        // CloudFront requires a us-east-1 cert; the shared wildcard cert is already there (DEFAULT_AWS
        // _REGION=us-east-1). Import it + the hosted zone from the domain stack's exports.
        const certificate = acm.Certificate.fromCertificateArn(
            this,
            'ImportedCertificate',
            Fn.importValue(`kitchensink-identity-domain-${stage}:CertificateArn`),
        );

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-identity-domain-${stage}:HostedZoneId`),
            zoneName: domainName,
        });

        const keyValueStore = new cloudfront.KeyValueStore(this, 'RouterKeyValueStore', {
            keyValueStoreName: `sandbox-pr-router-${stage}`,
        });

        const routerFunction = new cloudfront.Function(this, 'RouterFunction', {
            runtime: cloudfront.FunctionRuntime.JS_2_0,
            code: cloudfront.FunctionCode.fromInline(readFileSync(FUNCTION_BUNDLE, 'utf-8')),
            keyValueStore,
        });

        const distribution = new cloudfront.Distribution(this, 'RouterDistribution', {
            comment: `sandbox PR path router (${serviceDomain})`,
            domainNames: [serviceDomain],
            certificate,
            defaultBehavior: {
                // Placeholder origin — the function overrides it per request via updateRequestOrigin.
                origin: new origins.HttpOrigin('placeholder.invalid'),
                // Caching disabled so every request re-selects the per-PR origin at the edge.
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                functionAssociations: [
                    { function: routerFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
                ],
            },
        });

        new route53.ARecord(this, 'RouterAliasRecord', {
            zone: hostedZone,
            recordName: 'sandbox',
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
        });
    }
}
