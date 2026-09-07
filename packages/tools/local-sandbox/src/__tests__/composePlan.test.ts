/**
 * Repo-wide guard: the local compose file is GENERATED from the synthesised CDK, never hand-written.
 *
 * ## What this replaces
 *
 * Two hand-maintained compose files, which had already drifted apart and could not both run:
 *
 * | | `docker-compose.yml` | `infra/localstack/docker-compose.yml` |
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

const requirements = {
    localstackServices: ['s3', 'sqs'],
    containers: ['postgres:18'],
    services: [],
    migrations: [],
    unsupported: [],
    undecided: [],
};

describe('planCompose', () => {
    it('enables exactly the LocalStack services the CDK asked for', () => {
        expect(planCompose(requirements, { databases: [] }).services['localstack']?.environment['SERVICES']).toBe(
            's3,sqs',
        );
    });

    it('pins the LocalStack image rather than floating on a major tag', () => {
        // `docker-compose.yml` used `localstack/localstack:3` while the E2E harness used `4.4.0`. A floating
        // major is how two files that both "work" stop agreeing about behaviour.
        expect(planCompose(requirements, { databases: [] }).services['localstack']?.image).toMatch(
            /^localstack\/localstack:\d+\.\d+\.\d+$/u,
        );
    });

    it('takes the Postgres image from the CDK-derived container list, not a literal', () => {
        const plan = planCompose({ ...requirements, containers: ['postgres:17'] }, { databases: [] });

        expect(plan.services['postgres']?.image).toBe('postgres:17');
    });

    it('omits Postgres entirely when the CDK declares no database', () => {
        // Not vacuous: it is what makes this a DERIVED plan rather than a template with the same two
        // containers every time.
        expect(
            planCompose({ ...requirements, containers: [] }, { databases: [] }).services['postgres'],
        ).toBeUndefined();
    });

    it('creates every database the CDK named, in one init script', () => {
        const plan = planCompose(requirements, { databases: ['kitchensink_identity', 'kitchensink_food'] });

        expect(plan.initSql).toContain('CREATE DATABASE "kitchensink_identity"');
        expect(plan.initSql).toContain('CREATE DATABASE "kitchensink_food"');
    });

    it('guards each CREATE DATABASE so a re-run is a no-op', () => {
        // The volume survives `up`/`down` without `-v`; an unguarded CREATE would fail the whole init on
        // the second start and leave a half-provisioned cluster.
        expect(planCompose(requirements, { databases: ['a'] }).initSql).toMatch(/SELECT[\s\S]*pg_database[\s\S]*'a'/u);
    });

    it('gives both containers a healthcheck, so `up --wait` means READY not STARTED', () => {
        const plan = planCompose(requirements, { databases: [] });

        expect(plan.services['localstack']?.healthcheck).toBeDefined();
        expect(plan.services['postgres']?.healthcheck).toBeDefined();
    });

    it('is deterministic — the same requirements produce byte-identical output', () => {
        const a = planCompose(requirements, { databases: ['x', 'y'] });
        const b = planCompose(requirements, { databases: ['x', 'y'] });

        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('sorts the SERVICES list, so a reordered inventory is not a diff', () => {
        expect(
            planCompose({ ...requirements, localstackServices: ['sqs', 's3'] }, { databases: [] }).services[
                'localstack'
            ]?.environment['SERVICES'],
        ).toBe('s3,sqs');
    });
});
