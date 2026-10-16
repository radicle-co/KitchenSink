/**
 * Media delivery: ONE unsigned CloudFront distribution per BASE stage in front of the media bucket, reading it
 * through Origin Access Control (ADR-0064).
 *
 * Stored photos and avatars are public-by-URL on purpose (owner rulings 2026-10-16: "avatars public", "plain cdn for
 * every photo"): there is no signing key, no key group and no expiry. What keeps the bucket itself closed is Block
 * Public Access (left at BLOCK_ALL) plus a bucket policy that grants `s3:GetObject` to exactly this distribution.
 *
 * ⚠️ NO CloudFormation EXPORT for the distribution, deliberately. Its id, ARN and public URL go to SSM under
 * `/kitchensink/{baseStage}/media/`, which services read at deploy time. An export would put this stack in ADR-0002's
 * export-in-use position, where the distribution could never be replaced while any service imports it.
 *
 * ⚠️ WHY A DISTRIBUTION HERE WHEN ADR-0020 SAYS CLOUDFRONT IS PROD-ONLY. That rule exists because a distribution takes
 * minutes to create and must be disabled before it can be deleted, which cannot fit inside a `pr-{N}` preview's
 * lifetime. This one is per BASE stage and lives in `kitchensink-data-{stage}`, which `sandboxSharedTier.sh` lists as
 * never reclaimed, so ADR-0061 never deletes it; previews share the sandbox distribution. The premise that justified
 * the prod-only rule does not hold for it.
 *
 * ⚠️ A FUNCTION, NOT A `Construct` SUBCLASS, on purpose. `scripts/infrastructureManifest.mjs` reads every `new X(...)` of a
 * relative import as a CHILD STACK and `deployGate.sh stacks-for` refuses a stack whose name it cannot read, so a class
 * here would stop every deploy gate. The resources still live under one construct node (`MediaDelivery`) so their
 * logical ids group.
 *
 * @pattern Proxy — CloudFront in front of S3, authenticated to the origin by Origin Access Control
 * @pattern Factory Method — one function that adds the whole delivery path to a stack
 * @module
 */
import {
    Duration,
    aws_certificatemanager as acm,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_route53 as route53,
    aws_route53_targets as route53Targets,
    aws_s3 as s3,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** One year, in seconds. Every media key is write-once (a UUID or a timestamp), so a long TTL cannot serve stale bytes. */
const ONE_YEAR_SECONDS = 31_536_000;

/** How long a 403/404 is cached. Short, so an object written just after a miss is not hidden. */
const ERROR_CACHE_SECONDS = 10;

/**
 * The platform stage whose SSM tree and public name a stage uses: prod has its own; every other stage rides sandbox.
 *
 * @param stage - The deploy stage.
 * @returns `prod` or `sandbox`. Pure.
 */
export function mediaBaseStage(stage: string): 'prod' | 'sandbox' {
    return stage === 'prod' ? 'prod' : 'sandbox';
}

/**
 * The public host for a stage's media. A SINGLE label under the apex on purpose: `media-sandbox.{apex}` must not
 * overlap the sandbox router's `*.sandbox.{apex}` alias, and the `pr-{N}` exact-label scope in
 * `scripts/previewDomainScope.ts` cannot match it.
 *
 * @param stage - The deploy stage.
 * @param domainName - The apex domain, e.g. `commise.app`.
 * @returns The fully-qualified host. Pure.
 */
export function mediaHostFor(stage: string, domainName: string): string {
    return mediaBaseStage(stage) === 'prod' ? `media.${domainName}` : `media-sandbox.${domainName}`;
}

export interface MediaDeliveryProps {
    /** The bucket to serve. The construct adds the OAC read grant to its policy. */
    readonly bucket: s3.IBucket;
    readonly stage: string;
    /** The apex domain the public host sits under. */
    readonly domainName: string;
    /** A certificate in us-east-1 covering the public host (the apex wildcard). */
    readonly certificate: acm.ICertificate;
    readonly hostedZone: route53.IHostedZone;
}

/** The media distribution and its public URL. */
export interface MediaDelivery {
    readonly distribution: cloudfront.Distribution;
    /** `https://{host}` — no trailing slash. */
    readonly publicUrl: string;
}

/**
 * Add the media delivery path to `scope`: cache policy, response headers, distribution, OAC, alias records and the
 * SSM parameters that publish it.
 *
 * @param scope - The stack that owns the bucket (the OAC grant is added to the bucket's policy).
 * @param id - The construct id grouping the resources; it prefixes their logical ids, so it never changes.
 * @param props - The bucket, stage, domain, certificate and zone.
 * @returns The distribution and its public URL.
 * @sideEffect Adds constructs to `scope` and a statement to the bucket's resource policy.
 */
export function addMediaDelivery(scope: Construct, id: string, props: MediaDeliveryProps): MediaDelivery {
    const node = new Construct(scope, id);
    const host = mediaHostFor(props.stage, props.domainName);
    const baseStage = mediaBaseStage(props.stage);
    const publicUrl = `https://${host}`;

    // The key is the path alone: nothing a viewer can vary (query string, header, cookie) may fork the cache or
    // reach the origin.
    const cachePolicy = new cloudfront.CachePolicy(node, 'MediaCachePolicy', {
        comment: 'Media: cache on the path alone; keys are write-once',
        defaultTtl: Duration.seconds(ONE_YEAR_SECONDS),
        minTtl: Duration.seconds(0),
        maxTtl: Duration.seconds(ONE_YEAR_SECONDS),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(node, 'MediaResponseHeadersPolicy', {
        comment: 'Media: nosniff and an immutable Cache-Control',
        securityHeadersBehavior: { contentTypeOptions: { override: true } },
        customHeadersBehavior: {
            customHeaders: [
                { header: 'Cache-Control', value: `public, max-age=${ONE_YEAR_SECONDS}, immutable`, override: true },
            ],
        },
    });

    const distribution = new cloudfront.Distribution(node, 'MediaDistribution', {
        comment: `Commise media (${baseStage}) — plain URLs over an OAC-protected bucket (ADR-0064)`,
        domainNames: [host],
        certificate: props.certificate,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        defaultBehavior: {
            origin: origins.S3BucketOrigin.withOriginAccessControl(props.bucket),
            allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy,
            responseHeadersPolicy,
            compress: true,
        },
        errorResponses: [403, 404].map((httpStatus) => ({
            httpStatus,
            ttl: Duration.seconds(ERROR_CACHE_SECONDS),
        })),
    });

    const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));

    new route53.ARecord(node, 'MediaAliasRecord', { zone: props.hostedZone, recordName: host, target });
    new route53.AaaaRecord(node, 'MediaAliasRecordIpv6', { zone: props.hostedZone, recordName: host, target });

    const publish = (parameterId: string, name: string, value: string, description: string): void => {
        new ssm.StringParameter(node, parameterId, {
            parameterName: `/kitchensink/${baseStage}/media/${name}`,
            stringValue: value,
            description,
        });
    };

    publish('CdnUrlParameter', 'cdn-url', publicUrl, 'Public base URL of the media CDN (ADR-0064)');
    publish(
        'DistributionIdParameter',
        'distribution-id',
        distribution.distributionId,
        'Media distribution id, for CDN invalidation (ADR-0064)',
    );
    publish(
        'DistributionArnParameter',
        'distribution-arn',
        distribution.distributionArn,
        'Media distribution ARN, for the invalidation grant (ADR-0064)',
    );

    return { distribution, publicUrl };
}
