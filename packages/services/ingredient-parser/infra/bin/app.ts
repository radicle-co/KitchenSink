import { config as dotenvConfig } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks } from '@kitchensink/infra-security';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

import { IngredientParserStack } from '../lib/IngredientParserStack.js';
import { ASSET_DIRECTORY } from '../lib/packaging.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env['STAGE'] ?? 'dev';

// The ingredient parser is a non-global FEATURE deployable: a per-PR deploy (stage = pr-{N}) is ephemeral
// and tagged Environment=pr-{N} so the PR-close cleanup deletes it (by tag OR pr-{N} name prefix). A
// persistent (non-PR) deploy tags 'global'. Applied ONCE, here, at App level — a second stack-level tag is
// how the teardown selector and the deploy drift apart. See ADR-0005.
Tags.of(app).add('Environment', stage.startsWith('pr-') ? stage : 'global');
// cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and annotation-only
// so the synthesized template is unchanged. See @kitchensink/infra-security.
//
// ⚠️ EXPECT ONE AwsSolutions-L1 FINDING HERE, and do not suppress it. The function runs python3.13 because
// the CRF engine declares `Requires-Python: <3.14`, while aws-cdk-lib already knows python3.14. The finding
// is accurate, it is not ours to fix, and it clears itself when the engine supports the newer Python — the
// same posture `lambdaRuntime.ts` records for the framework-onEvent functions. `pythonLambdaRuntime.test.ts`
// asserts that the finding's presence is EXPLAINED by that ceiling and flips when the ceiling moves.
attachSecurityChecks(app);

const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const env = account ? { account, region } : { region };

new IngredientParserStack(app, `IngredientParser-${stage}`, {
    env,
    stackName: `kitchensink-ingredient-parser-${stage}`,
    stage,
    // Resolved HERE rather than inside the stack, so the stack's synth-time refusal can be fired at a real
    // directory, an empty one and a missing one from its test suite. `npm run infra:synth` stages it first.
    assetDirectory: resolve(__dirname, '../..', ASSET_DIRECTORY),
});

app.synth();
