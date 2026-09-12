// @vitest-environment node
/**
 * The workers read the recipe database name; they do not derive it (#119).
 *
 * ## Why this lives here and not beside the schema stack
 *
 * The original guard synthesized the schema, service AND workers templates in ONE suite, inside
 * `recipe-service/infra`, and compared the names they resolved. That required this package's stack to be
 * imported across a CDK-package boundary — a cross-app dependency that forced its own build ordering, and one
 * that only ever proved the three DERIVATIONS agreed for the arguments the test happened to pass.
 *
 * `RecipeSchemaStack` now publishes the name it used to SSM and every consumer reads that parameter, so the
 * value has one producer and there is nothing to compare. What is still worth asserting is local: that THIS
 * stack reads the shared path rather than computing a name of its own — and that can be checked here, where
 * the stack lives.
 *
 * ⛔ The failure this protects is not hypothetical. On the live `pr-73` preview the API ran against
 * `kitchensink_recipes_pr_73` while all six worker Lambdas ran against `kitchensink_recipes`, the shared
 * sandbox database — with three destructive EventBridge-scheduled sweepers among them.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, type AppProps } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { recipeDatabaseNameParameter } from '@radicle-co/infra-shared/database';
import { afterAll, describe, expect, it } from 'vitest';

import { RecipeWorkersStack } from '../lib/RecipeWorkersStack.js';

/** Cloud-assembly directories this file synthesized into, removed in `afterAll`. */
const synthOutputs: string[] = [];

afterAll(() => {
    for (const directory of synthOutputs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A CDK `App` whose synth output lands somewhere this file will remove.
 *
 * ⛔ `new App()` with no `outdir` synthesizes into a `mkdtemp(cdk.out*)` under the OS temp directory and
 * NEVER removes it — one per App, ~0.9 MB once a `Template.fromStack` has synthesized into it. `outdir` is
 * an ordinary constructor prop, so the leak is ours to close. `CDK_OUTDIR` is NOT the fix: merely setting it
 * makes every App in the process auto-synth at `beforeExit`.
 *
 * @param props - Everything else the App needs; `outdir` is supplied here.
 * @returns The App.
 * @sideEffect Creates a directory under the OS temp directory and registers it for removal.
 */
function testApp(props: AppProps = {}): App {
    const outdir = mkdtempSync(join(tmpdir(), 'cdk-synth-'));

    synthOutputs.push(outdir);

    return new App({ ...props, outdir });
}

const DB_RESOURCE_ID = 'db-EXAMPLERESOURCEID12345';

const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                    {
                        subnetId: 'subnet-private-2',
                        availabilityZone: 'us-east-1b',
                        routeTableId: 'rtb-private-2',
                        cidr: '10.0.2.0/24',
                    },
                ],
            },
        ],
    },
};

describe('the recipe workers read the published database name', () => {
    it('resolves the shared SSM parameter for its stage, and derives no name of its own', () => {
        const stage = 'pr-91';
        const app = testApp({ context: VPC_LOOKUP_CONTEXT });
        const stack = new RecipeWorkersStack(app, 'Workers', {
            env: { account: '123456789012', region: 'us-east-1' },
            stackName: `kitchensink-recipe-workers-${stage}`,
            stage,
            baseStage: 'sandbox',
            alarmsEnabled: true,
            vpcId: 'vpc-12345678',
            lambdaSecurityGroupId: 'sg-12345678',
            dbEndpoint: 'db.example.internal',
            dbPort: 5432,
            dbInstanceIdentifier: DB_RESOURCE_ID,
            archiveBucketName: 'commise-versions-sandbox',
            mediaBucketName: 'commise-photos-sandbox',
            handleSyncTopicArn: 'arn:aws:sns:us-east-1:123456789012:kitchensink-handle-sync-sandbox',
        });
        const parameters = (
            Template.fromStack(stack).toJSON() as { Parameters?: Record<string, { Type?: string; Default?: string }> }
        ).Parameters;
        const paths = Object.values(parameters ?? {})
            .filter((parameter) => (parameter.Type ?? '').startsWith('AWS::SSM::Parameter::Value'))
            .map((parameter) => parameter.Default ?? '');

        expect(paths).toContain(recipeDatabaseNameParameter(stage));
    });
});
