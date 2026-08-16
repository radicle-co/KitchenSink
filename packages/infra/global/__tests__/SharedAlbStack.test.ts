import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, beforeAll } from 'vitest';

import { DomainStack } from '../lib/platform/DomainStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { SharedAlbStack } from '../lib/platform/SharedAlbStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

let template: Template;

beforeAll(() => {
    const app = new App({
        context: {
            // DomainStack uses HostedZone.fromLookup; pre-seed it so synth resolves offline.
            'hosted-zone:account=123456789012:domainName=example.com:region=us-east-1': {
                Id: '/hostedzone/DUMMY',
                Name: 'example.com.',
            },
        },
    });
    const network = new NetworkStack(app, 'Net-test', { env, stage: 'test' });
    const domain = new DomainStack(app, 'Domain-test', { env, domainName: 'example.com', stage: 'prod' });
    const alb = new SharedAlbStack(app, 'SharedAlb-test', {
        env,
        stackName: 'kitchensink-alb-test',
        network,
        domain,
        stage: 'test',
    });

    template = Template.fromStack(alb);
});

describe('SharedAlbStack', () => {
    it('creates exactly one internet-facing Application Load Balancer', () => {
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
            Scheme: 'internet-facing',
        });
    });

    it('provisions exactly the two listeners (443 + 80) and no others', () => {
        // A third listener (or a second per port) would mean an accidental extra ingress path.
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 2);
    });

    it('terminates TLS on the HTTPS listener with an attached ACM certificate', () => {
        // Guards against the listener silently reverting to plaintext (certificate dropped).
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
            Port: 443,
            Protocol: 'HTTPS',
            Certificates: Match.arrayWith([Match.objectLike({ CertificateArn: Match.anyValue() })]),
        });
    });

    it('has an HTTPS listener whose default action is a 404 fixed-response', () => {
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
            Port: 443,
            Protocol: 'HTTPS',
            DefaultActions: Match.arrayWith([
                Match.objectLike({
                    Type: 'fixed-response',
                    FixedResponseConfig: Match.objectLike({
                        StatusCode: '404',
                        ContentType: 'text/plain',
                    }),
                }),
            ]),
        });
    });

    it('has an HTTP→HTTPS redirect listener', () => {
        template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
            Port: 80,
            Protocol: 'HTTP',
            DefaultActions: Match.arrayWith([
                Match.objectLike({
                    Type: 'redirect',
                    RedirectConfig: Match.objectLike({
                        Protocol: 'HTTPS',
                        Port: '443',
                        StatusCode: 'HTTP_301',
                    }),
                }),
            ]),
        });
    });

    it('exports the ALB ARN, DNS name, canonical hosted-zone id, and HTTPS listener ARN', () => {
        template.hasOutput('SharedAlbArn', {
            Export: { Name: 'kitchensink-alb-test:SharedAlbArn' },
        });
        template.hasOutput('SharedAlbDnsName', {
            Export: { Name: 'kitchensink-alb-test:SharedAlbDnsName' },
        });
        template.hasOutput('SharedAlbCanonicalHostedZoneId', {
            Export: { Name: 'kitchensink-alb-test:SharedAlbCanonicalHostedZoneId' },
        });
        template.hasOutput('SharedAlbHttpsListenerArn', {
            Export: { Name: 'kitchensink-alb-test:SharedAlbHttpsListenerArn' },
        });
    });
});

/**
 * ADR-0020 / plan U15 — the origin-side certificate reaches the listener.
 *
 * DomainStack mints `*.internal.{domain}` as a SECOND certificate (never a SAN on the first — that
 * replaces an in-use export and deadlocks per ADR-0002). It is only useful if the shared HTTPS listener
 * actually presents it, so this pins the attachment rather than trusting that the cert's existence is
 * enough. A cert that exists but is unattached fails the TLS handshake exactly as if it were missing.
 */
describe('SharedAlbStack internal-origin certificate attachment', () => {
    it('attaches the internal certificate alongside the apex one', () => {
        // CDK keeps the first certificate inline on the listener and emits every additional one as its
        // own ListenerCertificate resource — so the count IS the assertion that a second cert attached.
        template.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerCertificate', 1);
    });
});
