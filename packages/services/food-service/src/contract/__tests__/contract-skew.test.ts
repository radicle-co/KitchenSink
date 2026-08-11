/**
 * DRIFT LAYER 3 (Skew) — tests for the boot assertion, plus the assertion CI actually needs: that the two
 * COMMITTED stamps agree right now (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * The committed-stamp case is the important one. It is what makes the fail-closed boot check land on `npm test`
 * instead of on a container that will not start, so the tree can never reach a state where the deployed artifact
 * is the first thing to notice.
 *
 * MUTATION LENS. Each case names the mutation it kills. Two mutants are recorded below as things this suite does
 * NOT prove, rather than being papered over.
 */
import { describe, expect, it } from 'vitest';

import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-food';

import { CONTRACT_HASH } from '../contract-hash.js';
import { assertContractHashesAgree, ContractSkewError, isContractSkewError } from '../contract-skew.js';

const VALID = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('the committed contract stamps', () => {
    // THE gate. If this reds, the tree is in a state where the published contract does not describe the service,
    // and the fix is `npm run contract:generate` plus committing BOTH files.
    it('agree, so a built image cannot fail the boot assertion', () => {
        expect(CONTRACT_HASH).toBe(SCHEMA_PACKAGE_CONTRACT_HASH);
    });

    it('are both well-formed lower-case hex SHA-256 values', () => {
        expect(CONTRACT_HASH).toMatch(/^[0-9a-f]{64}$/u);
        expect(SCHEMA_PACKAGE_CONTRACT_HASH).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('pass the real assertion', () => {
        expect(() => assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH)).not.toThrow();
    });
});

describe('assertContractHashesAgree', () => {
    it('accepts two identical well-formed stamps', () => {
        expect(() => assertContractHashesAgree(VALID, VALID)).not.toThrow();
    });

    // Kills the mutation that never throws.
    it('throws when the two stamps differ', () => {
        expect(() => assertContractHashesAgree(VALID, OTHER)).toThrow(ContractSkewError);
    });

    // Kills the mutation that drops the FORMAT guard. A bare equality test passes on two empty strings — exactly
    // when its result is meaningless, because it means the stamp mechanism itself broke.
    it('throws when both stamps are empty, which is when equality means nothing', () => {
        expect(() => assertContractHashesAgree('', '')).toThrow(ContractSkewError);
    });

    it('throws when both stamps are identically TRUNCATED', () => {
        expect(() => assertContractHashesAgree(VALID.slice(0, 12), VALID.slice(0, 12))).toThrow(ContractSkewError);
    });

    it('throws when a stamp is the string "undefined" on both sides', () => {
        expect(() => assertContractHashesAgree('undefined', 'undefined')).toThrow(ContractSkewError);
    });

    it('throws when only ONE side is malformed', () => {
        expect(() => assertContractHashesAgree(VALID, 'nope')).toThrow(ContractSkewError);
        expect(() => assertContractHashesAgree('nope', VALID)).toThrow(ContractSkewError);
    });

    it('names both values in the error, so a log records what disagreed', () => {
        try {
            assertContractHashesAgree(VALID, OTHER);
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isContractSkewError(error)).toBe(true);
            expect((error as ContractSkewError).serviceHash).toBe(VALID);
            expect((error as ContractSkewError).schemaPackageHash).toBe(OTHER);
            expect((error as Error).message).toContain('CONTRACT SKEW');
            expect((error as Error).message).toContain('contract:generate');
        }
    });

    it('renders an empty stamp visibly rather than as blank space', () => {
        try {
            assertContractHashesAgree('', VALID);
            expect.unreachable('should have thrown');
        } catch (error) {
            expect((error as Error).message).toContain('<empty>');
        }
    });

    it('is guarded by a type guard that rejects other errors', () => {
        expect(isContractSkewError(new Error('other'))).toBe(false);
        expect(isContractSkewError(undefined)).toBe(false);
        expect(isContractSkewError('CONTRACT SKEW')).toBe(false);
    });

    // ── RECORDED AS *NOT* PROVEN, rather than claimed ──
    //
    // Two plausible mutations SURVIVE this suite, and the honest thing is to name them instead of inflating the
    // score. (1) A case-INSENSITIVE comparison: the format guard already requires lower-case hex on both sides,
    // so an upper-case stamp is rejected before equality is reached — the guard, not the comparison, is what
    // makes case irrelevant. (2) Deleting `Object.setPrototypeOf`: vitest's transpile target keeps the prototype
    // chain intact, so `instanceof` still works here. It is retained because the SERVICE is compiled to ES2022
    // by a different toolchain, where it is load-bearing — this suite simply cannot observe that.
});
