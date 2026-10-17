import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@radicle-co/infra-shared/security';
import { kitchenSinkAppProps, resolveStage } from '@kitchensink/cdk-bootstrap/appProps';
import { TIER_TAG_KEY, tierTagValueForStage } from '@kitchensink/cdk-bootstrap/qualifiers';

import { RemoteSearchStack } from '../lib/RemoteSearchStack.js';
import { parseRemoteSearchStage } from '../lib/remoteSearchStage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ⛔ The stage is read BEFORE the App exists: it selects the bootstrap qualifier and the permissions boundary
// this whole app synthesizes with (the bootstrap-qualifier ADR). `kitchenSinkAppProps` is the only place a
// qualifier is chosen; an app that built its own `App` would deploy through the account's DEFAULT bootstrap,
// whose execution role is another application's `AdministratorAccess`. `cdkQualifierCoverage.test.ts` fails it.
const stage = parseRemoteSearchStage(resolveStage(process.env));
const app = new App(kitchenSinkAppProps(stage));
// ADR-0065: the CloudFormation execution role authorizes every modify and delete by THIS tag, because
// CloudFormation's own stack-name tag is missing from ACM certificates, ECS, DynamoDB, CloudFront and some SQS
// queues. The value follows the stage exactly as the bootstrap qualifier does. `tierTagCoverage.test.ts` holds it.
Tags.of(app).add(TIER_TAG_KEY, tierTagValueForStage(stage));

// Parsed before anything is built: the service is deployed where food is, at `prod` and per pull request, so any
// other stage stops the synth here.

// ADR-0005's teardown selector, the same expression as food's: a preview's copy is `pr-{N}-sandbox`, which the PR-close
// cleanup deletes by tag, and prod is `production`, which no `pr-{N}` token can claim.
Tags.of(app).add(
    'Environment',
    stage.startsWith('pr-') ? `${stage}-sandbox` : stage === 'prod' ? 'production' : 'sandbox',
);

// cdk-nag AwsSolutions review, advisory and annotation-only. See @radicle-co/infra-shared/security.
attachSecurityChecks(app);
// The commit this deploy was built from, as a stack tag. See @radicle-co/infra-shared/security.
stampCommitProvenance(app);

const region = process.env['CDK_DEFAULT_REGION'] ?? process.env['DEFAULT_AWS_REGION'] ?? 'us-east-1';
const account = process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'];
const env = account ? { account, region } : { region };
const domainName = process.env['DOMAIN_NAME'];

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

// ⚠️ The construct id IS the stack name, written as a literal: `cdk deploy <selector>` matches the construct id, and
// the deploy tooling reads this literal out of the call (see food's `bin/app.ts`).
new RemoteSearchStack(app, `kitchensink-remote-search-${stage}`, {
    // Optional, resolved by CI rather than imported; empty means no drain yet (ADR-0042, `logDrainRegister.test.ts`).
    ...(process.env['LOG_FORWARDER_ARN'] === undefined || process.env['LOG_FORWARDER_ARN'] === ''
        ? {}
        : { logForwarderArn: process.env['LOG_FORWARDER_ARN'] }),
    // Resolved at synth from `ALARMS_ENABLED`, which the pipeline reads from
    // `/kitchensink/{stage}/observability/alarms-enabled`; unset is off, and SSM is never read here
    // (`alarmFeatureFlag.test.ts`).
    alarmsEnabled: process.env['ALARMS_ENABLED'] === 'true',
    alertEmail: process.env['COST_ALERT_EMAIL'],
    env,
    stackName: `kitchensink-remote-search-${stage}`,
    stage,
    domainName,
    lambdaAsset: resolve(__dirname, '../../dist-lambda'),
});

app.synth();
