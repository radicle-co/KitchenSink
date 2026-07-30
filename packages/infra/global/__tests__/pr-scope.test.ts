/**
 * Repo-wide guard: the per-PR teardown scope predicates (`.github/scripts/pr-scope.sh`).
 *
 * ADR-0005 tears down a closed PR's resources with **no denylist**. The shared, PERSISTENT tier — the
 * global `kitchensink-network/data/domain/alb/global` stacks, the single shared sandbox identity service
 * + webhooks, prod's identity service, and the RDS cluster behind them — is named `kitchensink-*` and
 * tagged `Environment=global`. Nothing stops a teardown run from deleting those except the precision of
 * the match, so these predicates ARE the security boundary, and this suite is the regression test for
 * that boundary: every global name below must answer *false*, and `pr-1` must never match `pr-15`.
 *
 * It lives in `@kitchensink/infra-global` (with `service-dockerfile-deps.test.ts`, the other repo-wide
 * guard) because the invariant it protects is the global tier's own: this package owns the resources
 * that must survive every PR close.
 *
 * The predicates are executed as real `bash` rather than re-implemented here — a TypeScript copy would
 * be a second matcher that could drift from the one teardown actually runs, which is exactly the failure
 * mode ADR-0005 warns about.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/pr-scope.sh', import.meta.url));

/** Every persistent name a PR-close teardown must never claim (ADR-0005 / the shared identity tier). */
const GLOBAL_NAMES = [
    'kitchensink-identity-service-sandbox',
    'kitchensink-identity-service-prod',
    'kitchensink-identity-webhooks-sandbox',
    'kitchensink-identity-webhooks-prod',
    'kitchensink-data-sandbox',
    'kitchensink-data-prod',
    'kitchensink-network-sandbox',
    'kitchensink-network-prod',
    'kitchensink-alb-sandbox',
    'kitchensink-alb-prod',
    'kitchensink-domain-sandbox',
    'kitchensink-global-sandbox',
    'kitchensink-cost-guardrails',
    'sandbox',
    'prod',
];

/**
 * Run one predicate; the process exit status IS the answer.
 *
 * @param args - `<predicate> <token> [candidate]`.
 * @returns The exit status (0 = yes, 1 = no, 2 = misuse).
 * @sideEffect Spawns `bash`.
 */
const run = (...args: readonly string[]): number => {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    return result.status ?? -1;
};

const isToken = (token: string): boolean => run('is-token', token) === 0;
const belongs = (token: string, name: string): boolean => run('belongs', token, name) === 0;
const pathBelongs = (token: string, name: string): boolean => run('path-belongs', token, name) === 0;

describe('pr-scope.sh — the file exists where teardown sources it from', () => {
    it('is present at .github/scripts/pr-scope.sh', () => {
        expect(existsSync(SCRIPT), `expected the scope predicates at ${SCRIPT}`).toBe(true);
    });
});

describe('pr_scope_is_token — only an exact pr-{N} token may drive a teardown', () => {
    it.each(['pr-1', 'pr-15', 'pr-73', 'pr-100', 'pr-0'])('accepts %s', (token) => {
        expect(isToken(token)).toBe(true);
    });

    // A loose token is the root of every over-broad match downstream: `belongs`/`path_belongs` splice it
    // straight into a glob, so `pr-` would match everything and `pr-1*` would reach neighbouring PRs.
    it.each([
        '',
        'pr-',
        'pr',
        'pr-1x',
        'pr-1.5',
        'pr-1 pr-2',
        'PR-1',
        'Pr-1',
        ' pr-1',
        'pr-1 ',
        'pr-*',
        'pr-1*',
        '*',
        '../pr-1',
        'sandbox',
        'prod',
        'global',
        'kitchensink-identity-service-sandbox',
    ])('refuses %j', (token) => {
        expect(isToken(token)).toBe(false);
    });
});

describe('pr_scope_belongs — delimiter-aware ownership of a resource NAME', () => {
    it('matches the token exactly', () => {
        expect(belongs('pr-1', 'pr-1')).toBe(true);
    });

    it('matches a name the token PREFIXES with a `-` delimiter', () => {
        expect(belongs('pr-73', 'pr-73-cluster')).toBe(true);
        expect(belongs('pr-73', 'pr-73-recipes-worker')).toBe(true);
    });

    // The case the delimiter exists for. Without the trailing `-`, closing PR #1 would delete PR #15's
    // and PR #100's resources too.
    it('never lets pr-1 claim pr-15, pr-100 or pr-1x', () => {
        expect(belongs('pr-1', 'pr-15')).toBe(false);
        expect(belongs('pr-1', 'pr-100')).toBe(false);
        expect(belongs('pr-1', 'pr-1x')).toBe(false);
        expect(belongs('pr-1', 'pr-15-cluster')).toBe(false);
    });

    it('never matches a name that merely CONTAINS the token', () => {
        expect(belongs('pr-1', 'apr-1')).toBe(false);
        expect(belongs('pr-1', 'kitchensink-food-service-pr-1')).toBe(false);
    });

    // ⛔ The regression that matters: the shared identity service, its webhooks, and the network/data/
    // ALB/domain tier behind them are PERMANENT. Every per-PR preview points at that one identity
    // service, so a single false positive here would take down every preview at once — and the RDS
    // cluster with it.
    it.each(GLOBAL_NAMES)('refuses the persistent global resource %s', (name) => {
        expect(belongs('pr-1', name)).toBe(false);
        expect(belongs('pr-73', name)).toBe(false);
    });

    it('refuses to answer at all for a malformed token (exit 2, not a match)', () => {
        expect(run('belongs', 'pr-', 'pr-73')).toBe(2);
        expect(run('belongs', '', 'kitchensink-identity-service-sandbox')).toBe(2);
    });
});

describe('pr_scope_path_belongs — the same rule for a `/`-delimited log-group path', () => {
    it('matches the token as a whole path SEGMENT', () => {
        expect(pathBelongs('pr-73', '/aws/lambda/pr-73')).toBe(true);
        expect(pathBelongs('pr-73', '/aws/ecs/containerinsights/pr-73-cluster/performance')).toBe(true);
        expect(pathBelongs('pr-73', 'pr-73-recipes')).toBe(true);
    });

    it('never lets pr-1 claim a pr-15 path segment', () => {
        expect(pathBelongs('pr-1', '/aws/ecs/containerinsights/pr-15-cluster/performance')).toBe(false);
        expect(pathBelongs('pr-1', '/aws/lambda/pr-15')).toBe(false);
    });

    it('never matches a segment that merely CONTAINS the token', () => {
        expect(pathBelongs('pr-1', '/aws/lambda/xpr-1')).toBe(false);
        expect(pathBelongs('pr-1', '/aws/lambda/service-pr-1')).toBe(false);
    });

    it.each(GLOBAL_NAMES)('refuses the persistent global log path for %s', (name) => {
        expect(pathBelongs('pr-1', `/aws/lambda/${name}`)).toBe(false);
        expect(pathBelongs('pr-73', `/aws/ecs/containerinsights/${name}-cluster/performance`)).toBe(false);
    });
});
