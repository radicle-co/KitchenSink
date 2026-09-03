import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { RecipeWorkersStack } from '../lib/RecipeWorkersStack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
// ADR-0006: a feature deploy imports the PERSISTENT platform tier, which exists only for `prod` and
// `sandbox`. Prod rides prod; every other stage rides the shared `sandbox` platform. Identical to the
// recipe SERVICE app's rule, and it must stay identical: it is half of the (stage, baseStage) pair that
// decides whether this deploy gets the shared recipe database or its own isolated one (#119).
const baseStage = stage === 'prod' ? 'prod' : 'sandbox';

// ADR-0005: recipe-workers is a non-global FEATURE deploy. A per-PR stack (stage = pr-{N}) is ephemeral
// and MUST tag Environment=pr-{N} so the PR-close cleanup deletes it — that job matches by tag OR
// pr-{N} name prefix with NO denylist, so the safety of every persistent resource depends on this line
// never tagging a global resource `pr-{N}` (and vice versa). A persistent deploy tags 'global'.
Tags.of(app).add('Environment', stage.startsWith('pr-') ? stage : 'global');

// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @kitchensink/infra-security.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @kitchensink/infra-security.
stampCommitProvenance(app);

const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const vpcId = process.env['RECIPE_VPC_ID'] ?? process.env['IDENTITY_VPC_ID'] ?? process.env['FOOD_VPC_ID'];

if (!vpcId) {
    throw new Error('RECIPE_VPC_ID (or IDENTITY_VPC_ID) env var is required');
}

const requireEnv = (key: string): string => {
    const value = process.env[key];

    if (!value) {
        throw new Error(`${key} env var is required`);
    }

    return value;
};

const env = account ? { account, region } : { region };

/**
 * The recipe-service Lambda bundle, which carries the schema-migration runner and this release's ordered
 * `*.sql`. Resolved HERE, at the composition root, because this is the layer that already knows the repo
 * layout — the stack takes it as a prop so the cross-package dependency is declared rather than hidden, and
 * so a synth test can drive the not-built branch deterministically.
 *
 * ⛔ It must be BUILT before this app is deployed (`npm run bundle:lambda --workspace=…/recipe-service`).
 * Both pipelines already do that ahead of the workers deploy, and the ordering is pinned by
 * `packages/infra/global/__tests__/prodDeployMigrationOrder.test.ts`. When it is absent the stack
 * synthesizes a THROWING placeholder, so the failure is a failed deploy rather than a migration that
 * silently applied nothing.
 */
const migrationBundlePath = join(__dirname, '../../../recipe-service/dist-lambda');

new RecipeWorkersStack(app, `RecipeWorkers-${stage}`, {
    migrationBundlePath,
    // R3.2 / U11 — the alarm recipient, per-stage config and never a committed literal.
    alertEmail: process.env['COST_ALERT_EMAIL'],
    env,
    stackName: `kitchensink-recipe-workers-${stage}`,
    stage,
    baseStage,
    vpcId,
    lambdaSecurityGroupId: requireEnv('RECIPE_LAMBDA_SG_ID'),
    dbEndpoint: requireEnv('RECIPE_DB_ENDPOINT'),
    dbPort: Number(process.env['RECIPE_DB_PORT'] ?? 5432),
    // REQUIRED, and deliberately the BASE name (the `kitchensink-data-{baseStage}:RecipeDatabaseName`
    // export) rather than the final one — the stack derives the per-stage name from it. This used to be
    // `process.env['RECIPE_DB_NAME'] ?? 'kitchensink_recipes'`, and because CI passed the endpoint, port and
    // resource id but never the NAME, that fallback silently pointed all six workers — including three
    // destructive scheduled sweepers — at the SHARED database while the API used the preview's own (#119).
    // `requireEnv` is the point: a CI step that forgets this variable now fails the deploy instead of
    // quietly targeting another stage's data.
    dbBaseName: requireEnv('RECIPE_DB_BASE_NAME'),
    // Passwordless RDS-IAM role (no password secret) — see DataStack's RecipeDbBootstrap.
    dbUser: process.env['RECIPE_DB_USER'] ?? 'recipe_app',
    // The RDS DbiResourceId (`db-XXXX…`), not the instance name — see the prop's doc comment.
    dbInstanceIdentifier: requireEnv('RECIPE_DB_INSTANCE_ID'),
    archiveBucketName: requireEnv('RECIPE_ARCHIVE_BUCKET'),
    mediaBucketName: requireEnv('RECIPE_MEDIA_BUCKET'),
    // The global handle-sync SNS topic ARN (W8-a.2), exported by DataStack; wired in by CI like the buckets.
    handleSyncTopicArn: requireEnv('HANDLE_SYNC_TOPIC_ARN'),
    // Optional (HAZ-051/067/039): no distribution is provisioned by this repo's CDK yet, so this is
    // simply unset until one exists — the erasure worker degrades to a logged CDN-invalidation no-op.
    cloudfrontDistributionId: process.env['RECIPE_CLOUDFRONT_DISTRIBUTION_ID'],
});

app.synth();
