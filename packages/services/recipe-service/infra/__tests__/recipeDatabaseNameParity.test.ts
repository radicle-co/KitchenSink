// @vitest-environment node
/**
 * Cross-stack parity: the recipe API, the recipe WORKERS and the recipe SCHEMA runner must all talk to the
 * same logical database (#119).
 *
 * ## What went wrong, and why this file is now short
 *
 * Nothing tied the three resolutions together, so they diverged silently and stayed diverged through a full
 * deploy. Measured on the live `pr-73` preview: the API task ran with `DB_NAME=kitchensink_recipes_pr_73`
 * while all six worker Lambdas ran with `RECIPE_DB_NAME=kitchensink_recipes` — the SHARED sandbox database.
 * Three of those workers are on EventBridge schedules and destructive (version-archive prune, GDPR erasure
 * sweep, erasure-orphan object deletion), so this was a cross-stage data-loss path that only a coincident
 * RDS-IAM auth failure (#121) prevented from firing.
 *
 * The original fix was to derive all three from ONE function and then SYNTHESISE all three templates here to
 * check they agreed. That worked, at a price: this package's test had to import `RecipeWorkersStack` from
 * another CDK package, which is a cross-app dependency that forced its own build ordering — and it only ever
 * made agreement *likely*, because a shared function still takes arguments and each stack passed its own.
 *
 * ⛔ Agreement is STRUCTURAL now. `RecipeSchemaStack` creates the database and publishes the name it used to
 * SSM; the service and the workers READ that parameter. There is one value, produced once, so there is
 * nothing left for a synthesis-wide comparison to disagree about. What remains worth checking is that each
 * stack points at the SAME parameter path — and since the path is derived from `stage` alone by one shared
 * function, that is a much smaller claim.
 *
 * ⚠️ The workers' half of this lives in `packages/services/recipe-workers/infra/__tests__/`, deliberately.
 * Reaching into another package's constructs to assert on them is the coupling this file used to carry.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, type AppProps } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { recipeDatabaseNameParameter } from '@radicle-co/infra-shared/database';
import { afterAll, describe, expect, it } from 'vitest';

import { RecipeSchemaStack } from '../lib/RecipeSchemaStack.js';
import { RecipeServiceStack } from '../lib/RecipeServiceStack.js';

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

/** Both stacks call `Vpc.fromLookup`; pre-seed the context so synth never reaches AWS. */
const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Public',
                type: 'Public',
                subnets: [
                    {
                        subnetId: 'subnet-public-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-public-1',
                        cidr: '10.0.0.0/24',
                    },
                ],
            },
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

const ENV = { account: '123456789012', region: 'us-east-1' };

/**
 * The SSM parameter paths a synthesized template resolves at deploy time.
 *
 * ⚠️ `valueForStringParameter` does NOT emit a `{{resolve:ssm:…}}` dynamic reference — it declares a
 * CloudFormation parameter of type `AWS::SSM::Parameter::Value<String>` whose `Default` is the path, which
 * CloudFormation resolves when the stack deploys. Looking for the dynamic-reference spelling found nothing
 * and made this assertion vacuous.
 *
 * @param template - A synthesized stack.
 * @returns Every SSM path the template reads. Pure over the template.
 */
function ssmParameterPaths(template: Template): readonly string[] {
    const parameters = (template.toJSON() as { Parameters?: Record<string, { Type?: string; Default?: string }> })
        .Parameters;

    return Object.values(parameters ?? {})
        .filter((parameter) => (parameter.Type ?? '').startsWith('AWS::SSM::Parameter::Value'))
        .map((parameter) => parameter.Default ?? '');
}

describe('the recipe database name has ONE producer and is read, never re-derived', () => {
    const stage = 'pr-91';

    it('the schema stack PUBLISHES the name it used', () => {
        const app = testApp({ context: { ...VPC_LOOKUP_CONTEXT } });
        const schema = new RecipeSchemaStack(app, 'Schema', {
            env: ENV,
            stage,
            baseStage: 'sandbox',
            vpcId: 'vpc-12345678',
        });

        Template.fromStack(schema).hasResourceProperties('AWS::SSM::Parameter', {
            Name: recipeDatabaseNameParameter(stage),
        });
    });

    it('the service stack READS that same parameter, and derives no name of its own', () => {
        const app = testApp({ context: { ...VPC_LOOKUP_CONTEXT } });
        const service = new RecipeServiceStack(app, 'Service', {
            env: ENV,
            stage,
            baseStage: 'sandbox',
            domainName: 'example.com',
            imageTag: 'test',
            desiredCount: 1,
            vpcId: 'vpc-12345678',
            cloudfrontUrl: 'https://cdn.example.com',
            foodServiceUrl: `https://food-${stage}.example.com`,
        });
        const template = Template.fromStack(service);

        expect(ssmParameterPaths(template)).toContain(recipeDatabaseNameParameter(stage));
    });

    it('⛔ is not vacuous: a DIFFERENT stage resolves a different parameter', () => {
        // Guards the failure that started this: a preview reading the base stage's database.
        expect(recipeDatabaseNameParameter('pr-91')).not.toBe(recipeDatabaseNameParameter('sandbox'));
    });
});
