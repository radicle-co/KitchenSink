import { App, Tags } from 'aws-cdk-lib';

import { attachSecurityChecks, stampCommitProvenance } from '@kitchensink/infra-security';

import { SandboxRouterStack } from '../lib/SandboxRouterStack.js';

const app = new App();

// U9: cdk-nag AwsSolutions review, ADVISORY — reported as warnings, never fails the build, and
// annotation-only so the synthesized template is unchanged. See @kitchensink/infra-security.
attachSecurityChecks(app);
// The COMMIT this deploy was built from, recorded as a CloudFormation STACK tag so
// `scripts/deploymentDrift.mjs` can answer "is what is running the code we think it is?". A stack
// tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource on every commit,
// breaching the ADR-0002/ADR-0008 no-prod-diff line for a fact about the BUILD rather than about any
// resource. See @kitchensink/infra-security.
stampCommitProvenance(app);

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? process.env['STAGE'] ?? 'sandbox';
const domainName = process.env['DOMAIN_NAME'];
const account = process.env['CDK_DEFAULT_ACCOUNT'];

// ADR-0005's PRIMARY teardown signal, and the one thing this app — alone among the repository's eight CDK
// apps — used to state nowhere. `teardown-sandbox-pr.sh` claims a closed PR's resources with NO denylist,
// by a `pr-{N}` NAME or by this TAG: §2 reads it per stack out of `describe-stacks`, §3 sweeps
// `resourcegroupstaggingapi` for anything tagged `Environment=pr-{N}` that no stack owned. An untagged app
// is invisible to both halves.
//
// `sandbox-router-deploy.yml` is the only deployer and pins `STAGE: sandbox`, so every real deploy stamps
// `global` — correct, because this is a PERSISTENT SINGLETON: its out-of-band deletion once left
// sandbox.commise.app NXDOMAIN and every web preview broken for ~3 weeks, which is precisely what a PR-close
// sweep must never be able to do. The value is nonetheless DERIVED from the stage, exactly as the four
// per-PR-capable services derive theirs, because the stage is a parameter and the two errors are not
// symmetric: a hardcoded `global` on a per-PR deploy would make that stack IMMORTAL, and the name rule
// could not reclaim it either — `kitchensink-sandbox-router-pr-{N}` does not START with `pr-{N}`, so
// `pr_scope_belongs` (a prefix rule) misses it and the tag is the only signal left.
//
// ⚠️ `Tags.of(app)`, unlike the commit stamp below it — and that is not a contradiction. The prohibition
// there is about VOLATILITY: `CommitSha` changes every commit, so the aspect form would rewrite every
// taggable resource on every deploy and breach the ADR-0002/ADR-0008 no-prod-diff line for a fact about the
// build. `Environment` is invariant for a given stack (it can only move when the stage does, which is a
// different stack), this app synthesizes no prod stack at all, and the aspect form is REQUIRED rather than
// merely tolerated: a stack-only tag would leave the resources themselves invisible to §3's tag sweep.
Tags.of(app).add('Environment', stage.startsWith('pr-') ? stage : 'global');

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
