import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

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

/**
 * ⛔ THE ACCEPTANCE CRITERION for U17's origin lockdown, asserted across BOTH stacks on purpose.
 *
 * ## The defect this exists to catch, which a single-stack assertion cannot
 *
 * `SharedAlbStack` passes `open: true` to both `addListener` calls. That is not a listener setting — it
 * calls `allowDefaultPortFrom(Peer.anyIpv4())` on `network.albSecurityGroup`, which is the SAME construct
 * instance `NetworkStack` created and already opened. Today the two are identical, CDK dedupes them, and
 * the live rules carry NetworkStack's descriptions, so `open: true` is invisible.
 *
 * The moment the lockdown narrows NetworkStack's `:443` rule to the CloudFront prefix list, the dedupe
 * stops matching and `open: true` re-emits `0.0.0.0/0:443` — as a standalone `AWS::EC2::SecurityGroupIngress`
 * in **SharedAlbStack's** template. Security-group rules are a union, so the ALB stays open to the whole
 * internet while `NetworkStack`'s template, its tests, and a `cdk diff` scoped to the stack that was
 * actually edited all show a correct, locked-down result.
 *
 * That is why every assertion here reads BOTH templates. An identical suite that trusted the edited stack
 * would pass against a completely open load balancer.
 */
describe('the U17 origin lockdown (prod only, ADR-0020)', () => {
    /**
     * Synthesize the network + ALB pair for a stage.
     *
     * @param stage - The deploy stage.
     * @returns Both templates, which must be asserted TOGETHER — see this block's docstring.
     * @sideEffect None beyond CDK synth.
     */
    function synthPair(stage: string): { readonly network: Template; readonly alb: Template } {
        const app = new App({
            context: {
                'hosted-zone:account=123456789012:domainName=example.com:region=us-east-1': {
                    Id: '/hostedzone/DUMMY',
                    Name: 'example.com.',
                },
            },
        });
        const network = new NetworkStack(app, `Net-${stage}`, { env, stage });
        const domain = new DomainStack(app, `Domain-${stage}`, { env, domainName: 'example.com', stage });
        const alb = new SharedAlbStack(app, `SharedAlb-${stage}`, {
            env,
            stackName: `kitchensink-alb-${stage}`,
            network,
            domain,
            stage,
        });

        return { network: Template.fromStack(network), alb: Template.fromStack(alb) };
    }

    /**
     * Every inbound rule on the ALB security group across BOTH templates, in either shape CDK emits —
     * inline `SecurityGroupIngress` on the group, or a standalone `AWS::EC2::SecurityGroupIngress`.
     *
     * @param templates - The network and ALB templates.
     * @returns The flattened inbound rules.
     */
    function albIngress(templates: {
        readonly network: Template;
        readonly alb: Template;
    }): readonly Record<string, unknown>[] {
        const rules: Record<string, unknown>[] = [];

        for (const template of [templates.network, templates.alb]) {
            for (const group of Object.values(template.findResources('AWS::EC2::SecurityGroup'))) {
                const properties = (group as { Properties: Record<string, unknown> }).Properties;

                if (String(properties['GroupDescription']).includes('RDS')) {
                    continue;
                }

                rules.push(...((properties['SecurityGroupIngress'] as Record<string, unknown>[]) ?? []));
            }

            rules.push(
                ...Object.values(template.findResources('AWS::EC2::SecurityGroupIngress')).map(
                    (rule) => (rule as { Properties: Record<string, unknown> }).Properties,
                ),
            );
        }

        return rules;
    }

    it('⛔ leaves NO 0.0.0.0/0 ingress on :443 in EITHER template for prod', () => {
        // The assertion that catches the `open: true` leak. It must span both templates — see the docstring.
        const open443 = albIngress(synthPair('prod')).filter(
            (rule) => rule['CidrIp'] === '0.0.0.0/0' && rule['FromPort'] === 443,
        );

        expect(open443).toEqual([]);
    });

    it('⛔ admits :443 ONLY from the CloudFront origin-facing prefix list in prod', () => {
        const prefixed = albIngress(synthPair('prod')).filter(
            (rule) => rule['FromPort'] === 443 && rule['SourcePrefixListId'] !== undefined,
        );

        expect(prefixed).toHaveLength(1);
    });

    it('keeps :80 a plain CIDR rule — the prefix list would blow the security-group quota', () => {
        // ⛔ NOT a stylistic choice. An AWS-managed prefix list counts against the 60-rules-per-security-group
        // quota by its WEIGHT (55 for CloudFront's), not by its current entry count. One such rule fits with
        // four to spare; a second one costs 110 and the deploy fails. :80 only redirects to :443, so it has
        // nothing to protect and stays a single cheap rule.
        const rules = albIngress(synthPair('prod'));
        const port80 = rules.filter((rule) => rule['FromPort'] === 80);

        expect(port80).toHaveLength(1);
        expect(port80[0]?.['CidrIp']).toBe('0.0.0.0/0');
        expect(port80[0]?.['SourcePrefixListId']).toBeUndefined();
    });

    it('⛔ leaves every NON-prod stage wide open, in both templates — no distribution fronts them', () => {
        // Sandbox and every per-PR preview reach their own ALB directly (ADR-0020 is prod-only). Locking
        // them down would make every preview unreachable, and it would do so silently.
        for (const stage of ['sandbox', 'test']) {
            const rules = albIngress(synthPair(stage));
            const open443 = rules.filter((rule) => rule['CidrIp'] === '0.0.0.0/0' && rule['FromPort'] === 443);

            expect(open443, `stage ${stage} must keep public :443`).toHaveLength(1);
            expect(rules.filter((rule) => rule['SourcePrefixListId'] !== undefined)).toEqual([]);
        }
    });
});
