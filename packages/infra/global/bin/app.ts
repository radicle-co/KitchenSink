import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@kitchensink/infra-security';

import { CostGuardrailsStack } from '../lib/platform/CostGuardrailsStack.js';
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
// Persistent global infra (VPC, RDS, domain, shared ALB) — NEVER torn down by per-PR cleanup.
// The cleanup workflow only touches resources tagged Environment=pr-{N} or named with a pr-{N} prefix;
// this tag (and the kitchensink-* names) keep the global tier out of that match. See ADR-0005.
Tags.of(app).add('Environment', 'global');
// U9: cdk-nag AwsSolutions review, ADVISORY — findings are reported as warnings, the build is not failed.
// Annotation-only, so it does not change synthesized output (the ADR-0002/ADR-0008 no-prod-diff line);
// `packages/infra/global/__tests__/cdkNagTemplateParity.test.ts` asserts that byte-for-byte.
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

// ONE resolution of the alert recipient for the whole app (R3.2 / plan U11). Read from context or env —
// never a literal, because this repository is public — and shared by the platform alarms and the cost
// guardrails so the two cannot drift onto different addresses.
const alertEmail = app.node.tryGetContext('costAlertEmail') ?? process.env['COST_ALERT_EMAIL'];

new GlobalStack(app, `Global-${stage}`, {
    env,
    stackName: `kitchensink-global-${stage}`,
    stage,
    domainName,
    alertEmail,
});

// ADR-0008: account-wide cost guardrails (budget + anomaly detection) are created ONCE, guarded to
// the prod stage so the two persistent stages (prod/sandbox) don't each register duplicate
// account-scoped budgets. This is an ADDITIVE new stack; every existing stack is untouched, so the
// prod synth diff is exactly "one new stack appears" and no existing prod template changes.
if (stage === 'prod') {
    new CostGuardrailsStack(app, 'CostGuardrails', {
        env,
        stackName: 'kitchensink-cost-guardrails',
        alertEmail,
    });

    // ADR-0020 / plan U16: the three CloudFront distributions and the viewer-request Clerk verifier.
    //
    // PROD ONLY, guarded here the same way the cost guardrails are — and enforced a second time inside the
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
