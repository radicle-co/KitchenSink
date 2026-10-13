// @vitest-environment node
/**
 * The midnight reclaim's planner and request parser (ADR-0061): which stacks a night may delete, and in what order.
 *
 * ## What is asserted, and the lens
 *
 * `planReclaim` is a PURE function from an observation of the account to a list of actions, so every rule the plan
 * states is a row in a table here. The table is built from hostile shapes, not from the happy path, because the
 * action on the other side of this predicate is `DeleteStack`: `pr-1` against `pr-15`, `pr-091`, a name that merely
 * CONTAINS a token, a tag that is a PREFIX of the token's, a tag of `production`, another application's stack and
 * the persistent tier. Each row would go red if the matcher were loosened to a prefix, a substring or a bare
 * `pr-*` glob.
 *
 * The last block generates every combination of name, tag and status and asserts the property that holds for all
 * of them: **the planner never names a stack it was not allowed to**.
 *
 * ## Every terminal state
 *
 * A reclaim that ends in `Fail` without a Sentry issue is silent, because the sandbox alarm topic has no
 * subscriber. So the contract here is stated over the outcomes: a run that ends incomplete is `failed` (and the
 * handler announces it), a run that ends complete is not, and a tier that cannot be observed THROWS, so it reaches
 * the state machine's Catch and its report rather than ending as a quiet "failed" result.
 *
 * @pattern Specification — one predicate (owns / quiescent / may go) fired at a fixture table
 */
import { describe, expect, it } from 'vitest';

import {
    InvalidReclaimRequestError,
    isInvalidReclaimRequestError,
} from '../lib/sandbox-scheduler/invalidReclaimRequestError.js';
import {
    PER_PR_STACK_NAME,
    SHARED_TIER_DELETE_ORDER,
    environmentTagBelongs,
    liveTokens,
    parseReclaimRequest,
    planReclaim,
    type ObservedCluster,
    type ReclaimAction,
    type ReclaimObservation,
    type StackSummary,
} from '../lib/sandbox-scheduler/reclaim.js';
import {
    ReclaimTierUnobservableError,
    isReclaimTierUnobservableError,
} from '../lib/sandbox-scheduler/reclaimTierUnobservableError.js';

const RDS_STOPPED = { identifier: 'kitchensink-data-sandbox', status: 'stopped' } as const;
const NAT_STOPPED = {
    instanceId: 'i-0abc',
    state: 'stopped',
    nameTag: 'kitchensink-network-sandbox/NatInstance',
    sourceDestCheck: false,
} as const;

/** A stack in a resting state. `tag` defaults to the tag the CDK apps give a stack whose name ends in a token. */
function stack(name: string, tag?: string | null, status = 'CREATE_COMPLETE'): StackSummary {
    const token = /(pr-[0-9]+)$/u.exec(name)?.[1];
    const environmentTag = tag === null ? undefined : (tag ?? (token === undefined ? 'sandbox' : `${token}-sandbox`));

    return { name, status, environmentTag };
}

/** An observation of a sandbox whose tier is down, unless a test says otherwise. */
function observe(stacks: readonly StackSummary[], rest: Partial<ReclaimObservation> = {}): ReclaimObservation {
    return {
        rdsInstances: [RDS_STOPPED],
        natInstances: [NAT_STOPPED],
        stacks,
        clusters: [],
        ...rest,
    };
}

/** The names the plan deletes, in plan order. */
const deletes = (actions: readonly ReclaimAction[]): string[] =>
    actions.flatMap((action) => (action.kind === 'deleteStack' ? [action.stackName] : []));

const cluster = (token: string, parts: Partial<ObservedCluster> = {}): ObservedCluster => ({
    arn: `arn:aws:ecs:us-east-1:123456789012:cluster/kitchensink-food-service-${token}-Cluster-X`,
    environmentTag: `${token}-sandbox`,
    services: [],
    tasks: [],
    ...parts,
});

const FOOD_91 = 'kitchensink-food-service-pr-91';
const RECIPE_91 = 'kitchensink-recipe-service-pr-91';

describe('which stacks a stage owns', () => {
    it.each<[string, string, string | null, boolean]>([
        ['an ordinary per-PR stack with the current tag', FOOD_91, 'pr-91-sandbox', true],
        ['the legacy bare-token tag', FOOD_91, 'pr-91', true],
        [
            'a token with a leading zero (the shell accepts pr-091)',
            'kitchensink-food-service-pr-091',
            'pr-091-sandbox',
            true,
        ],
        ['pr-1, with pr-15 beside it', 'kitchensink-food-service-pr-1', 'pr-1-sandbox', true],
        ['pr-15 carrying pr-1`s tag', 'kitchensink-food-service-pr-15', 'pr-1-sandbox', false],
        ['pr-1 carrying pr-15`s tag', 'kitchensink-food-service-pr-1', 'pr-15-sandbox', false],
        ['a tag that is a prefix of the token`s (pr-9 on pr-91)', FOOD_91, 'pr-9-sandbox', false],
        ['a tag with a trailing letter', FOOD_91, 'pr-91-sandboxx', false],
        ['a tag with a suffix of its own', FOOD_91, 'pr-91-anything', false],
        ['a production tag on a per-PR name', FOOD_91, 'production', false],
        ['the bare tier tag on a per-PR name', FOOD_91, 'sandbox', false],
        ['no tag at all', FOOD_91, null, false],
    ])('%s -> deleted: %s', (_name, name, tag, owned) => {
        const plan = planReclaim(observe([stack(name, tag)]), 0, 120);

        expect(deletes(plan.actions)).toEqual(owned ? [name] : []);
        expect(plan.warnings.length > 0).toBe(!owned);
    });

    it.each([
        ['a name that merely CONTAINS a token', 'kitchensink-food-service-pr-91-old'],
        ['a name with a second token', 'kitchensink-food-pr-1-pr-2'],
        ['another application in the account', 'armoury-api-pr-91'],
        ['a prod stack', 'kitchensink-food-service-prod'],
        ['the shared database', 'kitchensink-data-sandbox'],
        ['the network', 'kitchensink-network-sandbox'],
        ['the webhooks', 'kitchensink-identity-webhooks-sandbox'],
        ['the domain', 'kitchensink-domain-sandbox'],
        ['the scheduler', 'kitchensink-sandbox-scheduler-sandbox'],
        ['a prod network', 'kitchensink-network-prod'],
        ['a bare token', 'pr-91'],
        ['a stage with no application', 'kitchensink-pr-91'],
    ])('never touches %s (%s), and does not even warn about it', (_label, name) => {
        const plan = planReclaim(observe([stack(name, 'pr-91-sandbox')]), 0, 120);

        expect(plan.actions).toEqual([]);
        expect(plan.warnings).toEqual([]);
    });

    it('keeps a per-PR name that carries the wrong tag as LIVE, so the shared tier stays', () => {
        const plan = planReclaim(
            observe([stack(FOOD_91, 'production'), ...SHARED_TIER_DELETE_ORDER.map((name) => stack(name))]),
            0,
            120,
        );

        expect(deletes(plan.actions)).toEqual([]);
        expect(plan.done).toBe(true);
    });

    it('PER_PR_STACK_NAME is anchored at both ends', () => {
        expect(PER_PR_STACK_NAME.test('kitchensink-food-service-pr-91')).toBe(true);
        expect(PER_PR_STACK_NAME.test('xkitchensink-food-service-pr-91')).toBe(false);
        expect(PER_PR_STACK_NAME.test('kitchensink-food-service-pr-91x')).toBe(false);
    });
});

describe('the tier must be quiescent before anything is deleted', () => {
    const owned = [stack(FOOD_91)];

    it.each([
        ['a running database', { rdsInstances: [{ ...RDS_STOPPED, status: 'available' }] }],
        ['a database that is starting', { rdsInstances: [{ ...RDS_STOPPED, status: 'starting' }] }],
        ['a running NAT', { natInstances: [{ ...NAT_STOPPED, state: 'running' }] }],
        ['a NAT that is pending', { natInstances: [{ ...NAT_STOPPED, state: 'pending' }] }],
        [
            'one of two databases still up',
            { rdsInstances: [RDS_STOPPED, { identifier: 'kitchensink-other-sandbox', status: 'available' }] },
        ],
    ])('stands down for %s, and says so', (_label, rest) => {
        const plan = planReclaim(observe(owned, rest), 0, 120);

        expect(plan.standDown).toBe(true);
        expect(plan.actions).toEqual([]);
        // Nothing is in flight, so a deliberate stand-down is a finished run and NOT a failure.
        expect(plan.done).toBe(true);
    });

    it.each([
        ['a database that is stopping', { rdsInstances: [{ ...RDS_STOPPED, status: 'stopping' }] }],
        ['a NAT that is stopping', { natInstances: [{ ...NAT_STOPPED, state: 'stopping' }] }],
    ])('proceeds for %s', (_label, rest) => {
        const plan = planReclaim(observe(owned, rest), 0, 120);

        expect(plan.standDown).toBe(false);
        expect(deletes(plan.actions)).toEqual([FOOD_91]);
    });

    it('keeps tracking a delete already in flight while it stands down, and starts no new one', () => {
        const plan = planReclaim(
            observe([stack(FOOD_91, undefined, 'DELETE_IN_PROGRESS'), stack(RECIPE_91)], {
                rdsInstances: [{ ...RDS_STOPPED, status: 'available' }],
            }),
            0,
            120,
        );

        expect(plan.standDown).toBe(true);
        expect(plan.actions).toEqual([]);
        expect(plan.pending).toEqual([FOOD_91]);
        expect(plan.done).toBe(false);
    });

    // ADR-0061 review (N7). `isSandboxRdsInstance` used to match ANY identifier containing `-sandbox`, so a running instance
    // of the other application in this account would have held the tier "up" for ever, and silently.
    it('⛔ is not held up by a running database that is not ours', () => {
        const foreign = { identifier: 'armoury-sandbox-db', status: 'available' };
        const plan = planReclaim(observe(owned, { rdsInstances: [RDS_STOPPED, foreign] }), 0, 120);

        expect(plan.standDown).toBe(false);
        expect(deletes(plan.actions)).toEqual([FOOD_91]);
    });

    it('⛔ reads a foreign database ALONE as an unobservable tier, not as a quiescent one', () => {
        expect(() =>
            planReclaim(
                observe(owned, { rdsInstances: [{ identifier: 'armoury-sandbox-db', status: 'stopped' }] }),
                0,
                120,
            ),
        ).toThrow(ReclaimTierUnobservableError);
    });

    it.each([
        ['no database', { rdsInstances: [] }],
        ['no NAT', { natInstances: [] }],
        [
            'a database that is not a sandbox one',
            { rdsInstances: [{ identifier: 'kitchensink-data-prod', status: 'stopped' }] },
        ],
        ['an instance that is not a NAT', { natInstances: [{ ...NAT_STOPPED, sourceDestCheck: true }] }],
        [
            'a NAT that is not the sandbox one',
            { natInstances: [{ ...NAT_STOPPED, nameTag: 'kitchensink-network-prod/Nat' }] },
        ],
    ])('THROWS when it can find %s: an unobservable tier is an error, never a quiet success', (_label, rest) => {
        let thrown: unknown;

        try {
            planReclaim(observe(owned, rest), 0, 120);
        } catch (error) {
            thrown = error;
        }

        expect(isReclaimTierUnobservableError(thrown)).toBe(true);
        expect(thrown).toBeInstanceOf(ReclaimTierUnobservableError);
    });
});

describe('the order inside one stage: quiesce first, then delete', () => {
    const service = (status: string, name = 'api') => ({
        clusterArn: cluster('pr-91').arn,
        serviceArn: `arn:aws:ecs:us-east-1:123456789012:service/x/${name}`,
        serviceName: name,
        status,
    });
    const task = (desiredStatus: string, lastStatus: string, id = 't1') => ({
        clusterArn: cluster('pr-91').arn,
        taskArn: `arn:aws:ecs:us-east-1:123456789012:task/x/${id}`,
        desiredStatus,
        lastStatus,
    });
    const plan = (clusters: readonly ObservedCluster[], stacks = [stack(FOOD_91), stack(RECIPE_91)]) =>
        planReclaim(observe(stacks, { clusters }), 0, 120);

    it('force-deletes an ACTIVE service first, and deletes no stack in the same pass', () => {
        const result = plan([cluster('pr-91', { services: [service('ACTIVE')], tasks: [task('RUNNING', 'RUNNING')] })]);

        expect(result.actions).toEqual([
            { kind: 'deleteService', clusterArn: cluster('pr-91').arn, serviceArn: service('ACTIVE').serviceArn },
        ]);
        expect(result.done).toBe(false);
    });

    it('then stops a task whose desired status is still RUNNING', () => {
        const result = plan([
            cluster('pr-91', { services: [service('INACTIVE')], tasks: [task('RUNNING', 'RUNNING')] }),
        ]);

        expect(result.actions).toEqual([
            { kind: 'stopTask', clusterArn: cluster('pr-91').arn, taskArn: task('RUNNING', 'RUNNING').taskArn },
        ]);
    });

    it.each([
        ['a DRAINING service', [service('DRAINING')], []],
        ['a task asked to stop that has not stopped', [], [task('STOPPED', 'DEPROVISIONING')]],
        ['a task asked to stop that is still running', [], [task('STOPPED', 'RUNNING')]],
    ])('waits on %s, deleting nothing', (_label, services, tasks) => {
        const result = plan([cluster('pr-91', { services, tasks })]);

        expect(result.actions).toEqual([]);
        expect(result.pending.length).toBeGreaterThan(0);
        expect(result.done).toBe(false);
    });

    it('deletes every stack of the stage once its services are INACTIVE and its tasks STOPPED', () => {
        const result = plan([
            cluster('pr-91', { services: [service('INACTIVE')], tasks: [task('STOPPED', 'STOPPED')] }),
        ]);

        expect(deletes(result.actions)).toEqual([FOOD_91, RECIPE_91]);
    });

    it('does not let another stage`s running service hold this stage`s stacks', () => {
        const result = plan(
            [cluster('pr-91'), cluster('pr-92', { services: [service('ACTIVE')] })],
            [stack(FOOD_91), stack('kitchensink-food-service-pr-92')],
        );

        expect(deletes(result.actions)).toEqual([FOOD_91]);
        expect(result.actions.some((action) => action.kind === 'deleteService')).toBe(true);
    });

    it('⛔ ignores a FOREIGN cluster that carries a valid per-PR tag, and is not held up by it (ADR-0061 review B1)', () => {
        const foreign: ObservedCluster = {
            arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/armoury-api-pr-91-Cluster-X',
            environmentTag: 'pr-91-sandbox',
            services: [service('ACTIVE')],
            tasks: [task('RUNNING', 'RUNNING')],
        };
        const result = plan([foreign]);

        expect(result.actions.some((action) => action.kind === 'deleteService' || action.kind === 'stopTask')).toBe(
            false,
        );
        // Nothing of ours is running in it, so the stage's own stacks are not held waiting on somebody else's cluster.
        expect(deletes(result.actions)).toEqual([FOOD_91, RECIPE_91]);
    });

    it('ignores a cluster that is not a per-PR one (the shared identity cluster, prod)', () => {
        const shared: ObservedCluster = {
            arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/kitchensink-identity-service-sandbox-X',
            environmentTag: 'sandbox',
            services: [{ ...service('ACTIVE'), clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/shared' }],
            tasks: [],
        };
        const prod: ObservedCluster = {
            arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/kitchensink-food-service-prod-X',
            environmentTag: 'pr-91-sandbox',
            services: [service('ACTIVE')],
            tasks: [],
        };

        expect(plan([shared, prod]).actions.some((action) => action.kind === 'deleteService')).toBe(false);
    });

    it('is pending while a stack of the stage is still being created or updated, and acts on nothing in it', () => {
        const busy = [stack(FOOD_91, undefined, 'UPDATE_IN_PROGRESS'), stack(RECIPE_91)];
        const result = plan([cluster('pr-91', { services: [service('ACTIVE')] })], busy);

        expect(result.actions).toEqual([]);
        expect(result.pending).toContain(FOOD_91);
    });

    // ADR-0061 review (N3). `REVIEW_IN_PROGRESS` is a stack whose first change set was created and never executed. Nothing
    // is deploying: it will never leave that state by itself, so reading it as "being deployed" would wait for the whole
    // bound and then fail the night. CloudFormation deletes it.
    it('⛔ treats REVIEW_IN_PROGRESS as deletable, not as a deploy to wait for', () => {
        const result = plan([], [stack(FOOD_91, undefined, 'REVIEW_IN_PROGRESS'), stack(RECIPE_91)]);

        expect(deletes(result.actions)).toEqual([FOOD_91, RECIPE_91]);
        expect(result.pending).toEqual([]);
    });

    it('re-issues a DELETE_FAILED stack, and waits on one already DELETE_IN_PROGRESS', () => {
        const result = plan(
            [],
            [stack(FOOD_91, undefined, 'DELETE_FAILED'), stack(RECIPE_91, undefined, 'DELETE_IN_PROGRESS')],
        );

        expect(deletes(result.actions)).toEqual([FOOD_91]);
        expect(result.pending).toEqual([RECIPE_91]);
    });
});

describe('the shared tier goes last, one stack at a time, in the mirror order', () => {
    const [IDENTITY, SCHEMA, ALB] = SHARED_TIER_DELETE_ORDER;
    const shared = SHARED_TIER_DELETE_ORDER.map((name) => stack(name));

    it('is kept while any per-PR stack is left', () => {
        const result = planReclaim(observe([...shared, stack(FOOD_91, 'production')]), 0, 120);

        expect(deletes(result.actions)).toEqual([]);
    });

    it('is kept while a per-PR stack is merely being deleted (it still holds its import)', () => {
        const result = planReclaim(observe([...shared, stack(FOOD_91, undefined, 'DELETE_IN_PROGRESS')]), 0, 120);

        expect(deletes(result.actions)).toEqual([]);
        expect(result.pending).toEqual([FOOD_91]);
    });

    it.each(['CREATE_IN_PROGRESS', 'UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS'])(
        'is kept while a sandbox stack is %s (a deploy is standing something up)',
        (status) => {
            const result = planReclaim(
                observe([...shared, stack('kitchensink-identity-webhooks-sandbox', 'sandbox', status)]),
                0,
                120,
            );

            expect(deletes(result.actions)).toEqual([]);
        },
    );

    it('⛔ a REVIEW_IN_PROGRESS sandbox stack does not hold the shared tier either', () => {
        const stale = stack('kitchensink-identity-webhooks-sandbox', 'sandbox', 'REVIEW_IN_PROGRESS');

        expect(deletes(planReclaim(observe([stale, ...shared]), 0, 120).actions)).toEqual([IDENTITY]);
    });

    it('does not count a DELETE_COMPLETE per-PR stack as live', () => {
        const gone = stack(FOOD_91, undefined, 'DELETE_COMPLETE');

        expect(deletes(planReclaim(observe([gone, ...shared]), 0, 120).actions)).toEqual([IDENTITY]);
    });

    it('deletes the first allowlisted stack that is present, and only that one', () => {
        expect(deletes(planReclaim(observe(shared), 0, 120).actions)).toEqual([IDENTITY]);
    });

    it('moves to the next stack once the first is gone', () => {
        expect(deletes(planReclaim(observe([stack(SCHEMA), stack(ALB)]), 0, 120).actions)).toEqual([SCHEMA]);
        expect(deletes(planReclaim(observe([stack(ALB)]), 0, 120).actions)).toEqual([ALB]);
    });

    it('waits while the one it is deleting is DELETE_IN_PROGRESS, and does not start the next', () => {
        const result = planReclaim(
            observe([stack(IDENTITY, 'sandbox', 'DELETE_IN_PROGRESS'), stack(SCHEMA), stack(ALB)]),
            0,
            120,
        );

        expect(result.actions).toEqual([]);
        expect(result.pending).toEqual([IDENTITY]);
    });

    it('re-issues a DELETE_FAILED shared stack', () => {
        expect(deletes(planReclaim(observe([stack(IDENTITY, 'sandbox', 'DELETE_FAILED')]), 0, 120).actions)).toEqual([
            IDENTITY,
        ]);
    });

    it.each(['production', 'pr-91-sandbox', undefined])(
        '⛔ refuses an allowlisted stack tagged %s, with a warning (the IAM grant needs Environment=sandbox)',
        (tag) => {
            const result = planReclaim(observe([stack(IDENTITY, tag ?? null)]), 0, 120);

            expect(result.actions).toEqual([]);
            expect(result.warnings).toHaveLength(1);
        },
    );

    it('never names the database, the network, the webhooks or the scheduler, whatever is left', () => {
        const persistent = [
            'kitchensink-data-sandbox',
            'kitchensink-network-sandbox',
            'kitchensink-identity-webhooks-sandbox',
            'kitchensink-sandbox-scheduler-sandbox',
            'kitchensink-service-logs-sandbox',
            'kitchensink-remote-search-shared-sandbox',
            'kitchensink-domain-sandbox',
        ].map((name) => stack(name));
        const result = planReclaim(observe(persistent), 0, 120);

        expect(result.actions).toEqual([]);
        expect(result.done).toBe(true);
    });
});

describe('when the run is over', () => {
    const blocked = observe([stack(FOOD_91, undefined, 'DELETE_IN_PROGRESS')]);

    it('is done, and not failed, when there is nothing to do and nothing pending', () => {
        const result = planReclaim(observe([]), 5, 120);

        expect(result).toMatchObject({ done: true, lastIteration: false, actions: [], pending: [] });
    });

    it('is NOT done while work is pending, before the last iteration', () => {
        expect(planReclaim(blocked, 118, 120)).toMatchObject({ done: false, lastIteration: false });
    });

    it('marks the last iteration, so the caller can call a run with work left a failure', () => {
        expect(planReclaim(blocked, 119, 120)).toMatchObject({ done: false, lastIteration: true });
    });

    it('is done on the last iteration when the work finished', () => {
        expect(planReclaim(observe([]), 119, 120)).toMatchObject({ done: true, lastIteration: true });
    });

    it('a run that issued deletes on the last iteration still has work left', () => {
        expect(planReclaim(observe([stack(FOOD_91)]), 119, 120)).toMatchObject({ done: false, lastIteration: true });
    });
});

describe('⛔ the planner never names a stack it was not allowed to (generated over every shape)', () => {
    const names = [
        'kitchensink-food-service-pr-1',
        'kitchensink-food-service-pr-15',
        'kitchensink-food-service-pr-091',
        'kitchensink-food-service-pr-91-old',
        'kitchensink-recipe-workers-pr-91',
        'kitchensink-food-service-prod',
        'kitchensink-food-service-pr-1-pr-2',
        'armoury-api-pr-91',
        'kitchensink-data-sandbox',
        'kitchensink-network-sandbox',
        'kitchensink-identity-webhooks-sandbox',
        'kitchensink-identity-service-prod',
        'kitchensink-alb-prod',
        ...SHARED_TIER_DELETE_ORDER,
    ];
    const tags: (string | null)[] = [
        null,
        'sandbox',
        'production',
        'pr-1',
        'pr-1-sandbox',
        'pr-15-sandbox',
        'pr-9-sandbox',
        'pr-91',
        'pr-91-sandbox',
        'pr-91-sandboxx',
        'pr-091-sandbox',
    ];
    const statuses = [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'DELETE_FAILED',
        'DELETE_IN_PROGRESS',
        'UPDATE_IN_PROGRESS',
        'ROLLBACK_COMPLETE',
    ];

    const allowed = (candidate: StackSummary): boolean => {
        const token = PER_PR_STACK_NAME.exec(candidate.name)?.[1];

        return (
            (token !== undefined && environmentTagBelongs(token, candidate.environmentTag ?? '')) ||
            ((SHARED_TIER_DELETE_ORDER as readonly string[]).includes(candidate.name) &&
                candidate.environmentTag === 'sandbox')
        );
    };

    it('holds for every name x tag x status, alone and together with the shared tier', () => {
        let checked = 0;

        for (const name of names) {
            for (const tag of tags) {
                for (const status of statuses) {
                    const candidate = stack(name, tag, status);
                    const together = [candidate, ...SHARED_TIER_DELETE_ORDER.map((shared) => stack(shared))];

                    for (const stacks of [[candidate], together]) {
                        const result = planReclaim(observe(stacks), 0, 120);

                        for (const named of deletes(result.actions)) {
                            const subject = stacks.find((entry) => entry.name === named);

                            expect(subject, `${name} / ${String(tag)} / ${status} named ${named}`).toBeDefined();
                            expect(allowed(subject as StackSummary), `${name} / ${String(tag)} / ${status}`).toBe(true);
                            expect(named).not.toMatch(/-prod($|-)/u);
                            expect(subject?.environmentTag).not.toBe('production');
                        }

                        checked += 1;
                    }
                }
            }
        }

        expect(checked).toBe(names.length * tags.length * statuses.length * 2);
    });

    it('actually deletes in some of those shapes (the property is not vacuously true)', () => {
        expect(
            deletes(planReclaim(observe([stack('kitchensink-food-service-pr-1', 'pr-1-sandbox')]), 0, 120).actions),
        ).toEqual(['kitchensink-food-service-pr-1']);
    });
});

describe('liveTokens and environmentTagBelongs', () => {
    it('returns each token once, sorted', () => {
        expect(
            liveTokens([
                'kitchensink-recipe-service-pr-9',
                'kitchensink-food-service-pr-10',
                'kitchensink-food-service-pr-9',
                'kitchensink-data-sandbox',
                'kitchensink-food-service-pr-9-old',
            ]),
        ).toEqual(['pr-10', 'pr-9']);
    });

    it('answers equality against the two spellings a token can carry, and nothing else', () => {
        expect(environmentTagBelongs('pr-91', 'pr-91')).toBe(true);
        expect(environmentTagBelongs('pr-91', 'pr-91-sandbox')).toBe(true);
        expect(environmentTagBelongs('pr-91', 'pr-9-sandbox')).toBe(false);
        expect(environmentTagBelongs('pr-91', 'sandbox')).toBe(false);
        expect(environmentTagBelongs('pr-91', '')).toBe(false);
        expect(environmentTagBelongs('sandbox', 'sandbox')).toBe(false);
    });
});

describe('parseReclaimRequest', () => {
    it.each([
        [{ kind: 'step', iteration: 0, maxIterations: 120 }],
        [{ kind: 'step', iteration: 119, maxIterations: 120 }],
    ])('accepts a step: %j', (event) => {
        expect(parseReclaimRequest(event)).toEqual(event);
    });

    it('accepts a report, with or without the state machine`s error', () => {
        expect(parseReclaimRequest({ kind: 'report' })).toEqual({ kind: 'report', error: undefined });
        expect(parseReclaimRequest({ kind: 'report', error: { Error: 'X', Cause: 'y' } })).toEqual({
            kind: 'report',
            error: { Error: 'X', Cause: 'y' },
        });
    });

    it.each([
        [undefined],
        [null],
        ['step'],
        [{}],
        [{ kind: 'stop' }],
        [{ kind: 'step' }],
        [{ kind: 'step', iteration: -1, maxIterations: 120 }],
        [{ kind: 'step', iteration: 1.5, maxIterations: 120 }],
        [{ kind: 'step', iteration: '1', maxIterations: 120 }],
        [{ kind: 'step', iteration: 0, maxIterations: 0 }],
        [{ kind: 'step', iteration: 120, maxIterations: 120 }],
        [{ kind: 'step', iteration: 0 }],
        [{ iteration: 0, maxIterations: 120 }],
    ])('refuses %j rather than defaulting it', (event) => {
        let thrown: unknown;

        try {
            parseReclaimRequest(event);
        } catch (error) {
            thrown = error;
        }

        expect(isInvalidReclaimRequestError(thrown)).toBe(true);
        expect(thrown).toBeInstanceOf(InvalidReclaimRequestError);
    });
});
