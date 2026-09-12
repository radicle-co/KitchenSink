import { Fn, App, Tags } from 'aws-cdk-lib';
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING. This file's STDOUT is a machine-readable channel:
// `.github/scripts/verify-deployment.sh` runs `cdk ls --long --json --app "<this app>"` and parses the
// result, so one stray line ahead of the JSON makes the post-deploy verifier report nothing at all.
// dotenv@17 prints a marketing banner on every `config()` call — measured, even for a path that does
// not exist. `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts` asserts this flag on every
// DISCOVERED CDK app and observes the installed library actually honouring it.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

import { WebhooksStack } from '../lib/WebhooksStack.js';

const app = new App();
// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @radicle-co/infra-shared/security.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @radicle-co/infra-shared/security.
stampCommitProvenance(app);
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';

// ⛔ ADR-0005's PRIMARY teardown selector. The identity webhook lambdas are persistent global platform infra — it
// names the TIER this deploy lives in (`production` for prod, `sandbox` for every other stage) and NEVER a `pr-{N}`
// value, which is the only thing the PR-close cleanup deletes. That job runs with NO denylist, so this line is what
// keeps the shared platform out of its match.
//
// ⚠️ DERIVED FROM THE STAGE, not a constant, and the tier word is not a protection word: what protects this
// app is that `sandbox`/`production` contain no digits, so no `pr-{N}` token can ever claim them under any
// matcher in `.github/scripts/pr-scope.sh`. `environmentTagScheme.test.ts` asserts that in both directions.
Tags.of(app).add('Environment', stage === 'prod' ? 'production' : 'sandbox');
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

// ⛔ THE ALARM SWITCH, RESOLVED AT SYNTH TIME, DEFAULT OFF. The per-stage truth is stored in SSM at
// `/kitchensink/{stage}/observability/alarms-enabled`; the DEPLOY PIPELINE reads that parameter and exports
// `ALARMS_ENABLED`, exactly as `COST_ALERT_EMAIL` and the image tag already arrive. Absent, unreadable or
// malformed leaves the variable unset — which is `false`, so the flag fails CLOSED, toward creating none.
//
// ⛔ NOT `ssm.StringParameter.valueForStringParameter`: that resolves at DEPLOY time and returns a
// `${Token[…]}` string, so `=== 'true'` is false forever and the bare token is truthy forever — a flag that
// compiles, deploys and silently does nothing. Whether a construct EXISTS is decided here, at synth.
// Enforced by `packages/infra/global/__tests__/alarmFeatureFlag.test.ts`.
const alarmsEnabled = process.env['ALARMS_ENABLED'] === 'true';

new WebhooksStack(app, `IdentityWebhooks-${stage}`, {
    alarmsEnabled,
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
    authSecretArn: Fn.importValue(`kitchensink-data-${stage}:SecretArn`),
    migrationPlanSecretArn: Fn.importValue(`kitchensink-data-${stage}:MigrationPlanSecretArn`),
    dbInstanceIdentifier: `kitchensink-identity-${stage}`,
    dbEndpoint: Fn.importValue(`kitchensink-data-${stage}:DatabaseEndpoint`),
    dbPort: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
    dbName: Fn.importValue(`kitchensink-data-${stage}:DatabaseName`),
    dbResourceId: Fn.importValue(`kitchensink-data-${stage}:DatabaseResourceId`),
    deletionQueueArn: Fn.importValue(`kitchensink-data-${stage}:DeletionQueueArn`),
    mediaBucketName: Fn.importValue(`kitchensink-data-${stage}:MediaBucketName`),
    archiveBucketName: Fn.importValue(`kitchensink-data-${stage}:ArchiveBucketName`),
    hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
    zoneName: domainName,
});

app.synth();
