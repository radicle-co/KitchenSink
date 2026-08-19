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

/** A synthesized resource, reduced to what these assertions read off it. */
interface SynthesizedResource {
    readonly Type?: string;
    readonly Properties?: Record<string, unknown>;
    readonly DependsOn?: string | string[];
}

/**
 * Every Lambda in the app's real template that is configured with a recipe logical database.
 *
 * ⚠️ BOTH env spellings, and the reason is the in-deploy schema barrier: the six workers carry
 * `RECIPE_DB_NAME` while the migration runner the barrier ships carries `DB_NAME` (the contract
 * `recipe-service`'s `lambdas/migrate/handler.ts` reads). Reading only one of them both UNDER-covers the
 * runner — where migrating a different database than the workers read is exactly #119 through a new door —
 * and crashes on CDK's own trigger provider, which has no environment at all.
 *
 * @param template - The synthesized template.
 * @returns Logical id → the database name that function is configured with.
 */
function databaseBoundFunctions(template: Record<string, unknown>): ReadonlyMap<string, string> {
    const found = new Map<string, string>();

    for (const [logicalId, resource] of Object.entries(resources(template)) as [string, SynthesizedResource][]) {
        if (resource.Type !== 'AWS::Lambda::Function') {
            continue;
        }

        const variables = (resource.Properties?.['Environment'] as { Variables?: Record<string, string> } | undefined)
            ?.Variables;
        const name = variables?.['RECIPE_DB_NAME'] ?? variables?.['DB_NAME'];

        if (typeof name === 'string') {
            found.set(logicalId, name);
        }
    }

    return found;
}

afterAll(() => {
    for (const dir of outDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('recipe-workers CDK app — deploy input contract', () => {
    it('derives the per-PR database from the BASE name CI passes (#119)', () => {
        const template = synthApp('pr-73');
        const dbNames = [...databaseBoundFunctions(template).values()];

        // All six, and the preview's OWN database — not the shared `kitchensink_recipes` the old fallback
        // produced. This is the value the live pr-73 Lambdas were measured to have wrong.
        //
        // ⚠️ SEVEN since the in-deploy schema barrier landed: the six workers plus the migration runner it
        // ships. The runner is now inside this guarantee rather than beside it, which matters more than the
        // count — a runner migrating the BASE database while the workers read the preview's own would
        // reproduce #119 exactly, and report success doing it.
        expect(dbNames).toHaveLength(7);
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

        // Six worker roles plus the migration runner's — all authenticating as `recipe_app` over RDS-IAM,
        // so all failing the same way if the separator regresses. Derived from the database-bound set rather
        // than restated as a literal, so the count cannot be "repaired" to whatever it happens to be.
        expect(grants).toHaveLength(databaseBoundFunctions(template).size);

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

    it('⛔ wires the schema barrier from the REAL composition root, over every database-bound Lambda', () => {
        // The seam the synth suite cannot see. `RecipeWorkersStack` takes the recipe-service migration
        // bundle as a PROP; only `infra/bin/app.ts` knows where that bundle lives on disk. If that path is
        // wrong — a package moved, a directory renamed — the stack silently falls back to the throwing
        // placeholder and NOTHING about the template shape changes, so every assertion in the synth suite
        // still passes while the deploy would fail at the trigger. This runs the real app and reads the real
        // template back, which is the only place that path is exercised.
        const template = synthApp('pr-73');
        const all = resources(template) as Record<string, SynthesizedResource>;
        const triggerIds = Object.entries(all)
            .filter(([, resource]) => resource.Type === 'Custom::Trigger')
            .map(([id]) => id);

        expect(triggerIds, 'the app must synthesize exactly one in-deploy migration trigger').toHaveLength(1);

        const trigger = all[triggerIds[0] as string] as SynthesizedResource;
        const handlerArn = JSON.stringify(trigger.Properties?.['HandlerArn']);
        const runnerId = Object.entries(all)
            .filter(([id, resource]) => resource.Type === 'AWS::Lambda::Version' && handlerArn.includes(id))
            .map(([, resource]) => (resource.Properties?.['FunctionName'] as { Ref?: string } | undefined)?.Ref)
            .find((id): id is string => id !== undefined);

        expect(runnerId, 'the trigger must invoke a runner defined in this stack').toBeDefined();

        // The composition root resolved a REAL bundle, not the placeholder: an asset, not inline code.
        const runner = all[runnerId as string] as SynthesizedResource;

        expect(
            (runner.Properties?.['Code'] as { ZipFile?: string; S3Key?: string } | undefined)?.S3Key,
            'infra/bin/app.ts must resolve the recipe-service migration bundle — an inline placeholder here ' +
                'means the path is wrong and every deploy would fail at the trigger',
        ).toBeDefined();

        const unordered = [...databaseBoundFunctions(template).keys()]
            .filter((id) => id !== runnerId)
            .filter((id) => {
                const value = all[id]?.DependsOn;
                const deps = value === undefined ? [] : Array.isArray(value) ? value : [value];

                return !deps.includes(triggerIds[0] as string);
            });

        expect(unordered, 'these Lambdas would be updated before the migration has run').toStrictEqual([]);
    });
});
