/**
 * DomainStack owns the platform's Route53 hosted-zone lookup + the ACM certificate, and it is the
 * single producer of the `kitchensink-domain-${stage}:HostedZoneId` and `:CertificateArn` exports
 * that identity, identity-webhooks, food-service, and the web SandboxRouter all `Fn.importValue`.
 * Dropping or renaming either export, or narrowing the certificate's SANs, silently breaks every
 * downstream consumer — so these tests pin the exact export names and the wildcard SAN set.
 */
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { DomainStack } from '../lib/platform/domain-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };
const domainName = 'commise.app';

const domainTemplate = (stage: string): Template =>
    Template.fromStack(
        new DomainStack(new App(), `Domain-${stage}`, {
            env,
            stackName: `kitchensink-domain-${stage}`,
            domainName,
        }),
    );

describe('DomainStack ACM certificate', () => {
    it('requests exactly one certificate for the apex domain', () => {
        const template = domainTemplate('prod');

        template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
        template.hasResourceProperties('AWS::CertificateManager::Certificate', {
            DomainName: domainName,
        });
    });

    it('covers the apex + first-label and sandbox wildcards (per-service + per-PR hosts resolve)', () => {
        // ADR-0003 host-based routing and ADR-0001 sandbox addressing depend on `*.commise.app`
        // (identity/food subdomains) AND `*.sandbox.commise.app` (sandbox previews) both being on the
        // cert. Assert the exact SAN set so narrowing it (which would 4xx TLS for a whole tier) fails.
        domainTemplate('prod').hasResourceProperties('AWS::CertificateManager::Certificate', {
            SubjectAlternativeNames: Match.arrayWith([`*.${domainName}`, `*.sandbox.${domainName}`]),
        });
    });

    it('validates via DNS (not email) against the hosted zone', () => {
        // DNS validation is what lets the cert issue unattended in CI; email validation would hang deploys.
        const cert = Object.values(domainTemplate('prod').findResources('AWS::CertificateManager::Certificate'))[0] as {
            Properties: { ValidationMethod?: string };
        };

        expect(cert.Properties.ValidationMethod).toBe('DNS');
    });
});

describe('DomainStack cross-stack exports (consumed by identity/webhooks/food/web-router)', () => {
    it('exports HostedZoneId under the exact name downstream stacks importValue', () => {
        const outputs = domainTemplate('sandbox').findOutputs('*');
        const exportNames = Object.values(outputs).map((o: { Export?: { Name?: string } }) => o.Export?.Name);

        expect(exportNames).toContain('kitchensink-domain-sandbox:HostedZoneId');
    });

    it('exports CertificateArn under the exact name the web SandboxRouter importValues', () => {
        const outputs = domainTemplate('sandbox').findOutputs('*');
        const exportNames = Object.values(outputs).map((o: { Export?: { Name?: string } }) => o.Export?.Name);

        expect(exportNames).toContain('kitchensink-domain-sandbox:CertificateArn');
    });

    it('scopes the export names to the stage so prod and sandbox never collide', () => {
        const prodNames = Object.values(domainTemplate('prod').findOutputs('*')).map(
            (o: { Export?: { Name?: string } }) => o.Export?.Name,
        );

        expect(prodNames).toContain('kitchensink-domain-prod:HostedZoneId');
        expect(prodNames).toContain('kitchensink-domain-prod:CertificateArn');
        // The sandbox-scoped names must NOT appear in the prod template (per-stage isolation).
        expect(prodNames).not.toContain('kitchensink-domain-sandbox:HostedZoneId');
    });
});
