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
 *
 * ⚠️ THE #119 SEAM MOVED, AND THIS SUITE WAS REWRITTEN FOR IT (2026-09-11). `498c6be7` stopped the workers
 * deriving their database name from an env var: `RecipeSchemaStack` creates the database and publishes the
 * name it used to SSM, and every DB-bound Lambda here resolves `/kitchensink/{stage}/recipe/database-name`
 * at DEPLOY time. `RECIPE_DB_BASE_NAME` became dead. This suite could not run in CI then (the job never
 * installed `infra/`, so `tsx` was ENOENT) and nothing else noticed, so three of its tests went on asserting
 * the old contract — a literal `kitchensink_recipes_pr_73`, and a refusal to synth without the dead variable.
 * They now assert the new one: the parameter is THIS stage's, it is a strict SSM type (so a missing schema
 * stack fails the deploy rather than falling back), and the stage flows from `STAGE` rather than a constant.
 * What a synth can no longer see is the concrete name — that trade is `498c6be7`'s, stated there.
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

    // ⛔ THE INFRA DIRECTORY'S OWN `tsx`, by absolute path — never bare `npx tsx`. The CDK app lives
    // OUTSIDE the npm workspace with its own `node_modules`, so `tsx` is not on the workspace's `.bin`
    // path at all: `npx` then either resolves nothing or reaches for the registry, and the synth produces
    // no template while the command still exits 0. That is exactly how this read as "expected [] to have
    // a length of 10" rather than as a missing binary.
    execFileSync(join(packageRoot, 'infra/node_modules/.bin/tsx'), ['infra/bin/app.ts'], {
        cwd: packageRoot,
        env,
        stdio: 'pipe',
    });

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

/** The CloudFormation parameter type CDK emits for `ssm.StringParameter.valueForStringParameter`. */
const SSM_STRING_PARAMETER = 'AWS::SSM::Parameter::Value<String>';

/** A template parameter, reduced to what the database-name resolution reads. */
interface TemplateParameter {
    readonly Type?: string;
    readonly Default?: string;
}

/**
 * Every Lambda in the app's real template that is configured with a recipe logical database, with WHERE its
 * database name comes from.
 *
 * The value is a tagged string so a regression cannot hide in the type: `ssm:<path>` when the variable is a
 * `Ref` to a strict SSM parameter (the current contract), `literal:<name>` when it is a synth-time string
 * (the pre-`498c6be7` shape, and the #119 failure mode), and `other:<json>` for anything else. The earlier
 * version kept only string values, so the moment the source became a `Ref` every function silently dropped
 * out of the population — which is how the #121 ARN test came to compare 9 grants against 0 roles.
 *
 * ⚠️ BOTH env spellings are still read (`RECIPE_DB_NAME` and the migration runner's `DB_NAME`): the runner
 * left for `kitchensink-recipe-schema-{stage}` (ADR-0035), and reading `DB_NAME` too is what lets the
 * no-runner test below keep meaning something if one comes back.
 *
 * @param template - The synthesized template.
 * @returns Logical id → the tagged source of that function's database name.
 */
function databaseBoundFunctions(template: Record<string, unknown>): ReadonlyMap<string, string> {
    const found = new Map<string, string>();
    const parameters = (template['Parameters'] ?? {}) as Record<string, TemplateParameter>;

    for (const [logicalId, resource] of Object.entries(resources(template)) as [string, SynthesizedResource][]) {
        if (resource.Type !== 'AWS::Lambda::Function') {
            continue;
        }

        const variables = (resource.Properties?.['Environment'] as { Variables?: Record<string, unknown> } | undefined)
            ?.Variables;
        const name = variables?.['RECIPE_DB_NAME'] ?? variables?.['DB_NAME'];

        if (name === undefined) {
            continue;
        }

        if (typeof name === 'string') {
            found.set(logicalId, `literal:${name}`);
            continue;
        }

        const ref = (name as { Ref?: unknown }).Ref;
        const parameter = typeof ref === 'string' ? parameters[ref] : undefined;

        found.set(
            logicalId,
            parameter?.Type === SSM_STRING_PARAMETER && typeof parameter.Default === 'string'
                ? `ssm:${parameter.Default}`
                : `other:${JSON.stringify(name)}`,
        );
    }

    return found;
}

afterAll(() => {
    for (const dir of outDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('recipe-workers CDK app — deploy input contract', () => {
    it("points every DB-bound Lambda at THIS preview's published database name (#119)", () => {
        const template = synthApp('pr-73');
        const dbNames = [...databaseBoundFunctions(template).values()];

        // Every one, and the preview's OWN parameter — not `/kitchensink/sandbox/…`, which names the shared
        // base database. The base stage's name is exactly what the live pr-73 Lambdas were measured to have
        // (#119); the parameter is published by `RecipeSchemaStack`, the stack that CREATES the database, so
        // it cannot disagree with what exists.
        //
        // ⚠️ SEVEN since the in-deploy schema barrier landed: the six workers plus the migration runner it
        // ships. The runner is now inside this guarantee rather than beside it, which matters more than the
        // count — a runner migrating the BASE database while the workers read the preview's own would
        // reproduce #119 exactly, and report success doing it.
        // Seven workers plus the in-deploy migration runner — U11's verification gate is the seventh, and it
        // matters here specifically because it WRITES the spend counter: a gate pointed at the shared base
        // database would enforce ONE monthly ceiling across every open preview and deny them all once any
        // single preview exhausted it.
        //
        // TEN since the band-authority drain (plan U3, `BandDrainFunction`) and the parse leg (plan U8,
        // `RecipeParseLineFunction`) landed — both write this same preview database (band epochs / the
        // parse cache and job aggregates), so both are inside the #119 guarantee for the same reason.
        // The analytics retention sweeper (analytics plan U6) is the eleventh: it deletes this
        // preview's own aged analytics_events, so a base-database sweeper would age out another
        // stage's rows on schedule.
        //
        // ⚠️ TEN, DOWN FROM ELEVEN (ADR-0035): the migration runner this count included moved to
        // `kitchensink-recipe-schema-{stage}`, its own stack, deployed and migrated ahead of this app. The
        // #119 guarantee did not weaken — it got STRONGER, because one runner ahead of everything covers
        // consumers in BOTH CDK apps, which an in-stack trigger never could. That the runner resolves the
        // same name is asserted across all three templates by recipe-service's
        // `recipeDatabaseNameParity.test.ts`.
        expect(dbNames).toHaveLength(10);
        expect(new Set(dbNames)).toEqual(new Set(['ssm:/kitchensink/pr-73/recipe/database-name']));
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

        // One grant per distinct ROLE, not per function — all authenticating as `recipe_app` over
        // RDS-IAM, so all failing the same way if the separator regresses. Derived from the database-bound
        // set rather than restated as a literal, so the count cannot be "repaired" to whatever it happens
        // to be. ⚠️ Functions can SHARE a role (plan U8: `RecipeParseLineFunction` reuses the verification
        // role, ADR-0024 §4b's single Bedrock grantee), so the function count over-counts grants; the role
        // set is the authorization surface this test guards.
        const roleIds = new Set<string>();

        for (const logicalId of databaseBoundFunctions(template).keys()) {
            const fn = resources(template)[logicalId] as unknown as {
                Properties?: { Role?: { 'Fn::GetAtt'?: [string, string] } };
            };
            const roleRef = fn.Properties?.Role?.['Fn::GetAtt']?.[0];

            expect(roleRef).toBeDefined();

            if (roleRef !== undefined) {
                roleIds.add(roleRef);
            }
        }

        expect(grants).toHaveLength(roleIds.size);
        expect(roleIds.size).toBeGreaterThanOrEqual(9);

        for (const grant of grants) {
            // The colon after `dbuser` is the entire fix: the SLASH form (CDK's `formatArn` default) names
            // no real resource, so IAM denies and RDS reports `PAM authentication failed`.
            expect(grant).toContain(`:rds-db:${REGION}:${ACCOUNT}:dbuser:${DB_RESOURCE_ID}/recipe_app`);
            expect(grant).not.toContain('dbuser/');
        }
    });

    it('resolves the name at DEPLOY time through a strict SSM parameter keyed on STAGE — no fallback', () => {
        // ⚠️ REWRITTEN, not relaxed. This used to assert a refusal to synth without `RECIPE_DB_BASE_NAME`:
        // the guarantee that #119 could not silently recur, because a deploy step that dropped the variable
        // failed loudly instead of aiming workers at another stage's data. `498c6be7` made that variable
        // dead, so the guarantee now has two halves, both asserted here:
        //
        //   1. LOUD ON ABSENCE. Every source is a `Ref` to an `AWS::SSM::Parameter::Value<String>` parameter.
        //      CloudFormation resolves that type at deploy and fails the stack if the parameter does not
        //      exist — so a preview whose schema stack never ran cannot deploy workers at all, where a
        //      literal or a defaulted `String` parameter would deploy them against whatever it held.
        //   2. KEYED ON THE STAGE IT WAS GIVEN. A different stage yields a different path. A constant (or the
        //      BASE stage, which is #119 exactly) would give both stages the same one — which the
        //      `pr-73`-only assertion above cannot distinguish from a hard-coded `pr-73`.
        const sources = [...databaseBoundFunctions(synthApp('pr-74')).values()];

        expect(sources.length, 'no DB-bound functions found, so nothing below is checked').toBeGreaterThan(0);
        expect(sources.filter((source) => !source.startsWith('ssm:'))).toStrictEqual([]);
        expect(new Set(sources)).toEqual(new Set(['ssm:/kitchensink/pr-74/recipe/database-name']));
    });

    it('⛔ resolves NO migration bundle from the composition root — the schema left this app', () => {
        // ⚠️ THE SUBJECT MOVED, so this assertion inverted rather than being deleted.
        //
        // It used to prove a seam the synth suite could not see: `RecipeWorkersStack` took recipe-service's
        // migration bundle as a PROP, and only `infra/bin/app.ts` knew where that bundle lived on disk. A
        // wrong path there made the stack fall back to a throwing placeholder with NOTHING about the
        // template changing, so every synth assertion still passed while the deploy died at the trigger.
        //
        // ADR-0035 removed the prop and the trigger with it: the schema belongs to
        // `kitchensink-recipe-schema-{stage}`, deployed and migrated ahead of this app. The cross-package
        // path that could silently go wrong no longer exists, and what this test now protects is that it
        // does not come back — a re-added bundle path would reintroduce a failure mode whose whole
        // character was being invisible to the template.
        const template = synthApp('pr-73');
        const all = resources(template) as Record<string, SynthesizedResource>;
        const triggers = Object.entries(all)
            .filter(([, resource]) => resource.Type === 'Custom::Trigger')
            .map(([id]) => id);

        expect(triggers, 'a trigger here means a second runner for one database has come back').toStrictEqual([]);

        const migrationRunners = Object.entries(all)
            .filter(
                ([, resource]) =>
                    resource.Type === 'AWS::Lambda::Function' &&
                    String(resource.Properties?.['Handler'] ?? '').includes('migrate'),
            )
            .map(([id]) => id);

        expect(migrationRunners, 'this app must ship no migration runner of its own').toStrictEqual([]);
    });
});
