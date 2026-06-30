import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { FoodServiceStack } from '../lib/food-service-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
// food is a non-global FEATURE service: a per-PR deploy (stage = pr-{N}) is ephemeral and tagged
// Environment=pr-{N} so the PR-close cleanup deletes it (by tag OR pr-{N} name prefix). A persistent
// (non-PR) food deploy tags 'global'. See ADR-0005.
Tags.of(app).add('Environment', stage.startsWith('pr-') ? stage : 'global');
const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const domainName = process.env['DOMAIN_NAME'];
const vpcId = process.env['FOOD_VPC_ID'] ?? process.env['IDENTITY_VPC_ID'];

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

if (!vpcId) {
    throw new Error('FOOD_VPC_ID (or IDENTITY_VPC_ID) env var is required');
}

const env = account ? { account, region } : { region };

new FoodServiceStack(app, `FoodService-${stage}`, {
    env,
    stackName: `kitchensink-food-service-${stage}`,
    stage,
    domainName,
    vpcId,
    imageTag: process.env['FOOD_IMAGE_TAG'] ?? 'latest',
    desiredCount: Number(process.env['FOOD_DESIRED_COUNT'] ?? 2),
    workerDesiredCount: Number(process.env['FOOD_WORKER_DESIRED_COUNT'] ?? 1),
    // FLAG: USDA_API_KEY is a secret wired as plaintext container env (no Secrets Manager seam for
    // source creds yet — see FoodServiceStackProps.usdaApiKey). Empty when unset (synth/CI without the
    // secret); the real deploy passes it. Move to an ecs.Secret before a real key ships.
    usdaApiKey: process.env['USDA_API_KEY'],
    unresolvedTtlDays: process.env['FOOD_UNRESOLVED_TTL_DAYS']
        ? Number(process.env['FOOD_UNRESOLVED_TTL_DAYS'])
        : undefined,
});

app.synth();
