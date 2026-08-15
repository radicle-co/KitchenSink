import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

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

    it('an unknown/dev stage falls back to the throwaway 10.2.0.0/16 (synth/test never throws)', () => {
        // The fallback keeps local synth + the test harness working; it must be a THIRD range so a dev
        // synth can never overlap-collide with prod (10.0) or sandbox (10.1).
        networkTemplate('dev').hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.2.0.0/16' });
    });

    it('prod and sandbox are fully independent synths — deriving one never mutates the other', () => {
        // Guards against a shared/mutable CIDR map: read prod AFTER sandbox and confirm it is untouched.
        const sandboxCidr = Object.values(networkTemplate('sandbox').findResources('AWS::EC2::VPC')).map(
            (r: any) => r.Properties.CidrBlock,
        );
        const prodCidr = Object.values(networkTemplate('prod').findResources('AWS::EC2::VPC')).map(
            (r: any) => r.Properties.CidrBlock,
        );

        expect(sandboxCidr).toEqual(['10.1.0.0/16']);
        expect(prodCidr).toEqual(['10.0.0.0/16']);
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

describe('NetworkStack NAT (cost: instance, not Gateway)', () => {
    it('uses a t4g.nano NAT instance and no managed NAT Gateway (minimize-nat, issue #46)', () => {
        const t = networkTemplate('sandbox');
        // A managed NAT Gateway is ~$32/mo/stage; the instance is ~$3-4/mo. Guard the swap so a future
        // edit does not silently reintroduce the Gateway.
        t.resourceCountIs('AWS::EC2::NatGateway', 0);
        t.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't4g.nano' });
    });

    it('provisions exactly one NAT instance and no Gateway on prod too (both stages minimize NAT)', () => {
        const t = networkTemplate('prod');
        t.resourceCountIs('AWS::EC2::NatGateway', 0);
        t.resourceCountIs('AWS::EC2::Instance', 1);
        t.hasResourceProperties('AWS::EC2::Instance', { InstanceType: 't4g.nano' });
    });

    it('scopes the NAT instance SG ingress to the VPC CIDR — never 0.0.0.0/0 (ADR-0004)', () => {
        const template = networkTemplate('sandbox');

        // Identify the VPC and the NAT SG by their synthesized identity (description), not by a
        // brittle logical-id, so a construct-id rename does not break the guard.
        const vpcLogicalId = Object.keys(template.findResources('AWS::EC2::VPC'))[0];

        const natSgs = Object.values(template.findResources('AWS::EC2::SecurityGroup')).filter(
            (sg: any) => sg.Properties.GroupDescription === 'Security Group for NAT instances',
        );
        expect(natSgs.length).toBe(1);

        const ingress = ((natSgs[0] as any).Properties.SecurityGroupIngress ?? []) as any[];
        expect(ingress.length).toBe(1);

        // The single ingress rule must reference the VPC's OWN CidrBlock (private subnets route egress
        // through the NAT), allowing all protocols — and must NOT be a public 0.0.0.0/0 opening, which
        // would turn the NAT instance into an open relay.
        const rule = ingress[0];
        expect(rule.IpProtocol).toBe('-1');
        expect(rule.CidrIp).toEqual({ 'Fn::GetAtt': [vpcLogicalId, 'CidrBlock'] });

        // Belt-and-suspenders: no ingress rule on the NAT SG opens to the public internet.
        for (const r of ingress) {
            expect(r.CidrIp).not.toBe('0.0.0.0/0');
        }
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
