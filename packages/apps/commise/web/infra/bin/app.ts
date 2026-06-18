import { App } from 'aws-cdk-lib';

import { SandboxRouterStack } from '../lib/sandbox-router-stack.js';

const app = new App();

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? process.env['STAGE'] ?? 'sandbox';
const domainName = process.env['DOMAIN_NAME'];
const account = process.env['CDK_DEFAULT_ACCOUNT'];

if (!domainName) {
    throw new Error('DOMAIN_NAME is required to synth the sandbox router stack');
}

new SandboxRouterStack(app, `SandboxRouter-${stage}`, {
    // CloudFront certs (and the distribution) must be in us-east-1 regardless of the default region.
    env: { account, region: 'us-east-1' },
    stackName: `kitchensink-sandbox-router-${stage}`,
    stage,
    domainName,
});
