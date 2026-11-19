/**
 * Repo-wide guard: the local compose file is GENERATED from the synthesised CDK, never hand-written.
 *
 * ## What this replaces
 *
 * Two hand-maintained compose files, which had already drifted apart and could not both run:
 *
 * | | `compose.yml` | `infra/localstack/compose.yml` |
 * |---|---|---|
 * | LocalStack | `3` | `4.4.0` |
 * | `SERVICES` | `s3` | everything EXCEPT `s3` |
 * | Postgres user/db | `commise` / `commise` | `postgres` / `food_e2e` |
 *
 * Both bind 5432 and 4566, so they are mutually exclusive — and neither is a superset of the other, so
 * "run everything locally" was not achievable with either. The synthesised CDK says the answer is
 * `apigateway,dynamodb,events,lambda,logs,s3,secretsmanager,sns,sqs,ssm`; no human was ever going to keep
 * that list current by hand, which is exactly why it had not been.
 */
import { describe, expect, it } from 'vitest';

import { planCompose } from '../composePlan.js';
import { stackFrom } from '../stackPorts.js';

const stack = stackFrom({});

const requirements = {
    localstackServices: ['s3', 'sqs'],
    containers: ['postgres:18'],
    services: [],
    unsupported: [],
    undecided: [],
};

describe('planCompose', () => {
    it('enables exactly the LocalStack services the CDK asked for', () => {
        expect(
            planCompose(requirements, { databases: [], stack }).services['localstack']?.environment['SERVICES'],
        ).toBe('s3,sqs');
    });

    it('pins the LocalStack image rather than floating on a major tag', () => {
        // `compose.yml` used `localstack/localstack:3` while the E2E harness used `4.4.0`. A floating
        // major is how two files that both "work" stop agreeing about behaviour.
        expect(planCompose(requirements, { databases: [], stack }).services['localstack']?.image).toMatch(
            /^localstack\/localstack:\d+\.\d+\.\d+$/u,
        );
    });

    it('takes the Postgres image from the CDK-derived container list, not a literal', () => {
        const plan = planCompose({ ...requirements, containers: ['postgres:17'] }, { databases: [], stack });

        expect(plan.services['postgres']?.image).toBe('postgres:17');
    });

    it('omits Postgres entirely when the CDK declares no database', () => {
        // Not vacuous: it is what makes this a DERIVED plan rather than a template with the same two
        // containers every time.
        expect(
            planCompose({ ...requirements, containers: [] }, { databases: [], stack }).services['postgres'],
        ).toBeUndefined();
    });

    it('creates every database the CDK named, in one init script', () => {
        const plan = planCompose(requirements, { databases: ['kitchensink_identity', 'kitchensink_food'], stack });

        expect(plan.initSql).toContain('CREATE DATABASE "kitchensink_identity"');
        expect(plan.initSql).toContain('CREATE DATABASE "kitchensink_food"');
    });

    it('guards each CREATE DATABASE so a re-run is a no-op', () => {
        // The volume survives `up`/`down` without `-v`; an unguarded CREATE would fail the whole init on
        // the second start and leave a half-provisioned cluster.
        expect(planCompose(requirements, { databases: ['a'], stack }).initSql).toMatch(
            /SELECT[\s\S]*pg_database[\s\S]*'a'/u,
        );
    });

    it('gives both containers a healthcheck, so `up --wait` means READY not STARTED', () => {
        const plan = planCompose(requirements, { databases: [], stack });

        expect(plan.services['localstack']?.healthcheck).toBeDefined();
        expect(plan.services['postgres']?.healthcheck).toBeDefined();
    });

    it('is deterministic — the same requirements produce byte-identical output', () => {
        const a = planCompose(requirements, { databases: ['x', 'y'], stack });
        const b = planCompose(requirements, { databases: ['x', 'y'], stack });

        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('sorts the SERVICES list, so a reordered inventory is not a diff', () => {
        expect(
            planCompose({ ...requirements, localstackServices: ['sqs', 's3'] }, { databases: [], stack }).services[
                'localstack'
            ]?.environment['SERVICES'],
        ).toBe('s3,sqs');
    });
});

describe("planCompose publishes the stack's host ports (AE1, AE2)", () => {
    it('the default stack publishes LocalStack on 4566 and Postgres on 5432, exactly as before', () => {
        const plan = planCompose(requirements, { databases: [], stack: stackFrom({}) });

        expect(plan.services['localstack']?.ports).toEqual(['4566:4566']);
        expect(plan.services['postgres']?.ports).toEqual(['5432:5432']);
    });

    it('a shifted stack moves only the host side; the container side stays 4566 and 5432', () => {
        const plan = planCompose(requirements, { databases: [], stack: stackFrom({ LOCAL_SANDBOX_PORT: '3100' }) });

        expect(plan.services['localstack']?.ports).toEqual(['4666:4566']);
        expect(plan.services['postgres']?.ports).toEqual(['5532:5432']);
    });

    it('an explicit host port for postgres beats the shift', () => {
        const plan = planCompose(requirements, {
            databases: [],
            stack: stackFrom({ LOCAL_SANDBOX_PORT: '3100', LOCAL_SANDBOX_HOST_PORTS: 'postgres=5999' }),
        });

        expect(plan.services['postgres']?.ports).toEqual(['5999:5432']);
    });
});
