import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { FoodServiceStack } from '../lib/food-service-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
// ADR-0006: a feature deploy imports the PERSISTENT platform tier, which exists only for `prod` and
// `sandbox`. Prod rides prod; every other stage rides the shared `sandbox` platform. `stage` still drives
// naming/tagging/routing/DB-isolation.
//
const baseStage = stage === 'prod' ? 'prod' : 'sandbox';

// WHICH STAGES EXIST. The food service is deployed at exactly two kinds of stage: the one persistent
// PRODUCTION deploy, and an ephemeral per-PR preview (`pr-{N}`). It has NO persistent non-prod instance —
// every PR stands up its own. Only identity and packages/infra/global are shared and persistent.
//
// So deploying at the platform's own base stage is a configuration error, and it is caught HERE rather than
// in the DNS-label helper: which stages may be deployed is a property of the deploy, not of a hostname.
// (`foodSubdomainForStage` is correspondingly total — it cannot express a stage-qualified host at all.)
if (stage !== 'prod' && stage === baseStage) {
    throw new Error(
        `Refusing to deploy the food service at stage '${stage}': that is the shared platform's own base ` +
            'stage, and the food service has no persistent non-prod instance — every PR deploys its own ' +
            '(stage `pr-{N}`). Only identity and packages/infra/global are shared and persistent.',
    );
}
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
    baseStage,
    domainName,
    vpcId,
    imageTag: process.env['FOOD_IMAGE_TAG'] ?? 'latest',
    desiredCount: Number(process.env['FOOD_DESIRED_COUNT'] ?? 2),
    workerDesiredCount: Number(process.env['FOOD_WORKER_DESIRED_COUNT'] ?? 1),
    // USDA_API_KEY is injected into the containers from Secrets Manager (an out-of-band, externally
    // issued key imported by name `kitchensink/{stage}/food/usda-api-key`), not passed through here.
    unresolvedTtlDays: process.env['FOOD_UNRESOLVED_TTL_DAYS']
        ? Number(process.env['FOOD_UNRESOLVED_TTL_DAYS'])
        : undefined,
});

app.synth();
