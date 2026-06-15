import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DataStack } from '../lib/identity/data-stack.js';
import { NetworkStack } from '../lib/identity/network-stack.js';

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

describe('NetworkStack DB security-group pairing (ENI_SG_RULES_MISMATCH guard)', () => {
    it('every DB ingress on 5432 has a matching source-SG egress on 5432', () => {
        const template = networkTemplate('prod');

        const ingressOn5432 = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')).filter(
            (rule: any) => rule.Properties?.ToPort === 5432,
        );
        const egressOn5432 = Object.values(template.findResources('AWS::EC2::SecurityGroupEgress')).filter(
            (rule: any) => rule.Properties?.ToPort === 5432,
        );

        // service + lambda each reach the DB → 2 ingress rules, each paired with a source-SG egress.
        expect(ingressOn5432.length).toBe(2);
        expect(egressOn5432.length).toBe(2);
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
