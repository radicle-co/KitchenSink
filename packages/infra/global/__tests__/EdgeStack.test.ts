/**
 * ⛔ THE ACCEPTANCE CRITERION for the three production CloudFront distributions (plan U16, ADR-0020).
 *
 * ADR-0020 records TWO P0 defects that its own first design would have shipped, each caught only because
 * three reviewers independently landed on it. Both are properties of the SYNTHESIZED TEMPLATE, invisible in
 * a code review of the stack, and both are asserted here:
 *
 * | Invariant                                                                        | Test                                                     |
 * | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
 * | Owner-scoped recipe responses are keyed per PRINCIPAL, not per URL (P0 #1)        | 'keys recipe on the verified principal …'                |
 * | Food's caller-independent nutrition route keys on URL alone, and really caches     | 'keys food nutrition on the URL alone'                   |
 * | Identity caches NOTHING                                                           | 'caches nothing anywhere on identity'                    |
 * | `/health*` and `/api/v1/internal/*` are not merely exempt — the edge is NOT in     | 'attaches no function to a passthrough behavior' (P0 #2) |
 * | …and every other behavior IS verified                                             | 'attaches the viewer-request verifier to …'              |
 * | The origin is the internal name from ONE resolver, never a hand-written string     | 'origins from internalOriginForStage'                    |
 * | Identity forwards `Authorization` + `Origin` (ADR-0001 failure class)              | 'forwards Authorization and Origin …'                    |
 * | …and NOT the viewer `Host`, which U17 step 4 would break                           | 'sends the ORIGIN host, not the viewer Host'             |
 * | The runtime is pinned to one Lambda@Edge actually offers                           | 'pins a Lambda@Edge-supported Node runtime'              |
 * | Lambda@Edge's own constraints (no env, x86_64, ≤5s, dual trust policy)             | 'satisfies Lambda@Edge's execution constraints'          |
 * | Synth FAILS LOUDLY without the build-time key                                      | 'refuses to synthesize without CLERK_JWT_KEY'            |
 * | …and without a real bundle, or with one built from a different key                 | 'refuses to synthesize … bundle'                         |
 * | DNS is untouched — U17 owns the cutover                                            | 'claims no alias yet'                                    |
 * | Prod only — no sandbox, no per-PR                                                  | 'refuses to synthesize outside prod'                     |
 * | cdk-nag reviews it, advisory                                                       | 'reports cdk-nag findings … at warning level'            |
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactMetadataEntryType } from 'aws-cdk-lib/cloud-assembly-schema';
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { attachSecurityChecks } from '@kitchensink/infra-security';
import {
    EDGE_CUTOVER_SERVICES_ENV,
    EDGE_ORIGIN_HEADER_NAME,
    EPHEMERAL_SLOT_ORDER,
    edgeOriginHeaderFor,
    internalOriginForStage,
} from '@kitchensink/infra-alb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IConstruct } from 'constructs';

import { EDGE_ACCESS_LOG_RETENTION_DAYS, EDGE_LAMBDA_RUNTIME, EdgeStack } from '../lib/platform/EdgeStack.js';
import { EDGE_PRINCIPAL_HEADER, PASSTHROUGH_PATH_PATTERNS } from '../lib/edge-verifier/edgeRoutes.js';
import { TEST_EDGE_JWT_KEY, stubEdgeBundleDir } from './edgeBundleFixture.js';

const env = { account: '123456789012', region: 'us-east-1' };
const domainName = 'commise.app';

interface CacheBehavior {
    readonly PathPattern?: string;
    readonly CachePolicyId: unknown;
    readonly OriginRequestPolicyId?: unknown;
    readonly TargetOriginId: string;
    readonly ViewerProtocolPolicy: string;
    readonly AllowedMethods?: readonly string[];
    readonly LambdaFunctionAssociations?: readonly { readonly EventType: string }[];
}

interface DistributionOrigin {
    readonly Id: string;
    readonly DomainName: unknown;
    readonly CustomOriginConfig?: Record<string, unknown>;
    readonly OriginCustomHeaders?: readonly { readonly HeaderName: string; readonly HeaderValue: string }[];
}

interface DistributionConfig {
    readonly Comment?: string;
    readonly Aliases?: readonly string[];
    readonly ViewerCertificate?: Record<string, unknown>;
    readonly Origins: readonly DistributionOrigin[];
    readonly DefaultCacheBehavior: CacheBehavior;
    readonly CacheBehaviors?: readonly CacheBehavior[];
}

/** Synthesize the stack under test with everything the production path supplies. */
function synthesize(
    overrides: { readonly stage?: string; readonly bundleDir?: string; readonly cutOver?: string } = {},
): Stack {
    const app = new App();
    const previous = process.env[EDGE_CUTOVER_SERVICES_ENV];

    if (overrides.cutOver === undefined) {
        delete process.env[EDGE_CUTOVER_SERVICES_ENV];
    } else {
        process.env[EDGE_CUTOVER_SERVICES_ENV] = overrides.cutOver;
    }

    try {
        return new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage: overrides.stage ?? 'prod',
            domainName,
            verifierBundleDir: overrides.bundleDir ?? stubEdgeBundleDir(),
        });
    } finally {
        if (previous === undefined) {
            delete process.env[EDGE_CUTOVER_SERVICES_ENV];
        } else {
            process.env[EDGE_CUTOVER_SERVICES_ENV] = previous;
        }
    }
}

/** Every distribution in the template, indexed by the service its origin names. */
function distributionsByService(template: Template): Record<string, DistributionConfig> {
    const found: Record<string, DistributionConfig> = {};

    for (const resource of Object.values(template.findResources('AWS::CloudFront::Distribution'))) {
        const config = (resource as { Properties: { DistributionConfig: DistributionConfig } }).Properties
            .DistributionConfig;
        const host = String(config.Origins[0]?.DomainName);
        const service = host.split('.')[0] ?? host;

        found[service] = config;
    }

    return found;
}

/** Every behavior of a distribution — the default one first, then the path-pattern ones. */
function behaviorsOf(config: DistributionConfig): readonly CacheBehavior[] {
    return [config.DefaultCacheBehavior, ...(config.CacheBehaviors ?? [])];
}

/** The behavior serving `pathPattern`, or the default behavior when `pathPattern` is omitted. */
function behaviorFor(config: DistributionConfig, pathPattern?: string): CacheBehavior {
    const behavior =
        pathPattern === undefined
            ? config.DefaultCacheBehavior
            : (config.CacheBehaviors ?? []).find((candidate) => candidate.PathPattern === pathPattern);

    expect(behavior, `no behavior for ${pathPattern ?? '(default)'}`).toBeDefined();

    return behavior!;
}

/**
 * The cache-key configuration a behavior actually uses.
 *
 * A behavior names either a MANAGED policy (a literal id) or one this stack creates (a `Ref`), so the id is
 * resolved through the template rather than assumed — asserting on the `Ref` alone would pass for a policy
 * that keys on nothing.
 */
function cacheKeyOf(
    template: Template,
    behavior: CacheBehavior,
): {
    readonly managedId?: string;
    readonly headers: readonly string[];
    readonly queryStrings: string;
    readonly defaultTtl?: number;
} {
    const id = behavior.CachePolicyId;

    if (typeof id === 'string') {
        return { managedId: id, headers: [], queryStrings: 'managed' };
    }

    const logicalId = (id as { Ref: string }).Ref;
    const policy = template.findResources('AWS::CloudFront::CachePolicy')[logicalId] as {
        Properties: {
            CachePolicyConfig: {
                DefaultTTL: number;
                ParametersInCacheKeyAndForwardedToOrigin: {
                    HeadersConfig: { HeaderBehavior: string; Headers?: readonly string[] };
                    QueryStringsConfig: { QueryStringBehavior: string };
                };
            };
        };
    };

    expect(policy, `cache policy ${logicalId} is not in the template`).toBeDefined();

    const config = policy.Properties.CachePolicyConfig;
    const headersConfig = config.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig;

    return {
        headers: headersConfig.HeaderBehavior === 'none' ? [] : (headersConfig.Headers ?? []),
        queryStrings: config.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior,
        defaultTtl: config.DefaultTTL,
    };
}

const ORIGINAL_KEY = process.env['CLERK_JWT_KEY'];

beforeEach(() => {
    process.env['CLERK_JWT_KEY'] = TEST_EDGE_JWT_KEY;
});

afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
        delete process.env['CLERK_JWT_KEY'];
    } else {
        process.env['CLERK_JWT_KEY'] = ORIGINAL_KEY;
    }
});

describe('one distribution per service, originating from the internal ALB name', () => {
    it('fronts exactly the three services on the shared listener', () => {
        const services = Object.keys(distributionsByService(Template.fromStack(synthesize()))).sort();

        // Derived from the ALB registry, not restated: a fourth service joining the shared listener must
        // make a deliberate decision about its edge rather than silently having none.
        expect(services).toEqual([...EPHEMERAL_SLOT_ORDER].sort());
    });

    it('takes every origin from internalOriginForStage, never a hand-written string', () => {
        const distributions = distributionsByService(Template.fromStack(synthesize()));

        for (const service of EPHEMERAL_SLOT_ORDER) {
            const origin = internalOriginForStage({ service, stage: 'prod', domainName });

            expect(origin).toBeDefined();
            expect(distributions[service]?.Origins[0]?.DomainName).toBe(origin!.host);
        }
    });

    it('talks to the origin over HTTPS only, and answers viewers over HTTPS only', () => {
        const distributions = distributionsByService(Template.fromStack(synthesize()));

        for (const config of Object.values(distributions)) {
            expect(config.Origins[0]?.CustomOriginConfig?.['OriginProtocolPolicy']).toBe('https-only');

            for (const behavior of behaviorsOf(config)) {
                expect(behavior.ViewerProtocolPolicy).toBe('redirect-to-https');
            }
        }
    });

    it('allows every method an API needs, not just the cacheable ones', () => {
        const distributions = distributionsByService(Template.fromStack(synthesize()));

        for (const config of Object.values(distributions)) {
            for (const behavior of behaviorsOf(config)) {
                // A default of GET/HEAD only would answer 405 to every write — and to the erasure POST.
                expect(behavior.AllowedMethods).toEqual(
                    expect.arrayContaining(['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE']),
                );
            }
        }
    });

    it('claims no alias until a service is DECLARED cut over — U17 cuts one at a time', () => {
        // Attaching `{service}.commise.app` here while the A-record still points at the ALB would move the
        // public name's ownership without being asked, and U17 cuts one service at a time with a
        // verification between each.
        for (const config of Object.values(distributionsByService(Template.fromStack(synthesize())))) {
            expect(config.Aliases ?? []).toEqual([]);
        }
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for the edge's half of the U17 DNS cutover.
 *
 * The service stacks release `{service}.commise.app` when `EDGE_CUTOVER_SERVICES` names them
 * (`publicRecordOwnerFor` in `@kitchensink/infra-alb`). This is the other side of that handoff: for exactly
 * the same set of services, THIS stack must claim the name — as a distribution alias AND as the Route 53
 * record that resolves to it.
 *
 * Both stacks read the same variable through the same resolver, which is what makes the handoff atomic in
 * intent. It is emphatically NOT atomic in execution — they are two `cdk deploy`s, and the public name does
 * not resolve in between. That window is the owner-accepted downtime, and the order is fixed: the service
 * stack releases FIRST, because Route 53 refuses a duplicate record and the reverse order simply fails.
 */
describe('the U17 DNS cutover (ADR-0020)', () => {
    /** The domain names, per service, that the cutover is supposed to move. */
    const publicHostFor = (service: string): string => `${service}.${domainName}`;

    /**
     * Every Route 53 record name in the template, in CDK's trailing-dot FQDN form.
     *
     * @param template - The synthesized template.
     * @returns The record names.
     */
    function recordNames(template: Template): readonly string[] {
        return Object.values(template.findResources('AWS::Route53::RecordSet')).map(
            (record) => (record as { Properties: { Name: string } }).Properties.Name,
        );
    }

    it('publishes NOTHING in DNS while no service has cut over', () => {
        // The default an unset variable produces, and the state U16 shipped in. A record here would collide
        // with the one the service stack still owns.
        const template = Template.fromStack(synthesize());

        template.resourceCountIs('AWS::Route53::RecordSet', 0);
    });

    it('⛔ claims the alias AND the record for a cut-over service, and only for that one', () => {
        // The handoff. Claiming the alias without the record leaves a distribution nobody can reach by
        // name; claiming the record without the alias makes CloudFront answer 403 `SSL_ERROR` /
        // `The distribution does not have an alias for this domain`, because it matches viewer requests
        // to a distribution BY the Host header against its alias list.
        const template = Template.fromStack(synthesize({ cutOver: 'food' }));
        const distributions = distributionsByService(template);

        expect(distributions['food']?.Aliases).toEqual([publicHostFor('food')]);
        expect(distributions['recipe']?.Aliases ?? []).toEqual([]);
        expect(distributions['identity']?.Aliases ?? []).toEqual([]);

        expect(recordNames(template)).toEqual([`${publicHostFor('food')}.`]);
    });

    it('⛔ aliases the record to the DISTRIBUTION, never back to the ALB', () => {
        // The whole point of the cutover. An A-record aliased at the shared ALB would leave the edge
        // deployed, paid for, and entirely out of the request path — and every assertion about caching,
        // token verification and origin lockdown in this file would describe something no viewer reaches.
        const template = Template.fromStack(synthesize({ cutOver: 'food' }));
        const record = Object.values(template.findResources('AWS::Route53::RecordSet'))[0] as {
            Properties: { AliasTarget?: { DNSName?: unknown; HostedZoneId?: unknown } };
        };

        // CDK emits CloudFront's alias hosted-zone id through a partition MAPPING rather than the literal
        // `Z2FDTNDATAQYW2`, so the assertion is on the mapping's identity. It still separates the two
        // targets this test exists to tell apart: a `LoadBalancerTarget` would emit an `Fn::ImportValue`
        // of the shared ALB's canonical hosted-zone id, which contains neither.
        expect(JSON.stringify(record.Properties.AliasTarget?.HostedZoneId)).toContain('CloudFront');
        expect(JSON.stringify(record.Properties.AliasTarget?.DNSName)).toContain('DomainName');
        expect(JSON.stringify(record.Properties.AliasTarget)).not.toContain('SharedAlb');
    });

    it('attaches the ACM certificate that actually covers the name it is claiming', () => {
        // CloudFront requires a us-east-1 certificate, and the apex `KitchenSinkCertificate` already
        // carries `*.commise.app` — so U17 needs no new certificate, only the import. A distribution with
        // an alias and no certificate is refused at deploy time.
        const template = Template.fromStack(synthesize({ cutOver: 'food' }));
        const config = distributionsByService(template)['food'];

        expect(JSON.stringify(config?.ViewerCertificate)).toContain('CertificateArn');
    });

    it('claims all three once the cutover is complete — the steady state', () => {
        const template = Template.fromStack(synthesize({ cutOver: 'food,recipe,identity' }));
        const distributions = distributionsByService(template);

        for (const service of EPHEMERAL_SLOT_ORDER) {
            expect(distributions[service]?.Aliases).toEqual([publicHostFor(service)]);
        }

        expect([...recordNames(template)].sort()).toEqual(
            [...EPHEMERAL_SLOT_ORDER].map((service) => `${publicHostFor(service)}.`).sort(),
        );
    });

    it('⛔ leaves the ORIGIN untouched by the cutover — the alias is a viewer-side name only', () => {
        // A tempting and fatal simplification is to point the origin at the public name once it resolves to
        // CloudFront. That is a distribution whose origin is itself: an infinite loop that bills per
        // request. The origin must remain the internal ALB name in every cut-over state.
        for (const cutOver of [undefined, 'food', 'food,recipe,identity']) {
            const distributions = distributionsByService(Template.fromStack(synthesize({ cutOver })));

            for (const service of EPHEMERAL_SLOT_ORDER) {
                const origin = internalOriginForStage({ service, stage: 'prod', domainName });

                expect(String(distributions[service]?.Origins[0]?.DomainName)).toBe(origin?.host);
            }
        }
    });

    it('⛔ refuses to synthesize when the cut-over set names a service that does not exist', () => {
        // Delegated to the shared resolver, asserted here because THIS is the stack where a typo would
        // otherwise mean "claim nothing" — the silent half of the failure, with the service stack having
        // already released the record.
        expect(() => synthesize({ cutOver: 'fod' })).toThrow(/fod/);
    });
});

describe('the cache key per route class (ADR-0020 trap 1 — the P0 data leak)', () => {
    it('keys recipe on the verified principal, so two callers never share an owner-scoped entry', () => {
        const template = Template.fromStack(synthesize());
        const recipe = distributionsByService(template)['recipe']!;
        const key = cacheKeyOf(template, behaviorFor(recipe));

        expect(key.headers.map((header) => header.toLowerCase())).toContain(EDGE_PRINCIPAL_HEADER);
    });

    it('keys recipe on the query string too, so a filtered list is not served for an unfiltered one', () => {
        const template = Template.fromStack(synthesize());
        const recipe = distributionsByService(template)['recipe']!;

        expect(cacheKeyOf(template, behaviorFor(recipe)).queryStrings).toBe('all');
    });

    it('lets recipe origins decide what may be cached at all (default TTL 0)', () => {
        // The key is correct-by-construction; the TTL is deliberately origin-controlled, because the recipe
        // service sends no `Cache-Control` today and edge-caching mutable user data behind a stage-chosen
        // TTL would show a user a list that does not contain the recipe they just created.
        const template = Template.fromStack(synthesize());
        const recipe = distributionsByService(template)['recipe']!;

        expect(cacheKeyOf(template, behaviorFor(recipe)).defaultTtl).toBe(0);
    });

    it('keys food nutrition on the URL alone — no principal component', () => {
        const template = Template.fromStack(synthesize());
        const food = distributionsByService(template)['food']!;
        const key = cacheKeyOf(template, behaviorFor(food, '/api/v1/foods/nutrition*'));

        expect(key.headers).toEqual([]);
        expect(key.queryStrings).toBe('all');
    });

    it('really caches food nutrition, rather than keying a cache nothing ever enters', () => {
        // The whole reason food has a distribution. The food service sets no `Cache-Control`, so an
        // origin-controlled TTL here would cache exactly nothing and the URL-only key would be decoration.
        const template = Template.fromStack(synthesize());
        const food = distributionsByService(template)['food']!;

        expect(cacheKeyOf(template, behaviorFor(food, '/api/v1/foods/nutrition*')).defaultTtl!).toBeGreaterThan(0);
    });

    it('covers the deprecated /v1 nutrition alias with the same cache policy', () => {
        const template = Template.fromStack(synthesize());
        const food = distributionsByService(template)['food']!;

        expect(behaviorFor(food, '/v1/foods/nutrition*').CachePolicyId).toEqual(
            behaviorFor(food, '/api/v1/foods/nutrition*').CachePolicyId,
        );
    });

    it('caches nothing else on food — only the route whose response is caller-independent', () => {
        const template = Template.fromStack(synthesize());
        const food = distributionsByService(template)['food']!;

        expect(cacheKeyOf(template, behaviorFor(food)).managedId).toBe(CachePolicy.CACHING_DISABLED.cachePolicyId);
    });

    it('caches nothing anywhere on identity — every response is per-user', () => {
        const template = Template.fromStack(synthesize());
        const identity = distributionsByService(template)['identity']!;

        for (const behavior of behaviorsOf(identity)) {
            expect(cacheKeyOf(template, behavior).managedId).toBe(CachePolicy.CACHING_DISABLED.cachePolicyId);
        }
    });

    it("food's URL-only key stays sound only while food emits no CORS — asserted, not assumed", () => {
        // A `Vary: Origin` response cached on the URL alone would serve one origin's
        // `access-control-allow-origin` to another. The food service deliberately calls no `enableCors()`
        // (unlike recipe and identity), which is what makes the URL-only key correct. If that changes, the
        // cache policy must gain `Origin` in the SAME change — so the premise is checked here rather than
        // recorded in a comment.
        const main = readFileSync(
            fileURLToPath(new URL('../../../services/food-service/src/main.ts', import.meta.url)),
            'utf8',
        );

        expect(main).not.toContain('enableCors');
    });
});

describe('the passthrough list is enforced by TOPOLOGY, not only by the verifier (trap 2 and trap 3)', () => {
    const pathPatterns = PASSTHROUGH_PATH_PATTERNS.filter((pattern) => pattern !== '/health*');

    it('gives every service a /health* behavior with no function attached', () => {
        // `prod-deploy.yml` curls /health unauthenticated and expects 200, and so does the ALB health check.
        // No association means a cold start or a bug in the verifier cannot take the health signal down.
        for (const config of Object.values(distributionsByService(Template.fromStack(synthesize())))) {
            expect(behaviorFor(config, '/health*').LambdaFunctionAssociations ?? []).toEqual([]);
        }
    });

    it.each([...EPHEMERAL_SLOT_ORDER])(
        'gives %s an unverified behavior for each internal service-principal prefix',
        (service) => {
            // The erasure fan-out carries an EdDSA SERVICE token; a Clerk verifier rejects it, the deletion
            // worker rethrows, and SQS retries forever. The origin verifies it (`ServiceErasureGuard`).
            //
            // Applied uniformly rather than only to the two services that have such a route today: the
            // passthrough registry is ONE list, and a service that grows an internal route later must not
            // have to remember to come back here. On identity the prefix routes to nothing, and identity's
            // own `AuthMiddleware` still challenges every non-/health path.
            const config = distributionsByService(Template.fromStack(synthesize()))[service]!;

            for (const pattern of pathPatterns) {
                expect(behaviorFor(config, pattern).LambdaFunctionAssociations ?? []).toEqual([]);
            }
        },
    );

    it('attaches the viewer-request verifier to every behavior that is NOT a passthrough', () => {
        const template = Template.fromStack(synthesize());

        for (const config of Object.values(distributionsByService(template))) {
            for (const behavior of behaviorsOf(config)) {
                const isPassthrough = PASSTHROUGH_PATH_PATTERNS.some((pattern) => pattern === behavior.PathPattern);
                const associations = behavior.LambdaFunctionAssociations ?? [];

                expect(
                    associations.map((association) => association.EventType),
                    `${behavior.PathPattern ?? '(default)'} associations`,
                ).toEqual(isPassthrough ? [] : ['viewer-request']);
            }
        }
    });
});

describe('header forwarding — the ADR-0001 failure class, and the one place this deviates from ADR-0020', () => {
    it('forwards Authorization and Origin to every origin (CachingDisabled controls CACHING, not forwarding)', () => {
        const template = Template.fromStack(synthesize());

        for (const config of Object.values(distributionsByService(template))) {
            for (const behavior of behaviorsOf(config)) {
                expect(behavior.OriginRequestPolicyId).toBe(
                    OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
                );
            }
        }
    });

    it('sends the ORIGIN host, not the viewer Host, so the shared listener can still route the request', () => {
        // ⛔ ADR-0020 says identity "forwards the viewer Host". Doing so breaks the ALB host-based rule at
        // TWO points, so this asserts the opposite and the ADR is wrong: pre-cutover the viewer Host is the
        // CloudFront domain, which matches no rule and gets ADR-0003's default 404; and U17 step 4 REMOVES
        // the public host condition, after which the viewer Host `{service}.commise.app` matches nothing
        // either. `ALL_VIEWER_EXCEPT_HOST_HEADER` forwards every viewer header EXCEPT Host — which is
        // exactly Authorization + Origin + the rest — and lets the origin domain drive Host and SNI.
        const managed = OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId;

        expect(managed).not.toBe(OriginRequestPolicy.ALL_VIEWER.originRequestPolicyId);
    });
});

/**
 * ⛔ THE ACCEPTANCE CRITERION for the secret origin header, edge side (plan U17, ADR-0020 trap 5).
 *
 * The prefix-list restriction on prod's ALB authorizes **CloudFront**, not **our** CloudFront: the origin
 * hostnames are published in the public zone, so anyone may point their own distribution at
 * `food.internal.commise.app` and reach the ALB with this verifier out of the path. The boundary is the
 * shared secret header, and this is the half that SENDS it.
 *
 * The ordering is not symmetric and cannot be simplified: the distribution must send the header BEFORE the
 * ALB requires it. A listener rule that demands a header no distribution sends yet answers ADR-0003's
 * default `404` to all production traffic.
 */
describe('the secret origin header (ADR-0020 trap 5 — the boundary the prefix list is NOT)', () => {
    it('sends the header from every distribution, so no service is reachable around the edge', () => {
        const header = edgeOriginHeaderFor('prod');
        const distributions = distributionsByService(Template.fromStack(synthesize()));

        expect(header).toBeDefined();

        for (const service of EPHEMERAL_SLOT_ORDER) {
            const custom = distributions[service]?.Origins[0]?.OriginCustomHeaders ?? [];

            expect(
                custom.map((entry) => entry.HeaderName),
                `${service} custom headers`,
            ).toContain(header!.headerName);
        }
    });

    it('⛔ sends a dynamic REFERENCE, never the secret — this repository is public', () => {
        const distributions = distributionsByService(Template.fromStack(synthesize()));

        for (const service of EPHEMERAL_SLOT_ORDER) {
            const entry = (distributions[service]?.Origins[0]?.OriginCustomHeaders ?? []).find(
                (candidate) => candidate.HeaderName === EDGE_ORIGIN_HEADER_NAME,
            );

            expect(entry?.HeaderValue, `${service} header value`).toMatch(/^\{\{resolve:secretsmanager:/u);
        }
    });

    it('⛔ commits no opaque 64-character literal anywhere in the template', () => {
        // The scan that proves the assertion above was not defeated by some OTHER path putting the value in.
        // CDK legitimately emits 64-character runs — an asset hash, and substrings of long logical ids — so
        // the discriminator is the ALPHABET rather than the length: an asset hash is lower-case hex, while a
        // value generated from `excludePunctuation`'s 62-character alphabet is mixed-case alphanumeric with
        // overwhelming probability. Paste a real secret in and this reds.
        const json = JSON.stringify(Template.fromStack(synthesize()).toJSON());
        const exactlySixtyFour = json.match(/(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/gu) ?? [];

        for (const run of exactlySixtyFour) {
            expect(run, `64-character literal ${run}`).toMatch(/^[0-9a-f]{64}$/u);
        }
    });

    it('⛔ carries the header on the PASSTHROUGH behaviors too, via the one shared origin', () => {
        // `/health*` and `/api/v1/internal/*` have no function association, so nothing in the handler could
        // add the header for them. They inherit it because every behavior points at the SAME origin — which
        // is what makes the GDPR erasure fan-out work through a locked-down ALB with no special case.
        // Restructuring the origin per behavior would silently strand exactly those paths.
        for (const config of Object.values(distributionsByService(Template.fromStack(synthesize())))) {
            expect(config.Origins).toHaveLength(1);

            const originId = config.Origins[0]!.Id;

            for (const behavior of behaviorsOf(config)) {
                expect(behavior.TargetOriginId, `${behavior.PathPattern ?? '(default)'} origin`).toBe(originId);
            }
        }
    });

    it('keeps sending the header through every cut-over state', () => {
        // The cutover moves the public NAME; it must not move the boundary. A state that stopped sending the
        // header would 404 the whole service the moment the ALB condition is in place.
        for (const cutOver of [undefined, 'food', 'food,recipe,identity']) {
            const distributions = distributionsByService(Template.fromStack(synthesize({ cutOver })));

            for (const service of EPHEMERAL_SLOT_ORDER) {
                expect(
                    (distributions[service]?.Origins[0]?.OriginCustomHeaders ?? []).map((e) => e.HeaderName),
                    `${service} @ cutOver=${String(cutOver)}`,
                ).toContain(EDGE_ORIGIN_HEADER_NAME);
            }
        }
    });

    it('talks to the origin over HTTPS, which is what keeps the header secret in flight', () => {
        // A `http-only` or `match-viewer` origin policy would put a 64-character bearer of the origin
        // boundary on the wire in clear text. Asserted here, next to the header, rather than only in the
        // protocol test above — this is the reason the protocol choice is not merely a preference.
        for (const config of Object.values(distributionsByService(Template.fromStack(synthesize())))) {
            expect(config.Origins[0]?.CustomOriginConfig?.['OriginProtocolPolicy']).toBe('https-only');
        }
    });
});

describe("the function satisfies Lambda@Edge's own constraints", () => {
    it('pins a Lambda@Edge-supported Node runtime, not the repo-wide one', () => {
        // `@kitchensink/clerk-verify` declares `engines: node 24.x` and every other Lambda here runs
        // `nodejs24.x`, which Lambda@Edge does not offer. cdk-nag reports AwsSolutions-L1 for this on
        // purpose: the finding is accurate and the constraint is AWS's, so it stays visible.
        expect(EDGE_LAMBDA_RUNTIME.name).toBe('nodejs22.x');
        Template.fromStack(synthesize()).hasResourceProperties('AWS::Lambda::Function', {
            Runtime: 'nodejs22.x',
        });
    });

    it('declares no environment variables — Lambda@Edge cannot read them', () => {
        const functions = Template.fromStack(synthesize()).findResources('AWS::Lambda::Function');

        for (const resource of Object.values(functions)) {
            expect((resource as { Properties: Record<string, unknown> }).Properties['Environment']).toBeUndefined();
        }
    });

    it('runs on x86_64 within the viewer-request timeout and memory ceilings', () => {
        const template = Template.fromStack(synthesize());

        template.hasResourceProperties('AWS::Lambda::Function', {
            Architectures: ['x86_64'],
            MemorySize: 128,
            Timeout: 5,
        });
    });

    it('is assumable by BOTH lambda and edgelambda, or CloudFront cannot replicate it', () => {
        // A role trusting only `lambda.amazonaws.com` is accepted at create time and fails at replication.
        const roles = Template.fromStack(synthesize()).findResources('AWS::IAM::Role');
        const trust = JSON.stringify(
            Object.values(roles).map(
                (role) => (role as { Properties: Record<string, unknown> }).Properties['AssumeRolePolicyDocument'],
            ),
        );

        expect(trust).toContain('edgelambda.amazonaws.com');
        expect(trust).toContain('lambda.amazonaws.com');
    });

    it('associates a published VERSION — CloudFront cannot reference $LATEST', () => {
        Template.fromStack(synthesize()).resourceCountIs('AWS::Lambda::Version', 1);
    });
});

describe('the stack fails loudly rather than shipping something that cannot work', () => {
    it('refuses to synthesize without CLERK_JWT_KEY (ADR-0020 trap 6)', () => {
        delete process.env['CLERK_JWT_KEY'];

        expect(() => synthesize()).toThrow(/CLERK_JWT_KEY/u);
    });

    it('refuses to synthesize when the verifier bundle is absent', () => {
        // There is deliberately NO placeholder. A throwing stub is a total outage of both cached services;
        // a pass-through stub leaves the cache-partition header unset, which collapses every caller onto one
        // cache entry — the P0 this whole unit exists to prevent.
        expect(() => synthesize({ bundleDir: '/nonexistent/edge-bundle' })).toThrow(/bundle/iu);
    });

    it('refuses to synthesize a bundle built from a DIFFERENT key than synth was handed', () => {
        // The rotation hazard ADR-0020's runbook names: the key is compiled into the bundle, so a stale
        // bundle plus a fresh key is a verifier that rejects every request in production, discoverable only
        // in production on a 5–15 minute loop.
        expect(() =>
            synthesize({ bundleDir: stubEdgeBundleDir('-----BEGIN PUBLIC KEY-----\nstale\n-----END-----') }),
        ).toThrow(/key/iu);
    });

    it('refuses to synthesize outside prod — there is no edge on sandbox or a per-PR preview', () => {
        // A distribution takes 5–15 minutes to deploy and cannot be deleted without first disabling it and
        // waiting for propagation, which would wreck the ADR-0005 teardown and the ADR-0010 deploy gate.
        expect(() => synthesize({ stage: 'sandbox' })).toThrow(/prod/u);
    });
});

describe('cdk-nag reviews the edge, advisory', () => {
    it('reports findings at warning level and none at error level', () => {
        const app = new App();

        attachSecurityChecks(app);
        new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage: 'prod',
            domainName,
            verifierBundleDir: stubEdgeBundleDir(),
        });
        app.synth();

        const errors: string[] = [];
        const warnings: string[] = [];

        for (const node of (app as IConstruct).node.findAll()) {
            for (const entry of node.node.metadata) {
                if (entry.type === ArtifactMetadataEntryType.ERROR) {
                    errors.push(String(entry.data));
                } else if (entry.type === ArtifactMetadataEntryType.WARN) {
                    warnings.push(String(entry.data));
                }
            }
        }

        expect(warnings.filter((message) => message.startsWith('AwsSolutions-')).length).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    it('accepts CFR1/CFR2 per distribution and S1 on the log bucket, and nothing else anywhere', () => {
        // ⚠️ REWRITTEN (2026-09-03). This used to assert the template carried NO `cdk_nag` metadata at all,
        // which was true and right while the edge accepted nothing. The owner triaged `CFR1`/`CFR2` on these
        // three PRODUCTION distributions and `S1` on the access-log bucket that fixing `CFR3` introduced
        // (ADR-0013), so the claim becomes the stronger one: exactly those rules, on exactly those resource
        // TYPES, and no suppression anywhere else in the stack — the Lambda@Edge function, its role, the
        // certificate and the delivery resources must all still report.
        //
        // ⛔ It is NOT enough that the platform allowlist pins the same set: that suite compares logical IDs,
        // which say nothing about WHICH resource type they name. This one asserts the shape at the site.
        const template = Template.fromStack(synthesize()).toJSON() as {
            Resources: Record<
                string,
                { Type: string; Metadata?: { cdk_nag?: { rules_to_suppress?: { id: string }[] } } }
            >;
        };
        const suppressed = Object.entries(template.Resources)
            .flatMap(([logicalId, resource]) =>
                (resource.Metadata?.cdk_nag?.rules_to_suppress ?? []).map((rule) => ({
                    logicalId,
                    type: resource.Type,
                    id: rule.id,
                })),
            )
            .toSorted((left, right) => `${left.logicalId}${left.id}`.localeCompare(`${right.logicalId}${right.id}`));

        expect(suppressed.map((entry) => `${entry.type} ${entry.id}`).toSorted()).toEqual([
            'AWS::CloudFront::Distribution AwsSolutions-CFR1',
            'AWS::CloudFront::Distribution AwsSolutions-CFR1',
            'AWS::CloudFront::Distribution AwsSolutions-CFR1',
            'AWS::CloudFront::Distribution AwsSolutions-CFR2',
            'AWS::CloudFront::Distribution AwsSolutions-CFR2',
            'AWS::CloudFront::Distribution AwsSolutions-CFR2',
            'AWS::S3::Bucket AwsSolutions-S1',
        ]);
        // Every distribution, not merely three suppressions that could all sit on one — plus the bucket.
        const distributions = Object.values(template.Resources).filter(
            (resource) => resource.Type === 'AWS::CloudFront::Distribution',
        ).length;

        expect(new Set(suppressed.map((entry) => entry.logicalId)).size).toBe(distributions + 1);
    });

    it('leaves CFR3 REPORTING — a FALSE POSITIVE, never suppressed, explained instead', () => {
        // ⛔ The negative control on the acceptance above, and the reason it must exist: a suppression that
        // drifted from `[CFR1, CFR2]` to a broader set would still satisfy "the distributions carry
        // suppressions" and would silently launder a finding nobody ruled on.
        //
        // ⚠️ CFR3 fires even though access logging IS enabled. cdk-nag's `CloudFrontDistributionAccessLogging`
        // reads `distributionConfig.logging` — the LEGACY (v1) property — and this stack logs through
        // standard logging **v2** (`AWS::Logs::DeliverySource`/`DeliveryDestination`/`Delivery`), which the
        // rule cannot see. So the finding is a false positive: left reporting, EXPLAINED rather than
        // suppressed, on ADR-0025's precedent. The claim that makes it explained is asserted separately,
        // and derived — 'delivers access logs for EVERY distribution' below — so the two together say
        // "three findings, and three distributions that really are logging", which is a stronger statement
        // than either alone.
        const app = new App();

        attachSecurityChecks(app);
        new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage: 'prod',
            domainName,
            verifierBundleDir: stubEdgeBundleDir(),
        });
        app.synth();

        const warnings = (app as IConstruct).node
            .findAll()
            .flatMap((node) => node.node.metadata)
            .filter((entry) => entry.type === ArtifactMetadataEntryType.WARN)
            .map((entry) => String(entry.data));

        expect(warnings.filter((message) => message.startsWith('AwsSolutions-CFR3')).length).toBe(3);
        expect(warnings.filter((message) => message.startsWith('AwsSolutions-CFR1'))).toEqual([]);
        expect(warnings.filter((message) => message.startsWith('AwsSolutions-CFR2'))).toEqual([]);
    });
});

/**
 * ⛔ ACCESS LOGGING, via standard logging **v2** — and why not the legacy path the lint would have accepted.
 *
 * cdk-nag's `CFR3` reads only `DistributionConfig.Logging`, so the LEGACY (v1) path is the one that makes the
 * finding go away. It was rejected on three grounds, all of which outrank a quieter lint:
 *
 * 1. **v1 requires ACLs ENABLED on the log bucket** — AWS: _"Don't choose an Amazon S3 bucket with S3 Object
 *    Ownership set to bucket owner enforced. That setting disables ACLs … which prevents CloudFront from
 *    delivering log files."_ Satisfying the lint would mean WEAKENING a brand-new bucket to a model AWS is
 *    moving away from. v2 uses a bucket policy and no ACLs at all.
 * 2. **v1's failure mode is deploy-time, on a stack that cannot be rehearsed.** `EdgeStack` is prod-only
 *    (`bin/app.ts` gates it on `stage === 'prod'`), so its first execution is production. A bucket with ACLs
 *    disabled synthesizes clean and is REJECTED when CloudFront tries to write.
 * 3. **v1 mutates the bucket ACL out of band.** CloudFront calls `PutBucketAcl` to grant `awslogsdelivery`
 *    FULL_CONTROL, so CloudFormation does not own that grant and a `cdk diff` cannot show it drifting.
 *
 * The cost of choosing v2 is that `CFR3` keeps reporting on all three distributions. That is recorded in
 * ADR-0013 as a FALSE POSITIVE with the rule's own source quoted, never suppressed — and the assertions here
 * are what make the ADR's row true rather than a claim.
 */
describe('the edge delivers access logs (ADR-0013 CFR3 triage)', () => {
    it('delivers access logs for EVERY distribution, derived from the distributions themselves', () => {
        // ⛔ DERIVED, not a list of three names. The subject set is whatever distributions the template
        // contains, so a fourth service joining the edge without logging reds here rather than shipping dark.
        const template = Template.fromStack(synthesize());
        const distributionIds = Object.keys(template.findResources('AWS::CloudFront::Distribution'));
        const sources = Object.values(template.findResources('AWS::Logs::DeliverySource')) as {
            Properties: { ResourceArn: unknown; LogType: string; Name: string };
        }[];

        expect(distributionIds.length).toBeGreaterThan(0);
        expect(sources.length).toBe(distributionIds.length);
        // Every delivery source names a distribution IN THIS TEMPLATE, and asks for access logs.
        expect(sources.map((source) => source.Properties.LogType)).toEqual(distributionIds.map(() => 'ACCESS_LOGS'));
        expect(
            sources
                .map((source) => JSON.stringify(source.Properties.ResourceArn))
                .filter((arn) => distributionIds.some((id) => arn.includes(id))).length,
            'a delivery source that does not reference a distribution in this template logs nothing',
        ).toBe(distributionIds.length);
    });

    it('links every source to the one destination, which is the log bucket', () => {
        const template = Template.fromStack(synthesize());
        const destinations = Object.entries(template.findResources('AWS::Logs::DeliveryDestination'));
        const deliveries = Object.values(template.findResources('AWS::Logs::Delivery')) as {
            Properties: { DeliveryDestinationArn: unknown; DeliverySourceName: unknown };
        }[];
        const buckets = Object.keys(template.findResources('AWS::S3::Bucket'));

        // ONE destination for all three: three would be three identical resources with three names to keep
        // in step, and the per-service separation is already carried by the delivery's suffix path.
        expect(destinations.length).toBe(1);
        expect(deliveries.length).toBe(Object.keys(template.findResources('AWS::Logs::DeliverySource')).length);
        expect(buckets.length).toBe(1);

        const [destinationId, destination] = destinations[0] as [
            string,
            { Properties: { DestinationResourceArn: unknown } },
        ];

        expect(JSON.stringify(destination.Properties.DestinationResourceArn)).toContain(buckets[0] ?? '');

        for (const delivery of deliveries) {
            expect(JSON.stringify(delivery.Properties.DeliveryDestinationArn)).toContain(destinationId);
        }
    });

    it('bounds the bucket: blocked, encrypted, TLS-only, and expiring', () => {
        // ⛔ The lifecycle rule is the reason this cannot grow unbounded. Volume is trivial today (630
        // requests across all three distributions over 30 days, measured), which is exactly when an
        // unbounded log bucket is easiest to ship and hardest to notice.
        const template = Template.fromStack(synthesize());

        template.hasResourceProperties('AWS::S3::Bucket', {
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
            },
            BucketEncryption: {
                ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
            },
            LifecycleConfiguration: {
                Rules: [{ Status: 'Enabled', ExpirationInDays: EDGE_ACCESS_LOG_RETENTION_DAYS }],
            },
        });
    });

    it('keeps ACLs DISABLED, which is the whole reason v2 was chosen', () => {
        // ⛔ The inverse of the legacy path's requirement, asserted so nobody "fixes" CFR3 by switching to v1
        // and quietly re-enabling ACLs on this bucket. `BucketOwnerEnforced` is what v1 forbids.
        const template = Template.fromStack(synthesize());

        template.hasResourceProperties('AWS::S3::Bucket', {
            OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        });

        // …and no distribution carries the legacy `Logging` block, which is the property CFR3 reads.
        for (const resource of Object.values(template.findResources('AWS::CloudFront::Distribution'))) {
            expect(
                (resource as { Properties: { DistributionConfig: { Logging?: unknown } } }).Properties
                    .DistributionConfig.Logging,
            ).toBeUndefined();
        }
    });

    it('⛔ EXPLAINS every CFR3 finding: one per distribution, and every one of them is logging', () => {
        // ⛔ THE ASSERTION THAT MAKES ADR-0013's `CFR3` ROW TRUE RATHER THAN A PROMISE, and the reason the
        // finding may be left reporting instead of suppressed. It is a biconditional in substance: the
        // number of findings equals the number of distributions, AND the number of distributions equals the
        // number of deliveries. So "cdk-nag reports three" and "three distributions really are logging" are
        // asserted together — a distribution that quietly lost its delivery would keep the finding count
        // identical and is caught by the other half.
        //
        // ADR-0025's precedent: where a finding is accurate-but-not-ours (there, the Python runtime) or
        // inaccurate-but-not-ours (here, a rule reading the legacy property), what is asserted is the
        // EXPLANATION, so the claim flips on its own the day cdk-nag learns to read `AWS::Logs::Delivery`.
        const app = new App();

        attachSecurityChecks(app);
        const stack = new EdgeStack(app, 'Edge', {
            env,
            stackName: 'kitchensink-edge-prod',
            stage: 'prod',
            domainName,
            verifierBundleDir: stubEdgeBundleDir(),
        });
        const template = Template.fromStack(stack);

        app.synth();

        const findings = (app as IConstruct).node
            .findAll()
            .flatMap((node) => node.node.metadata)
            .filter((entry) => entry.type === ArtifactMetadataEntryType.WARN)
            .map((entry) => String(entry.data))
            .filter((message) => message.startsWith('AwsSolutions-CFR3'));
        const distributions = Object.keys(template.findResources('AWS::CloudFront::Distribution')).length;

        expect(findings.length).toBe(distributions);
        expect(Object.keys(template.findResources('AWS::Logs::Delivery')).length).toBe(distributions);
    });

    it('admits the log-delivery service to the bucket, scoped to this account', () => {
        // Without this statement the deliveries are created and silently deliver nothing. The conditions are
        // AWS's own documented ones — an unconditioned grant to `delivery.logs.amazonaws.com` would let any
        // account's delivery write here.
        const template = Template.fromStack(synthesize());
        const policies = Object.values(template.findResources('AWS::S3::BucketPolicy')) as {
            Properties: { PolicyDocument: { Statement: { Principal?: { Service?: unknown }; Condition?: unknown }[] } };
        }[];
        const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
        // Exact principal equality, not a substring of the serialised policy. The substring form also
        // matched `delivery.logs.amazonaws.com.evil` or a principal buried in a Condition, and CodeQL
        // (`js/incomplete-url-substring-sanitization`) read it as a host check for that reason. `Service`
        // is a string for one principal and an array for several; both shapes are handled and neither is
        // matched by prefix.
        //
        // Spelled as `===` under `.some`, not `Array.prototype.includes`: the two are equivalent, but the
        // analyzer cannot distinguish `Array.includes` from `String.includes` when the argument is a
        // hostname, and re-flagged the `.includes` form. Strict equality is unambiguous to a reader and to
        // the tool.
        const delivery = statements.filter((statement) => {
            const service = statement.Principal?.Service;
            const services = Array.isArray(service) ? service : [service];

            return services.some((candidate) => candidate === 'delivery.logs.amazonaws.com');
        });

        expect(delivery.length).toBe(1);
        expect(JSON.stringify(delivery[0]?.Condition ?? {})).toContain('aws:SourceAccount');
    });
});

describe('Aspects wiring is not accidentally load-bearing', () => {
    it('synthesizes identically with and without the security Aspect (ADR-0002 no-diff discipline)', () => {
        const plain = new App();
        const nagged = new App();

        attachSecurityChecks(nagged);

        const template = (app: App): string =>
            JSON.stringify(
                Template.fromStack(
                    new EdgeStack(app, 'Edge', {
                        env,
                        stackName: 'kitchensink-edge-prod',
                        stage: 'prod',
                        domainName,
                        verifierBundleDir: stubEdgeBundleDir(),
                    }),
                ).toJSON(),
                null,
                2,
            );

        expect(template(nagged)).toBe(template(plain));
        expect(Aspects.of(nagged).all.length).toBeGreaterThan(0);
    });
});
