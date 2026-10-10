/**
 * The remote search service's stack (ADR-0055 points 2, 6 and 7; plan 002 S7.3), asserted on the synthesized template
 * at prod and at a pull request's preview, the two kinds of stage it is deployed at.
 *
 * Each case names the ruling it holds. The CDN's trust model (signed URLs, origin access control, the dual invoke
 * permission) and its cache model (the key, the TTLs, one origin attempt) are one-way doors once food signs against
 * them, so every property the rulings fix is pinned here rather than left to a default.
 *
 * ⚠️ Everything the stack reads from its BASE stage is asserted at `pr-91`, whose base stage is `sandbox`. At prod the
 * stage and the base stage are both `prod`, so a case asserted there alone passes when the code reads the wrong one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';

import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { REMOTE_SEARCH_LATENCY_BOUND_MS } from '@kitchensink/schema-remote-search';
import { USDA_REQUEST_TIMEOUT_MS } from '@kitchensink/usda-client';

import { RemoteSearchStack, type RemoteSearchStackProps } from '../lib/RemoteSearchStack.js';
import type { RemoteSearchStage } from '../lib/remoteSearchStage.js';

/** Directories this file created, removed in `afterAll`. */
const created: string[] = [];

afterAll(() => {
    for (const directory of created) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A temporary directory, removed after the suite.
 *
 * @returns Its path.
 * @sideEffect Creates a directory under the OS temp directory.
 */
function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'remote-search-infra-'));

    created.push(directory);

    return directory;
}

/**
 * A staged Lambda asset: a directory holding one file, as `bundle:lambda` leaves it.
 *
 * @returns Its path.
 * @sideEffect Creates a directory and a file.
 */
function stagedAsset(): string {
    const directory = temporaryDirectory();

    writeFileSync(join(directory, 'handler.js'), 'export const handler = async () => ({});\n');

    return directory;
}

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const DOMAIN = 'commise.app';
const FORWARDER_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT}:function:kitchensink-log-forwarder-prod`;

/**
 * Build the stack.
 *
 * @param stage - The stage.
 * @param overrides - Props to replace.
 * @returns The stack.
 * @sideEffect Creates temporary asset directories.
 */
function buildStack(stage: RemoteSearchStage, overrides: Partial<RemoteSearchStackProps> = {}): RemoteSearchStack {
    const app = new App({ outdir: temporaryDirectory() });

    return new RemoteSearchStack(app, `kitchensink-remote-search-${stage}`, {
        env: { account: ACCOUNT, region: REGION },
        stage,
        domainName: DOMAIN,
        lambdaAsset: stagedAsset(),
        alarmsEnabled: false,
        ...overrides,
    });
}

/**
 * Synthesize the stack's template.
 *
 * @param stage - The stage.
 * @param overrides - Props to replace.
 * @returns The template.
 */
function synth(stage: RemoteSearchStage, overrides: Partial<RemoteSearchStackProps> = {}): Template {
    return Template.fromStack(buildStack(stage, overrides));
}

/** One resource's logical id and properties. */
interface Resource {
    readonly id: string;
    readonly properties: Record<string, unknown>;
    readonly dependsOn: readonly string[];
}

/**
 * Every resource of a type.
 *
 * @param template - The template.
 * @param type - The CloudFormation type.
 * @returns The resources.
 */
function resourcesOf(template: Template, type: string): readonly Resource[] {
    return Object.entries(template.findResources(type)).map(([id, resource]) => {
        const { Properties, DependsOn } = resource as { Properties?: Record<string, unknown>; DependsOn?: unknown };

        return {
            id,
            properties: Properties ?? {},
            dependsOn: Array.isArray(DependsOn)
                ? DependsOn.map(String)
                : typeof DependsOn === 'string'
                  ? [DependsOn]
                  : [],
        };
    });
}

/**
 * The single resource of a type.
 *
 * @param template - The template.
 * @param type - The CloudFormation type.
 * @returns The resource.
 */
function onlyResourceOf(template: Template, type: string): Resource {
    const resources = resourcesOf(template, type);

    expect(resources, `exactly one ${type}`).toHaveLength(1);

    const [resource] = resources;

    if (resource === undefined) {
        throw new Error(`no ${type}`);
    }

    return resource;
}

/**
 * The search function: the one whose code is the search asset.
 *
 * @param template - The template.
 * @returns The function.
 */
function searchFunction(template: Template): Resource {
    const [search] = resourcesOf(template, 'AWS::Lambda::Function').filter(
        (fn) => fn.properties['Handler'] === 'handler.handler',
    );

    if (search === undefined) {
        throw new Error('no search function');
    }

    return search;
}

/** The distribution's single cache behaviour and origin. */
function distributionConfig(template: Template): Record<string, unknown> {
    return onlyResourceOf(template, 'AWS::CloudFront::Distribution').properties['DistributionConfig'] as Record<
        string,
        unknown
    >;
}

/** A reference to a resource's logical id, in the two shapes CloudFormation uses. */
function refersTo(value: unknown, id: string): boolean {
    return JSON.stringify(value).includes(`"${id}"`);
}

const template = synth('prod');

const preview = synth('pr-91');

/**
 * The template synthesized at a stage, from the two built once above.
 *
 * @param stage - `prod` or `pr-91`.
 * @returns Its template.
 */
function templateAt(stage: 'prod' | 'pr-91'): Template {
    return stage === 'prod' ? template : preview;
}

/**
 * The deploy-time parameter a value refers to, and the SSM name it resolves.
 *
 * @param source - The template.
 * @param value - A value holding a `Ref` to a parameter.
 * @returns The parameter's logical id, type and default.
 */
function parameterReferencedBy(source: Template, value: unknown): { id: string; type: unknown; name: unknown } {
    const parameters =
        (source.toJSON() as { Parameters?: Record<string, { Type?: unknown; Default?: unknown }> }).Parameters ?? {};
    const id = Object.keys(parameters).find((candidate) => refersTo(value, candidate));

    if (id === undefined) {
        throw new Error(`no parameter is referenced by ${JSON.stringify(value)}`);
    }

    return { id, type: parameters[id]?.Type, name: parameters[id]?.Default };
}

/** Each stage the stack is deployed at, its base stage, and the host its distribution answers on. */
const HOSTS = [
    ['prod', 'prod', 'remote-search.commise.app'],
    ['pr-91', 'sandbox', 'remote-search-pr-91.commise.app'],
] as const;

describe('the search function (ADR-0055 points 1 and 8)', () => {
    it('runs Node 24 on arm64, attached to no VPC', () => {
        const { properties } = searchFunction(template);

        expect(properties['Runtime']).toBe(NODE_LAMBDA_RUNTIME.name);
        expect(properties['Runtime']).toBe('nodejs24.x');
        expect(properties['Architectures']).toEqual(['arm64']);
        expect(properties).not.toHaveProperty('VpcConfig');
    });

    it('attaches no Lambda in the stack to a VPC, so nothing here becomes a NAT consumer (ADR-0004)', () => {
        for (const fn of resourcesOf(template, 'AWS::Lambda::Function')) {
            expect(fn.properties, fn.id).not.toHaveProperty('VpcConfig');
        }
    });

    it('outlives one USDA request', () => {
        const { properties } = searchFunction(template);

        expect(properties['Timeout']).toBe(15);
        expect(Number(properties['Timeout']) * 1_000).toBeGreaterThan(USDA_REQUEST_TIMEOUT_MS);
    });

    it.each([
        ['prod', 10],
        ['pr-91', 2],
    ] as const)('caps its concurrency at %s to %i', (stage, cap) => {
        const source = stage === 'prod' ? template : preview;

        expect(searchFunction(source).properties['ReservedConcurrentExecutions']).toBe(cap);
    });

    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)('at %s is told where the %s USDA key is, never the key itself', (stage, base) => {
        const environment = synthEnvironment(stage);

        expect(Object.keys(environment).sort()).toEqual([
            'SENTRY_DSN',
            'SENTRY_RELEASE',
            'STAGE',
            'USDA_API_KEY_SECRET_ID',
        ]);
        expect(environment['USDA_API_KEY_SECRET_ID']).toBe(`kitchensink/${base}/food/usda-api-key`);
        expect(environment['STAGE']).toBe(stage);
    });

    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)('at %s reports to the %s Sentry project, its DSN resolved at deploy', (stage, base) => {
        const source = stage === 'prod' ? template : preview;
        const dsn = synthEnvironment(stage)['SENTRY_DSN'];
        const parameters = (source.toJSON() as { Parameters?: Record<string, { Default?: unknown }> }).Parameters ?? {};
        const parameterId = Object.keys(parameters).find((id) => refersTo(dsn, id));

        expect(parameterId).toBeDefined();
        expect(parameters[parameterId ?? '']?.Default).toBe(`/kitchensink/${base}/sentry/remote-search-dsn`);
    });

    it('may read the USDA key secret and nothing else in Secrets Manager', () => {
        const statements = policyStatementsOf(template, searchFunction(template)).filter((statement) =>
            JSON.stringify(statement.Action).includes('secretsmanager:'),
        );

        expect(statements).toHaveLength(1);
        expect([statement(statements).Action].flat().sort()).toEqual([
            'secretsmanager:DescribeSecret',
            'secretsmanager:GetSecretValue',
        ]);
        expect(JSON.stringify(statement(statements).Resource)).toContain(
            ':secret:kitchensink/prod/food/usda-api-key-??????',
        );
    });

    it('at a preview may read the sandbox key, which every preview shares', () => {
        const statements = policyStatementsOf(preview, searchFunction(preview)).filter((candidate) =>
            JSON.stringify(candidate.Action).includes('secretsmanager:'),
        );

        expect(JSON.stringify(statement(statements).Resource)).toContain(
            ':secret:kitchensink/sandbox/food/usda-api-key-??????',
        );
    });

    it('logs to a log group the stack owns, with retention', () => {
        expectOwnedLogGroups(template);
    });
});

describe('the function URL and who may invoke it (ADR-0055 point 7)', () => {
    it('demands AWS_IAM and answers buffered', () => {
        const url = onlyResourceOf(template, 'AWS::Lambda::Url');

        expect(url.properties['AuthType']).toBe('AWS_IAM');
        expect(url.properties['InvokeMode']).toBe('BUFFERED');
        expect(refersTo(url.properties['TargetFunctionArn'], searchFunction(template).id)).toBe(true);
    });

    it('lets CloudFront, for THIS distribution only, both invoke the URL and invoke the function', () => {
        const search = searchFunction(template);
        const url = onlyResourceOf(template, 'AWS::Lambda::Url');
        const distribution = onlyResourceOf(template, 'AWS::CloudFront::Distribution');
        // A permission names the function directly, or through the URL's `FunctionArn`, which is the same function.
        const permissions = resourcesOf(template, 'AWS::Lambda::Permission').filter(
            (permission) =>
                refersTo(permission.properties['FunctionName'], search.id) ||
                refersTo(permission.properties['FunctionName'], url.id),
        );
        const byAction = new Map(permissions.map((permission) => [permission.properties['Action'], permission]));

        expect([...byAction.keys()].sort()).toEqual(['lambda:InvokeFunction', 'lambda:InvokeFunctionUrl']);
        expect(permissions).toHaveLength(2);
        expect(byAction.get('lambda:InvokeFunction')?.properties['InvokedViaFunctionUrl']).toBe(true);

        for (const permission of permissions) {
            expect(permission.properties['Principal']).toBe('cloudfront.amazonaws.com');
            expect(refersTo(permission.properties['SourceArn'], distribution.id)).toBe(true);
            expect(JSON.stringify(permission.properties['SourceArn'])).toContain(':distribution/');
        }
    });

    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)(
        'at %s signs every origin request through the %s shared access control, read from SSM',
        (stage, base) => {
            const [origin] = distributionConfig(templateAt(stage))['Origins'] as Record<string, unknown>[];
            const parameter = parameterReferencedBy(templateAt(stage), origin?.['OriginAccessControlId']);

            expect(origin?.['OriginAccessControlId']).toEqual({ Ref: parameter.id });
            expect(parameter.type).toBe('AWS::SSM::Parameter::Value<String>');
            expect(parameter.name).toBe(`/kitchensink/${base}/remote-search/origin-access-control-id`);
        },
    );
});

describe('the distribution (ADR-0055 points 2 and 7)', () => {
    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)(
        'at %s admits only URLs signed with the %s key, its key group read from SSM at deploy',
        (stage, base) => {
            const behavior = distributionConfig(templateAt(stage))['DefaultCacheBehavior'] as Record<string, unknown>;
            const trusted = behavior['TrustedKeyGroups'];
            const parameter = parameterReferencedBy(templateAt(stage), trusted);

            expect(trusted).toEqual([{ Ref: parameter.id }]);
            expect(parameter.type).toBe('AWS::SSM::Parameter::Value<String>');
            expect(parameter.name).toBe(`/kitchensink/${base}/remote-search/key-group-id`);
            expect(behavior).not.toHaveProperty('TrustedSigners');
        },
    );

    it('serves GET and HEAD only, over HTTPS, uncompressed, with one behaviour', () => {
        const config = distributionConfig(template);
        const behavior = config['DefaultCacheBehavior'] as Record<string, unknown>;

        expect(behavior['AllowedMethods']).toEqual(['GET', 'HEAD']);
        expect(behavior['CachedMethods']).toEqual(['GET', 'HEAD']);
        expect(behavior['ViewerProtocolPolicy']).toBe('https-only');
        expect(behavior['Compress']).toBe(false);
        expect(config).not.toHaveProperty('CacheBehaviors');
    });

    // The read timeout IS the published latency bound, which food's admitted-fetch bound is derived from too, so the
    // two cannot drift apart.
    it('makes one attempt per origin request, and waits the published latency bound, longer than the function can run', () => {
        const origins = distributionConfig(template)['Origins'] as Record<string, unknown>[];
        const [origin] = origins;
        const custom = origin?.['CustomOriginConfig'] as Record<string, unknown>;

        expect(origins).toHaveLength(1);
        expect(origin?.['ConnectionAttempts']).toBe(1);
        expect(custom['OriginProtocolPolicy']).toBe('https-only');
        expect(custom['OriginReadTimeout']).toBe(REMOTE_SEARCH_LATENCY_BOUND_MS / 1000);
        expect(Number(custom['OriginReadTimeout'])).toBeGreaterThan(
            Number(searchFunction(template).properties['Timeout']),
        );
    });

    it('caches no error, for every status CloudFront lets an error TTL be set on', () => {
        const responses = distributionConfig(template)['CustomErrorResponses'] as Record<string, unknown>[];

        expect(responses.map((response) => Number(response['ErrorCode'])).sort((a, b) => a - b)).toEqual([
            400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504,
        ]);

        for (const response of responses) {
            expect(response).toEqual({ ErrorCode: response['ErrorCode'], ErrorCachingMinTTL: 0 });
        }
    });

    it.each(HOSTS)('at %s answers on its own name, on the %s certificate, at TLS 1.2 or later', (stage, base, host) => {
        const config = distributionConfig(templateAt(stage));

        expect(config['Aliases']).toEqual([host]);
        expect(config['ViewerCertificate']).toEqual({
            AcmCertificateArn: { 'Fn::ImportValue': `kitchensink-domain-${base}:CertificateArn` },
            MinimumProtocolVersion: 'TLSv1.2_2021',
            SslSupportMethod: 'sni-only',
        });
        templateAt(stage).resourceCountIs('AWS::CertificateManager::Certificate', 0);
    });

    it.each(HOSTS)('at %s owns its alias record, in the %s zone, aimed at the distribution', (stage, base, host) => {
        const source = templateAt(stage);
        const record = onlyResourceOf(source, 'AWS::Route53::RecordSet');
        const distribution = onlyResourceOf(source, 'AWS::CloudFront::Distribution');
        const alias = record.properties['AliasTarget'] as Record<string, unknown>;

        expect(record.properties['Name']).toBe(`${host}.`);
        expect(record.properties['Type']).toBe('A');
        expect(record.properties['HostedZoneId']).toEqual({
            'Fn::ImportValue': `kitchensink-domain-${base}:HostedZoneId`,
        });
        expect(alias['DNSName']).toEqual({ 'Fn::GetAtt': [distribution.id, 'DomainName'] });
    });
});

describe('the cache key and what reaches the origin (ADR-0055 points 2, 6 and 7)', () => {
    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)('at %s caches and forwards through the %s shared policies, read from SSM', (stage, base) => {
        const behavior = distributionConfig(templateAt(stage))['DefaultCacheBehavior'] as Record<string, unknown>;
        const cachePolicy = parameterReferencedBy(templateAt(stage), behavior['CachePolicyId']);
        const requestPolicy = parameterReferencedBy(templateAt(stage), behavior['OriginRequestPolicyId']);

        expect(behavior['CachePolicyId']).toEqual({ Ref: cachePolicy.id });
        expect(cachePolicy.name).toBe(`/kitchensink/${base}/remote-search/cache-policy-id`);
        expect(behavior['OriginRequestPolicyId']).toEqual({ Ref: requestPolicy.id });
        expect(requestPolicy.name).toBe(`/kitchensink/${base}/remote-search/origin-request-policy-id`);
    });
});

describe('what the base stage owns, so an account cap never limits the open previews (ADR-0055 point 7)', () => {
    it.each(['prod', 'pr-91'] as const)(
        'at %s holds no key, no policy, no access control and no provisioner',
        (stage) => {
            const source = templateAt(stage);

            for (const type of [
                'AWS::CloudFront::KeyGroup',
                'AWS::CloudFront::PublicKey',
                'AWS::CloudFront::CachePolicy',
                'AWS::CloudFront::OriginRequestPolicy',
                'AWS::CloudFront::OriginAccessControl',
                'AWS::SecretsManager::Secret',
                'Custom::CloudFrontSigningKey',
            ]) {
                source.resourceCountIs(type, 0);
            }

            expect(resourcesOf(source, 'AWS::Lambda::Function').map((fn) => fn.properties['Handler'])).toEqual([
                'handler.handler',
            ]);
        },
    );
});

describe('what food reads, through SSM and never through an export (ADR-0055 point 7; ruling 3)', () => {
    it.each(HOSTS)(
        'at %s publishes one value, the origin, which is the alias the %s certificate covers',
        (stage, _base, host) => {
            const parameters = resourcesOf(templateAt(stage), 'AWS::SSM::Parameter');
            const aliases = distributionConfig(templateAt(stage))['Aliases'];

            expect(parameters.map((parameter) => parameter.properties['Name'])).toEqual([
                `/kitchensink/${stage}/remote-search/origin`,
            ]);
            expect(parameters[0]?.properties['Value']).toBe(`https://${host}`);
            expect(aliases).toEqual([String(parameters[0]?.properties['Value']).replace(/^https:\/\//u, '')]);
        },
    );

    it('exports nothing', () => {
        const outputs = (template.toJSON() as { Outputs?: Record<string, { Export?: unknown }> }).Outputs ?? {};

        expect(Object.values(outputs).filter((output) => output.Export !== undefined)).toEqual([]);
    });
});

describe('every copy shares one account', () => {
    it('names each function for its stage', () => {
        expect(
            resourcesOf(preview, 'AWS::Lambda::Function')
                .map((fn) => fn.properties['FunctionName'])
                .filter((name) => name !== undefined)
                .sort(),
        ).toEqual(['kitchensink-remote-search-pr-91']);
    });
});

describe('alarms', () => {
    it('creates none unless the stage turns them on (alarmFeatureFlag.test.ts)', () => {
        template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    });

    it('pages the topic on an unexpected failure and on throttling, when turned on', () => {
        const alarmed = synth('prod', { alarmsEnabled: true });
        const topic = onlyResourceOf(alarmed, 'AWS::SNS::Topic');
        const alarms = resourcesOf(alarmed, 'AWS::CloudWatch::Alarm');
        const search = searchFunction(alarmed);

        expect(alarms.map((alarm) => alarm.properties['MetricName']).sort()).toEqual(['Errors', 'Throttles']);

        for (const alarm of alarms) {
            expect(refersTo(alarm.properties['AlarmActions'], topic.id)).toBe(true);
            expect(refersTo(alarm.properties['Dimensions'], search.id)).toBe(true);
        }
    });

    it('lets CloudWatch publish to the topic its policy otherwise closes (alarmTopicPublishGrant.test.ts)', () => {
        const policy = onlyResourceOf(template, 'AWS::SNS::TopicPolicy');

        expect(JSON.stringify(policy.properties['PolicyDocument'])).toContain('cloudwatch.amazonaws.com');
    });
});

describe('log drains (ADR-0042)', () => {
    it('drains every log group the stack owns when the forwarder is known', () => {
        const drained = synth('prod', { logForwarderArn: FORWARDER_ARN });
        const groups = resourcesOf(drained, 'AWS::Logs::LogGroup');
        const filters = resourcesOf(drained, 'AWS::Logs::SubscriptionFilter');

        expect(groups).toHaveLength(1);
        expect(filters).toHaveLength(1);

        for (const group of groups) {
            expect(
                filters.some((filter) => refersTo(filter.properties['LogGroupName'], group.id)),
                group.id,
            ).toBe(true);
        }

        for (const filter of filters) {
            expect(filter.properties['DestinationArn']).toBe(FORWARDER_ARN);
        }
    });

    it('attaches no drain when the forwarder is not known yet', () => {
        template.resourceCountIs('AWS::Logs::SubscriptionFilter', 0);
    });
});

describe('a missing bundle refuses to synthesize', () => {
    it('refuses when the functions were never bundled', () => {
        expect(() => buildStack('prod', { lambdaAsset: join(temporaryDirectory(), 'absent') })).toThrow(
            /bundle:lambda/u,
        );
    });

    it('refuses an empty bundle', () => {
        const empty = join(temporaryDirectory(), 'empty');

        mkdirSync(empty);
        expect(() => buildStack('prod', { lambdaAsset: empty })).toThrow(/empty/u);
    });
});

/** An IAM statement, as the template renders it. */
interface Statement {
    readonly Action: string | readonly string[];
    readonly Resource: unknown;
}

/**
 * The single statement of a list.
 *
 * @param statements - The statements.
 * @returns The one statement.
 */
function statement(statements: readonly Statement[]): Statement {
    const [only] = statements;

    if (only === undefined) {
        throw new Error('no statement');
    }

    return only;
}

/**
 * Every statement of every policy attached to a function's role.
 *
 * @param source - The template.
 * @param fn - The function.
 * @returns The statements.
 */
function policyStatementsOf(source: Template, fn: Resource): readonly Statement[] {
    const role = fn.properties['Role'] as { 'Fn::GetAtt': [string, string] };
    const [roleId] = role['Fn::GetAtt'];

    return resourcesOf(source, 'AWS::IAM::Policy')
        .filter((policy) => refersTo(policy.properties['Roles'], roleId))
        .flatMap((policy) => (policy.properties['PolicyDocument'] as { Statement: readonly Statement[] }).Statement)
        .filter((candidate) => !JSON.stringify(candidate.Action).includes('logs:'));
}

/**
 * The search function's environment at a stage.
 *
 * @param stage - The stage.
 * @returns Its variables.
 */
function synthEnvironment(stage: RemoteSearchStage): Record<string, unknown> {
    return (searchFunction(synth(stage)).properties['Environment'] as { Variables: Record<string, unknown> }).Variables;
}

/**
 * Assert every Lambda logs to a log group this stack declares, with a retention.
 *
 * @param source - The template.
 */
function expectOwnedLogGroups(source: Template): void {
    const groups = new Map(resourcesOf(source, 'AWS::Logs::LogGroup').map((group) => [group.id, group]));

    for (const fn of resourcesOf(source, 'AWS::Lambda::Function')) {
        const logGroup = (fn.properties['LoggingConfig'] as { LogGroup?: unknown } | undefined)?.LogGroup;
        const owner = [...groups.keys()].find((id) => refersTo(logGroup, id));

        expect(owner, `${fn.id} logs to a group this stack owns`).toBeDefined();
        expect(groups.get(owner ?? '')?.properties['RetentionInDays'], `${fn.id}'s group keeps a retention`).toEqual(
            expect.any(Number),
        );
    }
}
