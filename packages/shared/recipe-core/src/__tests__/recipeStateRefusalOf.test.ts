/**
 * `refusalOf` answers why a recipe cannot be made public, in the state model's REFUSAL_* names (4.5). The first
 * refusal that holds wins, and the order is the contract.
 */
import { describe, expect, it } from 'vitest';

import { RecipeSourceType } from '../recipe.types.js';
import { REFUSAL, refusalOf, type RefusalFacts } from '../recipeState/refusalOf.js';

const facts = (overrides: Partial<RefusalFacts> = {}): RefusalFacts => ({
    sourceType: RecipeSourceType.USER_CREATED,
    sourceKind: null,
    statementKind: null,
    held: false,
    ...overrides,
});

describe('refusalOf', () => {
    it('refuses nothing for an ordinary recipe', () => {
        expect(refusalOf(facts())).toBe(REFUSAL.REFUSAL_NONE);
    });

    it.each([
        [{ sourceType: RecipeSourceType.IMPORTED_PHYSICAL }, 'REFUSAL_POLICY_BOOK'],
        [{ sourceType: RecipeSourceType.IMPORTED_PAID }, 'REFUSAL_POLICY_PAID_SITE'],
        [{ sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceKind: 'public_web' }, 'REFUSAL_POLICY_WEB_PAGE'],
        [{ sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceKind: null }, 'REFUSAL_NONE'],
        [{ statementKind: 'fromPerson' }, 'REFUSAL_FROM_PERSON'],
        [{ statementKind: 'unrecognised' }, 'REFUSAL_UNRECOGNISED'],
        [{ sourceKind: 'unrecognised' }, 'REFUSAL_UNRECOGNISED'],
        [{ held: true }, 'REFUSAL_SOURCE_CONFLICT'],
        [{ sourceCorrected: true }, 'REFUSAL_SOURCE_CORRECTED'],
        [{ statementRequired: true }, 'REFUSAL_STATEMENT_REQUIRED'],
    ] as const)('answers %j with %s', (overrides, expected) => {
        expect(refusalOf(facts(overrides))).toBe(expected);
    });

    it('lets "from another person" win over a held recipe, as the recipe page does today', () => {
        expect(refusalOf(facts({ statementKind: 'fromPerson', held: true }))).toBe('REFUSAL_FROM_PERSON');
    });

    it('lets a private-only rule win over a source conflict', () => {
        expect(refusalOf(facts({ sourceType: RecipeSourceType.IMPORTED_PAID, held: true }))).toBe(
            'REFUSAL_POLICY_PAID_SITE',
        );
    });

    it('orders the held facts: conflict, then correction, then statement', () => {
        expect(refusalOf(facts({ held: true, sourceCorrected: true, statementRequired: true }))).toBe(
            'REFUSAL_SOURCE_CONFLICT',
        );
        expect(refusalOf(facts({ sourceCorrected: true, statementRequired: true }))).toBe('REFUSAL_SOURCE_CORRECTED');
    });
});

describe('refusalOf: an attested "from another person"', () => {
    it('refuses a recipe whose statement was cleared after the cook said it was from a person', () => {
        expect(refusalOf(facts({ attestedFromPerson: true }))).toBe('REFUSAL_FROM_PERSON');
        expect(refusalOf(facts({ attestedFromPerson: true, statementKind: 'authored' }))).toBe('REFUSAL_NONE');
    });
});

describe('the save refusal (ADR-0105)', () => {
    it('retires REFUSAL_DETECTED_NO_PRIVATE_SLOT and adds REFUSAL_SAVE_CANNOT_STAY_PUBLIC', () => {
        expect(Object.keys(REFUSAL)).not.toContain('REFUSAL_DETECTED_NO_PRIVATE_SLOT');
        expect(REFUSAL.REFUSAL_SAVE_CANNOT_STAY_PUBLIC).toBe('REFUSAL_SAVE_CANNOT_STAY_PUBLIC');
    });

    it('never answers a MAKE_PUBLIC question with the save reason, over the full fact cross product', () => {
        const types = Object.values(RecipeSourceType);
        const kinds = [null, 'public_web', 'book', 'paid_site', 'unrecognised'] as const;
        const statements = [null, 'authored', 'fromPerson', 'unrecognised'] as const;
        const flags = [false, true] as const;
        let checked = 0;

        for (const sourceType of types) {
            for (const sourceKind of kinds) {
                for (const statementKind of statements) {
                    for (const held of flags) {
                        for (const sourceCorrected of flags) {
                            for (const statementRequired of flags) {
                                for (const attestedFromPerson of flags) {
                                    const answer = refusalOf({
                                        sourceType,
                                        sourceKind,
                                        statementKind,
                                        held,
                                        sourceCorrected,
                                        statementRequired,
                                        attestedFromPerson,
                                    });

                                    expect(answer).not.toBe('REFUSAL_SAVE_CANNOT_STAY_PUBLIC');
                                    checked += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        expect(checked).toBeGreaterThan(500);
    });
});
