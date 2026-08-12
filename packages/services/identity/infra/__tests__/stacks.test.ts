import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect, beforeAll } from 'vitest';

import {
    BASE_LISTENER_PRIORITY,
    BASE_SPAN_CEILING,
    EPHEMERAL_SERVICE_SLOTS,
    ephemeralBandsForSlot,
} from '@kitchensink/infra-alb';

import { IdentityServiceStack } from '../lib/identity-service-stack.js';

// NetworkStack/DataStack assertions live with the deployed (global) definitions in
// packages/infra/global/__tests__. This suite covers only the service stack, which
// is what this package owns and deploys.

let serviceTemplate: Template;
let prodTemplate: Template;

const env = { account: '123456789012', region: 'us-east-1' };

beforeAll(() => {
    const app = new App({
        context: {
            stage: 'test',
            // Pre-seed the VPC lookup so `Vpc.fromLookup` resolves to a dummy VPC during synth
            // instead of attempting an AWS call (no credentials in CI).
            'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true':
                {
                    vpcId: 'vpc-12345678',
                    vpcCidrBlock: '10.0.0.0/16',
                    ownerAccountId: '123456789012',
                    availabilityZones: [],
                    subnetGroups: [
                        {
                            name: 'Public',
                            type: 'Public',
                            subnets: [
                                {
                                    subnetId: 'subnet-public-1',
                                    availabilityZone: 'us-east-1a',
                                    routeTableId: 'rtb-public-1',
                                    cidr: '10.0.0.0/24',
                                },
                            ],
                        },
                        {
                            name: 'Private',
                            type: 'Private',
                            subnets: [
                                {
                                    subnetId: 'subnet-private-1',
                                    availabilityZone: 'us-east-1a',
                                    routeTableId: 'rtb-private-1',
                                    cidr: '10.0.1.0/24',
                                },
                            ],
                        },
                    ],
                },
        },
    });

    const service = new IdentityServiceStack(app, 'TestService', {
        env,
        stage: 'test',
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    // A prod-stage synth to pin the stage-gated azp env: prod stays exact-match list, non-prod uses the
    // self-owned preview pattern (ADR-0001). Same App/context (VPC seed is account/region-scoped). Both
    // stacks must be constructed BEFORE any Template.fromStack() — synth freezes the whole App's tree.
    const prodService = new IdentityServiceStack(app, 'ProdService', {
        env,
        stage: 'prod',
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    serviceTemplate = Template.fromStack(service);
    prodTemplate = Template.fromStack(prodService);
});

describe('No Auth0 references', () => {
    it('service stack JSON contains no AUTH0_DOMAIN', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_DOMAIN');
    });

    it('service stack JSON contains no AUTH0_CLIENT_ID', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_ID');
    });

    it('service stack JSON contains no AUTH0_CLIENT_SECRET', () => {
        const json = JSON.stringify(serviceTemplate.toJSON());
        expect(json).not.toContain('AUTH0_CLIENT_SECRET');
    });
});

describe('Identity env vars present', () => {
    const templateHasEnvVar = (template: Template, name: string): boolean => {
        const tasks = template.findResources('AWS::ECS::TaskDefinition');

        return Object.values(tasks).some((task: any) =>
            (task.Properties?.ContainerDefinitions ?? []).some((container: any) =>
                (container.Environment ?? []).some((env: any) => env.Name === name),
            ),
        );
    };
    const taskHasEnvVar = (name: string): boolean => templateHasEnvVar(serviceTemplate, name);

    it('service task has AUTH_SECRET_ARN env var', () => {
        expect(taskHasEnvVar('AUTH_SECRET_ARN')).toBe(true);
    });

    it('service task has CLERK_JWT_KEY env var (read-through verification)', () => {
        expect(taskHasEnvVar('CLERK_JWT_KEY')).toBe(true);
    });

    // ── ADR-0001 stage-gated azp enforcement ──
    // Non-prod (sandbox) runs the self-owned preview pattern in `transition` mode (accepts the apex AND
    // pr-{N} subdomains during cutover). Prod stays exact-match list. Exactly one mode per stage (the
    // config contract), so each stage carries one set and NOT the other.
    it('non-prod task uses the azp PATTERN + preview mode, NOT the exact-match list', () => {
        expect(taskHasEnvVar('CLERK_AZP_PATTERN')).toBe(true);
        expect(taskHasEnvVar('CLERK_AZP_PREVIEW_MODE')).toBe(true);
        expect(taskHasEnvVar('CLERK_AUTHORIZED_PARTIES')).toBe(false);
    });

    it('prod task keeps the exact-match list, NOT the preview pattern (prod unaffected)', () => {
        expect(templateHasEnvVar(prodTemplate, 'CLERK_AUTHORIZED_PARTIES')).toBe(true);
        expect(templateHasEnvVar(prodTemplate, 'CLERK_AZP_PATTERN')).toBe(false);
        expect(templateHasEnvVar(prodTemplate, 'CLERK_AZP_PREVIEW_MODE')).toBe(false);
    });

    // Native (@clerk/expo) tokens are azp-less; pattern mode rejects them without the admission gate. The
    // mobile app authenticates against the shared sandbox identity, so non-prod admits `client_type:native`.
    // Prod runs list mode (skips the azp check on absent azp) → no flag, template byte-identical.
    it('non-prod task admits native azp-less tokens (CLERK_ADMIT_NATIVE_CLIENT), prod does NOT', () => {
        expect(taskHasEnvVar('CLERK_ADMIT_NATIVE_CLIENT')).toBe(true);
        expect(templateHasEnvVar(prodTemplate, 'CLERK_ADMIT_NATIVE_CLIENT')).toBe(false);
    });
});

describe('Alarms notify via SNS (A4)', () => {
    it('provisions an SNS alarm topic', () => {
        serviceTemplate.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('wires every CloudWatch alarm to an alarm action (no silent alarms)', () => {
        const alarms = serviceTemplate.findResources('AWS::CloudWatch::Alarm');
        const ids = Object.keys(alarms);
        expect(ids.length).toBeGreaterThanOrEqual(3);
        for (const id of ids) {
            const actions = (alarms[id] as any).Properties?.AlarmActions;
            expect(Array.isArray(actions), `${id} has no AlarmActions`).toBe(true);
            expect(actions.length).toBeGreaterThan(0);
        }
    });

    it('has a boot crash-loop alarm on HealthyHostCount treating missing data as breaching', () => {
        serviceTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
            MetricName: 'HealthyHostCount',
            ComparisonOperator: 'LessThanThreshold',
            Threshold: 1,
            TreatMissingData: 'breaching',
        });
    });
});

describe('Shared ALB topology (no per-service ALB)', () => {
    it('does NOT create its own Application Load Balancer (uses the shared per-stage ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    });

    /**
     * Identity is the ONE shared persistent service every per-PR preview signs in against, so it has no
     * ephemeral deploy and must NEVER allocate from an ephemeral band — it reads its BASE priority straight
     * from `@kitchensink/infra-alb`'s registry (note this stack imports `kitchensink-alb-${stage}`, not
     * `${baseStage}`: its stage is always a base stage). Asserted against the SYNTHESIZED rule, not the
     * constant, and against EVERY reserved slot's bands — so "consistency-fixing" this stack onto the stage
     * resolver reds here even though this suite synthesizes the non-prod `test` stage.
     */
    it('synthesizes its rule in the BASE span, outside every reserved slot`s ephemeral band', () => {
        const priorities = Object.values(
            serviceTemplate.findResources('AWS::ElasticLoadBalancingV2::ListenerRule'),
        ).map((resource) => resource.Properties.Priority as number);

        expect(priorities).toEqual([BASE_LISTENER_PRIORITY.identity]);
        expect(priorities[0]).toBe(100);

        for (let slot = 0; slot < EPHEMERAL_SERVICE_SLOTS; slot += 1) {
            const { perPr, named } = ephemeralBandsForSlot(slot);

            expect(priorities[0]).toBeLessThan(named.floor);
            expect(priorities[0]).toBeLessThan(perPr.floor);
        }

        expect(priorities[0]).toBeLessThanOrEqual(BASE_SPAN_CEILING);
    });

    it('attaches exactly one host-based listener rule to the shared HTTPS listener', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
            Priority: BASE_LISTENER_PRIORITY.identity,
            Conditions: Match.arrayWith([
                Match.objectLike({
                    Field: 'host-header',
                    HostHeaderConfig: Match.objectLike({
                        Values: ['identity.test.example.com'],
                    }),
                }),
            ]),
        });
    });

    it('still creates exactly one target group', () => {
        serviceTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    });

    // ADR-0011: every VERSIONED endpoint moved under the canonical `/api/{version}/` prefix, but `/health`
    // deliberately did NOT — this target group's health check dials it at the ORIGIN ROOT, and so do the
    // prod/sandbox deploy smoke steps. Nothing in CDK pinned that path before, so a well-meaning "move
    // /health under /api for consistency" would have synthesized a health check against a route the service
    // no longer serves: every task would fail its check, the target group would drain to zero healthy hosts,
    // and the deploy would roll back with no test having objected. This assertion is that objection.
    it('health-checks the UNPREFIXED /health at the origin root (ADR-0011)', () => {
        serviceTemplate.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
            HealthCheckPath: '/health',
            Matcher: { HttpCode: '200' },
        });
    });

    it('still creates the service A-record (aliased to the shared ALB)', () => {
        serviceTemplate.resourceCountIs('AWS::Route53::RecordSet', 1);
        serviceTemplate.hasResourceProperties('AWS::Route53::RecordSet', {
            Type: 'A',
            Name: 'identity.test.example.com.',
        });
    });

    it('no longer exports an IdentityAlbArn (canonical ALB outputs live on the shared ALB stack)', () => {
        const outputs = serviceTemplate.findOutputs('*');
        const exportNames = Object.values(outputs).map((o: any) => o.Export?.Name);
        expect(exportNames).not.toContain('TestService:IdentityAlbArn');
        expect(exportNames).not.toContain('TestService:IdentityAlbDnsName');
    });
});

const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Public',
                type: 'Public',
                subnets: [
                    {
                        subnetId: 'subnet-public-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-public-1',
                        cidr: '10.0.0.0/24',
                    },
                ],
            },
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                ],
            },
        ],
    },
};

const identityTemplate = (stage: string): Template => {
    const app = new App({ context: { ...VPC_LOOKUP_CONTEXT } });
    const stack = new IdentityServiceStack(app, `IdentitySpot-${stage}`, {
        env,
        stage,
        domainName: 'example.com',
        imageTag: 'test',
        desiredCount: 1,
        vpcId: 'vpc-12345678',
    });

    return Template.fromStack(stack);
};

describe('Per-stage Fargate Spot (ADR-0008)', () => {
    const serviceProps = (template: Template): any =>
        (Object.values(template.findResources('AWS::ECS::Service'))[0] as any).Properties;

    it('runs the non-prod (test) service on FARGATE_SPOT with the capacity provider on the cluster', () => {
        const template = identityTemplate('sandbox');
        const props = serviceProps(template);

        expect(props.CapacityProviderStrategy).toEqual([{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }]);
        expect(props.LaunchType).toBeUndefined();
        template.hasResourceProperties('AWS::ECS::ClusterCapacityProviderAssociations', {
            CapacityProviders: Match.arrayWith(['FARGATE_SPOT']),
        });
    });

    it('keeps prod on on-demand FARGATE (no Spot strategy, no capacity-provider association → no prod diff)', () => {
        const template = identityTemplate('prod');
        const props = serviceProps(template);

        expect(props.LaunchType).toBe('FARGATE');
        expect(props.CapacityProviderStrategy).toBeUndefined();
        template.resourceCountIs('AWS::ECS::ClusterCapacityProviderAssociations', 0);
    });
});

describe('Per-stage Container Insights (ADR-0007)', () => {
    const insightsValue = (template: Template): string => {
        const clusters = Object.values(template.findResources('AWS::ECS::Cluster'));
        const setting = (clusters[0] as any).Properties.ClusterSettings.find(
            (entry: any) => entry.Name === 'containerInsights',
        );

        return setting.Value;
    };

    it('drops the non-prod (test) identity cluster to STANDARD', () => {
        expect(insightsValue(serviceTemplate)).toBe('enabled');
    });

    it('keeps ENHANCED Container Insights for prod', () => {
        const app = new App({
            context: {
                'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true':
                    {
                        vpcId: 'vpc-12345678',
                        vpcCidrBlock: '10.0.0.0/16',
                        ownerAccountId: '123456789012',
                        availabilityZones: [],
                        subnetGroups: [
                            {
                                name: 'Public',
                                type: 'Public',
                                subnets: [
                                    {
                                        subnetId: 'subnet-public-1',
                                        availabilityZone: 'us-east-1a',
                                        routeTableId: 'rtb-public-1',
                                        cidr: '10.0.0.0/24',
                                    },
                                ],
                            },
                            {
                                name: 'Private',
                                type: 'Private',
                                subnets: [
                                    {
                                        subnetId: 'subnet-private-1',
                                        availabilityZone: 'us-east-1a',
                                        routeTableId: 'rtb-private-1',
                                        cidr: '10.0.1.0/24',
                                    },
                                ],
                            },
                        ],
                    },
            },
        });
        const prodService = new IdentityServiceStack(app, 'ProdService', {
            env,
            stage: 'prod',
            domainName: 'example.com',
            imageTag: 'test',
            desiredCount: 1,
            vpcId: 'vpc-12345678',
        });

        expect(insightsValue(Template.fromStack(prodService))).toBe('enhanced');
    });
});

describe('Auth secret grant (regression: ECS NotStabilized / GetSecretValue AccessDenied)', () => {
    // The data stack imports the Clerk auth secret by NAME and exports its suffix-LESS ARN
    // (`kitchensink/{stage}/identity/keys`). If the service stack consumes that as a COMPLETE ARN, the
    // IAM grant is written for the exact suffix-less resource, which never matches the secret's real ARN
    // (`...keys-XXXXXX`) — the task execution role gets AccessDenied on GetSecretValue, the container
    // never launches, and every deploy hangs on ECS "NotStabilized" then rolls back. Importing as a
    // PARTIAL ARN appends the `-??????` wildcard so the grant matches. These assertions fail if anyone
    // reverts to `secretCompleteArn`.
    const authSecretResource = {
        'Fn::Join': ['', [{ 'Fn::ImportValue': 'kitchensink-data-test:SecretArn' }, '-??????']],
    };

    it('grants GetSecretValue on the auth secret with the -?????? wildcard suffix (matches the real ARN)', () => {
        serviceTemplate.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
                        Resource: authSecretResource,
                    }),
                ]),
            },
        });
    });

    it('never grants the auth secret on a bare suffix-less ImportValue (the AccessDenied bug shape)', () => {
        const policies = serviceTemplate.findResources('AWS::IAM::Policy');
        const bareGrants = Object.values(policies).flatMap((policy) =>
            ((policy.Properties?.PolicyDocument?.Statement ?? []) as Array<Record<string, unknown>>).filter(
                (statement) => {
                    const actions = ([] as string[]).concat(statement['Action'] as string | string[]);
                    const resource = statement['Resource'];
                    const isBareSecretArn =
                        typeof resource === 'object' &&
                        resource !== null &&
                        'Fn::ImportValue' in resource &&
                        (resource as Record<string, unknown>)['Fn::ImportValue'] === 'kitchensink-data-test:SecretArn';
                    return actions.includes('secretsmanager:GetSecretValue') && isBareSecretArn;
                },
            ),
        );

        expect(bareGrants).toEqual([]);
    });
});

describe('Deletion-queue grant (regression: closure/reactivation never reached Clerk)', () => {
    /**
     * The service is a pure PRODUCER on the deletion queue: `queue/sqs.service.ts` imports exactly one command
     * (`SendMessageCommand`) and nothing in `src/` ever receives — the deletion-WORKER Lambda is the consumer,
     * and it holds its own `grantConsumeMessages` in the webhooks stack.
     *
     * This stack nevertheless granted the task role `grantConsumeMessages` and never `grantSendMessages`, while
     * injecting `DELETION_QUEUE_URL` into the container. Verified against the DEPLOYED sandbox role, which held
     * `sqs:ReceiveMessage`, `ChangeMessageVisibility`, `GetQueueUrl`, `DeleteMessage`, `GetQueueAttributes` and
     * no `sqs:SendMessage`. So every enqueue was an `AccessDenied`, and because both call sites
     * (`users.service.ts` closure, `admin.service.ts` reactivation) `await` inside a swallow that logs a
     * warning, the API answered `200`: account closure never BANNED the Clerk identity, reactivation never
     * UNBANNED it, and a reactivated user stayed locked out of a working account.
     *
     * Asserted over the SQS statements the template actually synthesizes rather than by construct id, so the
     * grant cannot be satisfied by a statement attached to some other role.
     */
    const sqsStatements = (): ReadonlyArray<{ readonly actions: readonly string[] }> =>
        Object.values(serviceTemplate.findResources('AWS::IAM::Policy'))
            .flatMap(
                (policy) =>
                    (policy.Properties?.PolicyDocument?.Statement ?? []) as ReadonlyArray<Record<string, unknown>>,
            )
            .map((statement) => ({
                actions: ([] as string[]).concat(statement['Action'] as string | string[]),
            }))
            .filter((statement) => statement.actions.some((action) => action.startsWith('sqs:')));

    it('grants sqs:SendMessage — without it every closure/reactivation enqueue is AccessDenied', () => {
        expect(sqsStatements().flatMap((statement) => statement.actions)).toContain('sqs:SendMessage');
    });

    it('does NOT grant the consume actions — the service never receives, the worker Lambda does', () => {
        // Least privilege, and the tell that the original grant was simply the wrong one rather than
        // insufficient: a consume grant here is dead permission on a queue this task only ever writes to.
        expect(sqsStatements().flatMap((statement) => statement.actions)).not.toContain('sqs:ReceiveMessage');
        expect(sqsStatements().flatMap((statement) => statement.actions)).not.toContain('sqs:DeleteMessage');
    });

    it('scopes the grant to the imported deletion queue, not a wildcard', () => {
        serviceTemplate.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: Match.arrayWith(['sqs:SendMessage']),
                        Resource: { 'Fn::ImportValue': 'kitchensink-data-test:DeletionQueueArn' },
                    }),
                ]),
            },
        });
    });
});
