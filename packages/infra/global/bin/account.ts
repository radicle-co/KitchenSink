/**
 * The ACCOUNT-scoped CDK app: infrastructure that exists once per AWS account, not once per stage.
 *
 * ## Why this is a separate entrypoint
 *
 * "Global" was being used for two different things, and they were living in one app:
 *
 * - **stage-shared** — the VPC, RDS, shared ALB, domain certificates and the identity service. There is one
 *   of each PER PERSISTENT STAGE: a sandbox set and a production set. Those belong to `bin/app.ts`, are
 *   named `…-{stage}`, and are tagged `sandbox` / `production`.
 * - **account-scoped** — the cost budget and the anomaly monitor. There is exactly ONE, for the whole
 *   account. It has no stage, it watches every stage's spend including sandbox's, and deploying a second
 *   copy would register a duplicate account-wide budget.
 *
 * Mixing them had two concrete consequences. `CostGuardrailsStack` was reachable only through
 * `if (stage === 'prod')` in `bin/app.ts`, so the account's cost monitoring could not be touched without
 * running a production deploy — and it inherited the per-stage app's `Environment` tag, which labelled an
 * account-wide resource as a production one. The guard was doing the right thing (one copy, never in
 * sandbox) by the wrong mechanism (coupling to a stage), and the wrong mechanism is what shows up as a tag
 * that lies about what the resource is.
 *
 * ## ⛔ THIS APP TAKES NO STAGE, AND MUST NOT ACQUIRE ONE
 *
 * There is no `stage` variable here, nothing reads `STAGE`, and no stack name carries a suffix. That is the
 * property `accountScopedInfra.test.ts` asserts, and it is what makes "deployed once" structural instead of
 * conditional: an app that cannot express a stage cannot be deployed per stage, so the sandbox case is not
 * refused at deploy time — it is unrepresentable.
 *
 * `Environment=global` here means exactly "account-scoped", which is narrower and more useful than the
 * "persistent, do not reap" it used to mean across every long-lived stack. The teardown selector is
 * unaffected either way: `global` carries no digits, so no `pr-{N}` matcher in `.github/scripts/pr-scope.sh`
 * can claim it.
 */
import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';

import { CostGuardrailsStack } from '../lib/platform/CostGuardrailsStack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING — this app's STDOUT is parsed by `verify-deployment.sh`, which runs
// `cdk ls --long --json --app "<this app>"`. One stray line ahead of the JSON makes the verifier report
// nothing at all. Asserted for every discovered app by `cdkAppStdoutPurity.test.ts`.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

const app = new App();
// cdk-nag AwsSolutions review, ADVISORY — annotation-only, so the synthesized template is unchanged.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, as a stack tag, so `scripts/deploymentDrift.mjs` can answer
// "is what is running the code we think it is?".
stampCommitProvenance(app);

// ⛔ A CONSTANT, and the one place in this repository where that is correct. Every other app derives the
// value from its stage because it has one; this app has no stage to derive from, which is the whole point.
Tags.of(app).add('Environment', 'global');

const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const alertEmail = process.env['COST_ALERT_EMAIL'];

// ADR-0008: the account's $300 monthly budget, its anomaly monitor and the subscription that notifies on a
// spike. ⚠️ The monitor watches the WHOLE ACCOUNT — sandbox and every `pr-{N}` preview included — which is
// the clearest statement of why it cannot be a per-stage resource: there is nothing stage-shaped about it,
// and a second copy would double-count the same spend.
new CostGuardrailsStack(app, 'CostGuardrails', {
    env: { account, region },
    stackName: 'kitchensink-cost-guardrails',
    alertEmail,
});

app.synth();
