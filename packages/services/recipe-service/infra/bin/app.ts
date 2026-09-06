import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING. This file's STDOUT is a machine-readable channel:
// `.github/scripts/verify-deployment.sh` runs `cdk ls --long --json --app "<this app>"` and parses the
// result, so one stray line ahead of the JSON makes the post-deploy verifier report nothing at all.
// dotenv@17 prints a marketing banner on every `config()` call — measured, even for a path that does
// not exist. `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts` asserts this flag on every
// DISCOVERED CDK app and observes the installed library actually honouring it.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

import { RecipeSchemaStack } from '../lib/RecipeSchemaStack.js';
import { RecipeServiceStack } from '../lib/RecipeServiceStack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';
// ADR-0006: a feature deploy imports the PERSISTENT platform tier, which exists only for `prod` and
// `sandbox`. Prod rides prod; every other stage rides the shared `sandbox` platform. `stage` still drives
// naming/tagging/routing/DB-isolation.
//
const baseStage = stage === 'prod' ? 'prod' : 'sandbox';

// WHICH STAGES EXIST. The recipe service is deployed at exactly two kinds of stage: the one persistent
// PRODUCTION deploy, and an ephemeral per-PR preview (`pr-{N}`). It has NO persistent non-prod instance —
// every PR stands up its own. Only identity and packages/infra/global are shared and persistent.
//
// So deploying at the platform's own base stage is a configuration error, and it is caught HERE rather than
// in the DNS-label helper: which stages may be deployed is a property of the deploy, not of a hostname.
// (`recipeSubdomainForStage` is correspondingly total — it cannot express a stage-qualified host at all.)
if (stage !== 'prod' && stage === baseStage) {
    throw new Error(
        `Refusing to deploy the recipe service at stage '${stage}': that is the shared platform's own base ` +
            'stage, and the recipe service has no persistent non-prod instance — every PR deploys its own ' +
            '(stage `pr-{N}`). Only identity and packages/infra/global are shared and persistent.',
    );
}

// recipe is a non-global FEATURE service: a per-PR deploy (stage = pr-{N}) is ephemeral and tagged
// Environment=pr-{N} so the PR-close cleanup deletes it (by tag OR pr-{N} name prefix); a persistent
// (non-PR) deploy tags 'global'. See ADR-0005.
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
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @kitchensink/infra-security.
stampCommitProvenance(app);
const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const domainName = process.env['DOMAIN_NAME'];
const vpcId = process.env['RECIPE_VPC_ID'] ?? process.env['IDENTITY_VPC_ID'] ?? process.env['FOOD_VPC_ID'];
const foodServiceUrl = process.env['RECIPE_FOOD_SERVICE_URL'];

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

if (!vpcId) {
    throw new Error('RECIPE_VPC_ID (or IDENTITY_VPC_ID) env var is required');
}

// REQUIRED (issue #120). This variable existed in the code and in NO workflow, so the conditional prop it fed
// never fired and every deployed recipe task ran with no food origin — falling back to `http://localhost:3002`
// inside its own container, where nothing listens. The service's config now requires the value, and the deploy
// refuses to synth without it: the CI step derives it from the food stack's own DNS-label helper
// (`packages/services/food-service/infra/bin/printFoodHost.ts`), so the host shape has ONE definition.
if (!foodServiceUrl) {
    throw new Error(
        'RECIPE_FOOD_SERVICE_URL env var is required — the recipe service cannot boot without a food origin. ' +
            'Derive it with `npx tsx packages/services/food-service/infra/bin/printFoodHost.ts $STAGE $DOMAIN_NAME`.',
    );
}

const env = account ? { account, region } : { region };

// ⛔ The SCHEMA, deployed and migrated by its own pipeline step AHEAD of both the workers and the service.
// It holds the migration runner and nothing that reads the schema. Recipe is where this earns the most: the
// in-deploy Trigger it replaces required TWO runners for ONE database — one here and a second copy of this
// same bundle in `RecipeWorkersStack`, a different CDK app — purely because `DependsOn` cannot leave a
// stack. One runner ahead of both covers every consumer regardless of which app it lives in.
new RecipeSchemaStack(app, `RecipeSchema-${stage}`, {
    env,
    stackName: `kitchensink-recipe-schema-${stage}`,
    stage,
    baseStage,
    vpcId,
});

new RecipeServiceStack(app, `RecipeService-${stage}`, {
    env,
    stackName: `kitchensink-recipe-service-${stage}`,
    stage,
    baseStage,
    domainName,
    vpcId,
    imageTag: process.env['RECIPE_IMAGE_TAG'] ?? 'latest',
    desiredCount: Number(process.env['RECIPE_DESIRED_COUNT'] ?? 1),
    // No CloudFront distribution exists yet — a placeholder keeps the service's storage config valid so it
    // boots and serves recipe CRUD; photo-via-CDN serving lands with a real distribution later.
    cloudfrontUrl: process.env['RECIPE_CLOUDFRONT_URL'] ?? `https://recipe-cdn.${domainName}`,
    // Optional (HAZ-051/067/039): no distribution is provisioned by this repo's CDK yet, so this is
    // simply unset until one exists — the service degrades to a logged CDN-invalidation no-op.
    cloudfrontDistributionId: process.env['RECIPE_CLOUDFRONT_DISTRIBUTION_ID'],
    // Food service origin — REQUIRED, validated above and again at synth (see `assertFoodServiceUrl`).
    foodServiceUrl,
});

app.synth();
