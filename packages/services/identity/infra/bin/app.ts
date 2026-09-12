import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING. This file's STDOUT is a machine-readable channel:
// `.github/scripts/verify-deployment.sh` runs `cdk ls --long --json --app "<this app>"` and parses the
// result, so one stray line ahead of the JSON makes the post-deploy verifier report nothing at all.
// dotenv@17 prints a marketing banner on every `config()` call — measured, even for a path that does
// not exist. `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts` asserts this flag on every
// DISCOVERED CDK app and observes the installed library actually honouring it.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

import { IdentitySchemaStack } from '../lib/IdentitySchemaStack.js';
import { IdentityServiceStack } from '../lib/IdentityServiceStack.js';

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

// ⛔ ADR-0005's PRIMARY teardown selector. Identity is persistent global platform infra (the auth service every
// preview signs in against) — it names the TIER this deploy lives in (`production` for prod, `sandbox` for every
// other stage) and NEVER a `pr-{N}` value, which is the only thing the PR-close cleanup deletes. That job runs with
// NO denylist, so this line is what keeps the shared platform out of its match.
//
// ⚠️ DERIVED FROM THE STAGE, not a constant, and the tier word is not a protection word: what protects this
// app is that `sandbox`/`production` contain no digits, so no `pr-{N}` token can ever claim them under any
// matcher in `.github/scripts/pr-scope.sh`. `environmentTagScheme.test.ts` asserts that in both directions.
Tags.of(app).add('Environment', stage === 'prod' ? 'production' : 'sandbox');
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

// ⛔ The SCHEMA, deployed and migrated by its own pipeline step AHEAD of the service. It holds the
// migration runner and nothing that reads the schema, which is what makes "deploy this, migrate, then
// deploy everything else" a real barrier rather than a convention. It takes no dependency on the service
// stack and the service takes none on it: the ordering is the pipeline's, so a `cdk deploy --all` that
// deploys them in either order is still correct — the migrate step is what sits between.
// ⛔ THE CONSTRUCT ID IS THE STACK NAME, deliberately, and unlike its siblings here.
//
// `cdk deploy <selector>` matches a stack's CONSTRUCT ID, not its CloudFormation name — measured:
// `cdk deploy "kitchensink-food-schema-pr-91"` answered `No stacks match the name(s) …` while the stack
// was declared perfectly. Every other consumer of this stack — the liveness probe, `run-migrations.sh`,
// the teardown sweep — addresses it by its CloudFormation name, because that is what CloudFormation
// knows. Making the two strings ONE removes the only place they could disagree, and the sibling stacks'
// `Id-${stage}` convention is not worth a second name for a stack the pipeline deploys BY NAME.
//
// ⚠️ And the two strings are spelled TWICE rather than shared through a const, which looks like the DRY
// violation it is not: `deploy-gate.sh stacks-for`, `prodDeployMigrationOrder` and `stackProbeCoverage`
// all derive this app's stacks by reading the template literal out of the `new …Stack(app, …)` call.
// Hoisting it to a variable made every one of them resolve NOTHING — three guards silently reporting an
// app with no stacks. One repeated literal is cheaper than teaching four readers to chase a binding.
new IdentitySchemaStack(app, `kitchensink-identity-schema-${stage}`, {
    env,
    stackName: `kitchensink-identity-schema-${stage}`,
    stage,
    vpcId,
});

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

new IdentityServiceStack(app, `IdentityService-${stage}`, {
    alarmsEnabled,
    // R3.2 / U11 — the alarm recipient, per-stage config and never a committed literal.
    alertEmail: process.env['COST_ALERT_EMAIL'],
    env,
    stackName: `kitchensink-identity-service-${stage}`,
    stage,
    domainName,
    vpcId,
    imageTag: process.env['IDENTITY_IMAGE_TAG'] ?? 'latest',
    desiredCount: Number(process.env['IDENTITY_DESIRED_COUNT'] ?? 2),
});

app.synth();
