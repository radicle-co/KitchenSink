/**
 * GlobalStack owns no resources of its own — it is the per-stage COMPOSITION of the platform's
 * foundational substacks (network → data → domain → shared ALB, plus the sandbox scheduler). Its
 * load-bearing invariants are therefore structural:
 *   1. Each child is named `kitchensink-{network,data,domain,alb}-${stage}` EXACTLY — every service
 *      stack cross-imports those stack names (`Fn.importValue('kitchensink-domain-${stage}:…')`), so a
 *      rename is an invisible break of the whole platform.
 *   2. The `stage` is propagated into each child (per-stage VPC CIDR, per-stage export scoping).
 *   3. The child export contract other stacks consume is actually produced.
 *   4. The sandbox nightly scheduler is created ONLY for sandbox (ADR-0007 / ADR-0002 no-prod-diff).
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';

const env = { account: '123456789012', region: 'us-east-1' };
const domainName = 'commise.app';

const makeGlobal = (stage: string): GlobalStack =>
    new GlobalStack(new App(), `Global-${stage}`, {
        env,
        stackName: `kitchensink-global-${stage}`,
        stage,
        domainName,
    });

describe('GlobalStack child-stack naming (cross-stack import contract)', () => {
    it('names every foundational substack kitchensink-{kind}-${stage} exactly', () => {
        const global = makeGlobal('sandbox');

        // These names are the literal keys other stacks resolve via Fn.importValue — a drift here
        // silently 404s every downstream import, so pin all four.
        expect(global.network.stackName).toBe('kitchensink-network-sandbox');
        expect(global.data.stackName).toBe('kitchensink-data-sandbox');
        expect(global.domain.stackName).toBe('kitchensink-domain-sandbox');
        expect(global.alb.stackName).toBe('kitchensink-alb-sandbox');
    });

    it('re-scopes the child names per stage (prod children never carry the sandbox suffix)', () => {
        const global = makeGlobal('prod');

        expect(global.network.stackName).toBe('kitchensink-network-prod');
        expect(global.data.stackName).toBe('kitchensink-data-prod');
        expect(global.domain.stackName).toBe('kitchensink-domain-prod');
        expect(global.alb.stackName).toBe('kitchensink-alb-prod');
    });
});

describe('GlobalStack stage propagation into children', () => {
    it('drives the per-stage VPC CIDR through NetworkStack (prod 10.0/16, sandbox 10.1/16)', () => {
        // Proves `stage` is actually threaded into the network child (not hard-coded), which is the
        // ADR-0002 guarantee the prod VPC never gets replaced.
        Template.fromStack(makeGlobal('prod').network).hasResourceProperties('AWS::EC2::VPC', {
            CidrBlock: '10.0.0.0/16',
        });
        Template.fromStack(makeGlobal('sandbox').network).hasResourceProperties('AWS::EC2::VPC', {
            CidrBlock: '10.1.0.0/16',
        });
    });
});

describe('GlobalStack child export contract (what services import)', () => {
    it('domain child produces the HostedZoneId + CertificateArn exports for this stage', () => {
        const outputs = Template.fromStack(makeGlobal('sandbox').domain).findOutputs('*');
        const exportNames = Object.values(outputs).map((o: { Export?: { Name?: string } }) => o.Export?.Name);

        expect(exportNames).toContain('kitchensink-domain-sandbox:HostedZoneId');
        expect(exportNames).toContain('kitchensink-domain-sandbox:CertificateArn');
    });

    it('shared-ALB child produces the HTTPS-listener + canonical-zone exports for this stage', () => {
        const outputs = Template.fromStack(makeGlobal('sandbox').alb).findOutputs('*');
        const exportNames = Object.values(outputs).map((o: { Export?: { Name?: string } }) => o.Export?.Name);

        expect(exportNames).toContain('kitchensink-alb-sandbox:SharedAlbHttpsListenerArn');
        expect(exportNames).toContain('kitchensink-alb-sandbox:SharedAlbCanonicalHostedZoneId');
    });

    it('wires exactly ONE shared internet-facing ALB per stage (not one per service — ADR-0003)', () => {
        const template = Template.fromStack(makeGlobal('sandbox').alb);

        template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
            Scheme: 'internet-facing',
        });
    });
});

describe('GlobalStack sandbox-scheduler guard (ADR-0007 / no prod diff)', () => {
    it('creates the SandboxSchedulerStack (the stop/start PAIR, ADR-0028 Update 2026-09-03) ONLY for the sandbox stage', () => {
        const sandbox = makeGlobal('sandbox');

        expect(sandbox.sandboxScheduler).toBeInstanceOf(SandboxSchedulerStack);
        // Two: the 00:00 ET stop and the 09:00 ET start restored by ADR-0028's Update of 2026-09-03. What
        // this file is actually guarding is the GUARD — that prod and dev get no scheduler at all — so it
        // asserts only the count; the expressions, actions and their pairing are pinned by
        // `SandboxSchedulerStack.test.ts`, which owns that decision.
        Template.fromStack(sandbox.sandboxScheduler!).resourceCountIs('AWS::Scheduler::Schedule', 2);
    });

    it('creates no scheduler for prod or an unspecified stage (guard leaves it undefined)', () => {
        expect(makeGlobal('prod').sandboxScheduler).toBeUndefined();
        expect(makeGlobal('dev').sandboxScheduler).toBeUndefined();
    });
});
