import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { IdentityServiceStack } from '../lib/identity-service-stack.js';

const app = new App();
// Identity is persistent global platform infra (auth service) — never per-PR. See ADR-0005.
Tags.of(app).add('Environment', 'global');
// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @kitchensink/infra-security.
attachSecurityChecks(app);
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const domainName = process.env['DOMAIN_NAME'];

const vpcId = process.env['IDENTITY_VPC_ID'];

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

if (!vpcId) {
    throw new Error('IDENTITY_VPC_ID env var is required');
}

const env = account ? { account, region } : { region };

new IdentityServiceStack(app, `IdentityService-${stage}`, {
    env,
    stackName: `kitchensink-identity-service-${stage}`,
    stage,
    domainName,
    vpcId,
    imageTag: process.env['IDENTITY_IMAGE_TAG'] ?? 'latest',
    desiredCount: Number(process.env['IDENTITY_DESIRED_COUNT'] ?? 2),
});

app.synth();
