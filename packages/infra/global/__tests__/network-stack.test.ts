import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DataStack } from '../lib/platform/data-stack.js';
import { NetworkStack } from '../lib/platform/network-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const networkTemplate = (stage: string): Template =>
    Template.fromStack(new NetworkStack(new App(), `Net-${stage}`, { env, stage }));

describe('NetworkStack per-stage CIDRs', () => {
    it('prod VPC uses 10.0.0.0/16 (explicit value equals the historical default — no replacement)', () => {
        networkTemplate('prod').hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.0.0.0/16' });
    });

    it('sandbox VPC uses a distinct 10.1.0.0/16 so the VPCs can be peered', () => {
        networkTemplate('sandbox').hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.1.0.0/16' });
    });
});

describe('NetworkStack VPC naming', () => {
    it('names the VPC KitchenSink-<stage> (platform-wide, not Identity-specific)', () => {
        networkTemplate('sandbox').hasResourceProperties('AWS::EC2::VPC', {
            Tags: Match.arrayWith([{ Key: 'Name', Value: 'KitchenSink-sandbox' }]),
        });
        networkTemplate('prod').hasResourceProperties('AWS::EC2::VPC', {
            Tags: Match.arrayWith([{ Key: 'Name', Value: 'KitchenSink-prod' }]),
        });
    });
});

describe('NetworkStack DB security-group pairing (ENI_SG_RULES_MISMATCH guard)', () => {
    it('pairs each DB ingress with an egress FROM the same source SG TO the DB SG (not just counts)', () => {
        const template = networkTemplate('prod');
        const key = (value: unknown): string => JSON.stringify(value);

        const ingressOn5432 = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'))
            .map((rule: any) => rule.Properties)
            .filter((p: any) => p?.ToPort === 5432);
        const egressOn5432 = Object.values(template.findResources('AWS::EC2::SecurityGroupEgress'))
            .map((rule: any) => rule.Properties)
            .filter((p: any) => p?.ToPort === 5432);

        // service + lambda each reach the DB → 2 ingress + 2 egress on 5432.
        expect(ingressOn5432.length).toBe(2);
        expect(egressOn5432.length).toBe(2);

        // PAIRING (the actual ENI_SG_RULES_MISMATCH guard): the set of source SGs the DB accepts ingress
        // FROM must exactly equal the set of SGs that egress TO the DB — a right-count/wrong-pairing
        // regression (e.g. lambda allowed ingress but only service granted egress) would pass a
        // count-only check but fails here.
        const ingressSources = new Set(ingressOn5432.map((p: any) => key(p.SourceSecurityGroupId)));
        const egressOwners = new Set(egressOn5432.map((p: any) => key(p.GroupId)));
        expect(ingressSources.size).toBe(2);
        expect(egressOwners).toEqual(ingressSources);

        // …and both sides point at the one DB SG.
        const ingressTargets = new Set(ingressOn5432.map((p: any) => key(p.GroupId)));
        const egressTargets = new Set(egressOn5432.map((p: any) => key(p.DestinationSecurityGroupId)));
        expect(ingressTargets.size).toBe(1);
        expect(egressTargets).toEqual(ingressTargets);
    });
});

describe('DataStack credentials secret', () => {
    it('has no Auth0 reference (service migrated to Clerk)', () => {
        const app = new App();
        const network = new NetworkStack(app, 'NetForData', { env, stage: 'test' });
        const data = new DataStack(app, 'DataForTest', { env, network, stage: 'test' });

        const json = JSON.stringify(Template.fromStack(data).toJSON());
        expect(json.toLowerCase()).not.toContain('auth0');
    });
});
