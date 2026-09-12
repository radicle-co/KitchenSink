/**
 * THE ACCOUNT WIRE CONTRACT, ASSERTED AGAINST THE IMPLEMENTATION THAT SERVES IT.
 *
 * This is the highest-risk vertical in the service: erasure is IRREVERSIBLE, and the export is the widest
 * personal-data egress surface it has. So the contract for it is not asserted by inspection — the suite
 * drives the real {@link AccountExportService} and {@link ErasureService} over stubbed DALs and parses their
 * ACTUAL return values with the published schema.
 *
 * ── THE INTENT GATE IS THE POINT, AND IT NOW HAS ONE REPRESENTATION ──
 *
 * `ACCOUNT_ERASURE_CONFIRMATION_PHRASE` and the match rule used to exist TWICE: in the service's DTO and,
 * independently, in `@commise/features-account` — two copies of the gate on an irreversible action, held
 * together by nothing but a test asserting the literal `'ERASE MY DATA'` in each. Drift between them would
 * `400` every erasure attempt in the product while both suites stayed green. Both now come from
 * `account.schema.ts`, so `matchesAccountErasureConfirmation` is the single rule the server enforces and the
 * UI gates its confirm button on.
 *
 * ── WHAT THIS SUITE DELIBERATELY DOES *NOT* ASSERT ──
 *
 * That the request schema rejects a WRONG phrase. It must not: the schema validates the phrase's SHAPE and
 * {@link ErasureService} validates its VALUE, and that split is deliberate (see `account.schema.ts`). The
 * `accepts a well-formed but WRONG phrase` case below exists to RED the build if someone "tightens" the
 * schema to `z.literal(ACCOUNT_ERASURE_CONFIRMATION_PHRASE)` — which would move the gate before the service,
 * change the `400` body, and publish the phrase as an enum in `openapi.yaml`.
 */
import { describe, expect, it, vi } from 'vitest';

import { AccountExportService, type AccountExportConfig } from '../export.service.js';
import { ErasureService } from '../erasure.service.js';
import { AccountExportDal } from '../dal/export.dal.js';
import { ErasureJobsDal } from '../dal/erasureJobs.dal.js';
import { ServicePrincipalErasureMetrics } from '../erasureMetrics.js';
import type { ErasureQueuePort } from '../erasure.queue.js';
import type { ServicePrincipal } from '../../auth/servicePrincipal.js';
import {
    ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
    accountExportSchema,
    erasureRequestSchema,
    erasureRequestAcceptedResponseSchema,
    matchesAccountErasureConfirmation,
    serviceErasureAcceptedResponseSchema,
} from '../account.schema.js';
import {
    FIXTURE_OWNER,
    makeAuthorHandleRow,
    makeCollectionRow,
    makeMembershipRow,
    makePhotoRow,
    makeRatingRow,
    makeRecipeRow,
    makeVersionRow,
} from '../__fixtures__/export.fixtures.js';

const CONFIG: AccountExportConfig = { cloudfrontUrl: 'https://cdn.example.com' };
const JOB_ID = '00000000-0000-4000-8000-0000000000e1';

/** Every row set the export DAL can return, fully populated. */
function makeFullDal(): { [K in keyof AccountExportDal]: ReturnType<typeof vi.fn> } {
    return {
        listRecipes: vi.fn().mockResolvedValue([makeRecipeRow()]),
        listCollections: vi.fn().mockResolvedValue([makeCollectionRow()]),
        listCollectionMemberships: vi.fn().mockResolvedValue([makeMembershipRow()]),
        listRatings: vi.fn().mockResolvedValue([makeRatingRow()]),
        listPhotos: vi.fn().mockResolvedValue([makePhotoRow()]),
        listVersions: vi.fn().mockResolvedValue([makeVersionRow()]),
        listAuthorHandles: vi.fn().mockResolvedValue([makeAuthorHandleRow()]),
    } as unknown as { [K in keyof AccountExportDal]: ReturnType<typeof vi.fn> };
}

/** Every row set empty — the "nothing held" export, which is a legitimate and fully-representable state. */
function makeEmptyDal(): { [K in keyof AccountExportDal]: ReturnType<typeof vi.fn> } {
    return {
        listRecipes: vi.fn().mockResolvedValue([]),
        listCollections: vi.fn().mockResolvedValue([]),
        listCollectionMemberships: vi.fn().mockResolvedValue([]),
        listRatings: vi.fn().mockResolvedValue([]),
        listPhotos: vi.fn().mockResolvedValue([]),
        listVersions: vi.fn().mockResolvedValue([]),
        listAuthorHandles: vi.fn().mockResolvedValue([]),
    } as unknown as { [K in keyof AccountExportDal]: ReturnType<typeof vi.fn> };
}

describe('the published account-export document is TRUE of what AccountExportService emits', () => {
    it('parses a fully-populated export — every nullable column set, every collection embedded', async () => {
        const dal = makeFullDal();
        const service = new AccountExportService(dal as unknown as AccountExportDal, CONFIG);

        const result = await service.exportForOwner(FIXTURE_OWNER);

        expect(accountExportSchema.parse(result)).toEqual(result);
        // Named so the assertion above cannot pass vacuously against an empty document.
        expect(result.recipes).toHaveLength(1);
        expect(result.collections[0]?.recipes).toHaveLength(1);
    });

    it('parses an export whose every nullable column IS null — the shape a brand-new account produces', async () => {
        const dal = makeFullDal();
        dal.listRecipes.mockResolvedValue([
            makeRecipeRow({
                description: null,
                difficulty: null,
                averageRating: null,
                cuisine: null,
                authorHandle: null,
                sourceUrl: null,
                sourceAttribution: null,
                clonedFromId: null,
                deletedAt: null,
            }),
        ]);
        dal.listPhotos.mockResolvedValue([makePhotoRow({ thumbnailKey: null, sizeBytes: null })]);
        dal.listVersions.mockResolvedValue([
            makeVersionRow({
                baseVersion: null,
                s3Key: null,
                changeSummary: null,
                editorHandle: null,
            }),
        ]);
        const service = new AccountExportService(dal as unknown as AccountExportDal, CONFIG);

        const result = await service.exportForOwner(FIXTURE_OWNER);

        const parsed = accountExportSchema.parse(result);
        expect(parsed).toEqual(result);
        // The portability decision, pinned: an absent value is an EXPLICIT null, never an omitted key.
        expect(parsed.recipes[0]).toHaveProperty('description', null);
        expect(parsed.photos[0]).toHaveProperty('thumbnailUrl', null);
        expect(parsed.versions[0]).toHaveProperty('editorHandle', null);
    });

    it('parses a TOMBSTONED recipe — an export is a faithful mirror, so a soft-deleted row is included', async () => {
        const dal = makeFullDal();
        dal.listRecipes.mockResolvedValue([makeRecipeRow({ deletedAt: new Date('2026-03-01T00:00:00.000Z') })]);
        const service = new AccountExportService(dal as unknown as AccountExportDal, CONFIG);

        const result = await service.exportForOwner(FIXTURE_OWNER);

        expect(accountExportSchema.parse(result)).toEqual(result);
        expect(result.recipes[0]?.deletedAt).toBe('2026-03-01T00:00:00.000Z');
    });

    it('parses an EMPTY export (nothing held) — every root is [] and none is absent', async () => {
        const service = new AccountExportService(makeEmptyDal() as unknown as AccountExportDal, CONFIG);

        const result = await service.exportForOwner(FIXTURE_OWNER);

        expect(accountExportSchema.parse(result)).toEqual(result);
    });

    it('echoes the VERIFIED owner into the document, so the export self-documents whose data it is', async () => {
        const service = new AccountExportService(makeEmptyDal() as unknown as AccountExportDal, CONFIG);

        const result = await service.exportForOwner(FIXTURE_OWNER);

        expect(accountExportSchema.parse(result).ownerId).toBe(FIXTURE_OWNER);
    });
});

describe('the published erasure-acceptance bodies are TRUE of what ErasureService emits', () => {
    /**
     * An erasure service over stubs. `dal` overrides let each case pre-decide the C-007 arbitration:
     * `insertQueuedJob` winning (a fresh job), losing to an in-flight one (`findActiveJob`), or
     * `hasCompletedJob` reporting a prior terminal erasure.
     */
    function makeErasureService(dal: Record<string, unknown>): ErasureService {
        return new ErasureService(
            {
                hasCompletedJob: vi.fn().mockResolvedValue(false),
                insertQueuedJob: vi.fn().mockResolvedValue(JOB_ID),
                findActiveJob: vi.fn().mockResolvedValue(undefined),
                ...dal,
            } as unknown as ErasureJobsDal,
            { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as ErasureQueuePort,
            { recordServicePrincipalErasure: vi.fn() } as unknown as ServicePrincipalErasureMetrics,
        );
    }

    it('requestErasure — a newly-queued job parses as { jobId, status } and nothing else', async () => {
        const service = makeErasureService({});

        const result = await service.requestErasure(FIXTURE_OWNER, {
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
        });

        expect(erasureRequestAcceptedResponseSchema.parse(result)).toEqual(result);
        expect(Object.keys(result).sort()).toEqual(['jobId', 'status']);
        expect(result.status).toBe('queued');
    });

    it('requestErasure — an idempotently-returned RUNNING job parses', async () => {
        const service = makeErasureService({
            insertQueuedJob: vi.fn().mockResolvedValue(undefined),
            findActiveJob: vi.fn().mockResolvedValue({ id: JOB_ID, status: 'running' }),
        });

        const result = await service.requestErasure(FIXTURE_OWNER, {
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
        });

        expect(erasureRequestAcceptedResponseSchema.parse(result)).toEqual(result);
        expect(result.status).toBe('running');
    });

    it('requestServiceErasure — a queued job parses WITH triggerSource', async () => {
        const service = makeErasureService({});
        const principal: ServicePrincipal = { ownerId: FIXTURE_OWNER, eventId: 'evt_1', actor: 'identity-worker' };

        const result = await service.requestServiceErasure(principal);

        expect(serviceErasureAcceptedResponseSchema.parse(result)).toEqual(result);
        expect(result.triggerSource).toBe('service');
    });

    it('requestServiceErasure — the already-erased NO-OP parses with NO jobId, which is why jobId is optional', async () => {
        const service = makeErasureService({ hasCompletedJob: vi.fn().mockResolvedValue(true) });
        const principal: ServicePrincipal = { ownerId: FIXTURE_OWNER, eventId: 'evt_1', actor: 'identity-worker' };

        const result = await service.requestServiceErasure(principal);

        expect(serviceErasureAcceptedResponseSchema.parse(result)).toEqual(result);
        expect(result).not.toHaveProperty('jobId');
        expect(result.status).toBe('completed');
    });

    it('the ACTIVE-status body REJECTS a terminal status — a 202 only ever reports queued or running', () => {
        expect(erasureRequestAcceptedResponseSchema.safeParse({ jobId: JOB_ID, status: 'completed' }).success).toBe(
            false,
        );
        expect(erasureRequestAcceptedResponseSchema.safeParse({ jobId: JOB_ID, status: 'failed' }).success).toBe(false);
    });

    it('the SERVICE body accepts a terminal status, because its already-erased no-op reports `completed`', () => {
        expect(
            serviceErasureAcceptedResponseSchema.safeParse({ status: 'completed', triggerSource: 'service' }).success,
        ).toBe(true);
    });

    it('the SERVICE body REJECTS triggerSource `user` — this route is only ever reached by a machine token', () => {
        expect(
            serviceErasureAcceptedResponseSchema.safeParse({ status: 'completed', triggerSource: 'user' }).success,
        ).toBe(false);
    });
});

describe('the erasure REQUEST schema — shape only, by design', () => {
    it('requires a confirmationPhrase: erasure must never proceed without a deliberate intent gate', () => {
        expect(erasureRequestSchema.safeParse({}).success).toBe(false);
        expect(erasureRequestSchema.safeParse({ confirmationPhrase: '' }).success).toBe(false);
    });

    it('accepts a well-formed but WRONG phrase — the VALUE is the service’s gate, not the pipe’s', () => {
        // ⚠️ If this ever starts failing, someone narrowed the schema to a literal. That moves the intent
        // gate before the service, changes the 400 body, and publishes the phrase as an enum in openapi.yaml.
        // See `account.schema.ts` for why the split is deliberate.
        expect(erasureRequestSchema.safeParse({ confirmationPhrase: 'delete it all' }).success).toBe(true);
    });

    it('has NO ownerId field, and REFUSES one rather than stripping it (GR-017 §17-c)', () => {
        const parsed = erasureRequestSchema.safeParse({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            ownerId: 'victim-2',
        });

        expect(parsed.success).toBe(false);
        expect(Object.keys(erasureRequestSchema.shape)).toEqual(['confirmationPhrase', 'publishRecipeIds']);
    });

    /**
     * WHERE STRICTNESS EARNS THE MOST IN THIS SERVICE, asserted rather than only argued in the schema's docstring.
     *
     * Erasure is IRREVERSIBLE, and `publishRecipeIds` is the per-recipe DONATE election. Under the previous
     * stripping behaviour a client that misspelled it had its whole election dropped and got a `202`: the erasure
     * proceeded and every owner-only recipe was REMOVED rather than donated, with nothing telling the user their
     * choice had not been recorded and no way to undo it.
     */
    it('REFUSES a misspelled publishRecipeIds, instead of erasing recipes the caller elected to donate', () => {
        const parsed = erasureRequestSchema.safeParse({
            confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
            publishRecipeIDs: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
        });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    });

    it('bounds the donate election, so one request cannot persist an unbounded array on the job row', () => {
        const id = '00000000-0000-4000-8000-0000000000d1';

        expect(
            erasureRequestSchema.safeParse({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: Array.from({ length: 1001 }, () => id),
            }).success,
        ).toBe(false);
        expect(
            erasureRequestSchema.safeParse({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: Array.from({ length: 1000 }, () => id),
            }).success,
        ).toBe(true);
    });

    it('rejects a non-uuid election entry, so no raw string reaches the durable row', () => {
        expect(
            erasureRequestSchema.safeParse({
                confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE,
                publishRecipeIds: ['not-a-uuid'],
            }).success,
        ).toBe(false);
    });
});

describe('matchesAccountErasureConfirmation — the ONE intent-gate rule both sides now use', () => {
    it('accepts the exact phrase', () => {
        expect(matchesAccountErasureConfirmation(ACCOUNT_ERASURE_CONFIRMATION_PHRASE)).toBe(true);
    });

    it('tolerates surrounding whitespace — a paste artefact is not a different intent', () => {
        expect(matchesAccountErasureConfirmation(`  ${ACCOUNT_ERASURE_CONFIRMATION_PHRASE}\n`)).toBe(true);
        expect(matchesAccountErasureConfirmation(`\t${ACCOUNT_ERASURE_CONFIRMATION_PHRASE}`)).toBe(true);
    });

    it('is CASE-SENSITIVE — the value of a confirmation ritual is that it is deliberate', () => {
        expect(matchesAccountErasureConfirmation('erase my data')).toBe(false);
        expect(matchesAccountErasureConfirmation('Erase My Data')).toBe(false);
    });

    it('rejects interior-whitespace, truncated and extended variants', () => {
        expect(matchesAccountErasureConfirmation('ERASE  MY  DATA')).toBe(false);
        expect(matchesAccountErasureConfirmation('ERASE MY DAT')).toBe(false);
        expect(matchesAccountErasureConfirmation('ERASE MY DATA NOW')).toBe(false);
    });

    it('rejects empty and whitespace-only input', () => {
        expect(matchesAccountErasureConfirmation('')).toBe(false);
        expect(matchesAccountErasureConfirmation('   ')).toBe(false);
    });

    it('is the literal the product has always used, so moving it here changed no behaviour', () => {
        expect(ACCOUNT_ERASURE_CONFIRMATION_PHRASE).toBe('ERASE MY DATA');
    });
});
