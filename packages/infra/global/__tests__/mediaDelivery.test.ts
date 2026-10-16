/**
 * ADR-0064 — media delivery: ONE unsigned CloudFront distribution per BASE stage in front of the media bucket,
 * reading it through Origin Access Control, plus the bucket CORS rule a browser PUT needs.
 *
 * Every assertion is on the SYNTHESIZED `DataStack` template, because the defects this closes (D1: no CORS, so a
 * browser PUT is refused; D2: Block Public Access with no grant, so no photo URL is readable) are properties of the
 * deployed bucket, not of any source line.
 *
 * | Requirement                                                               | Test                                          |
 * | ------------------------------------------------------------------------- | --------------------------------------------- |
 * | one distribution, alias per stage                                         | 'serves <alias> from exactly one distribution' |
 * | OAC, never OAI                                                            | 'reads the bucket through Origin Access Control' |
 * | exactly s3:GetObject for this distribution, never GetObjectVersion        | 'grants cloudfront.amazonaws.com EXACTLY'      |
 * | Block Public Access stays BLOCK_ALL                                       | 'keeps Block Public Access at BLOCK_ALL'       |
 * | no signing key anywhere                                                   | 'uses no signed URLs and no key group'         |
 * | empty cache key, long TTL                                                 | 'caches on the path alone'                     |
 * | nosniff + immutable Cache-Control                                         | 'sends nosniff and an immutable Cache-Control' |
 * | 403/404 cached 10 s                                                       | 'caches a 403 or 404 for ten seconds only'     |
 * | RDS and bucket logical ids unchanged                                      | 'does NOT replace the database or the buckets' |
 * | CORS PUT-only, no `*`, refuses empty origins                              | 'bucket CORS for the browser PUT'              |
 * | noncurrent versions expire in a day (GDPR)                                | 'expires noncurrent versions after one day'    |
 */
import { PREFLIGHT_MAX_AGE_SECONDS } from '@kitchensink/clerk-verify';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { mediaDeliveryProps } from './mediaDeliveryProps.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

const dataTemplate = (stage: string): Template => {
    const app = testApp();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });

    return Template.fromStack(new DataStack(app, `Data-${stage}`, { env, network, stage, ...mediaDeliveryProps(app) }));
};

interface TemplateStatement {
    readonly Principal?: { readonly Service?: string };
    readonly Condition?: unknown;
}

interface TemplateCorsRule {
    readonly AllowedOrigins: readonly string[];
    readonly ExposedHeaders?: unknown;
}

interface TemplateDistributionConfig {
    readonly Aliases: readonly string[];
    readonly DefaultCacheBehavior: {
        readonly ResponseHeadersPolicyId: unknown;
        readonly AllowedMethods: readonly string[];
        readonly ViewerProtocolPolicy: string;
    };
    readonly HttpVersion: string;
    readonly PriceClass: string;
    readonly ViewerCertificate: { readonly MinimumProtocolVersion: string };
    readonly CacheBehaviors?: unknown;
    readonly CustomErrorResponses: ReadonlyArray<{ readonly ErrorCode: number; readonly ErrorCachingMinTTL: number }>;
}

/**
 * The properties these tests read, across the resource types they look at. A field is declared whether or not every
 * type carries it, because each read sits behind the `resourcesOf` type filter.
 */
interface ResourceProperties {
    readonly Type: unknown;
    readonly Name: unknown;
    readonly DistributionConfig: TemplateDistributionConfig;
    readonly PolicyDocument: { readonly Statement: readonly TemplateStatement[] };
    readonly CachePolicyConfig: {
        readonly ParametersInCacheKeyAndForwardedToOrigin: unknown;
        readonly MaxTTL: number;
    };
    readonly CorsConfiguration?: { readonly CorsRules?: readonly TemplateCorsRule[] };
    readonly LifecycleConfiguration: { readonly Rules: unknown };
}

interface Resource {
    readonly Type: string;
    readonly Properties: ResourceProperties;
}

interface TemplateOutput {
    readonly Export?: { readonly Name?: string };
}

const resourcesOf = (template: Template, type: string): Resource[] =>
    Object.values(template.toJSON().Resources as Record<string, Resource>).filter((resource) => resource.Type === type);

describe.each([
    ['prod', 'media.commise.app'],
    ['sandbox', 'media-sandbox.commise.app'],
])('media delivery on %s', (stage, alias) => {
    it(`serves ${alias} from exactly one distribution`, () => {
        const distributions = resourcesOf(dataTemplate(stage), 'AWS::CloudFront::Distribution');

        expect(distributions).toHaveLength(1);
        expect(distributions[0]?.Properties?.['DistributionConfig'].Aliases).toEqual([alias]);
    });

    it('has Route 53 A and AAAA alias records for the alias', () => {
        const records = resourcesOf(dataTemplate(stage), 'AWS::Route53::RecordSet');

        expect(records.map((record) => record.Properties?.['Type']).toSorted()).toEqual(['A', 'AAAA']);

        for (const record of records) {
            expect(record.Properties?.['Name']).toBe(`${alias}.`);
        }
    });

    it('publishes the CDN url, distribution id and distribution ARN to SSM under the BASE stage', () => {
        const template = dataTemplate(stage);
        const names = resourcesOf(template, 'AWS::SSM::Parameter')
            .map((parameter) => parameter.Properties?.['Name'])
            .filter((name): name is string => typeof name === 'string' && name.includes('/media/'))
            .toSorted();

        expect(names).toEqual([
            `/kitchensink/${stage}/media/cdn-url`,
            `/kitchensink/${stage}/media/distribution-arn`,
            `/kitchensink/${stage}/media/distribution-id`,
        ]);
        template.hasResourceProperties('AWS::SSM::Parameter', {
            Name: `/kitchensink/${stage}/media/cdn-url`,
            Value: `https://${alias}`,
        });
    });
});

describe('media delivery (shape)', () => {
    it('reads the bucket through Origin Access Control, never an origin access identity', () => {
        const template = dataTemplate('prod');

        expect(resourcesOf(template, 'AWS::CloudFront::OriginAccessControl')).toHaveLength(1);
        template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
            OriginAccessControlConfig: Match.objectLike({
                OriginAccessControlOriginType: 's3',
                SigningBehavior: 'always',
            }),
        });
        expect(resourcesOf(template, 'AWS::CloudFront::CloudFrontOriginAccessIdentity')).toHaveLength(0);
    });

    it('grants cloudfront.amazonaws.com EXACTLY s3:GetObject, conditioned on this distribution', () => {
        const [policy] = resourcesOf(dataTemplate('prod'), 'AWS::S3::BucketPolicy').filter((candidate) =>
            JSON.stringify(candidate).includes('cloudfront.amazonaws.com'),
        );
        const statements = policy?.Properties?.PolicyDocument.Statement ?? [];
        const grants = statements.filter((statement) => statement.Principal?.Service === 'cloudfront.amazonaws.com');

        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({ Effect: 'Allow', Action: 's3:GetObject' });
        expect(JSON.stringify(grants[0]?.Condition)).toContain('AWS:SourceArn');
        expect(JSON.stringify(grants[0]?.Condition)).toContain('Distribution');
        // Never the versioned read: an erased photo's older versions must not be fetchable through the CDN.
        expect(JSON.stringify(statements)).not.toContain('s3:GetObjectVersion');
    });

    it('keeps Block Public Access at BLOCK_ALL on the media bucket', () => {
        dataTemplate('prod').hasResourceProperties('AWS::S3::Bucket', {
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
            },
            VersioningConfiguration: { Status: 'Enabled' },
            CorsConfiguration: Match.anyValue(),
        });
    });

    it('uses no signed URLs and no key group (plain URLs, owner ruling 2026-10-16)', () => {
        const json = JSON.stringify(dataTemplate('prod').toJSON());

        expect(json).not.toContain('TrustedKeyGroups');
        expect(json).not.toContain('TrustedSigners');
        expect(json).not.toContain('AWS::CloudFront::PublicKey');
        expect(json).not.toContain('AWS::CloudFront::KeyGroup');
    });

    it('caches on the path alone: no query string, header or cookie in the cache key', () => {
        const [policy] = resourcesOf(dataTemplate('prod'), 'AWS::CloudFront::CachePolicy');
        const config = policy?.Properties?.['CachePolicyConfig'];

        expect(config.ParametersInCacheKeyAndForwardedToOrigin).toMatchObject({
            CookiesConfig: { CookieBehavior: 'none' },
            HeadersConfig: { HeaderBehavior: 'none' },
            QueryStringsConfig: { QueryStringBehavior: 'none' },
        });
        // Keys are write-once (a UUID or a timestamp), so a year is safe; a deletion is invalidated explicitly.
        expect(config.MaxTTL).toBe(31536000);
    });

    it('sends nosniff and an immutable Cache-Control from a response-headers policy on the behaviour', () => {
        const template = dataTemplate('prod');
        const [distribution] = resourcesOf(template, 'AWS::CloudFront::Distribution');

        expect(
            distribution?.Properties?.['DistributionConfig'].DefaultCacheBehavior.ResponseHeadersPolicyId,
        ).toBeDefined();
        template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
            ResponseHeadersPolicyConfig: Match.objectLike({
                SecurityHeadersConfig: Match.objectLike({ ContentTypeOptions: { Override: true } }),
                CustomHeadersConfig: {
                    Items: [{ Header: 'Cache-Control', Value: 'public, max-age=31536000, immutable', Override: true }],
                },
            }),
        });
    });

    it('serves GET and HEAD only, over HTTPS, HTTP/2+3, TLS 1.2, the cheapest price class, on one behaviour', () => {
        const [distribution] = resourcesOf(dataTemplate('prod'), 'AWS::CloudFront::Distribution');
        const config = distribution?.Properties?.['DistributionConfig'];

        expect(config.DefaultCacheBehavior.AllowedMethods).toEqual(['GET', 'HEAD']);
        expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
        expect(config.HttpVersion).toBe('http2and3');
        expect(config.PriceClass).toBe('PriceClass_100');
        expect(config.ViewerCertificate.MinimumProtocolVersion).toBe('TLSv1.2_2021');
        expect(config.CacheBehaviors).toBeUndefined();
    });

    it('caches a 403 or 404 for ten seconds only, so a just-written object is not hidden', () => {
        const [distribution] = resourcesOf(dataTemplate('prod'), 'AWS::CloudFront::Distribution');
        const responses = distribution?.Properties.DistributionConfig.CustomErrorResponses ?? [];

        expect(responses.map((response) => [response.ErrorCode, response.ErrorCachingMinTTL])).toEqual([
            [403, 10],
            [404, 10],
        ]);
    });

    it('does NOT replace the database or the buckets: their logical ids are pinned', () => {
        // ⛔ Restated, not derived (ADR-0002): a construct-id change here replaces the prod RDS or a bucket.
        const template = dataTemplate('prod');

        expect(Object.keys(template.findResources('AWS::RDS::DBInstance'))).toEqual(['DatabaseB269D8BB']);
        expect(Object.keys(template.findResources('AWS::S3::Bucket')).toSorted()).toEqual([
            'ArchiveBucket9DECBF5D',
            'MediaBucketBCBB02BA',
        ]);
    });

    it('adds no CloudFormation export for the distribution (an export would lock it against replacement)', () => {
        const exports = Object.values(dataTemplate('prod').findOutputs('*')).map((output: TemplateOutput) =>
            String(output.Export?.Name ?? ''),
        );

        expect(exports.filter((name) => /distribution|cdn/iu.test(name))).toEqual([]);
    });
});

describe('bucket CORS for the browser PUT', () => {
    const corsOf = (template: Template): readonly TemplateCorsRule[] =>
        resourcesOf(template, 'AWS::S3::Bucket').flatMap(
            (bucket) => bucket.Properties?.['CorsConfiguration']?.CorsRules ?? [],
        );

    it('admits PUT only, with only Content-Type, no exposed headers and the shared preflight max-age', () => {
        const rules = corsOf(dataTemplate('prod'));

        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({
            AllowedMethods: ['PUT'],
            AllowedHeaders: ['Content-Type'],
            AllowedOrigins: ['https://commise.app'],
            MaxAge: PREFLIGHT_MAX_AGE_SECONDS,
        });
        expect(rules[0]?.ExposedHeaders).toBeUndefined();
    });

    it('never admits a bare * origin', () => {
        for (const rule of corsOf(dataTemplate('sandbox'))) {
            expect(rule.AllowedOrigins).not.toContain('*');
        }
    });

    it.each([
        ['an empty list', []],
        ['a bare wildcard', ['*']],
    ])('refuses to synthesize with %s of upload origins', (_name, uploadOrigins) => {
        const app = testApp();
        const network = new NetworkStack(app, 'Net-empty', { env, stage: 'prod' });

        expect(
            () =>
                new DataStack(app, 'Data-empty', {
                    env,
                    network,
                    stage: 'prod',
                    ...mediaDeliveryProps(app, { uploadOrigins }),
                }),
        ).toThrow(/upload origin/iu);
    });
});

describe('media bucket lifecycle', () => {
    it('expires noncurrent versions after one day and removes expired delete markers (GDPR: an erased photo is gone)', () => {
        const [bucket] = resourcesOf(dataTemplate('prod'), 'AWS::S3::Bucket').filter(
            (candidate) => candidate.Properties?.['CorsConfiguration'] !== undefined,
        );

        expect(bucket?.Properties?.['LifecycleConfiguration'].Rules).toEqual([
            expect.objectContaining({
                Status: 'Enabled',
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
                ExpiredObjectDeleteMarker: true,
            }),
        ]);
    });

    it('leaves the archive bucket on its own 30-day expiry', () => {
        const archive = resourcesOf(dataTemplate('prod'), 'AWS::S3::Bucket').filter(
            (candidate) => candidate.Properties?.['CorsConfiguration'] === undefined,
        );

        expect(JSON.stringify(archive)).toContain('"ExpirationInDays":30');
    });
});
