import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SandboxRouterStack } from '../lib/SandboxRouterStack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundleDir = path.join(here, '../../router/dist');
const bundlePath = path.join(bundleDir, 'router.cff.js');

let template: Template;

beforeAll(() => {
    // The stack inlines the esbuild-bundled function; stub it so synth doesn't require a real bundle.
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(bundlePath, 'async function handler(event) { return event.request; }');

    const app = new App();
    const stack = new SandboxRouterStack(app, 'TestRouter', {
        env: { account: '123456789012', region: 'us-east-1' },
        stage: 'sandbox',
        domainName: 'commise.app',
    });

    template = Template.fromStack(stack);
});

afterAll(() => {
    rmSync(bundleDir, { recursive: true, force: true });
});

describe('SandboxRouterStack', () => {
    it('creates a CloudFront KeyValueStore', () => {
        template.resourceCountIs('AWS::CloudFront::KeyValueStore', 1);
    });

    it('creates a CloudFront Function on the JS 2.0 runtime', () => {
        template.hasResourceProperties('AWS::CloudFront::Function', {
            FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
        });
    });

    it('serves sandbox.commise.app with caching disabled and a viewer-request function', () => {
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const config = Object.values(dists)[0]!.Properties.DistributionConfig;

        expect(config.Aliases).toContain('sandbox.commise.app');
        // CACHING_DISABLED managed policy id.
        expect(config.DefaultCacheBehavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
        expect(config.DefaultCacheBehavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    });

    it('creates a Route53 alias record for the sandbox subdomain', () => {
        template.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'sandbox.commise.app.',
        });
    });

    // ── ADR-0001 load-bearing invariants (path-based routing, singleton router) ──
    // Each assertion below must FAIL if the design regresses: a second distribution appears
    // (per-PR subdomains), the Function or KVS is dropped, the runtime downgrades, the origin
    // stops dropping the Host header, or the CI-consumed output disappears.

    it('provisions EXACTLY ONE CloudFront distribution — the singleton router, never one-per-PR', () => {
        // The whole ADR-0001 point: all previews share one origin (sandbox.commise.app). A second
        // distribution here means someone reintroduced per-PR fronting → Clerk azp 401s every preview.
        template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    });

    it('provisions EXACTLY ONE CloudFront Function and ONE KeyValueStore (the edge router + its store)', () => {
        template.resourceCountIs('AWS::CloudFront::Function', 1);
        template.resourceCountIs('AWS::CloudFront::KeyValueStore', 1);
    });

    it('wires the JS-2.0 Function to the KeyValueStore (per-PR host + Vercel-bypass edge lookups)', () => {
        // The function reads the per-PR origin host and the `vercel-bypass` secret from the KVS; without
        // the association the edge `kvs.get(...)` calls fail and every route 404s/503s. Reference the KVS
        // by its synthesized logical id so the assertion tracks the real store, not a literal ARN.
        const kvsId = Object.keys(template.findResources('AWS::CloudFront::KeyValueStore'))[0]!;

        template.hasResourceProperties('AWS::CloudFront::Function', {
            FunctionConfig: {
                Runtime: 'cloudfront-js-2.0',
                KeyValueStoreAssociations: [{ KeyValueStoreARN: { 'Fn::GetAtt': [kvsId, 'Arn'] } }],
            },
        });
    });

    it('binds the singleton distribution to that Function as its viewer-request hook', () => {
        // Ties the distribution to THE router function (not some other/stray function) at viewer-request —
        // the only phase where updateRequestOrigin can host-swap. Fails if the association is dropped or
        // moved to another event type.
        const fnId = Object.keys(template.findResources('AWS::CloudFront::Function'))[0]!;

        template.hasResourceProperties('AWS::CloudFront::Distribution', {
            DistributionConfig: Match.objectLike({
                DefaultCacheBehavior: Match.objectLike({
                    FunctionAssociations: [
                        { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [fnId, 'FunctionARN'] } },
                    ],
                }),
            }),
        });
    });

    it('forwards ALL_VIEWER_EXCEPT_HOST_HEADER so the host-swapped origin drives Host/SNI (not ALL_VIEWER)', () => {
        // ADR-0001: the function swaps the origin to a DIFFERENT host (the per-PR Vercel deployment), so the
        // origin's own domain must set the Host header + TLS SNI. ALL_VIEWER would forward the viewer Host
        // (sandbox.commise.app) as SNI → origin cert mismatch → every routed request 502s. This pins the
        // managed AllViewerExceptHostHeader policy id; a swap back to ALL_VIEWER changes it and fails here.
        const dists = template.findResources('AWS::CloudFront::Distribution');
        const behavior = Object.values(dists)[0]!.Properties.DistributionConfig.DefaultCacheBehavior;

        expect(behavior.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
    });

    it('exports the KVS ARN as the RouterKvsArn output the CI route-registration pipeline reads', () => {
        // sandbox-router-deploy.yml / sandbox-web-preview.yml query Outputs[?OutputKey=='RouterKvsArn'] to
        // seed per-PR routes + the bypass key. The output key AND the cross-stack export name are both a
        // consumed contract — renaming/removing either silently breaks preview route registration.
        const kvsId = Object.keys(template.findResources('AWS::CloudFront::KeyValueStore'))[0]!;

        template.hasOutput('RouterKvsArn', {
            Value: { 'Fn::GetAtt': [kvsId, 'Arn'] },
            Export: { Name: 'kitchensink-sandbox-router-sandbox:KvsArn' },
        });
    });
});
