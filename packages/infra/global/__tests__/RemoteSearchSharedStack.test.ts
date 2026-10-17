/**
 * What every remote search copy on a base stage shares (ADR-0055 points 2 and 7): the signing key, and the cache
 * policy, origin request policy and origin access control. An account caps all of them (ten public keys, about twenty
 * cache policies and twenty origin request policies), so a copy per pull request cannot each own one. Every copy
 * reads their ids from SSM, and food signs with this stack's key.
 *
 * Asserted on the synthesized template, for prod and sandbox, the two stages this app deploys.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { RemoteSearchSharedStack } from '../lib/platform/RemoteSearchSharedStack.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const FORWARDER_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:kitchensink-log-forwarder-prod';

/** The key group's logical id, pinned: CloudFormation replaces a resource whose logical id changes. */
const KEY_GROUP_LOGICAL_ID = 'SigningKeyGroup48DA3F97';

/**
 * Synthesize the stack at a stage.
 *
 * @param stage - The base stage.
 * @param logForwarderArn - The forwarder, when known.
 * @returns The template.
 */
function synth(stage: string, logForwarderArn?: string): Template {
    return Template.fromStack(
        new RemoteSearchSharedStack(testApp(), `RemoteSearchShared-${stage}`, {
            env,
            stackName: `kitchensink-remote-search-shared-${stage}`,
            stage,
            ...(logForwarderArn === undefined ? {} : { logForwarderArn }),
        }),
    );
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
function only(template: Template, type: string): Resource {
    const resources = resourcesOf(template, type);

    expect(resources, `exactly one ${type}`).toHaveLength(1);

    const [resource] = resources;

    if (resource === undefined) {
        throw new Error(`no ${type}`);
    }

    return resource;
}

/** Whether a rendered value refers to a logical id. */
function refersTo(value: unknown, id: string): boolean {
    return JSON.stringify(value).includes(`"${id}"`);
}

/**
 * The provisioner: the function whose handler is the signing key's, or the inline placeholder a bare synth ships.
 *
 * @param template - The template.
 * @returns The function.
 */
function provisioner(template: Template): Resource {
    const [fn] = resourcesOf(template, 'AWS::Lambda::Function').filter((candidate) =>
        /^(?:remoteSearchSigningKey\/handler|index)\.handler$/u.test(String(candidate.properties['Handler'])),
    );

    if (fn === undefined) {
        throw new Error('no provisioner');
    }

    return fn;
}

const prod = synth('prod');

describe('the signing key (ADR-0055 point 7)', () => {
    // A generation outlives its removal from the stack, so a food task restarted after the runbook's step 3 can still
    // read the key it was deployed with; the retained secret is deleted by hand at step 4.
    it('retains every key generation when the stack stops naming it', () => {
        const secrets = Object.values(prod.findResources('AWS::SecretsManager::Secret'));

        expect(secrets.length).toBeGreaterThan(0);

        for (const secret of secrets) {
            expect(secret).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
        }
    });

    it('keeps the private key in a secret the template holds no value for, and lets nothing change how it is generated', () => {
        const secret = only(prod, 'AWS::SecretsManager::Secret');

        expect(secret.properties).not.toHaveProperty('SecretString');
        expect(secret.properties).not.toHaveProperty('Name');
        expect(secret.properties['GenerateSecretString']).toEqual({});
        expect(JSON.stringify(prod.toJSON())).not.toMatch(/PRIVATE KEY/u);
    });

    it('has the provisioner write that secret, and CloudFront trust the public key it answers with', () => {
        const secret = only(prod, 'AWS::SecretsManager::Secret');
        const provisioned = only(prod, 'Custom::CloudFrontSigningKey');
        const key = only(prod, 'AWS::CloudFront::PublicKey');
        const group = only(prod, 'AWS::CloudFront::KeyGroup');

        expect(provisioned.properties['SecretArn']).toEqual({ Ref: secret.id });
        expect((key.properties['PublicKeyConfig'] as Record<string, unknown>)['EncodedKey']).toEqual({
            'Fn::GetAtt': [provisioned.id, 'PublicKeyPem'],
        });
        expect((group.properties['KeyGroupConfig'] as Record<string, unknown>)['Items']).toEqual([{ Ref: key.id }]);
    });

    it('keeps the key group one resource for good: every search copy holds its id, resolved at its own deploy', () => {
        // A new logical id or a new name replaces the key group, and CloudFormation cannot delete one a
        // distribution still trusts. Rotation adds a generation to THIS group instead.
        expect(only(prod, 'AWS::CloudFront::KeyGroup').id).toBe(KEY_GROUP_LOGICAL_ID);
        expect(only(synth('sandbox'), 'AWS::CloudFront::KeyGroup').id).toBe(KEY_GROUP_LOGICAL_ID);
    });

    it.each(['prod', 'sandbox'])('names the account-unique CloudFront resources for the %s stage', (stage) => {
        const template = stage === 'prod' ? prod : synth(stage);
        const key = only(template, 'AWS::CloudFront::PublicKey');
        const group = only(template, 'AWS::CloudFront::KeyGroup');

        expect((key.properties['PublicKeyConfig'] as Record<string, unknown>)['Name']).toBe(
            `kitchensink-remote-search-${stage}-signing-key-1`,
        );
        expect((group.properties['KeyGroupConfig'] as Record<string, unknown>)['Name']).toBe(
            `kitchensink-remote-search-${stage}-signing-keys`,
        );
    });
});

describe('the provisioner', () => {
    it('runs Node 24 on arm64, attached to no VPC, with nothing in its environment', () => {
        const fn = provisioner(prod);

        expect(fn.properties['Runtime']).toBe('nodejs24.x');
        expect(fn.properties['Architectures']).toEqual(['arm64']);
        expect(fn.properties).not.toHaveProperty('VpcConfig');
        expect(fn.properties).not.toHaveProperty('Environment');
    });

    it('may read and write that one secret, and nothing else in Secrets Manager', () => {
        const fn = provisioner(prod);
        const secret = only(prod, 'AWS::SecretsManager::Secret');
        const [roleId] = (fn.properties['Role'] as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'];
        const statements = resourcesOf(prod, 'AWS::IAM::Policy')
            .filter((policy) => refersTo(policy.properties['Roles'], roleId))
            .flatMap(
                (policy) =>
                    (policy.properties['PolicyDocument'] as { Statement: { Action: unknown; Resource: unknown }[] })
                        .Statement,
            )
            .filter((statement) => JSON.stringify(statement.Action).includes('secretsmanager:'));

        expect(statements).toHaveLength(1);
        expect([statements[0]?.Action].flat().sort()).toEqual([
            'secretsmanager:GetSecretValue',
            'secretsmanager:PutSecretValue',
        ]);
        expect(statements[0]?.Resource).toEqual({ Ref: secret.id });
    });

    it('logs every function to a group the stack owns, with retention', () => {
        const groups = new Map(resourcesOf(prod, 'AWS::Logs::LogGroup').map((group) => [group.id, group]));

        for (const fn of resourcesOf(prod, 'AWS::Lambda::Function')) {
            const owner = [...groups.keys()].find((id) =>
                refersTo((fn.properties['LoggingConfig'] as { LogGroup?: unknown } | undefined)?.LogGroup, id),
            );

            expect(owner, `${fn.id} logs to a group this stack owns`).toBeDefined();
            expect(groups.get(owner ?? '')?.properties['RetentionInDays']).toEqual(expect.any(Number));
        }
    });

    it('drains every log group when the forwarder is known, and none before (ADR-0042)', () => {
        const drained = synth('prod', FORWARDER_ARN);
        const groups = resourcesOf(drained, 'AWS::Logs::LogGroup');
        const filters = resourcesOf(drained, 'AWS::Logs::SubscriptionFilter');

        expect(groups.length).toBeGreaterThanOrEqual(2);
        expect(filters).toHaveLength(groups.length);
        prod.resourceCountIs('AWS::Logs::SubscriptionFilter', 0);
    });
});

describe('the cache and origin policies every copy uses (ADR-0055 points 2, 6 and 7)', () => {
    it('keys the cache on the path and `q` alone: no header, no cookie, no signature parameter', () => {
        const config = only(prod, 'AWS::CloudFront::CachePolicy').properties['CachePolicyConfig'] as Record<
            string,
            unknown
        >;
        const key = config['ParametersInCacheKeyAndForwardedToOrigin'] as Record<string, unknown>;

        expect(key['QueryStringsConfig']).toEqual({ QueryStringBehavior: 'whitelist', QueryStrings: ['q'] });
        expect(key['HeadersConfig']).toEqual({ HeaderBehavior: 'none' });
        expect(key['CookiesConfig']).toEqual({ CookieBehavior: 'none' });
        expect(key['EnableAcceptEncodingGzip']).toBe(false);
        expect(key['EnableAcceptEncodingBrotli']).toBe(false);
    });

    it('stores only what the function says to store, for at most seven days', () => {
        const config = only(prod, 'AWS::CloudFront::CachePolicy').properties['CachePolicyConfig'] as Record<
            string,
            unknown
        >;

        expect(config['MinTTL']).toBe(0);
        expect(config['DefaultTTL']).toBe(0);
        expect(config['MaxTTL']).toBe(7 * 24 * 60 * 60);
    });

    it('forwards `q`, `admit` and `rid` to the function, and nothing else', () => {
        const config = only(prod, 'AWS::CloudFront::OriginRequestPolicy').properties[
            'OriginRequestPolicyConfig'
        ] as Record<string, unknown>;
        const queryStrings = config['QueryStringsConfig'] as { QueryStringBehavior: string; QueryStrings: string[] };

        expect(queryStrings.QueryStringBehavior).toBe('whitelist');
        expect([...queryStrings.QueryStrings].sort()).toEqual(['admit', 'q', 'rid']);
        expect(config['HeadersConfig']).toEqual({ HeaderBehavior: 'none' });
        expect(config['CookiesConfig']).toEqual({ CookieBehavior: 'none' });
    });

    it('signs every origin request to a function URL with SigV4', () => {
        const config = only(prod, 'AWS::CloudFront::OriginAccessControl').properties[
            'OriginAccessControlConfig'
        ] as Record<string, unknown>;

        expect(config['OriginAccessControlOriginType']).toBe('lambda');
        expect(config['SigningBehavior']).toBe('always');
        expect(config['SigningProtocol']).toBe('sigv4');
    });

    it.each(['prod', 'sandbox'])('names the account-unique policies and access control for the %s stage', (stage) => {
        const template = stage === 'prod' ? prod : synth(stage);
        const name = (type: string, configKey: string): unknown =>
            (only(template, type).properties[configKey] as Record<string, unknown>)['Name'];

        expect(name('AWS::CloudFront::CachePolicy', 'CachePolicyConfig')).toBe(
            `kitchensink-remote-search-${stage}-cache`,
        );
        expect(name('AWS::CloudFront::OriginRequestPolicy', 'OriginRequestPolicyConfig')).toBe(
            `kitchensink-remote-search-${stage}-origin-request`,
        );
        expect(name('AWS::CloudFront::OriginAccessControl', 'OriginAccessControlConfig')).toBe(
            `kitchensink-remote-search-${stage}-origin-access`,
        );
    });
});

describe('what every search copy and food read (SSM, never an export)', () => {
    it.each(['prod', 'sandbox'])('publishes the key, the policies and the access control under %s', (stage) => {
        const template = stage === 'prod' ? prod : synth(stage);
        const parameters = new Map(
            resourcesOf(template, 'AWS::SSM::Parameter').map((parameter) => [parameter.properties['Name'], parameter]),
        );
        const group = only(template, 'AWS::CloudFront::KeyGroup');
        const key = only(template, 'AWS::CloudFront::PublicKey');
        const secret = only(template, 'AWS::SecretsManager::Secret');
        const provisioned = only(template, 'Custom::CloudFrontSigningKey');

        expect([...parameters.keys()].sort()).toEqual([
            `/kitchensink/${stage}/remote-search/cache-policy-id`,
            `/kitchensink/${stage}/remote-search/key-group-id`,
            `/kitchensink/${stage}/remote-search/key-pair-id`,
            `/kitchensink/${stage}/remote-search/origin-access-control-id`,
            `/kitchensink/${stage}/remote-search/origin-request-policy-id`,
            `/kitchensink/${stage}/remote-search/signing-key-secret-arn`,
        ]);
        expect(
            refersTo(
                parameters.get(`/kitchensink/${stage}/remote-search/cache-policy-id`)?.properties['Value'],
                only(template, 'AWS::CloudFront::CachePolicy').id,
            ),
        ).toBe(true);
        expect(
            refersTo(
                parameters.get(`/kitchensink/${stage}/remote-search/origin-request-policy-id`)?.properties['Value'],
                only(template, 'AWS::CloudFront::OriginRequestPolicy').id,
            ),
        ).toBe(true);
        expect(
            refersTo(
                parameters.get(`/kitchensink/${stage}/remote-search/origin-access-control-id`)?.properties['Value'],
                only(template, 'AWS::CloudFront::OriginAccessControl').id,
            ),
        ).toBe(true);
        expect(parameters.get(`/kitchensink/${stage}/remote-search/key-group-id`)?.properties['Value']).toEqual({
            Ref: group.id,
        });
        expect(parameters.get(`/kitchensink/${stage}/remote-search/key-pair-id`)?.properties['Value']).toEqual({
            Ref: key.id,
        });

        const secretParameter = parameters.get(`/kitchensink/${stage}/remote-search/signing-key-secret-arn`);

        expect(secretParameter?.properties['Value']).toEqual({ Ref: secret.id });
        // The ARN is known before the key is written; nothing may read it until the secret holds the key.
        expect(secretParameter?.dependsOn).toContain(provisioned.id);
    });

    it('exports nothing', () => {
        const outputs = (prod.toJSON() as { Outputs?: Record<string, { Export?: unknown }> }).Outputs ?? {};

        expect(Object.values(outputs).filter((output) => output.Export !== undefined)).toEqual([]);
    });
});
