import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    Duration,
    Fn,
    RemovalPolicy,
    Stack,
    type StackProps,
    aws_certificatemanager as acm,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
} from 'aws-cdk-lib';
import { AcceptedNagFindings, acceptNagFindings } from '@kitchensink/infra-security';
import {
    EPHEMERAL_SLOT_ORDER,
    cutOverServicesFromEnv,
    edgeOriginHeaderFor,
    internalOriginForStage,
    publicRecordOwnerFor,
    type SharedListenerService,
} from '@kitchensink/infra-alb';
import type { Construct } from 'constructs';

import { EDGE_PRINCIPAL_HEADER, PASSTHROUGH_PATH_PATTERNS } from '../edge-verifier/edgeRoutes.js';

/**
 * ⚠️ DELIBERATE — see docs/architecture/decisions/0020-cloudfront-edge-and-internal-alb-hostnames.md
 *
 * The production edge: one CloudFront distribution per service on the shared ALB, each originating from that
 * service's `{service}.internal.commise.app` name (plan U15), with a viewer-request Lambda@Edge that
 * verifies the Clerk session token networklessly and partitions the cache per principal.
 *
 * ## Read this before changing a cache policy — the P0 it exists to prevent
 *
 * The tension here is caching versus AUTHORIZATION, not authentication. Verifying a token proves the caller
 * is _someone_; it does not prove they may read _this resource_. Recipe's read routes are owner-scoped from
 * the token, so **every user requests the identical URL and must receive different content** — a URL-only
 * cache key would serve the first caller's recipe list to every other authenticated caller. That defect was
 * in ADR-0020's first design and was caught by three independent reviewers. The cache key per route class:
 *
 * | Route class              | Cache key                                              | Why                              |
 * | ------------------------ | ------------------------------------------------------ | -------------------------------- |
 * | Recipe, owner-scoped     | URL + {@link EDGE_PRINCIPAL_HEADER} (+ `Origin`)       | The response varies by principal |
 * | Food, nutrition          | URL alone                                              | Caller-independent (plan U8)     |
 * | Identity                 | Nothing is cached                                      | Every response is per-user       |
 * | `/health*`, `/…/internal/*` | Nothing is cached, and the edge is not in the path  | See below                        |
 *
 * ## The edge must NOT reject every tokenless request, and topology is how that is guaranteed
 *
 * `PASSTHROUGH_PATH_PATTERNS` gets its own cache behavior on every distribution with **no function
 * association at all**, so the verifier is not merely instructed to let `/health*` and
 * `/api/v1/internal/*` through — it is not in those paths. A cold start, a bad key, or a bug in the handler
 * therefore cannot break the unauthenticated `/health` curl `prod-deploy.yml` expects `200` from, nor the
 * GDPR erasure fan-out, which carries an EdDSA SERVICE token that a Clerk verifier would reject (after which
 * the deletion worker rethrows and SQS retries forever). `OPTIONS` is a method rather than a path, so CORS
 * preflight exemption can only live in the handler; the handler re-checks the path patterns too, as the belt
 * to this braces.
 *
 * ## ⛔ WHERE THIS DEVIATES FROM ADR-0020, AND WHY THE ADR IS WRONG
 *
 * The ADR says identity's distribution "forwards the viewer `Host`". It must not, and the origin request
 * policy here is `ALL_VIEWER_EXCEPT_HOST_HEADER` for all three services. Forwarding the viewer Host breaks
 * the ALB's host-based rule (ADR-0003) at BOTH ends of the cutover:
 *
 *  - **Before U17**, the viewer Host is the `d….cloudfront.net` domain — which matches no listener rule and
 *    receives the shared listener's default `404`. That is precisely the pre-cutover verification U16 is
 *    supposed to make possible.
 *  - **After U17 step 4**, the public host condition is REMOVED from the rule, so a forwarded
 *    `{service}.commise.app` matches nothing either.
 *
 * What the ADR is actually protecting is the ADR-0001 failure class — an origin that terminates on the wrong
 * host — and that concern is real for a Next.js app (Clerk's handshake `redirect_url`, Next 15's
 * Server-Action origin check) and absent for these Nest APIs, which generate no absolute URLs from `Host`
 * and enforce CORS/`azp` from `Origin` and the signed token. `ALL_VIEWER_EXCEPT_HOST_HEADER` forwards every
 * viewer header EXCEPT `Host` — so `Authorization` and `Origin` are forwarded, which is the ADR's real
 * requirement (`CachingDisabled` controls caching, NOT header forwarding, and an unconfigured policy
 * silently strips them). A hand-rolled allowlist policy naming only those two would have been worse: it
 * would also drop `Content-Type`, breaking every request body.
 *
 * ## No placeholder, in either direction
 *
 * Unlike `SandboxSchedulerStack`, this stack REFUSES to synthesize without a real bundle. Both stubs are
 * unacceptable: a throwing one is a total outage of every fronted service, and a pass-through one leaves the
 * cache-partition header unset, which collapses every caller onto one cache entry — the P0 above. The key
 * is checked into the bundle at build time (Lambda@Edge cannot read environment variables), so the bundle is
 * also verified to have been built with the key synth was handed; a stale bundle after a Clerk rotation is
 * otherwise a silent, production-only outage on a 5–15 minute deploy loop.
 *
 * ## Not here, deliberately
 *
 * No aliases, no ACM certificate, no Route 53 records: U17 owns the cutover, one service at a time, identity
 * last. U17 also adds the origin lockdown (restricting prod's ALB `:443` to the CloudFront managed prefix
 * list) — until then `{service}.internal.commise.app` is a naming convention, not a network boundary.
 */
export interface EdgeStackProps extends StackProps {
    /** The deploy stage. Anything but `prod` is refused — CloudFront is production-only (ADR-0020). */
    readonly stage: string;
    /** The apex domain the internal origin names sit under, e.g. `commise.app`. */
    readonly domainName: string;
    /**
     * The directory holding the bundled viewer-request function (`handler.js`), produced by `esbuild.mjs`.
     *
     * Defaults to the package's `dist-edge/`. It is a prop ONLY so a unit test can synthesize against a
     * fixture: absence is a hard synth failure by design, so there has to be a way to give the check
     * something to find without running a bundle. Production never passes it.
     */
    readonly verifierBundleDir?: string;
}

/** The environment variable CI exports from SSM before synth. Public key material — nothing secret. */
export const EDGE_VERIFICATION_KEY_ENV = 'CLERK_JWT_KEY';

/**
 * The Node runtime the edge function is pinned to.
 *
 * ⛔ NOT `NODE_LAMBDA_RUNTIME`. Every other Lambda in this repository runs `nodejs24.x` (and
 * `@kitchensink/clerk-verify` declares `engines: node 24.x`), but **Lambda@Edge offers no `nodejs24.x`**, so
 * the repo-wide pin cannot be used here and a moving alias would be worse. cdk-nag's `AwsSolutions-L1` is
 * therefore reported against this function and left REPORTING: the finding is accurate, the constraint is
 * AWS's, and it clears itself when Lambda@Edge catches up — exactly the treatment `lambdaRuntime.ts` gives
 * the `custom_resources.Provider` framework functions.
 */
export const EDGE_LAMBDA_RUNTIME: lambda.Runtime = lambda.Runtime.NODEJS_22_X;

/**
 * How long an access-log object lives before S3 expires it.
 *
 * ⛔ A CAP, not a preference. CloudFront deletes nothing (AWS: _"CloudFront doesn't automatically delete log
 * files from your destination"_), so a log bucket without a lifecycle rule grows forever — and it grows
 * quietly, because the cost of a bucket nobody looks at is the cost of a bucket nobody looks at. Today's
 * volume makes that easy to miss: all three distributions together served **630 requests over 30 days**
 * (~0.3 MB/month), so nothing would go wrong for years and then would.
 *
 * 90 days matches the retention this ADR-0013 recommendation named for access-log prefixes, and is long
 * enough to investigate an incident found late.
 */
export const EDGE_ACCESS_LOG_RETENTION_DAYS = 90;

/** How long a food nutrition response may be served from the edge before it is revalidated. */
const NUTRITION_DEFAULT_TTL = Duration.hours(1);

/** The ceiling on any edge-cached response, including one an origin asks to keep longer. */
const EDGE_MAX_TTL = Duration.days(1);

/** Whether a service's default (non-passthrough) behavior varies by principal, and what else it caches. */
interface EdgeServicePolicy {
    /**
     * `true` when the default behavior's responses are owner-scoped, so the cache key must carry the
     * verified principal. `false` means the default behavior caches nothing at all.
     */
    readonly ownerScopedDefault: boolean;
    /** Path patterns whose responses are caller-INDEPENDENT and may be cached on the URL alone. */
    readonly sharedCachePathPatterns: readonly string[];
}

/**
 * The per-service edge policy. A `Record` over the ALB registry's own union, so a service added to the
 * shared listener without an edge decision is a COMPILE error rather than a distribution nobody noticed was
 * missing — the same construction `BASE_LISTENER_PRIORITY` uses one package over.
 */
const EDGE_POLICY: Readonly<Record<SharedListenerService, EdgeServicePolicy>> = {
    // Identity sits directly in the Clerk auth path and every response is per-user. Three reviewers argued
    // against fronting it at all; the owner ruled to keep it, and U17 cuts it over LAST.
    identity: { ownerScopedDefault: false, sharedCachePathPatterns: [] },
    // Only the nutrition route. The rest of food (search, status, admin) is either mutable or scope-gated,
    // and caching it would be reach beyond what U8 established as caller-independent.
    //
    // Both the canonical path and the DEPRECATED `/v1` alias (ADR-0011) are listed: the alias is live in
    // production, so covering only the canonical form would leave half the traffic uncached.
    food: {
        ownerScopedDefault: false,
        sharedCachePathPatterns: ['/api/v1/foods/nutrition*', '/v1/foods/nutrition*'],
    },
    // Everything on recipe is owner-scoped: `recipes.controller.ts` declares `@Get()` → `list(ownerId, …)`,
    // and search/collections/photos are all visibility-filtered by the caller.
    recipe: { ownerScopedDefault: true, sharedCachePathPatterns: [] },
};

/** `food` → `Food`, for construct ids. Pure. */
function pascalCase(service: string): string {
    return service.charAt(0).toUpperCase() + service.slice(1);
}

/**
 * The build-time Clerk verification key, or a loud failure.
 *
 * Lambda@Edge cannot read environment variables and this repository's
 * `ssm.StringParameter.valueForStringParameter` pattern resolves at DEPLOY time — too late for an asset
 * bundled and hashed at synth. CI therefore reads the key from SSM and exports it BEFORE synth. A stage that
 * silently shipped a verifier with no key would reject every request, so absence is fatal here rather than
 * defaulted.
 *
 * @param env - The environment to read (injected so the failure path is testable).
 * @returns The PEM public key. Pure w.r.t. its argument.
 * @throws {Error} when the variable is unset or blank.
 */
export function requireEdgeVerificationKey(env: NodeJS.ProcessEnv): string {
    const key = env[EDGE_VERIFICATION_KEY_ENV]?.trim();

    if (!key) {
        throw new Error(
            `${EDGE_VERIFICATION_KEY_ENV} must be exported before synthesizing the CloudFront edge: Lambda@Edge ` +
                'cannot read environment variables, so the key is compiled into the bundle at build time ' +
                '(ADR-0020). CI reads it from SSM /kitchensink/prod/clerk/jwt-public-key.',
        );
    }

    return key;
}

/**
 * The key as it appears inside a JavaScript string literal: real newlines become the two-character escape
 * every JS printer emits for them. Quote-agnostic, so it matches whichever quoting esbuild chose. Pure.
 */
function asStringLiteralBody(key: string): string {
    return key.replace(/\r?\n/gu, '\\n');
}

/**
 * Locate the bundled verifier and prove it was built with the key this synth was handed.
 *
 * The containment check is what makes a Clerk rotation safe: the key is inlined by `esbuild.mjs`'s `define`,
 * so a bundle left over from an earlier build carries the OLD key while synth reports success. That ships a
 * verifier which rejects every request in production, discoverable only in production. A false negative here
 * (e.g. if the bundler ever started minifying) fails the synth loudly, which is the safe direction.
 *
 * @param explicit - A caller-supplied bundle directory (tests only).
 * @param jwtKey - The key synth was handed.
 * @returns The directory to package as the Lambda asset.
 * @throws {Error} when no bundle exists, or it was built from a different key.
 * @sideEffect Reads the filesystem.
 */
function resolveVerifierBundle(explicit: string | undefined, jwtKey: string): string {
    // This module lives at lib/platform/, so the package-root output is two levels up from source (tsx) and
    // three from the compiled dist/lib/platform/ (how CI deploys, via `node dist/bin/app.js`) — probe both.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates =
        explicit === undefined ? [resolve(here, '../../dist-edge'), resolve(here, '../../../dist-edge')] : [explicit];
    const directory = candidates.find((candidate) => existsSync(join(candidate, 'handler.js')));

    if (directory === undefined) {
        throw new Error(
            `The Lambda@Edge verifier bundle is missing (looked in ${candidates.join(', ')}). Run ` +
                `\`npm run bundle:lambda --workspace=packages/infra/global\` with ${EDGE_VERIFICATION_KEY_ENV} ` +
                'exported. There is deliberately no placeholder: a throwing stub is an outage of every fronted ' +
                'service, and a pass-through stub collapses every caller onto one cache entry (ADR-0020 trap 1).',
        );
    }

    if (!readFileSync(join(directory, 'handler.js'), 'utf8').includes(asStringLiteralBody(jwtKey))) {
        throw new Error(
            `The Lambda@Edge verifier bundle in ${directory} was built with a different ` +
                `${EDGE_VERIFICATION_KEY_ENV} than this synth was given. Re-run \`npm run bundle:lambda\` with the ` +
                'current key before deploying — a stale bundle rejects every request at the edge.',
        );
    }

    return directory;
}

/**
 * The production CloudFront edge: three distributions and the viewer-request verifier they share.
 *
 * @implements ADR-0020
 */
export class EdgeStack extends Stack {
    /** Each service's distribution, for U17's alias records and origin lockdown. */
    public readonly distributions: Readonly<Record<SharedListenerService, cloudfront.Distribution>>;

    public constructor(scope: Construct, id: string, props: EdgeStackProps) {
        super(scope, id, props);

        const { stage, domainName } = props;
        const jwtKey = requireEdgeVerificationKey(process.env);

        // ⛔ ONE resolver for the origin host (`@kitchensink/infra-alb`), never a template string here. Four
        // independently-deployed stacks have to agree on it: the service stack matches it as an ALB
        // listener-rule host condition and publishes the Route 53 record, and this stack names it as the
        // CloudFront origin. Nothing checks that they agree — a mismatch synthesizes clean and surfaces in
        // production as a TLS handshake failure or the shared listener's default 404.
        //
        // It returns `undefined` outside prod, which is ALSO the prod-only guard: a distribution takes 5–15
        // minutes to deploy and cannot be deleted without first disabling it and waiting for propagation,
        // which would wreck the ADR-0005 per-PR teardown and the ADR-0010 ensure-exists deploy gate.
        const originHosts = Object.fromEntries(
            EPHEMERAL_SLOT_ORDER.map((service) => {
                const origin = internalOriginForStage({ service, stage, domainName });

                if (origin === undefined) {
                    throw new Error(
                        `The CloudFront edge is prod-only (ADR-0020) and cannot be synthesized for stage '${stage}'. ` +
                            'Sandbox and every per-PR preview reach their ALB directly.',
                    );
                }

                return [service, origin.host];
            }),
        ) as Record<SharedListenerService, string>;

        // U17's cutover, read through the SAME resolver each service stack uses. When a service is named
        // here it has released `{service}.{apex}`, and this stack must claim it — as a distribution alias
        // AND as the record resolving to it. Claiming one without the other is not a partial success:
        // CloudFront matches a viewer request to a distribution by Host against its alias list, so a record
        // pointing at a distribution that does not list the name answers 403 for every request.
        const cutOverServices = cutOverServicesFromEnv(process.env);

        // Imports, not resources. Referenced only on the cut-over path, so a stack with nothing cut over
        // synthesizes exactly as it did in U16 — no cross-stack import, no template diff.
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
            zoneName: domainName,
        });

        // The apex `KitchenSinkCertificate` already carries `*.{apex}` and lives in us-east-1, which is
        // where CloudFront requires it — so the cutover needs NO new certificate, only this import. A
        // second certificate for the same names would be a second thing to renew for no benefit.
        const certificate = acm.Certificate.fromCertificateArn(
            this,
            'ImportedCertificate',
            Fn.importValue(`kitchensink-domain-${stage}:CertificateArn`),
        );

        // ADR-0020 trap 5 — the secret that makes this edge the ONLY way to the origin. The prefix-list
        // restriction on prod's ALB authorizes CloudFront, not ours; the origin hostnames are in the public
        // zone, so without this header anyone may point their own distribution at one.
        //
        // ⛔ ORDERING, and it does not commute: this half must be DEPLOYED FIRST. The listener rules that
        // require the header answer ADR-0003's default 404 to everything until the distribution is sending
        // it, and `DomainStack` must have minted the secret before either resolves the reference.
        //
        // Resolved from the same module the ALB conditions read, so the two cannot be spelled apart — and
        // `undefined` outside prod, where `originHosts` above has already refused to synthesize anyway.
        const originHeader = edgeOriginHeaderFor(stage);

        const verifierVersion = this.createVerifier(props.verifierBundleDir, jwtKey);
        const ownerScopedCachePolicy = this.createOwnerScopedCachePolicy();
        const sharedCachePolicy = this.createSharedCachePolicy();
        const logDestination = this.createAccessLogDestination(stage);

        this.distributions = Object.fromEntries(
            EPHEMERAL_SLOT_ORDER.map((service) => {
                const policy = EDGE_POLICY[service];
                // ⛔ ONE `HttpOrigin` instance per service, shared by `verified()` AND every passthrough
                // behavior below. That sharing is what carries the secret header onto `/health*` and
                // `/api/v1/internal/*`, which have no function association and so have no other way to get
                // it — it is what makes the GDPR erasure fan-out work through the locked-down ALB with no
                // special case. Do not give a behavior its own origin instance.
                const origin = new origins.HttpOrigin(originHosts[service], {
                    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
                    originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
                    ...(originHeader === undefined
                        ? {}
                        : { customHeaders: { [originHeader.headerName]: originHeader.value } }),
                });
                const verified = (cachePolicy: cloudfront.ICachePolicy): cloudfront.BehaviorOptions => ({
                    origin,
                    cachePolicy,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    compress: true,
                    edgeLambdas: [
                        {
                            functionVersion: verifierVersion,
                            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
                        },
                    ],
                });

                const claimsPublicName = publicRecordOwnerFor({ service, stage, cutOverServices }) === 'edge';
                const publicHost = `${service}.${domainName}`;

                const distribution = new cloudfront.Distribution(this, `${pascalCase(service)}Distribution`, {
                    comment: `${service} edge — origin ${originHosts[service]} (ADR-0020)`,
                    // Cost lever, in step with ADR-0008's posture: NA + EU edge locations only. Viewers
                    // elsewhere are still served, from a further edge; the alternative is roughly a
                    // doubling of per-request price for an audience that does not exist yet.
                    priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
                    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
                    defaultBehavior: verified(
                        policy.ownerScopedDefault ? ownerScopedCachePolicy : cloudfront.CachePolicy.CACHING_DISABLED,
                    ),
                    additionalBehaviors: {
                        // No `edgeLambdas`: the edge is NOT in these paths at all (see the class doc).
                        ...Object.fromEntries(
                            PASSTHROUGH_PATH_PATTERNS.map((pattern) => [
                                pattern,
                                {
                                    origin,
                                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                                    compress: true,
                                } satisfies cloudfront.BehaviorOptions,
                            ]),
                        ),
                        ...Object.fromEntries(
                            policy.sharedCachePathPatterns.map((pattern) => [pattern, verified(sharedCachePolicy)]),
                        ),
                    },
                    ...(claimsPublicName ? { domainNames: [publicHost], certificate } : {}),
                });

                // ⛔ Owner triage, ADR-0013 (2026-09-03). `CFR1` (geo restriction) is judged INAPPLICABLE —
                // a country allow/deny list on a consumer recipe app denies legitimate viewers to satisfy a
                // lint and blocks no threat this product has. `CFR2` (WAFv2) is DEFERRED on cost while the
                // product is pre-launch, and that premise expires: the reason text carries the reopening
                // condition, because nothing here can observe "launched".
                //
                // ⚠️ This is its OWN register key, never `CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE` —
                // that entry argues the same two rules for the SANDBOX router and ends "REVISIT if the
                // router ever fronts production". Reusing it here would discharge its revisit condition by
                // ignoring it, which is how it went stale in the first place.
                acceptNagFindings(distribution, AcceptedNagFindings.PRODUCTION_EDGE_GEO_INAPPLICABLE_AND_WAF_DEFERRED);

                this.deliverAccessLogs(service, distribution, logDestination, stage);

                if (claimsPublicName) {
                    // ⛔ Aliased at the DISTRIBUTION, never back at the ALB. An A-record still pointing at
                    // the shared ALB would leave the edge deployed, paid for and completely out of the
                    // request path — with every caching, token-verification and lockdown property in this
                    // stack describing something no viewer ever reaches.
                    new route53.ARecord(this, `${pascalCase(service)}AliasRecord`, {
                        zone: hostedZone,
                        recordName: service,
                        target: route53.RecordTarget.fromAlias(new route53_targets.CloudFrontTarget(distribution)),
                    });
                }

                return [service, distribution];
            }),
        ) as Record<SharedListenerService, cloudfront.Distribution>;
    }

    /**
     * The access-log bucket and the ONE delivery destination every distribution writes through.
     *
     * ## ⛔ Why standard logging **v2**, and not the legacy path the lint would have accepted
     *
     * cdk-nag's `AwsSolutions-CFR3` reads `distributionConfig.logging` — the LEGACY (v1) property — so v1 is
     * the path that makes the finding go away, and v2 leaves it reporting. It was still the wrong path:
     *
     * 1. **v1 requires ACLs ENABLED on the bucket.** AWS: _"Don't choose an Amazon S3 bucket with S3 Object
     *    Ownership set to bucket owner enforced. That setting disables ACLs for the bucket and the objects in
     *    it, which prevents CloudFront from delivering log files."_ Clearing the lint would mean WEAKENING a
     *    brand-new bucket to an access-control model AWS is steering away from — and it would attract its own
     *    findings for doing so. v2 uses a bucket policy and no ACL at all.
     * 2. **v1 fails at DEPLOY time, on a stack that cannot be rehearsed.** This stack is prod-only
     *    (`bin/app.ts` gates it on `stage === 'prod'`), so its first execution is production; a bucket with
     *    ACLs disabled synthesizes perfectly and is rejected when CloudFront tries to write. v2 adds three
     *    resources and does not modify the distribution at all.
     * 3. **v1 mutates the bucket ACL out of band** — CloudFront calls `PutBucketAcl` to grant
     *    `awslogsdelivery` FULL_CONTROL — so CloudFormation does not own that grant and `cdk diff` cannot
     *    show it drifting away.
     *
     * ⚠️ The accepted consequence: `CFR3` keeps reporting on all three distributions even though logging is
     * on. ADR-0013 records it as a FALSE POSITIVE, left REPORTING and never suppressed, with the assertion
     * made about the EXPLANATION — the same treatment ADR-0025 gives the Python runtime and this stack's own
     * `L1`. `EdgeStack.test.ts` asserts every distribution has a delivery, so the ADR's row is a measured
     * claim rather than a promise.
     *
     * ONE destination for all three distributions: three would be three identical resources with three names
     * to keep in step, and per-service separation is already carried by each delivery's suffix path.
     *
     * @param stage - The deploy stage, which names the delivery destination.
     * @returns The delivery destination every {@link deliverAccessLogs} call links to.
     * @sideEffect Adds an S3 bucket, its policy statement, and a `Logs::DeliveryDestination` to this stack.
     */
    private createAccessLogDestination(stage: string): logs.CfnDeliveryDestination {
        const bucket = new s3.Bucket(this, 'EdgeAccessLogs', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            // ⛔ EXPLICIT, and it is the load-bearing half of choosing v2. ACLs stay DISABLED here; the
            // legacy path would have required the opposite. Stating it means a later "fix CFR3 by switching
            // to v1" has to change this line, in review, rather than discover the requirement in production.
            objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
            lifecycleRules: [{ enabled: true, expiration: Duration.days(EDGE_ACCESS_LOG_RETENTION_DAYS) }],
            // Matches the house posture for prod buckets (`DataStack`'s media and archive buckets). Access
            // logs for a pre-launch product do not warrant a RETAIN that would strand a bucket on any
            // rebuild of this stack.
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // ⛔ Owner triage, ADR-0013 (2026-09-03). Fixing `CFR3` ADDS this finding, and that was expected:
        // "log the reads of the log" does not terminate — whatever bucket became this one's server-access-log
        // target would fire `S1` in turn, forever. The chain ends here rather than one bucket further along.
        // ⚠️ The key is NARROW to a bucket whose contents are logs; `DataStack`'s media and archive buckets
        // carry the same finding over USER DATA and it stays open.
        acceptNagFindings(bucket, AcceptedNagFindings.ACCESS_LOG_BUCKET_TERMINATES_THE_LOG_CHAIN);

        // ⛔ Without this the deliveries are created, report healthy, and silently write nothing. The
        // conditions are AWS's own documented ones and they are not decoration: an unconditioned grant to
        // `delivery.logs.amazonaws.com` would let ANY account's delivery write into this bucket.
        bucket.addToResourcePolicy(
            new iam.PolicyStatement({
                sid: 'AWSLogsDeliveryWrite',
                principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
                actions: ['s3:PutObject'],
                resources: [bucket.arnForObjects('*')],
                conditions: {
                    StringEquals: {
                        's3:x-amz-acl': 'bucket-owner-full-control',
                        'aws:SourceAccount': this.account,
                    },
                    ArnLike: {
                        'aws:SourceArn': `arn:${this.partition}:logs:${this.region}:${this.account}:delivery-source:*`,
                    },
                },
            }),
        );

        // ⚠️ `w3c`, not `parquet`: AWS charges CloudWatch conversion fees for Parquet, and at ~0.3 MB/month
        // there is nothing to gain from a columnar format.
        return new logs.CfnDeliveryDestination(this, 'EdgeAccessLogDestination', {
            // Delivery resource names accept `[\w-]` only — no dots.
            name: `kitchensink-edge-access-logs-${stage}`,
            destinationResourceArn: bucket.bucketArn,
            outputFormat: 'w3c',
        });
    }

    /**
     * Wire one distribution's access logs to the shared destination.
     *
     * A distribution may have exactly ONE delivery source (AWS: _"you can only have one delivery source per
     * distribution"_), so this is called once per distribution and never twice.
     *
     * @param service - The service this distribution fronts, which names the resources and the log prefix.
     * @param distribution - The distribution to collect access logs from.
     * @param destination - The shared destination from {@link createAccessLogDestination}.
     * @param stage - The deploy stage, which names the delivery source.
     * @sideEffect Adds a `Logs::DeliverySource` and a `Logs::Delivery` to this stack.
     */
    private deliverAccessLogs(
        service: SharedListenerService,
        distribution: cloudfront.Distribution,
        destination: logs.CfnDeliveryDestination,
        stage: string,
    ): void {
        const source = new logs.CfnDeliverySource(this, `${pascalCase(service)}AccessLogSource`, {
            name: `kitchensink-edge-${service}-${stage}`,
            resourceArn: distribution.distributionArn,
            logType: 'ACCESS_LOGS',
        });

        const delivery = new logs.CfnDelivery(this, `${pascalCase(service)}AccessLogDelivery`, {
            deliverySourceName: source.name,
            deliveryDestinationArn: destination.attrArn,
            // Appended AFTER the `AWSLogs/{account-id}/CloudFront/` prefix AWS adds when the destination ARN
            // carries none. The service name keeps the bucket navigable by a human; the date parts keep a
            // prefix listing bounded.
            s3SuffixPath: `${service}/{DistributionId}/{yyyy}/{MM}/{dd}`,
        });

        // ⛔ EXPLICIT. Neither `Delivery` property is a CloudFormation `Ref` to the source (one is its NAME,
        // a plain string), so CloudFormation infers no ordering and would happily create the delivery first
        // — which fails, naming a delivery source that does not exist yet.
        delivery.addDependency(source);
        delivery.addDependency(destination);
    }

    /**
     * The viewer-request function, published as an immutable version CloudFront can associate.
     *
     * @param bundleDir - Test-only override of the bundle location.
     * @param jwtKey - The key the bundle must have been built with.
     * @returns The published version.
     * @sideEffect Adds a Lambda function, its role, and a version to this stack.
     */
    private createVerifier(bundleDir: string | undefined, jwtKey: string): lambda.IVersion {
        // Lambda@Edge replicas assume the role from BOTH principals; a role trusting only
        // `lambda.amazonaws.com` is accepted at create time and fails when CloudFront tries to replicate.
        const role = new iam.Role(this, 'EdgeVerifierRole', {
            assumedBy: new iam.CompositePrincipal(
                new iam.ServicePrincipal('lambda.amazonaws.com'),
                new iam.ServicePrincipal('edgelambda.amazonaws.com'),
            ),
            description: 'Lambda@Edge viewer-request Clerk verifier (ADR-0020)',
            managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        });

        const verifier = new lambda.Function(this, 'EdgeVerifierFunction', {
            runtime: EDGE_LAMBDA_RUNTIME,
            // Lambda@Edge is x86_64 ONLY — an ARM_64 function is rejected at association time, not at synth.
            architecture: lambda.Architecture.X86_64,
            handler: 'handler.handler',
            code: lambda.Code.fromAsset(resolveVerifierBundle(bundleDir, jwtKey)),
            role,
            // Viewer-request ceilings: 5s and 128 MB. Neither is a tuning choice — they are AWS's limits,
            // and the verification itself is a networkless signature check measured in single-digit ms.
            timeout: Duration.seconds(5),
            memorySize: 128,
            description: 'Verifies the Clerk session token and partitions the CloudFront cache per principal',
            // NO `environment`: Lambda@Edge rejects environment variables outright, which is why the key is
            // compiled in. NO `logGroup` either — a replica logs to the region that served the request, so a
            // log group declared here would be a permanently empty one that reads as if it captured them.
        });

        return verifier.currentVersion;
    }

    /**
     * The cache policy for owner-scoped responses: URL + the verified principal.
     *
     * `Origin` joins the key because the recipe service answers with `Vary: Origin` (its CORS policy is an
     * allowlist, not a wildcard), so a response cached without it could hand one origin's
     * `access-control-allow-origin` to another.
     *
     * The TTL is deliberately ORIGIN-CONTROLLED (`defaultTtl` 0): the key is correct-by-construction, but
     * the recipe service sends no `Cache-Control` today, and edge-caching mutable user data behind a
     * stage-chosen TTL would show a user a list that does not contain the recipe they just created. When a
     * route opts in with a `Cache-Control` header, it is already keyed per principal.
     *
     * @returns The policy.
     * @sideEffect Adds a cache policy to this stack.
     */
    private createOwnerScopedCachePolicy(): cloudfront.CachePolicy {
        return new cloudfront.CachePolicy(this, 'OwnerScopedCachePolicy', {
            comment: 'URL + verified principal — owner-scoped API responses (ADR-0020 trap 1)',
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList(EDGE_PRINCIPAL_HEADER, 'Origin'),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            // Bearer-only services: nothing in recipe or food reads a cookie (asserted by recipe's
            // `bearerOnlyPrecondition.test.ts`), so keying on one would fragment the cache for no signal.
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            minTtl: Duration.seconds(0),
            defaultTtl: Duration.seconds(0),
            maxTtl: EDGE_MAX_TTL,
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
        });
    }

    /**
     * The cache policy for caller-INDEPENDENT responses: the URL alone.
     *
     * ⛔ No header component, deliberately — that is what lets two different authenticated callers share one
     * entry, which is most of why food has a distribution at all. It is sound only while the response really
     * does not vary by caller: U8 canonicalizes the `ids` list (sorted, de-duplicated, capped) so the URL is
     * a stable key, and the food service enables no CORS, so nothing varies by `Origin` either. Both are
     * standing invariants, asserted in `EdgeStack.test.ts` rather than assumed.
     *
     * Unlike the owner-scoped policy this one sets a real `defaultTtl`: the food service sends no
     * `Cache-Control`, so an origin-controlled TTL would cache exactly nothing.
     *
     * @returns The policy.
     * @sideEffect Adds a cache policy to this stack.
     */
    private createSharedCachePolicy(): cloudfront.CachePolicy {
        return new cloudfront.CachePolicy(this, 'SharedCachePolicy', {
            comment: 'URL alone — caller-independent responses (plan U8 keeps that invariant)',
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            minTtl: Duration.seconds(0),
            defaultTtl: NUTRITION_DEFAULT_TTL,
            maxTtl: EDGE_MAX_TTL,
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
        });
    }
}
