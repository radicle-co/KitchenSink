import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CfnOutput,
    CustomResource,
    Duration,
    RemovalPolicy,
    SecretValue,
    Stack,
    type StackProps,
    aws_ec2 as ec2,
    aws_lambda as lambda,
    aws_rds as rds,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_sqs as sqs,
    custom_resources as cr,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { AcceptedNagFindings, NODE_LAMBDA_RUNTIME, acceptNagFindings } from '@radicle-co/infra-shared/security';
import {
    DATABASE_ROLES,
    RDS_MASTER_USERNAME,
    databaseAclStatements,
    iamLoginStatements,
    roleModelStatements,
    type DatabaseService,
} from '@kitchensink/db-schema-guard';

import { LEGACY_RECREATE_TOKEN_PREFIX } from '../../src/db-bootstrap/disposition.js';

import type { NetworkStack } from './NetworkStack.js';

/**
 * Where the esbuild-produced handler bundle lives, and whether it is there — read ONCE, at module load.
 *
 * ⛔ The reading is pinned deliberately, and it used to happen inside the constructor. `bin/app.ts` builds
 * every stack of a stage in ONE process, so a per-construction probe makes each stack's template depend on
 * when it happened to be built rather than on the app's inputs — two stacks in the same synth could
 * disagree about their own handler. That is not a hypothetical: `cdkNagSynth.integration.test.ts` runs
 * `npm run bundle:lambda`, which creates this directory, and it sits in `__tests__/` where the default unit
 * glob picks it up — so vitest runs it in PARALLEL with `cdkNagTemplateParity.test.ts`, whose two
 * module-scope synths must be byte-identical. The bundle landing between those two lines made the same app
 * emit `"codeSource": "inline-stub"` and then `"codeSource": "bundle"`, and the prod no-diff proof failed
 * on a diff nobody wrote. Reproduced deterministically by creating the directory ~0.95s into that file's
 * import; by 1.05s the window has closed.
 *
 * Reading once is also right for the real path: `npm run deploy` is `bundle:lambda && cdk deploy`, so the
 * bundle is complete before this module is ever imported. The integration suite likewise bundles and then
 * synthesizes in a CHILD process, which loads this module fresh afterwards.
 *
 * `find` already answers both questions — a candidate it returns is one that exists — so there is no
 * separate second `existsSync` to drift from it.
 */
const LAMBDA_ASSET_CANDIDATES = ((): { readonly dir: string; readonly present: boolean } => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')];
    const found = candidates.find((candidate) => existsSync(candidate));

    return { dir: found ?? candidates[0]!, present: found !== undefined };
})();

/**
 * ⚠️⚠️ The stages the ONE-SHOT legacy recreate is ARMED on (`docs/plans/2026-09-11-database-role-split.md`,
 * owner rulings 1, 2 and 8). While a stage is listed, a deploy may DROP a base database still owned by its
 * pre-role-split owner and recreate it owned by `<svc>_owner`; one already owned by `<svc>_owner` is left alone.
 *
 * ⛔ The DISARM commit — mandatory, the second prod deploy — DELETES this list, the arming property and flag, and the
 * recreate path itself (see `__tests__/roleSplitLegacyRecreateArmed.test.ts`, which restates the list and deletes
 * with it). A literal list rather than anything derived from the stage, so arming a stage is a reviewed line, never a
 * consequence.
 */
const LEGACY_RECREATE_ARMED_STAGES: readonly string[] = ['sandbox', 'prod'];

/** The construct-ID prefix of each database's bootstrap custom resource. */
const SERVICE_RESOURCE_PREFIX: Readonly<Record<DatabaseService, string>> = {
    identity: 'Identity',
    food: 'Food',
    recipe: 'Recipe',
};

/**
 * A digest of every statement a database's bootstrap applies on this kind of stage — the role model, the `rds_iam`
 * grants, and the database ACL — so that changing any of them changes the custom resource's properties.
 *
 * @param service - The database.
 * @param database - Its name.
 * @param isProd - Whether the stage is prod (the statements differ).
 * @returns A SHA-256 hex digest. Pure.
 */
function roleModelDigest(service: DatabaseService, database: string, isProd: boolean): string {
    const roles = DATABASE_ROLES[service];
    const statements = [
        ...roleModelStatements(roles, { master: RDS_MASTER_USERNAME, isProd }),
        ...iamLoginStatements(roles),
        ...databaseAclStatements(roles, database),
    ];

    return createHash('sha256').update(statements.join('\n')).digest('hex');
}

/**
 * The bootstrap handler's bundle digest, or `inline-stub` without a bundle — read ONCE at module load, for the same
 * reason as {@link LAMBDA_ASSET_CANDIDATES}: two synths in one process must agree.
 */
const BOOTSTRAP_BUNDLE_DIGEST = ((): string => {
    const bundle = resolve(LAMBDA_ASSET_CANDIDATES.dir, 'db-bootstrap/handler.js');

    return LAMBDA_ASSET_CANDIDATES.present && existsSync(bundle)
        ? `bundle-${createHash('sha256').update(readFileSync(bundle)).digest('hex')}`
        : 'inline-stub';
})();

export interface DataStackProps extends StackProps {
    readonly network: NetworkStack;
    readonly stage?: string;
}

/**
 * @implements REQ-013 REQ-014 REQ-017 REQ-025 REQ-026 REQ-050 REQ-IF-007 REQ-CN-007 FR-013 FR-014 FR-017 FR-025 FR-026 ARCH-017 ARCH-031 MOD-017 MOD-031
 */
export class DataStack extends Stack {
    public readonly database: rds.DatabaseInstance;
    public readonly deletionQueue: sqs.Queue;
    /**
     * The handle-sync SNS topic (W8-a.2 / decision 6). Owned by GLOBAL infra (never swept by per-PR
     * cleanup): the identity service (`PATCH /api/v1/users/me`) and the Clerk `user.updated` webhook both
     * publish `{ userId, displayName, sourceTimestamp }` here, and each recipe-workers deployment subscribes
     * its OWN per-stack SQS queue — SNS fan-out, not one shared queue (which would deliver each rename to
     * exactly one of N preview consumers). Its ARN is exported for the producer + subscriber stacks.
     */
    public readonly handleSyncTopic: sns.Topic;
    public readonly deletionDlq: sqs.Queue;
    public readonly mediaBucket: s3.Bucket;
    public readonly archiveBucket: s3.Bucket;
    public readonly dbCredentialsSecret: secretsmanager.Secret;
    public readonly authSecretKey: secretsmanager.ISecret;
    public readonly migrationPlanSecret: secretsmanager.Secret;
    public readonly databaseName: string;
    /**
     * Name of the second logical database provisioned on the shared instance (feature 003). It and its three
     * roles (`food_owner` / `food_migrator` / `food_app`) are created by the `FoodDbRoleModel` custom resource,
     * connected as the master — the IAM-auth roles have no password and cannot bootstrap themselves.
     */
    public readonly foodDatabaseName: string;

    /**
     * Name of the third logical database provisioned on the shared instance (feature 001). It and its three
     * roles are created by the `RecipeDbRoleModel` custom resource, connected as the master.
     */
    public readonly recipeDatabaseName: string;

    public constructor(scope: Construct, id: string, props: DataStackProps) {
        super(scope, id, props);

        this.dbCredentialsSecret = new secretsmanager.Secret(this, 'DatabaseCredentialsSecret', {
            description: ' PostgreSQL credentials',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: RDS_MASTER_USERNAME }),
                generateStringKey: 'password',
                excludePunctuation: true,
                includeSpace: false,
            },
        });

        const stageTag = props.stage ?? 'dev';

        // Per-stage RDS right-sizing (ADR-0007). Prod keeps db.t4g.small (unchanged → no prod diff);
        // every non-prod stage (sandbox, dev, per-PR base imports) runs db.t4g.micro. The instance
        // class is the only stage-dependent RDS property, so prod's synthesized template is untouched.
        const dbInstanceSize = stageTag === 'prod' ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO;

        // Per-stage RDS storage type (ADR-0008). Prod stays on the default gp2 (`undefined` here →
        // CDK's default `StorageType: gp2`, byte-identical → no prod diff); every non-prod stage uses
        // gp3. gp3 is cheaper per GB-month and bundles 3,000 baseline IOPS at 100 GB, so NO provisioned
        // IOPS/throughput is set (CDK emits neither `Iops` nor `StorageThroughput` for gp3 under 400 GB).
        // Flipping prod to gp3 later is a safe online modify, deliberately deferred to preserve no-prod-diff.
        const dbStorageType = stageTag === 'prod' ? undefined : rds.StorageType.GP3;

        this.authSecretKey = secretsmanager.Secret.fromSecretNameV2(
            this,
            'Secret',
            `kitchensink/${stageTag}/identity/keys`,
        );

        this.migrationPlanSecret = new secretsmanager.Secret(this, 'MigrationPlanSecret', {
            description: 'Deployment bootstrap instructions for pg_trgm extension',
            secretObjectValue: {
                bootstrapSql: SecretValue.unsafePlainText('CREATE EXTENSION IF NOT EXISTS pg_trgm;'),
                migrationOwner: SecretValue.unsafePlainText('@kitchensink/identity-service'),
            },
        });

        // AwsSolutions-SMG4 accepted: this secret is not a credential — it carries two static, non-sensitive
        // values set from source above, so there is nothing rotation could mean. Justification in
        // @radicle-co/infra-shared/security. (SMG4 on `DatabaseCredentialsSecret` is NOT accepted and NOT
        // suppressed: it is a real gap, ESCALATED in ADR-0013, because single-user rotation there would take
        // the identity service down — see that ADR for the evidence.)
        acceptNagFindings(this.migrationPlanSecret, AcceptedNagFindings.MIGRATION_PLAN_SECRET_HOLDS_NO_CREDENTIAL);

        this.databaseName = 'kitchensink_identity';

        // Feature 003 — second logical database `kitchensink_food` on this SAME shared instance. No new
        // instance/cluster: the role-model bootstrap below creates it and its roles. `pg_trgm` is created by the
        // food migrations themselves (a trusted extension), so FR-008 search needs nothing here.
        this.foodDatabaseName = 'kitchensink_food';

        // Feature 001 — third logical database `kitchensink_recipes` on this SAME shared instance. Same additive
        // pattern as food (ADR-0006), created by the same role-model bootstrap below. No new instance/cluster.
        this.recipeDatabaseName = 'kitchensink_recipes';

        const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
            description: 'Isolated subnets for identity PostgreSQL',
            vpc: props.network.vpc,
            removalPolicy: RemovalPolicy.DESTROY,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        });

        this.database = new rds.DatabaseInstance(this, 'Database', {
            vpc: props.network.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
            subnetGroup: dbSubnetGroup,
            securityGroups: [props.network.databaseSecurityGroup],
            credentials: rds.Credentials.fromSecret(this.dbCredentialsSecret),
            // Every migrator and service role authenticates passwordlessly with short-lived RDS IAM tokens. The
            // master `identity_app` keeps password auth — and must never reach `rds_iam` by any chain, or IAM auth
            // takes precedence and locks it out. See the role-model bootstrap below.
            iamAuthentication: true,
            // ⛔ ONE-WAY DOOR. A PostgreSQL MAJOR version cannot be downgraded in place; AWS states that
            // "after an upgrade is complete, you can't revert to the previous version of the DB engine" and
            // the only recovery is restoring the pre-upgrade snapshot into a NEW instance — which
            // CloudFormation does not own. ADR-0002's standing "fix forward only" posture for this stack
            // therefore does NOT apply to this one property. Before moving it, execute
            // `docs/runbooks/pg18-upgrade.md`: it carries the pre-flight checks, the window, and the
            // rehearsed restore leg.
            //
            // ⚠️ MAJOR-ONLY on purpose. `VER_18` synthesizes `EngineVersion: '18'`, and with
            // `autoMinorVersionUpgrade` below RDS tracks the 18 series' patch releases rather than freezing
            // the instance on whichever minor it landed on. Pinning a minor here would make every security
            // patch a code change. The cost of the prefix form is that RDS resolves it at deploy time, so
            // the runbook's pre-flight asserts the resolved target is in this instance's `ValidUpgradeTarget`
            // list — not every 16.x minor can reach every 18.x minor.
            //
            // ⚠️ NO `parameterGroup` is set, DELIBERATELY, and that is what makes this bump a one-property
            // change. Parameter-group families are version-pinned (`postgres16` vs `postgres18`) and
            // `ModifyDBInstance` requires the group to be "in the same DB parameter group family as the DB
            // instance" — so a custom group would have to be REPLACED in the same change set as the version,
            // and getting that wrong fails the deploy AFTER the outage has begun. Without one, RDS uses the
            // default group for the engine version and moves it with the engine. Adding a custom parameter
            // group here is a decision that must handle the family swap; `engineVersionDiff.test.ts` fails
            // if one appears.
            //
            // The reviewed version is RESTATED in `engineVersionDiff.test.ts`, on purpose — a gate that read
            // it from here would agree with it by construction. `localPostgresParity.test.ts` reads it from
            // here for the opposite reason, so every Docker Postgres pin in the repo follows this line.
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_18,
            }),
            // Required IN THE SAME deployment that changes `engine` above: AWS rejects a major-version
            // change without it. It only PERMITS an upgrade, it never triggers one — the trigger is the
            // version, which `engineVersionDiff.test.ts` pins to a reviewed constant. Left on afterwards so
            // the next major hop is not a two-deploy dance during a maintenance window.
            allowMajorVersionUpgrade: true,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, dbInstanceSize),
            // ⛔ 100 EVERYWHERE, AND DO NOT "OPTIMISE" IT DOWN. **RDS cannot shrink allocated storage.**
            //
            // This was briefly `stageTag === 'prod' ? 100 : 50`, on the reasoning that two EMPTY databases
            // carrying 100 GB apiece is ~$23/mo of storage for ~0 bytes (measured 2026-08-27: ~101.9 GB free
            // of 100 GB allocated on BOTH), and that the full intended scope — all of USDA FoodData Central
            // including Branded, ~1.9M foods and ~30M food_nutrients rows, plus 10,000 recipes — models to
            // only ~10-11 GB.
            //
            // The sizing was right and the change was still wrong. `AllocatedStorage` is a MUTABLE property,
            // so CloudFormation attempts an in-place modify rather than a replacement, and RDS rejects it:
            //
            //     Invalid storage size for engine name postgres and storage type gp3: 50
            //
            // It failed twice (2026-08-27 21:12 and 23:49) and the second attempt left
            // `kitchensink-data-sandbox` in **UPDATE_ROLLBACK_FAILED** — a wedged stack blocking every
            // sandbox deploy until `continue-update-rollback` recovered it.
            //
            // ⛔ Reaching a smaller number requires REPLACING the instance, and that is not a local edit: two
            // stacks (`identity-service-sandbox`, `identity-webhooks-sandbox`) import this stack's exports,
            // so the delete hits ADR-0002's export-in-use deadlock and the whole sandbox platform has to come
            // down in order. That is a large, risky operation to reclaim **$5.75/month**, and the answer is
            // no. If a future rebuild happens for some OTHER reason, size it then.
            allocatedStorage: 100,
            // ⚠️ The number above is a MODEL — nothing has ingested Branded yet, and `usdaBulk.parser.ts`
            // does not seed it today. This is what makes being wrong survivable: autoscaling costs nothing
            // until used and turns "out of disk at 3am" into "grew". It was OFF on both instances, which is
            // the real defect the oversized literal was hiding.
            maxAllocatedStorage: 200,
            storageType: dbStorageType,
            storageEncrypted: true,
            backupRetention: Duration.days(7),
            multiAz: false,
            databaseName: this.databaseName,
            // ON for every stage (owner ruling 2026-08-08). It is free, and it is the ONLY thing between an
            // accidental replacement and total data loss: this instance has no Multi-AZ standby (T-196 closed
            // that as WON'T DO — one cluster, one AZ, one region until the product earns) and
            // `removalPolicy: DESTROY` below takes NO safety snapshot.
            //
            // The concrete hazard it closes is ADR-0002's: changing the prod VPC CIDR, or any construct id
            // feeding the VPC, REPLACES the prod VPC and its RDS with no snapshot. Protection converts that
            // from silent data loss into a loud CloudFormation failure.
            //
            // SANDBOX IS INCLUDED DELIBERATELY. It is not disposable — it hosts the single shared identity
            // service every PR preview signs in against, and the teardown rules say the shared RDS must never
            // be destroyed. Per-PR cleanup operates on LOGICAL databases inside this instance and on
            // `pr-{N}`-tagged resources, so protecting the instance cannot block it.
            //
            // ⚠️ ACCEPTED CONSEQUENCE: with protection on and `removalPolicy: DESTROY` retained, a genuine
            // teardown FAILS until someone disables protection first. That extra deliberate step is the
            // point — it makes destroying a database an explicit act, not a side effect of a rename.
            // `removalPolicy` is intentionally left as-is: flipping it to RETAIN is a separate decision that
            // would change teardown semantics ADR-0002 documents.
            deletionProtection: true,
            publiclyAccessible: false,
            removalPolicy: RemovalPolicy.DESTROY,
            autoMinorVersionUpgrade: true,
        });

        // ── Database role model + base databases (the role split, ADR-0039) ─────────────────────────
        //
        // ONE master-connected function brings each database on this instance into the role split's shape
        // (`docs/plans/2026-09-11-database-role-split.md`): a NOLOGIN `<svc>_owner` owning the database, an
        // IAM-auth `<svc>_migrator` that migrates as it, an IAM-auth data-only service role, the database closed
        // to PUBLIC, and the master never on a chain to `rds_iam`. It replaces the two per-service bootstraps
        // (food, recipe), which were the same code twice; identity had none and ran as the master itself.
        //
        // The placeholder shipped when `dist-lambda/` was never built. It must NOT report success: a
        // success-returning no-op is how prod ran for four weeks with NO `food_app`/`recipe_app` role at all —
        // CloudFormation recorded CREATE_COMPLETE for a 101-byte stub that did nothing. Deleting must still no-op,
        // or a stack delete would wedge on a throwing resource.
        const bootstrapFn = new lambda.Function(this, 'DbBootstrapFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: LAMBDA_ASSET_CANDIDATES.present ? 'db-bootstrap/handler.handler' : 'index.handler',
            code: LAMBDA_ASSET_CANDIDATES.present
                ? lambda.Code.fromAsset(LAMBDA_ASSET_CANDIDATES.dir)
                : lambda.Code.fromInline(
                      `exports.handler = async (e) => { if (e.RequestType === 'Delete') { ` +
                          `return { PhysicalResourceId: e.PhysicalResourceId ?? 'db-bootstrap' }; } ` +
                          `throw new Error('db-bootstrap was deployed WITHOUT its real bundle, so it would silently ` +
                          `create no role and no database. Run \`npm run bundle:lambda --workspace=packages/infra/global\` ` +
                          `before cdk deploy (the package\\'s own npm \`deploy\` script already does).'); };`,
                  ),
            // ⚠️ 600 s — BELOW the provider framework's own 900 s. With the two equal, a long pass outlives the
            // framework, whose failure lets Lambda's async retry start a SECOND pass beside the live one (the
            // advisory lock serializes them, but the timeout should not manufacture the race). The armed pass drops,
            // recreates and re-owns in seconds; idempotent runs take less.
            timeout: Duration.seconds(600),
            memorySize: 256,
            description: `Bootstrap the database role model (${stageTag})`,
            vpc: props.network.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [props.network.lambdaSecurityGroup],
            environment: {
                DB_SECRET_ARN: this.dbCredentialsSecret.secretArn,
                DB_ENDPOINT: this.database.dbInstanceEndpointAddress,
                DB_PORT: this.database.dbInstanceEndpointPort,
                STAGE: stageTag,
                // ⚠️ The function's half of the ONE-SHOT arming: the handler arms only when this AND the event's
                // `legacyRecreate` both name the stage, so a hand-crafted invoke cannot arm an unarmed deploy.
                ...(LEGACY_RECREATE_ARMED_STAGES.includes(stageTag)
                    ? { LEGACY_RECREATE_ARMED: `${LEGACY_RECREATE_TOKEN_PREFIX}:${stageTag}` }
                    : {}),
            },
        });
        this.dbCredentialsSecret.grantRead(bootstrapFn);

        const bootstrapProvider = new cr.Provider(this, 'DbBootstrapProvider', { onEventHandler: bootstrapFn });

        // ⛔ SERIALIZED: identity, then food, then recipe. Every pass rewrites the cluster-wide role catalog as the
        // master, so two at once race on it; and each runs after the instance, because `GRANT rds_iam` needs its
        // IAM-auth setting applied first. New logical IDs (not the old `FoodDbBootstrap`/`RecipeDbBootstrap`): the
        // old resources are DELETED by this change, which their handler answers as a no-op.
        const isProdStage = stageTag === 'prod';
        const armed = LEGACY_RECREATE_ARMED_STAGES.includes(stageTag);
        let previous: CustomResource | undefined;

        for (const [service, database] of [
            ['identity', this.databaseName],
            ['food', this.foodDatabaseName],
            ['recipe', this.recipeDatabaseName],
        ] as const) {
            const resource = new CustomResource(this, `${SERVICE_RESOURCE_PREFIX[service]}DbRoleModel`, {
                serviceToken: bootstrapProvider.serviceToken,
                properties: {
                    service,
                    database,
                    stage: stageTag,
                    // CloudFormation re-invokes a custom resource only when a property changes: a changed statement
                    // list must change one, or the new model never reaches a deployed stage.
                    roleModelDigest: roleModelDigest(service, database, isProdStage),
                    // …and so must a changed HANDLER (the stub → bundle transition, or new pass logic).
                    codeSource: BOOTSTRAP_BUNDLE_DIGEST,
                    // ⚠️ The ONE-SHOT legacy recreate, armed per stage (see LEGACY_RECREATE_ARMED_STAGES). Absent
                    // everywhere once the disarm commit empties that list.
                    ...(armed ? { legacyRecreate: `${LEGACY_RECREATE_TOKEN_PREFIX}:${stageTag}` } : {}),
                },
            });

            resource.node.addDependency(this.database);

            if (previous !== undefined) {
                resource.node.addDependency(previous);
            }

            previous = resource;
        }

        // ── Per-PR logical-database reaper (ADR-0031) ───────────────────────────────────────────────
        //
        // ⛔ NON-PROD ONLY. This function connects AS MASTER and issues `DROP DATABASE`. Production has no
        // per-PR logical databases at all — its migrators hold no CREATEDB, which `assertRoleModel` asserts on
        // every bootstrap run — so deploying it there would be dead code
        // carrying a live risk. The handler ALSO refuses at runtime when `STAGE` is `prod`, belt and braces,
        // because a master-credentialed drop capability must not depend on one guard in one file.
        //
        // ⚠️ This ACCEPTS a prod/sandbox template divergence, which ADR-0028 argues against on the grounds
        // that "keeping prod on a different shape is how ADR-0007's cost problem came to hide in the
        // exempted half". ADR-0031 records why the exception is taken here rather than reasoned around, and
        // `perPrDatabaseReaperStack.test.ts` asserts the divergence in BOTH directions so it cannot rot.
        //
        // Why it lives in `DataStack` rather than in a service's stack: a door inside the stack whose database
        // it drops cannot reclaim a database whose stack is gone, wedged in `DELETE_FAILED`/
        // `UPDATE_ROLLBACK_FAILED` (which publishes no outputs), or was reaped while nothing ever called its door
        // — which is why the runners' `action: 'drop'` doors were deleted by the role split and this is the ONLY
        // thing that drops a per-PR database. It sits beside the instance and outlives every service stack. It
        // can drop an owner-owned database because the master INHERITs each `<svc>_owner` outside prod.
        if (stageTag !== 'prod') {
            const reaperFn = new lambda.Function(this, 'PerPrDatabaseReaperFunction', {
                runtime: NODE_LAMBDA_RUNTIME,
                architecture: lambda.Architecture.ARM_64,
                handler: LAMBDA_ASSET_CANDIDATES.present ? 'db-reaper/handler.handler' : 'index.handler',
                code: LAMBDA_ASSET_CANDIDATES.present
                    ? lambda.Code.fromAsset(LAMBDA_ASSET_CANDIDATES.dir)
                    : lambda.Code.fromInline(
                          "exports.handler = async () => { throw new Error('per-pr-database-reaper was " +
                              'deployed WITHOUT its real bundle. Run `npm run bundle:lambda ' +
                              "--workspace=packages/infra/global` before cdk deploy.'); };",
                      ),
                // Long enough for a `DROP DATABASE … WITH (FORCE)` per registered base on a cold instance. It is
                // never on a request path.
                timeout: Duration.seconds(300),
                memorySize: 256,
                description: `Count and reclaim per-PR logical databases (${stageTag}) — ADR-0031`,
                vpc: props.network.vpc,
                vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                securityGroups: [props.network.lambdaSecurityGroup],
                environment: {
                    DB_SECRET_ARN: this.dbCredentialsSecret.secretArn,
                    DB_ENDPOINT: this.database.dbInstanceEndpointAddress,
                    DB_PORT: this.database.dbInstanceEndpointPort,
                    STAGE: stageTag,
                },
            });
            this.dbCredentialsSecret.grantRead(reaperFn);

            // ⚠️ Deliberately NOT named `*MigrationFunctionName`. `perPrDatabaseDropDoors.test.ts` discovers
            // per-service migration runners by that exact anchored shape; a reaper output matching it would
            // be counted as a service's own drop door and confuse both sides of that guard.
            new CfnOutput(this, 'PerPrDatabaseReaperFunctionName', {
                value: reaperFn.functionName,
                exportName: `${this.stackName}:PerPrDatabaseReaperFunctionName`,
            });
        }

        this.deletionDlq = new sqs.Queue(this, 'DeletionDlq', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.minutes(2),
        });

        this.deletionQueue = new sqs.Queue(this, 'DeletionQueue', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.minutes(2),
            deadLetterQueue: {
                queue: this.deletionDlq,
                maxReceiveCount: 5,
            },
        });

        // Handle-sync fan-out topic (W8-a.2). A plain topic: the payload is transient and non-secret at the
        // topic; the PII (a display name) is bounded by each subscriber SQS queue's retention + SSE. Named
        // per-stage but tagged with its persistent tier (prod/sandbox baseline only, never pr-{N}-…).
        this.handleSyncTopic = new sns.Topic(this, 'HandleSyncTopic', {
            enforceSSL: true,
            topicName: `kitchensink-handle-sync-${stageTag}`,
            displayName: 'Recipe author/editor handle sync',
        });

        this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        this.archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            lifecycleRules: [
                {
                    enabled: true,
                    expiration: Duration.days(30),
                },
            ],
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        new CfnOutput(this, 'HandleSyncTopicArn', {
            value: this.handleSyncTopic.topicArn,
            exportName: `${this.stackName}:HandleSyncTopicArn`,
        });
        new CfnOutput(this, 'DatabaseEndpoint', {
            value: this.database.dbInstanceEndpointAddress,
            exportName: `${this.stackName}:DatabaseEndpoint`,
        });
        new CfnOutput(this, 'DatabasePort', {
            value: this.database.dbInstanceEndpointPort,
            exportName: `${this.stackName}:DatabasePort`,
        });
        new CfnOutput(this, 'DatabaseName', {
            value: this.databaseName,
            exportName: `${this.stackName}:DatabaseName`,
        });
        new CfnOutput(this, 'DatabaseSecretArn', {
            value: this.dbCredentialsSecret.secretArn,
            exportName: `${this.stackName}:DatabaseSecretArn`,
        });
        new CfnOutput(this, 'SecretArn', {
            value: this.authSecretKey.secretArn,
            exportName: `${this.stackName}:SecretArn`,
        });
        new CfnOutput(this, 'MigrationPlanSecretArn', {
            value: this.migrationPlanSecret.secretArn,
            exportName: `${this.stackName}:MigrationPlanSecretArn`,
        });
        new CfnOutput(this, 'FoodDatabaseName', {
            value: this.foodDatabaseName,
            exportName: `${this.stackName}:FoodDatabaseName`,
        });
        new CfnOutput(this, 'RecipeDatabaseName', {
            value: this.recipeDatabaseName,
            exportName: `${this.stackName}:RecipeDatabaseName`,
        });
        // RDS instance resource id (dbi-…), needed to scope `rds-db:connect` IAM to the food_app db-user.
        // Always present on an owned instance (only `undefined` for some imports), so guard for the type.
        const databaseResourceId = this.database.instanceResourceId;

        if (!databaseResourceId) {
            throw new Error('DatabaseInstance.instanceResourceId is unexpectedly undefined');
        }

        new CfnOutput(this, 'DatabaseResourceId', {
            value: databaseResourceId,
            exportName: `${this.stackName}:DatabaseResourceId`,
        });
        new CfnOutput(this, 'DeletionQueueArn', {
            value: this.deletionQueue.queueArn,
            exportName: `${this.stackName}:DeletionQueueArn`,
        });
        new CfnOutput(this, 'DeletionQueueUrl', {
            value: this.deletionQueue.queueUrl,
            exportName: `${this.stackName}:DeletionQueueUrl`,
        });
        new CfnOutput(this, 'DeletionDlqArn', {
            value: this.deletionDlq.queueArn,
            exportName: `${this.stackName}:DeletionDlqArn`,
        });
        new CfnOutput(this, 'MediaBucketName', {
            value: this.mediaBucket.bucketName,
            exportName: `${this.stackName}:MediaBucketName`,
        });
        new CfnOutput(this, 'ArchiveBucketName', {
            value: this.archiveBucket.bucketName,
            exportName: `${this.stackName}:ArchiveBucketName`,
        });
    }
}
