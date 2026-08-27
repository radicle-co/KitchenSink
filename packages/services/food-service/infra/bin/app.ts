import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { FoodServiceStack } from '../lib/FoodServiceStack.js';
import { synthEnv } from '../lib/synthEnv.js';

// Validated ONCE, up front: a malformed count or TTL fails the synth here rather than being coerced to
// `NaN`/`0` and emitted into a CloudFormation template (see lib/synthEnv.ts).
const { desiredCount, workerDesiredCount, unresolvedTtlDays } = synthEnv();

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

// ADR-0028 — an on-demand sandbox carries its own expiry. `sandbox-up.yml` computes it ONCE at the press of
// the button and passes it here; the hourly reconciler only ever compares that number to now, so the two
// can never disagree about when this preview dies.
//
// ⚠️  A `pr-{N}` deploy that arrives WITHOUT the variable is left deliberately untagged, and the reconciler
// treats untagged as EXPIRED. That is the fail-safe direction: a preview stood up outside the button is one
// nobody has taken responsibility for, and reaping something reproducible by one button press is the cheap
// mistake. The expensive one is infrastructure no process will ever collect.
const sandboxExpiresAt = process.env['SANDBOX_EXPIRES_AT'];

if (stage.startsWith('pr-') && sandboxExpiresAt) {
    Tags.of(app).add('SandboxExpiresAt', sandboxExpiresAt);
}

// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @kitchensink/infra-security.
attachSecurityChecks(app);
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
    // R3.2 / U11 — the alarm recipient, per-stage config and never a committed literal.
    alertEmail: process.env['COST_ALERT_EMAIL'],
    env,
    stackName: `kitchensink-food-service-${stage}`,
    stage,
    baseStage,
    domainName,
    vpcId,
    imageTag: process.env['FOOD_IMAGE_TAG'] ?? 'latest',
    desiredCount,
    workerDesiredCount,
    // USDA_API_KEY is injected into the containers from Secrets Manager (an out-of-band, externally
    // issued key imported by name `kitchensink/{baseStage}/food/usda-api-key`), not passed through here.
    // ⚠️ `baseStage`, NOT `stage` — this comment said `{stage}` until 2026-08-24, which is wrong in the
    // REASSURING direction: a reader concluded each `pr-{N}` preview held its own key and its own quota.
    // Every preview shares ONE key while each counts only its own calls. See the OPEN entry in
    // `specs/003-usda-food-data/tasks.md`.
    unresolvedTtlDays,
});

app.synth();
