// @vitest-environment node
/**
 * The scheduler and the reclaim make NO per-resource call outside their stage scope (ADR-0065).
 *
 * Every role a non-production stack creates carries a permissions boundary that DENIES every action, reads included, on
 * a production-named resource and ALLOWS only `kitchensink-*`. A list call that takes no resource is fine; a
 * per-resource call (`DescribeClusters`, `ListTagsForResource`, Start/Stop) on a name outside that line is refused as an
 * explicit deny, and one refusal fails the whole run. Measured: Sandbox Up's scheduler listed every cluster, described
 * them all with TAGS, and was refused on `kitchensink-food-service-prod-FoodServiceCluster`.
 *
 * So the rule pinned here is about which RESOURCES a per-resource call is made on: the adapters take the scheduler's
 * scope predicate and apply it to a listing's names BEFORE any per-resource call, and the scheduler hands over the one
 * predicate that mirrors the boundary. A fake account holds a production-named, an other-application and an in-scope
 * resource of each kind, and every command each adapter sends is inspected.
 */
import {
    ListStackResourcesCommand,
    ListStacksCommand,
    type CloudFormationClient,
} from '@aws-sdk/client-cloudformation';
import { DescribeClustersCommand, ListClustersCommand, type ECSClient } from '@aws-sdk/client-ecs';
import { ListRulesCommand, ListTagsForResourceCommand, type EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { describe, expect, it, vi } from 'vitest';

import { runReclaimStep, type ReclaimPorts } from '../lib/sandbox-scheduler/reclaim.js';
import {
    isCandidateClusterArn,
    isScheduledCluster,
    isStageScopedName,
    runSchedulerAction,
    selectRdsTargets,
    selectSandboxNatInstances,
    type SchedulerClients,
} from '../lib/sandbox-scheduler/scheduler.js';
import { createEcsApi, createEventsApi } from '../src/sandbox-scheduler/awsAdapters.js';
import { createReclaimEcsApi } from '../src/sandbox-scheduler/reclaimAdapters.js';

const arn = (name: string): string => `arn:aws:ecs:us-east-1:123456789012:cluster/${name}`;

const PROD_CLUSTER = arn('kitchensink-food-service-prod-FoodServiceClusterABC-x1');
const PROD_IDENTITY_CLUSTER = arn('kitchensink-identity-service-prod-Cluster-x2');
const ARMOURY_CLUSTER = arn('armoury-production-cluster');
const ARMOURY_SANDBOX_CLUSTER = arn('armoury-sandbox-cluster');
const SANDBOX_CLUSTER = arn('kitchensink-identity-service-sandbox-Cluster-x3');
const PR_CLUSTER = arn('kitchensink-food-service-pr-91-Cluster-x4');

const ACCOUNT_CLUSTERS = [
    PROD_CLUSTER,
    ARMOURY_CLUSTER,
    ARMOURY_SANDBOX_CLUSTER,
    SANDBOX_CLUSTER,
    PROD_IDENTITY_CLUSTER,
    PR_CLUSTER,
];

type Sent = { readonly name: string; readonly input: Record<string, unknown> };

/** A fake client whose `send` records each command and answers from a function of it. */
function fakeClient<T>(answer: (command: Sent) => unknown) {
    const commands: Sent[] = [];
    const client = {
        send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
            const entry = { name: command.constructor.name, input: command.input };
            commands.push(entry);

            return answer(entry);
        }),
    };

    return { client: client as unknown as T, commands };
}

/** An ECS account that lists every cluster but refuses (throws on) a describe that names an out-of-scope one. */
function ecsAccount() {
    return fakeClient<ECSClient>((command) => {
        if (command.name === ListClustersCommand.name) {
            return { clusterArns: ACCOUNT_CLUSTERS };
        }

        const asked = command.input['clusters'] as string[];

        for (const clusterArn of asked) {
            if (!isCandidateClusterArn(clusterArn)) {
                throw new Error(`AccessDenied: ecs:DescribeClusters on ${clusterArn} (permissions boundary)`);
            }
        }

        return {
            clusters: asked.map((clusterArn) => ({
                clusterArn,
                tags: [{ key: 'Environment', value: clusterArn.includes('pr-91') ? 'pr-91-sandbox' : 'sandbox' }],
            })),
        };
    });
}

describe('isStageScopedName / isCandidateClusterArn', () => {
    it.each([
        ['kitchensink-food-service-pr-91-Cluster-x4', true],
        ['kitchensink-identity-service-sandbox-Cluster-x3', true],
        ['kitchensink-recipe-workers-sandbox-ReconcileRule-Q', true],
        // Case-sensitive, as the IAM pattern `*-prod*` is: a logical id is not a stage.
        ['kitchensink-recipe-workers-pr-7-ProducerRule-Q', true],
        ['kitchensink-food-service-prod-FoodServiceCluster-x1', false],
        ['kitchensink-identity-webhooks-prod-Rule-9', false],
        ['armoury-production-cluster', false],
        ['armoury-sandbox-cluster', false],
        ['', false],
    ])('%s -> %s', (name, expected) => {
        expect(isStageScopedName(name)).toBe(expected);
    });

    it('judges a cluster by the NAME segment of its ARN, and refuses a prod name even with a per-PR path', () => {
        expect(isCandidateClusterArn(PR_CLUSTER)).toBe(true);
        expect(isCandidateClusterArn(PROD_CLUSTER)).toBe(false);
        expect(isCandidateClusterArn(ARMOURY_SANDBOX_CLUSTER)).toBe(false);
        expect(isCandidateClusterArn('arn:aws:ecs:us-east-1:1:cluster/kitchensink-x-prod')).toBe(false);
    });

    it('the name door of isScheduledCluster no longer admits another application sandbox cluster', () => {
        expect(isScheduledCluster({ arn: ARMOURY_SANDBOX_CLUSTER, environmentTag: undefined })).toBe(false);
        expect(isScheduledCluster({ arn: SANDBOX_CLUSTER, environmentTag: undefined })).toBe(true);
    });
});

describe('the ECS adapters describe only the clusters the scheduler admits', () => {
    it.each([
        ['scheduler', (client: ECSClient) => createEcsApi(client)],
        ['reclaim', (client: ECSClient) => createReclaimEcsApi(client)],
    ])('%s: a prod-named and an other-application cluster are never passed to DescribeClusters', async (_n, build) => {
        const { client, commands } = ecsAccount();

        const clusters = await build(client).listClusters(isCandidateClusterArn);

        expect(clusters.map((cluster) => cluster.arn)).toEqual([SANDBOX_CLUSTER, PR_CLUSTER]);
        const described = commands
            .filter((command) => command.name === DescribeClustersCommand.name)
            .flatMap((command) => command.input['clusters'] as string[]);
        expect(described).toEqual([SANDBOX_CLUSTER, PR_CLUSTER]);
        // The list call is made, once: it names no resource.
        expect(commands.filter((command) => command.name === ListClustersCommand.name)).toHaveLength(1);
    });

    it('makes NO describe call at all when nothing in the listing is in scope', async () => {
        const { client, commands } = fakeClient<ECSClient>(() => ({ clusterArns: [PROD_CLUSTER, ARMOURY_CLUSTER] }));

        await expect(createEcsApi(client).listClusters(isCandidateClusterArn)).resolves.toEqual([]);

        expect(commands.map((command) => command.name)).toEqual([ListClustersCommand.name]);
    });

    it('the adapter DECIDES NOTHING: it applies whatever predicate it is given', async () => {
        const { client, commands } = ecsAccount();

        await createEcsApi(client).listClusters((clusterArn) => clusterArn === PR_CLUSTER);

        expect(commands.find((command) => command.name === DescribeClustersCommand.name)?.input['clusters']).toEqual([
            PR_CLUSTER,
        ]);
    });
});

/**
 * The real names, read from the account 2026-10-17. CloudFormation TRUNCATES a generated rule name, so the rule of a
 * PRODUCTION stack starts `kitchensink-identity-webh-…` and carries no `-prod`: a predicate on the RULE name cannot
 * tell it from its sandbox twin. The STACK name is never truncated.
 */
const PROD_STACK = 'kitchensink-identity-webhooks-prod';
const SANDBOX_STACK = 'kitchensink-identity-webhooks-sandbox';
const FOOD_PROD_STACK = 'kitchensink-food-service-prod';
const PROD_RULE = 'kitchensink-identity-webh-ReconciliationScheduleAC1-ZT61PUKdNJV9';
const SANDBOX_RULE = 'kitchensink-identity-webh-ReconciliationScheduleAC1-ynaOAukW661u';
const FOOD_PROD_RULE = 'kitchensink-food-service--IngestionScheduled495FB8C-TDL4xhEXcOBu';

const ruleArn = (name: string): string => `arn:aws:events:us-east-1:123456789012:rule/${name}`;

describe('the scheduler finds its rules through the stacks that own them, never by a rule name', () => {
    it('isStageScopedName cannot tell a truncated production rule name from a sandbox one (why the stack is judged)', () => {
        expect(isStageScopedName(PROD_RULE)).toBe(true);
        expect(isStageScopedName(FOOD_PROD_RULE)).toBe(true);
        expect(isStageScopedName(PROD_STACK)).toBe(false);
        expect(isStageScopedName(FOOD_PROD_STACK)).toBe(false);
        expect(isStageScopedName(SANDBOX_STACK)).toBe(true);
    });

    /**
     * An account where the prod rules are tagged `kitchensink:tier=prod` (the first prod deploy after merge does this),
     * so the boundary's DenyOtherTierTag refuses ANY per-resource call on them and on a prod stack.
     */
    function account() {
        const prodRules = new Set([PROD_RULE, FOOD_PROD_RULE]);
        const eventsAccount = fakeClient<EventBridgeClient>((command) => {
            if (command.name === ListRulesCommand.name) {
                return {
                    Rules: [PROD_RULE, SANDBOX_RULE, FOOD_PROD_RULE].map((name) => ({
                        Name: name,
                        Arn: ruleArn(name),
                        ScheduleExpression: 'rate(1 day)',
                    })),
                };
            }

            const resource = String(command.input['ResourceARN']);

            if (prodRules.has(resource.split('/').pop() ?? '')) {
                throw new Error(`AccessDenied: events:ListTagsForResource on ${resource} (DenyOtherTierTag)`);
            }

            return {
                Tags: [
                    { Key: 'SandboxStage', Value: 'sandbox' },
                    { Key: 'kitchensink:tier', Value: 'nonprod' },
                ],
            };
        });
        const ruleOf = new Map([
            [PROD_STACK, PROD_RULE],
            [SANDBOX_STACK, SANDBOX_RULE],
            [FOOD_PROD_STACK, FOOD_PROD_RULE],
        ]);
        const cloudFormationAccount = fakeClient<CloudFormationClient>((command) => {
            if (command.name === ListStacksCommand.name) {
                // Two pages, so an adapter that stops at the first page loses the third stack.
                return command.input['NextToken'] === undefined
                    ? { StackSummaries: [{ StackName: PROD_STACK }, { StackName: SANDBOX_STACK }], NextToken: 'p2' }
                    : { StackSummaries: [{ StackName: FOOD_PROD_STACK }] };
            }

            const stackName = String(command.input['StackName']);

            if (!isStageScopedName(stackName)) {
                throw new Error(`AccessDenied: cloudformation:ListStackResources on ${stackName} (DenyOtherTierTag)`);
            }

            return {
                StackResourceSummaries: [
                    { ResourceType: 'AWS::Events::Rule', PhysicalResourceId: ruleOf.get(stackName) },
                ],
            };
        });

        return { eventsAccount, cloudFormationAccount };
    }

    it('a truncated production rule is never passed to ListTagsForResource, and its stack is never listed', async () => {
        const { eventsAccount, cloudFormationAccount } = account();

        const rules = await createEventsApi(eventsAccount.client, cloudFormationAccount.client).listScheduledRules(
            isStageScopedName,
        );

        expect(rules).toEqual([{ name: SANDBOX_RULE, stageTag: 'sandbox', environmentTag: undefined }]);
        expect(
            eventsAccount.commands
                .filter((command) => command.name === ListTagsForResourceCommand.name)
                .map((command) => command.input['ResourceARN']),
        ).toEqual([ruleArn(SANDBOX_RULE)]);
        expect(
            cloudFormationAccount.commands
                .filter((command) => command.name === ListStackResourcesCommand.name)
                .map((command) => command.input['StackName']),
        ).toEqual([SANDBOX_STACK]);
    });

    it('the adapter DECIDES NOTHING: it applies the stack predicate it is given', async () => {
        const { eventsAccount, cloudFormationAccount } = account();

        const rules = await createEventsApi(eventsAccount.client, cloudFormationAccount.client).listScheduledRules(
            (stackName) => stackName === SANDBOX_STACK,
        );

        expect(rules.map((rule) => rule.name)).toEqual([SANDBOX_RULE]);
    });

    it('makes no tag call when no stack is in scope', async () => {
        const { eventsAccount, cloudFormationAccount } = account();

        await expect(
            createEventsApi(eventsAccount.client, cloudFormationAccount.client).listScheduledRules(() => false),
        ).resolves.toEqual([]);

        expect(eventsAccount.commands.map((command) => command.name)).not.toContain(ListTagsForResourceCommand.name);
    });
});

describe('Start/Stop selection never names an out-of-scope resource', () => {
    it('RDS: only a kitchensink sandbox instance, never a prod or another application one', () => {
        const instances = [
            { identifier: 'kitchensink-data-prod-databaseb269d8bb-x', status: 'available' },
            { identifier: 'armoury-sandbox-db', status: 'available' },
            { identifier: 'kitchensink-data-sandbox-databaseb269d8bb-x', status: 'available' },
        ];

        expect(selectRdsTargets(instances, 'stop')).toEqual(['kitchensink-data-sandbox-databaseb269d8bb-x']);
    });

    /**
     * The tags are the ones AWS holds (read 2026-10-17): the CDK path `Name` carries no repository prefix, so the stack
     * that owns the instance is what says it is ours.
     */
    it('EC2: the sandbox NAT is the one a kitchensink sandbox stack owns, never prod or another application', () => {
        const nat = (instanceId: string, nameTag: string, stackNameTag: string | undefined) => ({
            instanceId,
            state: 'running',
            nameTag,
            stackNameTag,
            sourceDestCheck: false,
        });

        expect(
            selectSandboxNatInstances(
                [
                    nat('i-prod', 'Global-prod/Network-prod/Vpc/publicSubnet1/NatInstance', 'kitchensink-network-prod'),
                    nat('i-armoury', 'armoury-sandbox-nat', 'armoury-network-sandbox'),
                    nat('i-untagged', 'sandbox-nat', undefined),
                    nat(
                        'i-sbx',
                        'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance',
                        'kitchensink-network-sandbox',
                    ),
                ],
                'stop',
            ),
        ).toEqual(['i-sbx']);
    });
});

describe('the scheduler and the reclaim hand the adapters the one scope predicate', () => {
    it('the scheduler asks for clusters with the predicate that refuses prod and foreign names', async () => {
        const listClusters = vi.fn(async (_inScope: (clusterArn: string) => boolean) => []);
        const clients = {
            rds: { listInstances: async () => [], stopInstance: vi.fn(), startInstance: vi.fn() },
            ecs: { listClusters, listServices: vi.fn(), updateDesiredCount: vi.fn() },
            ec2: { listInstances: async () => [], stopInstances: vi.fn(), startInstances: vi.fn() },
            ssm: { getParameter: vi.fn(), putParameter: vi.fn() },
            events: {
                listScheduledRules: vi.fn(async (_inScope: (name: string) => boolean) => []),
                enableRule: vi.fn(),
                disableRule: vi.fn(),
            },
            reclaim: { startLoop: vi.fn() },
        } as unknown as SchedulerClients;

        await runSchedulerAction({ action: 'sync' }, clients).catch(() => undefined);

        const inScope = listClusters.mock.calls[0]?.[0];
        expect(inScope).toBeDefined();
        expect(ACCOUNT_CLUSTERS.filter((candidate) => inScope?.(candidate))).toEqual([SANDBOX_CLUSTER, PR_CLUSTER]);
        const ruleScope = vi.mocked(clients.events.listScheduledRules).mock.calls[0]?.[0];
        expect(ruleScope?.('kitchensink-x-prod-Rule')).toBe(false);
        expect(ruleScope?.('kitchensink-x-sandbox-Rule')).toBe(true);
    });

    it('the reclaim asks for clusters with the same predicate and expands no foreign cluster', async () => {
        const listClusters = vi.fn(async (_inScope: (clusterArn: string) => boolean) => []);
        const ports = {
            rds: { listInstances: async () => [{ identifier: 'kitchensink-data-sandbox-x', status: 'stopped' }] },
            ec2: {
                listInstances: async () => [
                    {
                        instanceId: 'i-1',
                        state: 'stopped',
                        nameTag: 'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance',
                        stackNameTag: 'kitchensink-network-sandbox',
                        sourceDestCheck: false,
                    },
                ],
            },
            cloudFormation: { listStacks: async () => [], deleteStack: vi.fn() },
            ecs: { listClusters, listServices: vi.fn(), listTasks: vi.fn(), deleteService: vi.fn(), stopTask: vi.fn() },
        } as unknown as ReclaimPorts;

        await runReclaimStep(ports, 0, 5);

        const inScope = listClusters.mock.calls[0]?.[0];
        expect(ACCOUNT_CLUSTERS.filter((candidate) => inScope?.(candidate))).toEqual([SANDBOX_CLUSTER, PR_CLUSTER]);
    });
});
