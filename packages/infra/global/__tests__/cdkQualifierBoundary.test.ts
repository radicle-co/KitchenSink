/**
 * Guard: every IAM role a stage app synthesizes carries that stage's permissions boundary, and every asset goes
 * to that stage's bootstrap bucket (the bootstrap-qualifier ADR).
 *
 * | Invariant                                                                     | Test                                              |
 * | ----------------------------------------------------------------------------- | ------------------------------------------------- |
 * | Every role of the platform stacks has the boundary — including CDK-internal   | 'bounds every role …'                              |
 * | …custom-resource and log-retention roles nobody wrote by hand                   | 'bounds the roles CDK creates for itself'          |
 * | A prod stage gets the prod boundary and qualifier, never the nonprod ones       | 'keeps prod and nonprod on their own tier'         |
 * | The comparison can fail: without the helper no role is bounded                  | 'negative control …'                               |
 * | No stage app produces a docker image asset                                      | 'produces no docker image asset'                   |
 *
 * WHY a role guard on top of the execution policy. The execution policy only allows `iam:CreateRole` when the
 * request carries the boundary, so a role without one fails the deploy: loudly, at the worst moment. This asserts
 * at unit-test time that CDK stamps it on EVERY role, including the ones constructs create internally
 * (`Custom::S3AutoDeleteObjects` providers, log retention, the provider framework), which no stack author wrote.
 * `bootstrap/scripts/templateParity.ts` proves the same for every real app and stage.
 *
 * WHY real constructs here and not the bins: the bins need built Lambda bundles and a full environment, which is the
 * parity script's job. This tier uses the platform stacks that need neither.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import { kitchenSinkAppProps } from '@kitchensink/cdk-bootstrap/appProps';
import { boundaryPolicyName } from '@kitchensink/cdk-bootstrap/qualifiers';
import { describe, expect, it } from 'vitest';

import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { stubEdgeBundleDir, TEST_EDGE_AUTHORIZED_PARTIES, TEST_EDGE_JWT_KEY } from './edgeBundleFixture.js';
import { EdgeStack } from '../lib/platform/EdgeStack.js';
import { TEST_UPLOAD_ORIGINS } from './mediaDeliveryProps.js';
import { testApp } from './testApp.js';

process.env['CLERK_JWT_KEY'] = TEST_EDGE_JWT_KEY;
process.env['CLERK_AUTHORIZED_PARTIES'] = TEST_EDGE_AUTHORIZED_PARTIES;

const env = { account: '123456789012', region: 'us-east-1' };

interface Role {
    readonly stack: string;
    readonly id: string;
    readonly boundary: string | undefined;
}

interface Synthesis {
    readonly roles: readonly Role[];
    readonly assetBuckets: readonly string[];
    readonly dockerImages: number;
}

/** Renders a template value to text so an ARN built from `Fn::Join` and pseudo parameters can be searched. */
const text = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * Synthesizes the platform for one stage with the given App props, plus a stack of the constructs CDK itself
 * creates roles for.
 */
function synthesize(stage: string, withHelper: boolean): Synthesis {
    const app = testApp(withHelper ? kitchenSinkAppProps(stage) : {});

    new GlobalStack(app, `Global-${stage}`, {
        env,
        stackName: `kitchensink-global-${stage}`,
        stage,
        domainName: 'commise.app',
        alarmsEnabled: true,
        uploadOrigins: TEST_UPLOAD_ORIGINS,
    });

    if (stage === 'prod') {
        new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage,
            domainName: 'commise.app',
            verifierBundleDir: stubEdgeBundleDir(),
        });
    }

    // Roles no stack author wrote: the auto-delete provider, log retention and an asset-backed resource.
    const internals = new Stack(app, `Internals-${stage}`, { env, stackName: `kitchensink-internals-${stage}` });
    new s3.Bucket(internals, 'Auto', { autoDeleteObjects: true, removalPolicy: RemovalPolicy.DESTROY });
    new logs.LogRetention(internals, 'Retention', {
        logGroupName: '/kitchensink/test',
        retention: logs.RetentionDays.ONE_DAY,
    });
    new s3assets.Asset(internals, 'Asset', { path: new URL('./edgeBundleFixture.ts', import.meta.url).pathname });

    const assembly = app.synth();
    const roles: Role[] = [];
    const assetBuckets: string[] = [];
    let dockerImages = 0;

    for (const stack of assembly.stacks) {
        const resources = (
            stack.template as { Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }> }
        ).Resources;

        for (const [id, resource] of Object.entries(resources ?? {})) {
            if (resource.Type === 'AWS::IAM::Role') {
                const boundary = resource.Properties?.['PermissionsBoundary'];

                roles.push({
                    stack: stack.stackName,
                    id,
                    boundary: boundary === undefined ? undefined : text(boundary),
                });
            }
        }
    }

    for (const file of readdirSync(assembly.directory)) {
        if (!file.endsWith('.assets.json')) {
            continue;
        }

        const assets = JSON.parse(readFileSync(join(assembly.directory, file), 'utf8')) as {
            files?: Record<string, { destinations: Record<string, { bucketName: string }> }>;
            dockerImages?: Record<string, unknown>;
        };

        dockerImages += Object.keys(assets.dockerImages ?? {}).length;

        for (const entry of Object.values(assets.files ?? {})) {
            for (const destination of Object.values(entry.destinations)) {
                assetBuckets.push(destination.bucketName);
            }
        }
    }

    return { roles, assetBuckets, dockerImages };
}

const expectedBoundary = (qualifier: 'ksnonprod' | 'ksprod'): string => `:policy/${boundaryPolicyName(qualifier)}"`;

describe('every role a stage synthesizes carries its permissions boundary (the bootstrap-qualifier ADR)', () => {
    it.each([
        ['prod', 'ksprod'],
        ['sandbox', 'ksnonprod'],
        ['pr-1', 'ksnonprod'],
    ] as const)('bounds every role at stage %s with the %s boundary', (stage, qualifier) => {
        const { roles } = synthesize(stage, true);

        expect(roles.length).toBeGreaterThan(0);

        const unbounded = roles.filter(
            (role) => role.boundary === undefined || !role.boundary.includes(expectedBoundary(qualifier)),
        );

        expect(unbounded).toEqual([]);
    });

    it('bounds the roles CDK creates for itself, which no stack author wrote', () => {
        const { roles } = synthesize('sandbox', true);
        const internal = roles.filter((role) => role.stack === 'kitchensink-internals-sandbox');

        // The auto-delete provider and log retention each create a role in the stack. If CDK stopped creating them
        // this test would pass vacuously, so pin that they exist.
        expect(internal.length).toBeGreaterThanOrEqual(2);
        expect(internal.filter((role) => role.boundary === undefined)).toEqual([]);
    });

    it('keeps prod and nonprod on their own tier', () => {
        const prod = synthesize('prod', true).roles;
        const sandbox = synthesize('sandbox', true).roles;

        expect(prod.some((role) => role.boundary?.includes(boundaryPolicyName('ksnonprod')))).toBe(false);
        expect(sandbox.some((role) => role.boundary?.includes(boundaryPolicyName('ksprod')))).toBe(false);
    });

    it('negative control: without the helper no role is bounded, so the assertions above can fail', () => {
        const { roles } = synthesize('sandbox', false);

        expect(roles.length).toBeGreaterThan(0);
        expect(roles.every((role) => role.boundary === undefined)).toBe(true);
    });
});

describe('every asset goes to the stage qualifier bucket, and none is a docker image', () => {
    it.each([
        ['prod', 'ksprod'],
        ['pr-1', 'ksnonprod'],
    ] as const)('publishes stage %s assets to the cdk-%s-assets bucket', (stage, qualifier) => {
        const { assetBuckets } = synthesize(stage, true);

        expect(assetBuckets.length).toBeGreaterThan(0);
        expect(assetBuckets.every((bucket) => bucket.includes(`cdk-${qualifier}-assets-`))).toBe(true);
    });

    it('produces no docker image asset, so the CI roles never need an image-publishing role', () => {
        expect(synthesize('prod', true).dockerImages).toBe(0);
    });
});
