import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CfnOutput,
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
            Fn.importValue(`kitchensink-domain-${stage}:CertificateArn`),
        );

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
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
                // EXCEPT_HOST_HEADER, not ALL_VIEWER: the function host-swaps the origin to a DIFFERENT
                // host (the per-PR Vercel deployment), so the origin's own domain must drive the Host
                // header + TLS SNI. ALL_VIEWER forwards the viewer Host (`sandbox.commise.app`), which
                // CloudFront then uses as SNI — it won't match the origin's cert (`*.vercel.app`), so the
                // origin TLS handshake fails and EVERY routed request 502s. Cookies/Authorization (Clerk)
                // are still forwarded; only Host is dropped. See ADR-0001.
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
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

        // CI reads this to write per-PR routes + seed the bypass key (avoids brittle name-matching).
        new CfnOutput(this, 'RouterKvsArn', {
            value: keyValueStore.keyValueStoreArn,
            exportName: `kitchensink-sandbox-router-${stage}:KvsArn`,
        });
    }
}
