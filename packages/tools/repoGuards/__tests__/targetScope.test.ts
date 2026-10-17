// @vitest-environment node
/**
 * Repo-wide guard: the deployed-test target predicate (`.github/scripts/targetScope.sh`).
 *
 * ⛔ WHY THIS IS A SECURITY BOUNDARY AND NOT HYGIENE. Every `E2E (…)` job resolves its origins at run time
 * and then sends this repository's bearer tokens, Clerk fixtures and real writes to them. The predicate is
 * the only thing between that traffic and an address a resolver bug, an unset repository variable or a
 * crafted dispatch input put there.
 *
 * ⛔ WHY IT MOVED. It was written TEN times inline across `deployedE2eTiers.yml`, `_ci.yml` and
 * `_ci-heavy.yml` — ten places to fix one rule and, more to the point, no place to TEST it. This
 * repository's own standard for the sibling case is stated in CLAUDE.md: *"The NAME match lives ONCE, in
 * `.github/scripts/prScope.sh` … do not add a second matcher."*
 *
 * The predicate is executed as real `bash` rather than re-implemented here, for the reason `prScope.test.ts`
 * gives: a TypeScript copy would be a second matcher that could drift from the one CI actually runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/targetScope.sh', import.meta.url));
const DOMAIN = 'commise.app';

/** Run the real script; the exit status IS the answer. */
function run(...args: string[]): { readonly code: number; readonly out: string } {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

const admits = (origin: string): boolean => run('under-domain', DOMAIN, origin).code === 0;

describe('the deployed-target predicate', () => {
    it('exists where every workflow expects it', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('admits this repository’s own hosts', () => {
        expect(admits(`https://${DOMAIN}`)).toBe(true);
        expect(admits(`https://identity.sandbox.${DOMAIN}`)).toBe(true);
        expect(admits(`https://recipe-pr-91.${DOMAIN}`)).toBe(true);
    });

    /**
     * ⛔ THE CASE NO INLINE COPY EVER TESTED, and the one that makes a domain check worse than none: a bare
     * suffix match admits `evil-commise.app` for `commise.app`. It reads as a guard and passes an attacker's
     * host, so the suite's tokens go to them with a green check.
     */
    it('⛔ refuses a suffix-confusion host', () => {
        expect(admits(`https://evil-${DOMAIN}`)).toBe(false);
        expect(admits(`https://${DOMAIN}.attacker.test`)).toBe(false);
        expect(admits(`https://not${DOMAIN}`)).toBe(false);
    });

    /**
     * ⛔ THE SCHEME IS PART OF THE MATCH. `http://` would send this suite's bearer tokens in clear, and a
     * predicate that only looked at the host would admit it — as would one admitting any scheme at all.
     */
    it('⛔ refuses a plaintext or foreign scheme', () => {
        expect(admits(`http://identity.sandbox.${DOMAIN}`)).toBe(false);
        expect(admits(`ftp://identity.sandbox.${DOMAIN}`)).toBe(false);
        expect(admits(`//identity.sandbox.${DOMAIN}`)).toBe(false);
    });

    it('refuses an unrelated host and an empty origin', () => {
        expect(admits('https://example.test')).toBe(false);
        expect(admits('')).toBe(false);
    });
});

describe('the assertion the jobs actually call', () => {
    it('passes every origin under the domain, and names each', () => {
        const result = run('assert', DOMAIN, `https://${DOMAIN}`, `https://food-pr-91.${DOMAIN}`);

        expect(result.code).toBe(0);
        expect(result.out).toContain(`target https://food-pr-91.${DOMAIN}`);
    });

    it('⛔ fails, and names the offender, when one origin of several is foreign', () => {
        const result = run('assert', DOMAIN, `https://${DOMAIN}`, 'https://example.test');

        expect(result.code).not.toBe(0);
        expect(result.out).toContain("::error::resolved target 'https://example.test' is not under commise.app");
    });

    /**
     * ⛔ AN EMPTY DOMAIN IS A FAILURE, NOT A PASS. With `DOMAIN_NAME` unset every origin would be compared
     * against a bare label — and this is precisely the branch an inline copy never exercises, because the
     * happy path always has the variable.
     */
    it('⛔ refuses outright when DOMAIN_NAME is empty, rather than admitting everything', () => {
        const result = run('assert', '', `https://${DOMAIN}`);

        expect(result.code).not.toBe(0);
        expect(result.out).toContain('DOMAIN_NAME repository variable is empty');
    });

    /** ⛔ A guard handed nothing to check is not a guard; it must not report success. */
    it('⛔ refuses when it is passed no origins at all', () => {
        const result = run('assert', DOMAIN);

        expect(result.code).not.toBe(0);
        expect(result.out).toContain('no origins were passed');
    });

    it('refuses a misuse rather than guessing', () => {
        expect(run('nonsense', DOMAIN).code).toBe(2);
    });
});
