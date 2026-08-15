/**
 * Integration coverage for the recipe-workers CDK **app entrypoint** (`infra/bin/app.ts`) — #119 / #121.
 *
 * The synth tests in `infra/__tests__/` construct `RecipeWorkersStack` directly with hand-written props, so
 * they cannot see the seam both defects actually lived in: the translation from the environment variables
 * CI exports to the stack's props. #119 was exactly that translation — `RECIPE_DB_NAME` was read with a
 * `?? 'kitchensink_recipes'` fallback and CI never passed it, so six Lambdas were configured against the
 * SHARED database while the API used the preview's own, and no unit test could have noticed.
 *
 * So this spec runs the REAL app the way CI runs it: a child process, the same env keys the
 * `CDK Deploy — recipe workers` step exports, and the emitted CloudFormation template read back off disk.
 * It needs no AWS credentials and no LocalStack — `CDK_CONTEXT_JSON` pre-seeds the `Vpc.fromLookup` cache
 * so synth never calls AWS, and `CDK_OUTDIR` sends the template to a temp directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const VPC_ID = 'vpc-12345678';
const DB_RESOURCE_ID = 'db-EXAMPLERESOURCEID12345';

/**
 * The `Vpc.fromLookup` context-provider cache entry, pre-seeded so synth resolves the VPC locally. The key
 * shape is CDK's own; a mismatch surfaces as `StackAccountRegionNotSpecified`/a live lookup attempt, not as
 * a silent pass.
 */
const CDK_CONTEXT_JSON = JSON.stringify({
    [`vpc-provider:account=${ACCOUNT}:filter.vpc-id=${VPC_ID}:region=${REGION}:returnAsymmetricSubnets=true`]: {
        vpcId: VPC_ID,
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: ACCOUNT,
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: `${REGION}a`,
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                    {
                        subnetId: 'subnet-private-2',
                        availabilityZone: `${REGION}b`,
                        routeTableId: 'rtb-private-2',
                        cidr: '10.0.2.0/24',
                    },
                ],
            },
        ],
    },
});

/** Exactly the variables the `CDK Deploy — recipe workers` workflow step exports, with test values. */
function deployEnv(stage: string): Record<string, string> {
    return {
        STAGE: stage,
        DOMAIN_NAME: 'example.com',
        RECIPE_VPC_ID: VPC_ID,
        RECIPE_LAMBDA_SG_ID: 'sg-12345678',
        RECIPE_DB_ENDPOINT: 'db.example.internal',
        RECIPE_DB_PORT: '5432',
        RECIPE_DB_INSTANCE_ID: DB_RESOURCE_ID,
        RECIPE_DB_BASE_NAME: 'kitchensink_recipes',
        RECIPE_ARCHIVE_BUCKET: 'commise-versions-sandbox',
        RECIPE_MEDIA_BUCKET: 'commise-photos-sandbox',
        HANDLE_SYNC_TOPIC_ARN: `arn:aws:sns:${REGION}:${ACCOUNT}:kitchensink-handle-sync-sandbox`,
    };
}

const outDirs: string[] = [];

/**
 * Run the real CDK app and return the emitted template.
 *
 * @sideEffect Spawns `npx tsx infra/bin/app.ts` and writes a CloudFormation template to a temp directory.
 */
function synthApp(stage: string, overrides: Record<string, string | undefined> = {}): Record<string, unknown> {
    const outDir = mkdtempSync(join(tmpdir(), 'recipe-workers-synth-'));
    outDirs.push(outDir);

    const env: Record<string, string> = {
        // A deliberately MINIMAL environment: no ambient AWS credentials, so a regression that reintroduces
        // a live lookup fails here rather than quietly succeeding on a developer's machine.
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        CDK_CONTEXT_JSON,
        CDK_OUTDIR: outDir,
        AWS_ACCOUNT_ID: ACCOUNT,
        DEFAULT_AWS_REGION: REGION,
        ...deployEnv(stage),
    };

    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
            delete env[key];
        } else {
            env[key] = value;
        }
    }

    execFileSync('npx', ['tsx', 'infra/bin/app.ts'], { cwd: packageRoot, env, stdio: 'pipe' });

    return JSON.parse(readFileSync(join(outDir, `RecipeWorkers-${stage}.template.json`), 'utf8')) as Record<
        string,
        unknown
    >;
}

function resources(template: Record<string, unknown>): Record<string, { Type?: string; Properties?: never }> {
    return (template['Resources'] ?? {}) as Record<string, { Type?: string; Properties?: never }>;
}

afterAll(() => {
    for (const dir of outDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('recipe-workers CDK app — deploy input contract', () => {
    it('derives the per-PR database from the BASE name CI passes (#119)', () => {
        const template = synthApp('pr-73');
        const dbNames = Object.values(resources(template))
            .filter((resource) => resource.Type === 'AWS::Lambda::Function')
            .map(
                (resource) =>
                    (resource as unknown as { Properties: { Environment: { Variables: Record<string, string> } } })
                        .Properties.Environment.Variables['RECIPE_DB_NAME'],
            );

        // All six, and the preview's OWN database — not the shared `kitchensink_recipes` the old fallback
        // produced. This is the value the live pr-73 Lambdas were measured to have wrong.
        expect(dbNames).toHaveLength(6);
        expect(new Set(dbNames)).toEqual(new Set(['kitchensink_recipes_pr_73']));
    });

    it('emits a COLON-separated rds-db dbuser ARN keyed on the DbiResourceId (#121)', () => {
        const template = synthApp('pr-73');
        const grants: string[] = [];

        for (const resource of Object.values(resources(template))) {
            if (resource.Type !== 'AWS::IAM::Policy') {
                continue;
            }

            const statements = (
                resource as unknown as {
                    Properties: { PolicyDocument: { Statement: { Action?: unknown; Resource?: unknown }[] } };
                }
            ).Properties.PolicyDocument.Statement;

            for (const statement of statements) {
                if (statement.Action === 'rds-db:connect') {
                    grants.push(JSON.stringify(statement.Resource));
                }
            }
        }

        expect(grants).toHaveLength(6);

        for (const grant of grants) {
            // The colon after `dbuser` is the entire fix: the SLASH form (CDK's `formatArn` default) names
            // no real resource, so IAM denies and RDS reports `PAM authentication failed`.
            expect(grant).toContain(`:rds-db:${REGION}:${ACCOUNT}:dbuser:${DB_RESOURCE_ID}/recipe_app`);
            expect(grant).not.toContain('dbuser/');
        }
    });

    it('REFUSES to synth when the base database name is not supplied', () => {
        // The guarantee that #119 cannot silently recur: a deploy step that drops the variable now fails
        // loudly at synth instead of producing workers aimed at another stage's data.
        let message = '';

        try {
            synthApp('pr-73', { RECIPE_DB_BASE_NAME: undefined });
        } catch (err) {
            message = String((err as { stderr?: Buffer }).stderr ?? err);
        }

        expect(message).toContain('RECIPE_DB_BASE_NAME');
    });
});
