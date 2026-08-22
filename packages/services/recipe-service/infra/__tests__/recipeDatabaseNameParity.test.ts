/**
 * Cross-stack parity: the recipe API and the recipe WORKERS must talk to the same logical database (#119).
 *
 * **Why this file exists at all.** Nothing in the repository tied the two resolutions together, so they
 * diverged silently and stayed diverged through a full deploy. Measured on the live `pr-73` preview: the
 * API task ran with `DB_NAME=kitchensink_recipes_pr_73` while all six worker Lambdas ran with
 * `RECIPE_DB_NAME=kitchensink_recipes` — the SHARED sandbox database. Three of those workers are on
 * EventBridge schedules and are destructive (version-archive prune, GDPR erasure sweep, erasure-orphan
 * object deletion), so this was a cross-stage data-loss path that only a coincident RDS-IAM auth failure
 * (#121) prevented from firing.
 *
 * Both stacks now derive the name from ONE authority (`recipeDatabaseNameForStage` in
 * `@kitchensink/recipe-core`). Deriving from one function makes agreement *likely*; this test is what makes
 * it *checked* — it synthesizes BOTH CloudFormation templates for the same `(stage, baseStage)` and compares
 * the values that actually reach the task definition and the Lambda configurations. A future edit that
 * re-hardcodes either side, or feeds one of them the wrong stage pair, fails here.
 *
 * Requires `packages/services/recipe-workers/dist` (the esbuild bundle the workers stack ships via
 * `Code.fromAsset`). Turbo's `test` task depends on `^build`, so the dependency edge on
 * `@kitchensink/recipe-workers` guarantees it in CI and in a full `turbo run test`.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { BASE_RECIPE_DATABASE_NAME, recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';
import { RecipeWorkersStack } from '@kitchensink/recipe-workers/infra';

import { RecipeServiceStack } from '../lib/RecipeServiceStack.js';

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

function serviceTemplate(stage: string, baseStage: string): Template {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });

    return Template.fromStack(
        new RecipeServiceStack(app, `RecipeService-${stage}`, {
            env: ENV,
            stage,
            baseStage,
            domainName: 'example.com',
            imageTag: 'test',
            desiredCount: 1,
            vpcId: 'vpc-12345678',
            cloudfrontUrl: 'https://cdn.example.com',
            foodServiceUrl: `https://food-${stage}.example.com`,
        }),
    );
}

function workersTemplate(stage: string, baseStage: string): Template {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });

    return Template.fromStack(
        new RecipeWorkersStack(app, `RecipeWorkers-${stage}`, {
            env: ENV,
            stackName: `kitchensink-recipe-workers-${stage}`,
            stage,
            baseStage,
            vpcId: 'vpc-12345678',
            lambdaSecurityGroupId: 'sg-12345678',
            dbEndpoint: 'db.example.internal',
            dbPort: 5432,
            // What CI passes: the resolved value of `kitchensink-data-{baseStage}:RecipeDatabaseName`. The
            // SERVICE stack consumes the very same export, as an unresolved `Fn.importValue` token.
            dbBaseName: BASE_RECIPE_DATABASE_NAME,
            dbUser: 'recipe_app',
            dbInstanceIdentifier: 'db-EXAMPLERESOURCEID12345',
            archiveBucketName: 'commise-versions-sandbox',
            mediaBucketName: 'commise-photos-sandbox',
            handleSyncTopicArn: 'arn:aws:sns:us-east-1:123456789012:kitchensink-handle-sync-sandbox',
        }),
    );
}

/** The `DB_NAME` the recipe API container is configured with. */
function apiDatabaseName(template: Template): unknown {
    const taskDefinitions = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
    const containers = taskDefinitions.flatMap(
        (definition) => (definition.Properties?.ContainerDefinitions ?? []) as { Environment?: unknown[] }[],
    );
    const entries = containers.flatMap(
        (container) => (container.Environment ?? []) as { Name?: string; Value?: unknown }[],
    );
    const dbNames = entries.filter((entry) => entry.Name === 'DB_NAME').map((entry) => entry.Value);

    expect(dbNames, 'exactly one container must declare DB_NAME').toHaveLength(1);

    return dbNames[0];
}

/** Every distinct `DB_NAME` / `RECIPE_DB_NAME` across a template's Lambda functions. */
function lambdaDatabaseNames(template: Template, key: 'DB_NAME' | 'RECIPE_DB_NAME'): unknown[] {
    return Object.values(template.findResources('AWS::Lambda::Function'))
        .map((fn) => (fn.Properties?.Environment?.Variables ?? {})[key])
        .filter((value) => value !== undefined);
}

describe('recipe database-name parity — API vs workers', () => {
    it('agrees on the derived per-PR database for a preview stage', () => {
        const expected = recipeDatabaseNameForStage('pr-73', 'sandbox', BASE_RECIPE_DATABASE_NAME);
        const service = serviceTemplate('pr-73', 'sandbox');
        const workers = workersTemplate('pr-73', 'sandbox');

        // The assertion the defect needed: the SAME literal on both sides of the deploy, derived
        // independently by two CDK apps that CI runs as two separate `cdk deploy` invocations.
        const apiName = apiDatabaseName(service);
        const workerNames = lambdaDatabaseNames(workers, 'RECIPE_DB_NAME');

        // SEVEN workers since U11's verification gate landed (the migration runner reads DB_NAME, not
        // RECIPE_DB_NAME, so it is not in this set). The count is pinned rather than derived because a worker
        // that quietly LOSES its RECIPE_DB_NAME would otherwise leave this comparison silently — and #119 was
        // exactly a worker addressing a different database than the API believed it was.
        expect(workerNames).toHaveLength(7);
        expect(new Set(workerNames)).toEqual(new Set([apiName]));

        // And that the shared value is the ADR-0006 suffix form, not merely "equal to each other" — two
        // sides agreeing on the WRONG name would otherwise satisfy the comparison above.
        expect(apiName).toBe(expected);
        expect(apiName).toBe('kitchensink_recipes_pr_73');

        // The in-VPC migration runner lives in the SERVICE stack and creates the database the workers then
        // query, so it is part of the same agreement — not a third opinion.
        expect(new Set(lambdaDatabaseNames(service, 'DB_NAME'))).toEqual(new Set([apiName]));
    });

    it('agrees across independent preview stages, without cross-contamination', () => {
        // `pr-5999` is the LARGEST PR number the shared-ALB per-PR band admits (ADR-0003 —
        // `@kitchensink/infra-alb`'s `PER_PR_BAND_WIDTH`), so it doubles as this suite's boundary probe. It
        // was `pr-9999`, which now throws at synth: that is the priority ceiling doing its job, not a
        // regression here — do not raise it back without widening the band.
        for (const stage of ['pr-1', 'pr-15', 'pr-5999']) {
            const apiName = apiDatabaseName(serviceTemplate(stage, 'sandbox'));
            const workerNames = new Set(lambdaDatabaseNames(workersTemplate(stage, 'sandbox'), 'RECIPE_DB_NAME'));

            expect(workerNames).toEqual(new Set([apiName]));
            // pr-1 must never resolve to pr-15's database (the delimiter-awareness that ADR-0005's cleanup
            // matcher also depends on).
            expect(apiName).toBe(`kitchensink_recipes_${stage.replace('-', '_')}`);
        }
    });

    it('wires both stacks to the SAME platform export on a base stage', () => {
        // On a base stage the two resolutions cannot be compared as literals, by design: the service stack
        // emits the unresolved `Fn.importValue` token while CI resolves that export to a literal and hands
        // it to the workers app. So the parity claim here is "same export", and this pins it — if the export
        // name ever changes on one side only, prod's API and prod's workers split.
        const service = serviceTemplate('prod', 'prod');
        const workers = workersTemplate('prod', 'prod');

        expect(apiDatabaseName(service)).toEqual({ 'Fn::ImportValue': 'kitchensink-data-prod:RecipeDatabaseName' });
        expect(new Set(lambdaDatabaseNames(workers, 'RECIPE_DB_NAME'))).toEqual(new Set([BASE_RECIPE_DATABASE_NAME]));
    });
});
