import { Fn, App, Tags } from 'aws-cdk-lib';
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSecurityChecks, stampCommitProvenance } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { WebhooksStack } from '../lib/WebhooksStack.js';

const app = new App();
// Identity webhooks are persistent global platform lambdas — never per-PR. See ADR-0005.
Tags.of(app).add('Environment', 'global');
// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @kitchensink/infra-security.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @kitchensink/infra-security.
stampCommitProvenance(app);
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const domainName = process.env['DOMAIN_NAME'];

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

const env = account ? { account, region } : { region };
const isProd = stage === 'prod';
const isSandbox =
    stage === 'sandbox' || stage.startsWith('sandbox-') || stage.startsWith('mr-') || stage.startsWith('pr-');

const vpcId = process.env['IDENTITY_VPC_ID'];

if (!vpcId) {
    throw new Error('IDENTITY_VPC_ID env var is required');
}

new WebhooksStack(app, `IdentityWebhooks-${stage}`, {
    // R3.2 / U11 — the alarm recipient, per-stage config and never a committed literal.
    alertEmail: process.env['COST_ALERT_EMAIL'],
    env,
    stackName: `kitchensink-identity-webhooks-${stage}`,
    stage,
    vpcId,
    domainName:
        (isProd ? 'registration.identity' : isSandbox ? 'registration.identity.sandbox' : 'registration.identity.dev') +
        `.${domainName}`,
    lambdaSecurityGroupId: Fn.importValue(`kitchensink-network-${stage}:LambdaSecurityGroupId`),
    databaseSecurityGroupId: Fn.importValue(`kitchensink-network-${stage}:DatabaseSecurityGroupId`),
    dbSecretArn: Fn.importValue(`kitchensink-data-${stage}:DatabaseSecretArn`),
    authSecretArn: Fn.importValue(`kitchensink-data-${stage}:SecretArn`),
    migrationPlanSecretArn: Fn.importValue(`kitchensink-data-${stage}:MigrationPlanSecretArn`),
    dbInstanceIdentifier: `kitchensink-identity-${stage}`,
    dbEndpoint: Fn.importValue(`kitchensink-data-${stage}:DatabaseEndpoint`),
    dbPort: Number(Fn.importValue(`kitchensink-data-${stage}:DatabasePort`)),
    deletionQueueArn: Fn.importValue(`kitchensink-data-${stage}:DeletionQueueArn`),
    mediaBucketName: Fn.importValue(`kitchensink-data-${stage}:MediaBucketName`),
    archiveBucketName: Fn.importValue(`kitchensink-data-${stage}:ArchiveBucketName`),
    hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
    zoneName: domainName,
});

app.synth();
