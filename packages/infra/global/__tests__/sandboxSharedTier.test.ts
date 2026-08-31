/**
 * Repo-wide guard: the shared sandbox tier's delete allowlist and mirror order
 * (`.github/scripts/sandbox-shared-tier.sh`), the on-demand half of ADR-0028.
 *
 * ## Why this guard is stricter than the others
 *
 * Every other teardown in this repository is safe because of `pr-scope.sh`: it only ever matches `pr-{N}`,
 * and `prScope.test.ts` proves the shared `*-sandbox` names can never be claimed. This script is the single
 * deliberate exception — it deletes `kitchensink-identity-service-sandbox` and `kitchensink-alb-sandbox`,
 * two of the very names that suite forbids everywhere else.
 *
 * So nothing about the shape of a name makes an operation here safe, and the allowlist IS the boundary.
 * These assertions fire the predicate at the four shared-tier stacks that must never be in it — the RDS
 * instance holding every per-PR logical database, the VPC/NAT, the webhooks whose Clerk fixture `e2e-web`
 * blocks on, and prod — because a predicate that has only ever seen the two names it accepts has not been
 * shown to refuse anything.
 *
 * ## The order is the other half of the correctness argument
 *
 * `kitchensink-alb-sandbox` exports the HTTPS listener ARN, DNS name and hosted-zone id that
 * `kitchensink-identity-service-sandbox` imports, and CloudFormation refuses to delete a stack whose
 * exports are in use. Delete is therefore importer-then-exporter, the exact mirror of create
 * (ALB, then the identity service that attaches to it). Reversing either half deadlocks, which is why the
 * order is asserted as a SEQUENCE rather than as set membership.
 *
 * The predicates are executed as real `bash`, not re-implemented here: a TypeScript copy would be a second
 * matcher that could drift from the one the reconciler actually runs, which is the failure mode ADR-0005
 * was written after.
 *
 * DESIGN PATTERN: Specification module over one script — `may-delete` and `order` are pure verbs, so both
 * are fired at inputs the working tree never supplies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-shared-tier.sh', import.meta.url));

/** The two stacks the on-demand tier is allowed to destroy and rebuild, in DELETE order. */
const RECLAIMABLE = ['kitchensink-identity-service-sandbox', 'kitchensink-alb-sandbox'];

/**
 * Every shared name this script must refuse, with the reason refusing it matters.
 *
 * These are not hypothetical: each is a `*-sandbox` stack sitting beside the two in the allowlist, so a
 * prefix match, a glob, or a "delete the sandbox tier" generalisation reaches all of them.
 */
const MUST_REFUSE: ReadonlyArray<readonly [string, string]> = [
    ['kitchensink-data-sandbox', 'the RDS instance and every per-PR logical database (ADR-0006)'],
    ['kitchensink-network-sandbox', 'the VPC, the NAT instance and the shared security groups'],
    ['kitchensink-identity-webhooks-sandbox', "the webhook e2e-web's Clerk fixture blocks on"],
    ['kitchensink-domain-sandbox', 'the hosted zone records every preview resolves through'],
    ['kitchensink-global-sandbox', 'shared foundational resources'],
    ['kitchensink-messaging-sandbox', 'the message substrate'],
    ['kitchensink-sandbox-scheduler-sandbox', 'the scheduler that starts the RDS this tier needs'],
    ['kitchensink-identity-service-prod', 'prod'],
    ['kitchensink-alb-prod', 'prod'],
    ['kitchensink-data-prod', 'prod'],
    // Near-misses: an exact-equality check refuses these, a prefix match does not.
    ['kitchensink-alb-sandbox-old', 'a near-miss a prefix match would claim'],
    ['kitchensink-identity-service-sandbox2', 'a near-miss a prefix match would claim'],
    ['sandbox', 'a bare stage name'],
    ['', 'the empty string'],
];

const run = (...args: string[]): { status: number; stdout: string } => {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    return { status: result.status ?? -1, stdout: result.stdout ?? '' };
};

describe('sandbox-shared-tier.sh (ADR-0028 on-demand shared tier)', () => {
    it('exists — the reconciler shells out to it by path', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('deletes the importer before the exporter, so the ALB is never pinned by a live import', () => {
        const order = run('order')
            .stdout.split('\n')
            .filter((line) => line.trim() !== '');

        expect(order).toEqual(RECLAIMABLE);
    });

    it('authorises exactly the two reclaimable stacks', () => {
        for (const stack of RECLAIMABLE) {
            expect(run('may-delete', stack).status).toBe(0);
        }
    });

    it.each(MUST_REFUSE)('refuses %s — %s', (stack, _why) => {
        // 1 = refused, 2 = misuse (the empty string). Never 0, which would authorise a delete.
        expect(run('may-delete', stack).status).not.toBe(0);
    });

    it('refuses every stack it does not name, rather than defaulting to permitted', () => {
        const authorised = MUST_REFUSE.filter(([stack]) => run('may-delete', stack).status === 0);

        expect(authorised).toEqual([]);
    });

    it('rejects an unknown verb rather than doing something', () => {
        expect(run('destroy-everything').status).toBe(2);
        expect(run().status).toBe(2);
    });
});
