import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { RecipeWorkersStack } from '../lib/recipe-workers-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';

// ADR-0005: recipe-workers is a non-global FEATURE deploy. A per-PR stack (stage = pr-{N}) is ephemeral
// and MUST tag Environment=pr-{N} so the PR-close cleanup deletes it — that job matches by tag OR
// pr-{N} name prefix with NO denylist, so the safety of every persistent resource depends on this line
// never tagging a global resource `pr-{N}` (and vice versa). A persistent deploy tags 'global'.
Tags.of(app).add('Environment', stage.startsWith('pr-') ? stage : 'global');

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

new RecipeWorkersStack(app, `RecipeWorkers-${stage}`, {
    env,
    stackName: `kitchensink-recipe-workers-${stage}`,
    stage,
    vpcId,
    lambdaSecurityGroupId: requireEnv('RECIPE_LAMBDA_SG_ID'),
    dbEndpoint: requireEnv('RECIPE_DB_ENDPOINT'),
    dbPort: Number(process.env['RECIPE_DB_PORT'] ?? 5432),
    dbName: process.env['RECIPE_DB_NAME'] ?? 'kitchensink_recipes',
    // Passwordless RDS-IAM role (no password secret) — see DataStack's RecipeDbBootstrap.
    dbUser: process.env['RECIPE_DB_USER'] ?? 'recipe_app',
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
