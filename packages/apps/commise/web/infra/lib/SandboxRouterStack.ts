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

import { AcceptedNagFindings, acceptNagFindings } from '@kitchensink/infra-security';

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
 * Singleton sandbox router: ONE CloudFront distribution whose viewer-request CloudFront Function
 * (runtime 2.0) host-swaps a request to that PR's app, reading the per-PR host + the Vercel bypass
 * secret from an attached KeyValueStore. Caching is disabled so the origin is re-selected per request.
 * Deployed ONCE (persistent), never via the per-PR teardown.
 *
 * It serves BOTH addressing modes during the ADR-0001 subdomain migration (GO, 2026-07-12): the apex
 * `sandbox.commise.app/pr-{N}` (legacy path routing) AND `pr-{N}.sandbox.commise.app` (subdomains) — the
 * CFF resolves the PR from the Host label first, then the path, against the same KVS. Both alias the same
 * distribution. Load-bearing invariants (do NOT regress without reading the ADR): stay a SINGLE
 * distribution (never one-per-PR), never switch to a prefix-stripping proxy, and keep the
 * ALL_VIEWER_EXCEPT_HOST_HEADER origin policy so the host-swapped origin drives Host/SNI.
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

        // Apex serves path-routed previews (`sandbox.commise.app/pr-{N}`); the wildcard serves the
        // subdomain form (`pr-{N}.sandbox.commise.app`) the migration moves to. BOTH hit this ONE
        // distribution — the CFF resolves the PR from the Host label first, then the path. The imported
        // cert already carries `*.sandbox.commise.app` (domain-stack SAN), so the wildcard alias is covered.
        const wildcardDomain = `*.${serviceDomain}`;

        const distribution = new cloudfront.Distribution(this, 'RouterDistribution', {
            comment: `sandbox PR router — path + subdomain (${serviceDomain})`,
            domainNames: [serviceDomain, wildcardDomain],
            certificate,
            defaultBehavior: {
                // Placeholder origin — the function overrides it per request via updateRequestOrigin.
                origin: new origins.HttpOrigin('placeholder.invalid'),
                // Caching disabled so every request re-selects the per-PR origin at the edge.
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                // EXCEPT_HOST_HEADER, not ALL_VIEWER: the function host-swaps the origin to a DIFFERENT
                // host (the per-PR Vercel deployment), so the origin's own domain must drive the Host
                // header + TLS SNI. Forwarding the viewer Host fails at Vercel whichever way you slice it
                // (measured 2026-07-28, ADR-0001): an unregistered host is `404 DEPLOYMENT_NOT_FOUND`, and
                // a registered host arriving under the deployment's SNI is `403 x-vercel-mitigated: deny`
                // (anti-domain-fronting). Cookies/Authorization (Clerk) are still forwarded; only Host is
                // dropped.
                //
                // ⚠️ This is why previews are unreachable in a browser: the app's Host is then the Vercel
                // deployment host, not the public origin, which breaks Clerk's handshake redirect and
                // Next's Server-Action same-origin check. The fix is NOT ALL_VIEWER — it is to stop
                // resolving preview hostnames through CloudFront at all. See ADR-0001 "Update (2026-07-28)".
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                functionAssociations: [
                    { function: routerFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
                ],
            },
        });

        // AwsSolutions-CFR1 + -CFR2 accepted: geo restriction is not a control this product needs (no
        // licensing/export constraint, and it would block legitimate viewers of a developer preview), and a
        // WAFv2 web ACL is not proportionate for a NON-PRODUCTION router that ADR-0001 records as being
        // retired for previews. Justification in @kitchensink/infra-security. CFR3 (access logging) is
        // deliberately left REPORTING — see ADR-0013's remaining-backlog list.
        acceptNagFindings(distribution, AcceptedNagFindings.CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE);

        new route53.ARecord(this, 'RouterAliasRecord', {
            zone: hostedZone,
            recordName: 'sandbox',
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
        });

        // Wildcard record: `pr-{N}.sandbox.commise.app` → the same router distribution. One record covers
        // every current and future PR, so a new preview needs no per-PR DNS write — the CFF selects the app
        // from the `pr-{N}` Host label via the existing KVS lookup.
        new route53.ARecord(this, 'RouterWildcardAliasRecord', {
            zone: hostedZone,
            recordName: '*.sandbox',
            target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
        });

        // CI reads this to write per-PR routes + seed the bypass key (avoids brittle name-matching).
        new CfnOutput(this, 'RouterKvsArn', {
            value: keyValueStore.keyValueStoreArn,
            exportName: `kitchensink-sandbox-router-${stage}:KvsArn`,
        });
    }
}
