/**
 * The food request DTOs, driven through the REAL `nestjs-zod` `ZodValidationPipe`.
 *
 * ## Why the real pipe, and not the schemas
 *
 * `foods.schema.test.ts` already proves the zod schemas accept and reject the right shapes. That is NOT the
 * question here. The question is whether the shapes the schemas describe are actually ENFORCED on a request —
 * and the failure mode this file exists for is precisely one where the schemas are correct, the DTOs are
 * correct, the controller signatures are correct, and nothing validates anything:
 *
 *   ⚠️ A `createZodDto` class carries NO `class-validator` metadata. Under Nest's own `ValidationPipe` — or
 *   under `ZodValidationPipe` registered against the bare class token instead of `APP_PIPE` — every DTO below
 *   passes straight through, unvalidated, while the wiring reads as correct in every file you would think to
 *   look at.
 *
 * So these cases construct the pipe the way `AppModule` does and hand it the DTO metatype the way Nest does.
 * A revert to Nest's pipe, a lost `APP_PIPE` token, or a DTO that stops wrapping its schema all fail here.
 * `app.module.test.ts`'s companion assertion covers the binding itself.
 *
 * ## What moved here, and from where
 *
 * The `400` assertions that used to live in `foods.controller.test.ts` — a non-array `names`, a body with no
 * `candidateIds`, an empty `name`. They could not stay: the controller's parameters are now typed as the DTOs,
 * so a controller-level test can only pass a well-formed object (proving nothing) or cast a lie past the
 * compiler (proving less). The rejection is the PIPE's job now, so it is tested where it happens.
 *
 * The `400` BODY these produce is deliberately not asserted here — `ZodValidationException`'s shape is
 * `nestjs-zod`'s, and what reaches the wire is the ARCH-PS-2 envelope the exception filter renders from it.
 * That translation is pinned in `common/filters/__tests__/api-exception.filter.test.ts`.
 */
import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { MAX_FOOD_NAME_LENGTH } from '../../foods.schema.js';
import { AddFoodBodyDto, BatchAddFoodBodyDto, ResolveFoodBodyDto, SearchFoodQueryDto } from '../foods.dto.js';

/** The pipe exactly as `AppModule` binds it — no options, so this cannot pass by being configured leniently. */
const pipe = new ZodValidationPipe();

/** The metadata Nest supplies for a `@Body()`/`@Query()` parameter of the given DTO type. */
const metadata = (metatype: unknown, type: 'body' | 'query' = 'body'): ArgumentMetadata =>
    ({ type, metatype }) as ArgumentMetadata;

/** Run a value through the pipe for a DTO, returning the parsed output. */
const through = <T>(dto: unknown, value: unknown, type: 'body' | 'query' = 'body'): T =>
    pipe.transform(value, metadata(dto, type)) as T;

/** Assert the pipe REJECTS a value for a DTO. */
const rejects = (dto: unknown, value: unknown, type: 'body' | 'query' = 'body'): void => {
    expect(() => pipe.transform(value, metadata(dto, type))).toThrow(BadRequestException);
};

describe('AddFoodBodyDto (POST /api/v1/foods)', () => {
    it('accepts a name and TRIMS it, so the service never sees the caller’s whitespace', () => {
        expect(through<{ name: string }>(AddFoodBodyDto, { name: '  chicken breast  ' })).toEqual({
            name: 'chicken breast',
        });
    });

    it.each([
        ['an absent name', {}],
        ['a null name', { name: null }],
        ['a non-string name', { name: 42 }],
        ['an empty name (FR-006)', { name: '' }],
        ['a whitespace-only name, which is empty AFTER trimming (FR-006)', { name: '   ' }],
    ])('rejects %s', (_label, body) => {
        rejects(AddFoodBodyDto, body);
    });

    it('rejects a name longer than the published bound, so one request cannot hand Postgres a megabyte', () => {
        // The name is normalized and trigram-indexed. Unbounded, the work per request is the caller's choice.
        expect(() => through(AddFoodBodyDto, { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH) })).not.toThrow();
        rejects(AddFoodBodyDto, { name: 'a'.repeat(MAX_FOOD_NAME_LENGTH + 1) });
    });

    it('REJECTS an unknown key rather than silently stripping it (z.strictObject)', () => {
        // The distinction is the whole point of the ruling: plain `z.object()` would drop `ownerId` and answer
        // 202, telling the caller their field was accepted. `additionalProperties: false` is already published,
        // so stripping made the document a lie.
        rejects(AddFoodBodyDto, { name: 'chicken', ownerId: 'someone-else' });
    });
});

describe('BatchAddFoodBodyDto (POST /api/v1/foods/batch)', () => {
    it('accepts an array of names, each trimmed', () => {
        expect(through<{ names: string[] }>(BatchAddFoodBodyDto, { names: [' egg ', 'milk'] })).toEqual({
            names: ['egg', 'milk'],
        });
    });

    it('rejects a non-array `names` — the case that moved out of the controller test', () => {
        rejects(BatchAddFoodBodyDto, { names: 'nope' });
    });

    it.each([
        ['an absent names', {}],
        ['a non-string entry', { names: ['egg', 7] }],
        ['an over-long entry', { names: ['a'.repeat(MAX_FOOD_NAME_LENGTH + 1)] }],
        ['an unknown key', { names: ['egg'], limit: 9999 }],
    ])('rejects %s', (_label, body) => {
        rejects(BatchAddFoodBodyDto, body);
    });

    it('accepts a blank entry, because dropping those is the CONTROLLER’s normalization, not the contract’s', () => {
        // Deliberate division of labour: the shape is the contract's, the blank-dropping and the runtime
        // `FOOD_MAX_BATCH_NAMES` cap are the controller's (a `.transform()` is not representable in the
        // published JSON Schema, and a static cap would disagree with the env var the moment it is tuned).
        expect(through<{ names: string[] }>(BatchAddFoodBodyDto, { names: ['egg', '  '] })).toEqual({
            names: ['egg', ''],
        });
    });
});

describe('ResolveFoodBodyDto (PATCH /api/v1/foods/{id})', () => {
    it('accepts at least one candidate id', () => {
        expect(through<{ candidateIds: string[] }>(ResolveFoodBodyDto, { candidateIds: ['c1'] })).toEqual({
            candidateIds: ['c1'],
        });
    });

    it.each([
        ['a body with no candidateIds (DSN-14) — moved out of the controller test', {}],
        ['an EMPTY candidateIds array (.min(1))', { candidateIds: [] }],
        ['a non-array candidateIds', { candidateIds: 'c1' }],
        ['an unknown key', { candidateIds: ['c1'], force: true }],
    ])('rejects %s', (_label, body) => {
        rejects(ResolveFoodBodyDto, body);
    });
});

describe('SearchFoodQueryDto (GET /api/v1/foods/search)', () => {
    it('accepts and trims a search term', () => {
        expect(through<{ query: string }>(SearchFoodQueryDto, { query: '  chicken  ' }, 'query')).toEqual({
            query: 'chicken',
        });
    });

    it('keeps a legitimate % in the term — escaping belongs where the ILIKE pattern is BUILT', () => {
        // If escaping were hoisted into validation, this would arrive as `50\% cream` and the full-text and
        // trigram branches (which receive the same string as a VALUE) would find nothing. See
        // `dao/food-search.dao.ts` → `toIlikePattern`.
        expect(through<{ query: string }>(SearchFoodQueryDto, { query: '50% cream' }, 'query')).toEqual({
            query: '50% cream',
        });
    });

    it.each([
        ['an absent query, which used to be silently treated as the empty string', {}],
        ['an empty query', { query: '' }],
        ['a whitespace-only query', { query: '  ' }],
        ['an over-long query', { query: 'a'.repeat(MAX_FOOD_NAME_LENGTH + 1) }],
    ])('rejects %s', (_label, query) => {
        rejects(SearchFoodQueryDto, query, 'query');
    });

    it('rejects an unknown query parameter instead of ignoring it', () => {
        // A caller who sends `?query=egg&limit=1000` now learns `limit` is not a parameter, rather than
        // believing it applied.
        rejects(SearchFoodQueryDto, { query: 'egg', limit: '1000' }, 'query');
    });
});

/**
 * The trap, asserted directly: these DTOs carry NO `class-validator` metadata, so the only thing standing
 * between a caller and the database is the ZOD pipe specifically.
 *
 * Without this case the suite above would still pass if someone swapped `AppModule`'s pipe for Nest's — every
 * test here constructs `ZodValidationPipe` explicitly. This one states WHY that substitution is not available.
 */
describe('the DTOs are validated by the Zod pipe SPECIFICALLY', () => {
    it('carries no class-validator metadata, so Nest’s own ValidationPipe would validate nothing', () => {
        // `class-validator` stores constraints on the constructor under its own metadata keys. A `createZodDto`
        // class has none, which is exactly why Nest's `ValidationPipe` treats it as a plain type and passes the
        // payload through untouched.
        const metadataKeys = Reflect.getMetadataKeys(AddFoodBodyDto) as unknown[];

        expect(metadataKeys.some((key) => String(key).includes('class-validator'))).toBe(false);
        // …and the schema IS reachable from the class, which is what the Zod pipe uses instead.
        expect((AddFoodBodyDto as unknown as { schema?: unknown }).schema).toBeDefined();
    });
});
