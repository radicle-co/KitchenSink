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

import { DomainStack } from '../lib/platform/DomainStack.js';

const env = { account: '123456789012', region: 'us-east-1' };
const domainName = 'commise.app';

const domainTemplate = (stage: string): Template =>
    Template.fromStack(
        new DomainStack(new App(), `Domain-${stage}`, {
            env,
            stackName: `kitchensink-domain-${stage}`,
            domainName,
            stage,
        }),
    );

describe('DomainStack ACM certificate', () => {
    it('requests exactly one certificate for the apex domain', () => {
        // Counting apex certs specifically, not all certs: prod legitimately carries a SECOND cert for
        // `*.internal.{domain}` (ADR-0020 / U15). A bare total-count assertion would either forbid that
        // addition or, once relaxed to 2, stop catching a genuine duplicate of the apex cert — which is
        // the regression this test exists for.
        const apexCerts = Object.values(
            domainTemplate('prod').findResources('AWS::CertificateManager::Certificate'),
        ).filter((c) => (c as { Properties: { DomainName?: string } }).Properties.DomainName === domainName);

        expect(apexCerts).toHaveLength(1);
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

/**
 * ADR-0020 / plan U15 — the ADDITIVE `*.internal.commise.app` certificate.
 *
 * The shared ALB certificate covers SINGLE-label wildcards only (`*.commise.app`,
 * `*.sandbox.commise.app`) — verified against the live account 2026-08-15 — so a 3-label origin host
 * like `food.internal.commise.app` fails the TLS handshake. The CloudFront edge needs exactly such a
 * host to origin at.
 *
 * ⛔ The fix is a SECOND certificate, never a SAN added to the existing one. `KitchenSinkCertificate`'s
 * ARN is exported as `${stackName}:CertificateArn` and imported by SharedAlbStack, identity, webhooks,
 * food and the web router; changing its `subjectAlternativeNames` REPLACES the resource and mints a new
 * ARN, and ADR-0002 records that "CloudFormation refuses to change an export while another stack imports
 * it … A naive deploy deadlocks on export-in-use." These tests pin both halves: the new cert exists, and
 * the original's SAN set is untouched.
 */
describe('DomainStack internal-origin certificate (prod only)', () => {
    it('adds a second certificate covering the internal-origin wildcard in prod', () => {
        const template = domainTemplate('prod');

        template.resourceCountIs('AWS::CertificateManager::Certificate', 2);
        template.hasResourceProperties('AWS::CertificateManager::Certificate', {
            DomainName: `*.internal.${domainName}`,
        });
    });

    it('leaves the original certificate untouched — a SAN change would deadlock on export-in-use', () => {
        // The regression this guards is not "the wildcard is missing" but "someone added it to the
        // EXISTING cert", which synthesizes fine and dies mid-deploy (ADR-0002).
        const certs = Object.values(
            domainTemplate('prod').findResources('AWS::CertificateManager::Certificate'),
        ) as Array<{ Properties: { DomainName?: string; SubjectAlternativeNames?: string[] } }>;
        const apex = certs.find((c) => c.Properties.DomainName === domainName);

        expect(apex?.Properties.SubjectAlternativeNames).toEqual([`*.${domainName}`, `*.sandbox.${domainName}`]);
    });

    it('exports the internal certificate ARN under a stage-scoped name', () => {
        const outputs = domainTemplate('prod').findOutputs('*');
        const exportNames = Object.values(outputs).map((o: { Export?: { Name?: string } }) => o.Export?.Name);

        expect(exportNames).toContain('kitchensink-domain-prod:InternalCertificateArn');
    });

    it('creates NOTHING extra outside prod — sandbox and per-PR have no distributions to origin from', () => {
        // KTD-7 scopes CloudFront to prod only. A non-prod stage that minted this cert would pay for a
        // validation record and an ACM entry that nothing ever presents.
        const sandbox = domainTemplate('sandbox');

        sandbox.resourceCountIs('AWS::CertificateManager::Certificate', 1);
        expect(
            Object.values(sandbox.findOutputs('*')).map((o: { Export?: { Name?: string } }) => o.Export?.Name),
        ).not.toContain('kitchensink-domain-sandbox:InternalCertificateArn');
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
