import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { FoodServiceStack } from '../lib/food-service-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
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
    workerDesiredCount: Number(process.env['USDA_WORKER_DESIRED_COUNT'] ?? 1),
});

app.synth();
