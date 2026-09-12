import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';

import { EdgeStack } from '../lib/platform/EdgeStack.js';
import { GlobalStack } from '../lib/platform/GlobalStack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING. This file's STDOUT is a machine-readable channel:
// `.github/scripts/verify-deployment.sh` runs `cdk ls --long --json --app "<this app>"` and parses the
// result, so one stray line ahead of the JSON makes the post-deploy verifier report nothing at all.
// dotenv@17 prints a marketing banner on every `config()` call — measured, even for a path that does
// not exist. `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts` asserts this flag on every
// DISCOVERED CDK app and observes the installed library actually honouring it.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

const app = new App();
// U9: cdk-nag AwsSolutions review, ADVISORY — findings are reported as warnings, the build is not failed.
// Annotation-only, so it does not change synthesized output (the ADR-0002/ADR-0008 no-prod-diff line);
// `packages/infra/global/__tests__/cdkNagTemplateParity.test.ts` asserts that byte-for-byte.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @radicle-co/infra-shared/security.
stampCommitProvenance(app);
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';

// ⛔ ADR-0005's PRIMARY teardown selector. Persistent global infra (VPC, RDS, domain, shared ALB) is NEVER torn down
// per-PR — it names the TIER this deploy lives in (`production` for prod, `sandbox` for every other stage) and NEVER
// a `pr-{N}` value, which is the only thing the PR-close cleanup deletes. That job runs with NO denylist, so this
// line is what keeps the shared platform out of its match.
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

// ONE resolution of the alert recipient for the whole app (R3.2 / plan U11). Read from context or env —
// never a literal, because this repository is public — and shared by the platform alarms and the cost
// guardrails so the two cannot drift onto different addresses.
const alertEmail = app.node.tryGetContext('costAlertEmail') ?? process.env['COST_ALERT_EMAIL'];

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

new GlobalStack(app, `Global-${stage}`, {
    alarmsEnabled,
    env,
    stackName: `kitchensink-global-${stage}`,
    stage,
    domainName,
    alertEmail,
});

// ⚠️ PROD-ONLY, and note what this guard is NOT doing any more: the account's cost guardrails used to be
// smuggled in here behind the same `if`, which made an ACCOUNT-scoped stack reachable only by deploying a
// STAGE. They now live in `bin/account.ts`, which has no stage at all. What remains is genuinely
// stage-shaped — a prod-only stage resource, not an account one.
if (stage === 'prod') {
    // ADR-0020 / plan U16: the three CloudFront distributions and the viewer-request Clerk verifier.
    //
    // PROD ONLY, and enforced a second time inside the
    // stack, which refuses any stage without an internal origin. A distribution takes 5–15 minutes to deploy
    // and cannot be deleted without first disabling it and waiting for propagation, which would wreck the
    // ADR-0005 per-PR teardown and the ADR-0010 ensure-exists deploy gate; both assume a preview's
    // infrastructure can be created and reclaimed inside a PR's lifetime.
    //
    // It is ADDITIVE: no existing stack is touched, so the prod synth diff is exactly "one new stack
    // appears". DNS is NOT cut over here — the distributions claim no alias, and U17 moves the public names
    // one service at a time, identity last.
    //
    // ⚠️ Requires `CLERK_JWT_KEY` in the environment at SYNTH time (CI exports it from SSM before the
    // bundle step) and a bundle built from that same key. Both absences fail loudly rather than shipping a
    // verifier that cannot work — see `EdgeStack`'s docstring for why there is no placeholder.
    new EdgeStack(app, 'Edge', {
        env,
        stackName: `kitchensink-edge-${stage}`,
        stage,
        domainName,
    });
}

app.synth();
