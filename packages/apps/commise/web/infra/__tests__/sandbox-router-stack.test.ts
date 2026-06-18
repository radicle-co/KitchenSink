import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SandboxRouterStack } from '../lib/sandbox-router-stack.js';

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
});
