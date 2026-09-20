import { config as dotenvConfig } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';

const __dirname = dirname(fileURLToPath(import.meta.url));
// ⛔ `quiet: true` IS LOAD-BEARING. This file's STDOUT is a machine-readable channel:
// `.github/scripts/verifyDeployment.sh` runs `cdk ls --long --json --app "<this app>"` and parses the
// result, so one stray line ahead of the JSON makes the post-deploy verifier report nothing at all.
// dotenv@17 prints a marketing banner on every `config()` call — measured, even for a path that does
// not exist. `packages/infra/global/__tests__/cdkAppStdoutPurity.test.ts` asserts this flag on every
// DISCOVERED CDK app and observes the installed library actually honouring it.
dotenvConfig({ path: join(__dirname, '../../.env'), quiet: true });

import { IngredientParserStack } from '../lib/IngredientParserStack.js';
import { ASSET_DIRECTORY } from '../lib/packaging.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';

// ⛔ ADR-0005's PRIMARY teardown selector, and the ONE line that decides whether this deploy is
// reclaimable. A per-PR stack (stage = pr-{N}) is ephemeral and tags `pr-{N}-sandbox`, which the PR-close
// cleanup deletes by tag OR by `pr-{N}` name prefix with NO denylist; every persistent stage tags the TIER
// it lives in — `production` for prod, `sandbox` for everything else — and no token can ever claim either,
// because a token carries digits and neither tier word does.
//
// Applied ONCE, here, at App level — a second stack-level tag is how the teardown selector and the
// deploy drift apart.
Tags.of(app).add(
    'Environment',
    stage.startsWith('pr-') ? `${stage}-sandbox` : stage === 'prod' ? 'production' : 'sandbox',
);

// cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and annotation-only
// so the synthesized template is unchanged. See @radicle-co/infra-shared/security.
//
// ⚠️ EXPECT ONE AwsSolutions-L1 FINDING HERE, and do not suppress it. The function runs python3.13 because
// the CRF engine declares `Requires-Python: <3.14`, while aws-cdk-lib already knows python3.14. The finding
// is accurate, it is not ours to fix, and it clears itself when the engine supports the newer Python — the
// same posture `lambdaRuntime.ts` records for the framework-onEvent functions. `pythonLambdaRuntime.test.ts`
// asserts that the finding's presence is EXPLAINED by that ceiling and flips when the ceiling moves.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @radicle-co/infra-shared/security.
stampCommitProvenance(app);

const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const env = account ? { account, region } : { region };

new IngredientParserStack(app, `IngredientParser-${stage}`, {
    // ⚠️ OPTIONAL BY DESIGN, and resolved by CI rather than imported. `Fn.importValue` on the webhooks
    // app's `LogForwarderArn` export deadlocked every importer against the stack that publishes it — the
    // schema stacks ADR-0035 deploys FIRST imported a stack the same pipeline deploys LAST. Empty or unset
    // means this deploy attaches no subscription filter; it attaches on the next deploy of this app.
    //
    // ⚠️ EMPTY, not merely unset: `cfnExport.sh --optional` answers empty when the export does not exist
    // yet, and an empty GitHub Actions step output arrives as a variable that is SET and EMPTY. An app
    // checking only `undefined` would synthesize a filter whose destination ARN is the empty string — clean
    // synth, failed deploy. Every reading of it is held to BOTH halves of that by `logDrainRegister.test.ts`,
    // over a population derived from which entries CONSTRUCT a guarded stack (ADR-0042).
    ...(process.env['LOG_FORWARDER_ARN'] === undefined || process.env['LOG_FORWARDER_ARN'] === ''
        ? {}
        : { logForwarderArn: process.env['LOG_FORWARDER_ARN'] }),
    env,
    stackName: `kitchensink-ingredient-parser-${stage}`,
    stage,
    // Resolved HERE rather than inside the stack, so the stack's synth-time refusal can be fired at a real
    // directory, an empty one and a missing one from its test suite. `npm run infra:synth` stages it first.
    assetDirectory: resolve(__dirname, '../..', ASSET_DIRECTORY),
});

app.synth();
