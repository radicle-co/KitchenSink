/**
 * DRIFT LAYER 3 (Skew) — the boot assertion (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * The property under test is precisely the one an assertion can get wrong in the direction that matters: it
 * must FAIL on a mismatch. An assertion that only ever passes is indistinguishable from no assertion, so most
 * of this file is the failing cases, and `assertContractHashesAgree` is exercised directly rather than through
 * a booted app — the value is in the predicate, and a boot test would prove the wiring while hiding the logic.
 *
 * The last describe block is the one with the real teeth: it reads the TWO COMMITTED STAMPS and requires them
 * to agree. That is what moves the failure from "the container crash-loops in ECS" to "`npm test` is red",
 * which is the only acceptable place for a fail-closed boot check to surface.
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_HASH as SCHEMA_PACKAGE_CONTRACT_HASH } from '@kitchensink/schema-recipe';

import { CONTRACT_HASH as SERVICE_CONTRACT_HASH } from '../contractHash.js';
import { assertContractHashesAgree, ContractSkewError, isContractSkewError } from '../contractSkew.js';

const A_HASH = 'a'.repeat(64);
const B_HASH = 'b'.repeat(64);

describe('assertContractHashesAgree', () => {
    it('passes when the two stamps agree', () => {
        expect(() => assertContractHashesAgree(A_HASH, A_HASH)).not.toThrow();
    });

    it('THROWS when they differ — the whole point of the layer', () => {
        expect(() => assertContractHashesAgree(A_HASH, B_HASH)).toThrow(ContractSkewError);
    });

    it('names both hashes in the message, so the failure is diagnosable from a log line alone', () => {
        try {
            assertContractHashesAgree(A_HASH, B_HASH);
            expect.unreachable('expected a ContractSkewError');
        } catch (error: unknown) {
            expect(isContractSkewError(error)).toBe(true);
            expect((error as ContractSkewError).serviceHash).toBe(A_HASH);
            expect((error as ContractSkewError).schemaPackageHash).toBe(B_HASH);
            expect((error as Error).message).toContain(A_HASH);
            expect((error as Error).message).toContain(B_HASH);
            expect((error as Error).message).toContain('contract:generate');
        }
    });

    it('rejects an EMPTY stamp rather than treating two blanks as agreement', () => {
        expect(() => assertContractHashesAgree('', '')).toThrow(ContractSkewError);
        expect(() => assertContractHashesAgree(A_HASH, '')).toThrow(ContractSkewError);
        expect(() => assertContractHashesAgree('', A_HASH)).toThrow(ContractSkewError);
    });

    it('rejects a stamp that is not a 64-hex SHA-256, because a truncated stamp compares equal to itself', () => {
        expect(() => assertContractHashesAgree('abc', 'abc')).toThrow(ContractSkewError);
        expect(() => assertContractHashesAgree(A_HASH.toUpperCase(), A_HASH.toUpperCase())).toThrow(ContractSkewError);
    });

    // NO case-sensitivity case here, deliberately. It would look like a real assertion and prove nothing: the
    // format guard rejects a non-lower-case stamp before the comparison is reached, so a mutant that
    // lower-cases both sides passes it. Measured — that mutant survives. The property is real but it is the
    // format guard that delivers it, and that guard IS mutation-covered (dropping it reds two cases above).

    it('exposes a working instanceof and a guard that rejects a structural look-alike', () => {
        const error = new ContractSkewError(A_HASH, B_HASH);

        // `Object.setPrototypeOf` in the constructor is the repo's custom-error convention, and it is insurance
        // for a DOWN-LEVEL transpile target where `class extends Error` loses the chain. This suite cannot
        // exercise that — vitest's esbuild target keeps the chain natively, and a mutant deleting the call
        // passes here. It stays because the convention is what protects a future target change, not because
        // this assertion proves it.
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(ContractSkewError);
        expect(error.name).toBe('ContractSkewError');
        expect(isContractSkewError(new Error('not this'))).toBe(false);
        expect(isContractSkewError({ serviceHash: A_HASH, schemaPackageHash: B_HASH })).toBe(false);
    });
});

describe('the two committed stamps', () => {
    it('AGREE, so the fail-closed boot check reds `npm test` rather than an ECS task', () => {
        expect(SERVICE_CONTRACT_HASH).toBe(SCHEMA_PACKAGE_CONTRACT_HASH);
    });

    it('are both a lower-case 64-hex SHA-256, so the format guard above is not vacuous', () => {
        expect(SERVICE_CONTRACT_HASH).toMatch(/^[0-9a-f]{64}$/u);
        expect(SCHEMA_PACKAGE_CONTRACT_HASH).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('are what the boot assertion is actually given, and it passes on them', () => {
        expect(() => assertContractHashesAgree(SERVICE_CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH)).not.toThrow();
    });
});
