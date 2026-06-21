import { config as dotenvConfig } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';

import { GlobalStack } from '../lib/platform/global-stack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '../../.env') });

const app = new App();
// Persistent global infra (VPC, RDS, domain, shared ALB) — NEVER torn down by per-PR cleanup.
// The cleanup workflow only touches resources tagged Environment=pr-{N} or named with a pr-{N} prefix;
// this tag (and the kitchensink-* names) keep the global tier out of that match. See ADR-0005.
Tags.of(app).add('Environment', 'global');
const stage = app.node.tryGetContext('stage') ?? process.env.STAGE ?? 'dev';
const region = process.env.CDK_DEFAULT_REGION ?? process.env.DEFAULT_AWS_REGION ?? 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const domainName = process.env.DOMAIN_NAME;

if (!domainName) {
    throw new Error('DOMAIN_NAME env var is required');
}

const env = account ? { account, region } : { region };

new GlobalStack(app, `Global-${stage}`, {
    env,
    stackName: `kitchensink-global-${stage}`,
    stage,
    domainName,
});

app.synth();
