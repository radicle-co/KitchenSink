/**
 * Unit tests for `ResolutionMappingsService` — the correction write path's orchestration (plan U10 / R19, R20).
 *
 * The service owns three things and no rules: the TRANSACTION that makes read-decide-write one unit, the
 * PARSE of the caller's raw phrase into the persisted key, and the AUDIT emission. The scope rules live in
 * the pure policy (truth-tested there) and the statements live in the DAL (integration-tested there), so what
 * is asserted here is the orchestration a mock CAN prove:
 *
 *  1. **The grant is read as `scopes` ∪ `permissions`.** identity's `ScopesGuard` rule is that a scope is
 *     satisfied by EITHER list; a mutant reading only `scopes` would silently demote every curator whose
 *     grant Clerk happened to put in `permissions`, and the correction would still succeed — just at the
 *     wrong reach, which is the failure nobody notices.
 *  2. **The audit fires exactly when a promotion actually happened**, never on a write that did not promote
 *     and never on a write that lost the race. An audit line for a promotion that did not occur is worse than
 *     none: it is what a reviewer would rely on.
 *  3. **A phrase with no visible content is refused before anything is written**, rather than keying a row on
 *     the empty string that every other contentless phrase then collides with.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Principal } from '../../../auth/principal.js';
import { CURATOR_MAPPING_SCOPE } from '../../domain/mappingScopePolicy.js';
import type { MappingPromotionAudit } from '../mappingPromotionAudit.js';
import type { ResolutionMappingsDal } from '../resolutionMappings.dal.js';
import { ResolutionMappingsService } from '../resolutionMappings.service.js';

const FOOD_A = '01JU10SVC00000000000000FOODA';
const AUTHOR = '01JU10SVC0000000000000AUTHA';
const CORROBORATOR = '01JU10SVC0000000000000AUTHB';

/** A principal with the given grants, split across the two lists the caller chooses. */
function principal(scopes: string[] = [], permissions: string[] = []): Principal {
    return { userId: AUTHOR, sub: 'user_clerk', scopes, permissions };
}

/** No history at all — the virgin-phrase facts. */
const NO_HISTORY = { liveGlobal: undefined, liveOwn: undefined, corroboratorsForSameFood: [] };

/** Build the service over stubs, returning the stubs so a spec can assert against them. */
function build(
    overrides: {
        facts?: Awaited<ReturnType<ResolutionMappingsDal['findWriteFacts']>>;
        result?: Awaited<ReturnType<ResolutionMappingsDal['applyWrite']>>;
    } = {},
) {
    const findWriteFacts = vi.fn().mockResolvedValue(overrides.facts ?? NO_HISTORY);
    const applyWrite = vi
        .fn()
        .mockResolvedValue(overrides.result ?? { written: true, mappingId: 'row-new', promotion: undefined });
    const recordPromotion = vi.fn();
    // The transaction seam: the service asks the DAL for a unit of work and gets one that simply runs `fn`.
    const runInTransaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({}));
    const dal = { findWriteFacts, applyWrite, runInTransaction } as unknown as ResolutionMappingsDal;
    const audit = { recordPromotion } as unknown as MappingPromotionAudit;

    return { service: new ResolutionMappingsService(dal, audit), findWriteFacts, applyWrite, recordPromotion };
}

describe('ResolutionMappingsService — the grant is scopes ∪ permissions', () => {
    it.each([
        ['scopes', [CURATOR_MAPPING_SCOPE], []],
        ['permissions', [], [CURATOR_MAPPING_SCOPE]],
    ])('binds globally when the curator grant arrives via %s', async (_label, scopes, permissions) => {
        const { service, applyWrite } = build();

        await service.recordCorrection({
            principal: principal(scopes, permissions),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(applyWrite.mock.calls[0]![0].decision.write).toBe('global');
    });

    it('binds to the author alone when neither list carries the grant', async () => {
        const { service, applyWrite } = build();

        await service.recordCorrection({
            principal: principal(['admin:users'], ['premium']),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(applyWrite.mock.calls[0]![0].decision.write).toBe('author');
    });
});

describe('ResolutionMappingsService — the phrase is PARSED at the boundary', () => {
    it('keys the correction on the normalized phrase, and persists the raw one beside it', async () => {
        const { service, findWriteFacts, applyWrite } = build();

        await service.recordCorrection({
            principal: principal(),
            phrase: '  Plain   FLOUR ',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(findWriteFacts).toHaveBeenCalledWith('plain flour', AUTHOR, FOOD_A, expect.anything());
        // The raw phrase is what makes a future key-derivation change a backfill rather than data loss, so it
        // must be the CALLER's text and not the key echoed back.
        expect(applyWrite.mock.calls[0]![0]).toMatchObject({
            normalizedKey: 'plain flour',
            sourcePhrase: '  Plain   FLOUR ',
        });
    });

    it('REFUSES a phrase with no visible content, writing nothing at all', async () => {
        const { service, findWriteFacts, applyWrite } = build();

        const result = await service.recordCorrection({
            principal: principal(),
            phrase: '   ​ ',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(result.written).toBe(false);
        // Not "wrote a row keyed on the empty string" — nothing was read and nothing was written.
        expect(findWriteFacts).not.toHaveBeenCalled();
        expect(applyWrite).not.toHaveBeenCalled();
    });
});

describe('ResolutionMappingsService — the audit fires exactly on a real promotion (R20)', () => {
    it('emits the signal, naming the binding and BOTH corroborating authors', async () => {
        const { service, recordPromotion } = build({
            facts: { ...NO_HISTORY, corroboratorsForSameFood: [{ id: 'row-them', authorId: CORROBORATOR }] },
            result: {
                written: true,
                mappingId: 'row-new',
                promotion: { mappingId: 'row-binding', citesExisting: 'row-them', citesNew: 'row-new' },
            },
        });

        await service.recordCorrection({
            principal: principal(),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(recordPromotion).toHaveBeenCalledTimes(1);
        expect(recordPromotion).toHaveBeenCalledWith({
            mappingId: 'row-binding',
            corroboratingAuthorIds: [CORROBORATOR, AUTHOR],
            normalizedKey: 'plain flour',
        });
    });

    it('does NOT emit for a write that promoted nothing', async () => {
        const { service, recordPromotion } = build();

        await service.recordCorrection({
            principal: principal(),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(recordPromotion).not.toHaveBeenCalled();
    });

    it('does NOT emit when the write LOST the concurrent promotion race', async () => {
        // The loser's `applyWrite` returns no promotion because the `ON CONFLICT DO NOTHING` insert matched
        // nothing. Emitting here would double-count one promotion and point a reviewer at a binding this
        // request did not create.
        const { service, recordPromotion } = build({
            facts: { ...NO_HISTORY, corroboratorsForSameFood: [{ id: 'row-them', authorId: CORROBORATOR }] },
            result: { written: true, mappingId: 'row-new', promotion: undefined },
        });

        await service.recordCorrection({
            principal: principal(),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(recordPromotion).not.toHaveBeenCalled();
    });

    it('does NOT emit when nothing was written at all', async () => {
        const { service, recordPromotion } = build({
            result: { written: false, reason: 'The caller already holds this exact mapping.' },
        });

        await service.recordCorrection({
            principal: principal(),
            phrase: 'Plain Flour',
            foodId: FOOD_A,
            surfacing: 'picker_correction',
        });

        expect(recordPromotion).not.toHaveBeenCalled();
    });
});
