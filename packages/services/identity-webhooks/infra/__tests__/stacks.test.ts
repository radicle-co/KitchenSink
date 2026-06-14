import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DataStack } from '../lib/data-stack.js';
import { NetworkStack } from '../lib/network-stack.js';
import { WebhooksStack } from '../lib/webhooks-stack.js';
import { IdentityServiceStack } from '../lib/identity-service-stack.js';

let webhooksTemplate: Template;
let dataTemplate: Template;
let serviceTemplate: Template;

const distPath = join(__dirname, '../../dist');

beforeAll(() => {
    mkdirSync(join(distPath, 'handlers'), { recursive: true });
    writeFileSync(join(distPath, 'handlers', 'identityWebhook.js'), 'exports.handler = () => {};');
    writeFileSync(join(distPath, 'handlers', 'deletion-worker.js'), 'exports.handler = () => {};');
    writeFileSync(join(distPath, 'handlers', 'reconciliation.js'), 'exports.handler = () => {};');

    const app = new App({ context: { stage: 'test' } });

    const network = new NetworkStack(app, 'TestNetwork', {
        env: { account: '123456789012', region: 'us-east-1' },
    });

    const data = new DataStack(app, 'TestData', {
        env: { account: '123456789012', region: 'us-east-1' },
        network,
        stage: 'test',
    });

    const webhooks = new WebhooksStack(app, 'TestWebhooks', {
        env: { account: '123456789012', region: 'us-east-1' },
        network,
        data,
        certificate: {
            certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test',
            certificateId: 'test-cert-id',
            stack: { account: '123456789012', region: 'us-east-1' },
            env: { account: '123456789012', region: 'us-east-1' },
            node: { id: 'TestCert' },
        } as any,
        hostedZone: { hostedZoneId: 'ZTEST', zoneName: 'test.com' } as any,
        domainName: 'identity.test.com',
        stage: 'test',
    });

    const service = new IdentityServiceStack(app, 'TestService', {
        env: { account: '123456789012', region: 'us-east-1' },
        network,
        data,
        stage: 'test',
    });

    webhooksTemplate = Template.fromStack(webhooks);
    dataTemplate = Template.fromStack(data);
    serviceTemplate = Template.fromStack(service);
});

afterAll(() => {
    rmSync(distPath, { recursive: true, force: true });
});

describe.skip('No Auth0 references', () => {
    it('webhooks stack JSON contains no AUTH0_DOMAIN', () => {
        const json = JSON.stringify(webhooksTemplate.toJSON());
        expect(json).not.toContain('AUTH0_DOMAIN');
    });

    it('webhooks stack JSON contains no AUTH0_CLIENT_ID', () => {
        const json = JSON.stringify(webhooksTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_ID');
    });

    it('webhooks stack JSON contains no AUTH0_CLIENT_SECRET', () => {
        const json = JSON.stringify(webhooksTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_SECRET');
    });

    it('webhooks stack JSON contains no AUTH0_MANAGEMENT_SECRET_ARN', () => {
        const json = JSON.stringify(webhooksTemplate.toJSON());
        expect(json).not.toContain('AUTH0_MANAGEMENT_SECRET_ARN');
    });

    it('webhooks stack JSON contains no WEBHOOK_SECRET (old auth0 action secret)', () => {
        const json = JSON.stringify(webhooksTemplate.toJSON());
        expect(json).not.toMatch(/["']WEBHOOK_SECRET["']/);
    });

    it('service stack JSON contains no AUTH0_DOMAIN', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_DOMAIN');
    });

    it('service stack JSON contains no AUTH0_CLIENT_ID', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_ID');
    });

    it('service stack JSON contains no AUTH0_CLIENT_SECRET', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_SECRET');
    });

    it('data stack JSON contains no auth0 in secret description', () => {
        const json = JSON.stringify(dataTemplate.toJSON());
        expect(json.toLowerCase()).not.toContain('auth0');
    });
});

describe.skip('Identity env vars present', () => {
    it('webhooks lambda has AUTH_SECRET_ARN env var', () => {
        const allFunctions = webhooksTemplate.findResources('AWS::Lambda::Function');
        const hasIdentityKey = Object.values(allFunctions).some(
            (fn: any) => 'AUTH_SECRET_ARN' in (fn.Properties?.Environment?.Variables ?? {}),
        );
        expect(hasIdentityKey).toBe(true);
    });
});

describe.skip('User webhook route', () => {
    it('API Gateway has POST /webhooks/users resource', () => {
        webhooksTemplate.hasResourceProperties('AWS::ApiGateway::Resource', {
            PathPart: 'users',
        });
    });

    it('POST method on users resource exists', () => {
        webhooksTemplate.hasResourceProperties('AWS::ApiGateway::Method', {
            HttpMethod: 'POST',
            AuthorizationType: 'NONE',
        });
    });
});

describe.skip('Deletion worker has IDP_SECRET_ARN', () => {
    it('deletion worker lambda has IDP_SECRET_ARN', () => {
        const allFunctions = webhooksTemplate.findResources('AWS::Lambda::Function');
        const hasIdentityKey = Object.values(allFunctions).some(
            (fn: any) => 'IDP_SECRET_ARN' in (fn.Properties?.Environment?.Variables ?? {}),
        );
        expect(hasIdentityKey).toBe(true);
    });
});
