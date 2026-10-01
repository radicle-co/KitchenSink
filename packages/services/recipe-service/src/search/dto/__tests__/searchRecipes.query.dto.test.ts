/**
 * The REQUEST CONTRACT of `GET /api/v1/search/recipes`, driven through the REAL pipe the controller applies.
 *
 * ── WHY THIS FILE WAS REWRITTEN ──
 *
 * It used to test `maxCookTime` alone, through Nest's OWN `ValidationPipe` over a `class-validator` DTO. That DTO
 * was the LAST `class-validator` importer in `packages/services/**` — a second DTO framework in a service ADR-0015
 * §1 requires to have exactly one, which had three consequences the old suite could not see:
 *
 *  1. **The rejection took a different path.** `class-validator` puts its constraints on `message[]`, not on the
 *     `errors` key `nestjs-zod` uses, so this route's `400` fell through to `codeForStatus(400)` and published
 *     `BAD_REQUEST` — a code that is deliberately NOT a member of `recipeErrorCodeSchema` (see `apiError.ts`), so
 *     the typed client's union rejected it and degraded to status-mapping. Every OTHER validated route in the
 *     service answers `VALIDATION_FAILED`, which is what the published document promises for this one too.
 *  2. **The bound came from the DAL.** `@Max(MAX_SEARCH_PAGE_SIZE)` imported a data-access constant into the wire
 *     contract — the same backwards dependency `search.schema.ts`'s header records for `RecipeSearchFacets`.
 *  3. **`INT4_CEILING` was re-declared locally** while `@kitchensink/recipe-core` already exports it.
 *
 * So the assertions below are about the CONTRACT (what is accepted, what is rejected, what the rejection SAYS),
 * not about which decorator library implements it.
 *
 * The pipe is the real `ZodValidationPipe` and the metadata is the real `SearchRecipesQueryDto`, so a schema that
 * stopped being wired to the route would fail here rather than pass on a hand-parsed schema object.
 */
import { HttpException, type ArgumentMetadata } from '@nestjs/common';
import { INT4_CEILING, MAX_SEARCH_PAGE_SIZE, RecipeSearchSortBy } from '@kitchensink/recipe-core';
import { ZodValidationPipe } from 'nestjs-zod';
import { describe, expect, it } from 'vitest';

import { SearchRecipesQueryDto } from '../searchRecipes.query.dto.js';
import type { RecipeSearchQuery } from '../../search.schema.js';

/** The exact pipe the app binds globally, over the exact DTO the controller declares. */
const pipe = new ZodValidationPipe();
const meta: ArgumentMetadata = { type: 'query', metatype: SearchRecipesQueryDto, data: '' };

/** Parse a raw query bag exactly as Nest would. Throws the pipe's own exception on rejection. */
function parse(raw: Record<string, unknown>): RecipeSearchQuery {
    return pipe.transform(raw, meta) as RecipeSearchQuery;
}

/**
 * The pipe's rejection for a bag, as the serialized body the exception filter will read.
 *
 * Fails loudly when the bag is ACCEPTED, so a case can never silently assert nothing — the failure mode the
 * repo's own review notes call out (a check defeated by its surroundings rather than by its logic).
 */
function rejectionBody(raw: Record<string, unknown>): { statusCode?: number; errors?: unknown } {
    try {
        pipe.transform(raw, meta);
    } catch (error) {
        expect(error).toBeInstanceOf(HttpException);

        return (error as HttpException).getResponse() as { statusCode?: number; errors?: unknown };
    }

    throw new Error(`expected ${JSON.stringify(raw)} to be rejected, but it was accepted`);
}

describe('the search query contract — coercion', () => {
    it('coerces the numeric filters out of their query-string form', () => {
        expect(parse({ maxPrepTime: '15', maxCookTime: '30', maxTotalTime: '45' })).toEqual({
            maxPrepTime: 15,
            maxCookTime: 30,
            maxTotalTime: 45,
        });
    });

    it('accepts zero for a time filter — the lower bound is inclusive', () => {
        expect(parse({ maxCookTime: '0' }).maxCookTime).toBe(0);
    });

    it('accepts a list filter as REPEATED params', () => {
        expect(parse({ tags: ['quick', 'vegan'] }).tags).toEqual(['quick', 'vegan']);
    });

    it('accepts the SAME list filter as one comma-separated value', () => {
        expect(parse({ tags: 'quick,vegan' }).tags).toEqual(['quick', 'vegan']);
    });

    it('trims each list entry and drops the empty ones a trailing comma produces', () => {
        expect(parse({ dietaryFlags: ' vegan , ,gluten-free ' }).dietaryFlags).toEqual(['vegan', 'gluten-free']);
    });

    it('accepts every published sort key', () => {
        for (const sortBy of Object.values(RecipeSearchSortBy)) {
            expect(parse({ sortBy }).sortBy).toBe(sortBy);
        }
    });
});

/*
 * ── AN EMPTY PARAMETER MEANS "NOT SUPPLIED", NEVER `0` AND NEVER `''` ──
 *
 * `?maxPrepTime=` is what a UI serializes for a cleared numeric input, and `?query=` for an empty search box.
 * Under the previous `@Type(() => Number)` DTO the first became `Number('') === 0` and passed `@Min(0)`, so the
 * request meant "recipes taking zero minutes or less" and returned NOTHING — a wrong answer, delivered as a
 * `200`, from a parameter the caller believed they had left blank.
 *
 * The `''` → absent mapping is made HERE, at the boundary, rather than downstream: `search.dal.ts` already
 * re-derived it for `query` alone (`filters.query.trim().length > 0`), which is a parse decision taken three
 * layers below the parser and only for one of the eleven fields.
 */
describe('the search query contract — a blank parameter is an absent parameter', () => {
    it('reads a blank time filter as absent rather than as zero', () => {
        expect(parse({ maxPrepTime: '' }).maxPrepTime).toBeUndefined();
    });

    it('reads a blank text filter as absent rather than as the empty string', () => {
        expect(parse({ query: '', cuisine: '' })).toEqual({});
    });

    it('reads a blank page/pageSize as absent, so the service default applies', () => {
        expect(parse({ page: '', pageSize: '' })).toEqual({});
    });

    it('reads a blank list filter as absent rather than as [""]', () => {
        expect(parse({ tags: '' }).tags).toBeUndefined();
    });
});

describe('the search query contract — bounds', () => {
    it('rejects a negative time filter', () => {
        expect(rejectionBody({ maxCookTime: '-1' }).statusCode).toBe(400);
    });

    it('rejects a non-integer time filter instead of truncating it', () => {
        expect(rejectionBody({ maxCookTime: '12.5' }).statusCode).toBe(400);
    });

    it('rejects a value no int4 column can hold, so the filter is a 400 and not a Postgres 22003 → 500', () => {
        expect(parse({ maxTotalTime: String(INT4_CEILING) }).maxTotalTime).toBe(INT4_CEILING);
        expect(rejectionBody({ maxTotalTime: String(INT4_CEILING + 1) }).statusCode).toBe(400);
    });

    it('rejects page 0 — the wire is 1-based', () => {
        expect(rejectionBody({ page: '0' }).statusCode).toBe(400);
    });

    /*
     * The page-size ceiling is load-bearing for ENVELOPE HONESTY, not just for load. `search.service.ts` echoes
     * the REQUESTED `pageSize` into the response envelope while `search.dal.ts` independently clamps the LIMIT it
     * issues, so an accepted `pageSize=999` would report `pageSize: 999` beside 50 rows. The boundary bound is
     * what keeps the two from disagreeing — which is also why the published document must state the maximum.
     */
    it('rejects a page size above the published ceiling', () => {
        expect(parse({ pageSize: String(MAX_SEARCH_PAGE_SIZE) }).pageSize).toBe(MAX_SEARCH_PAGE_SIZE);
        expect(rejectionBody({ pageSize: String(MAX_SEARCH_PAGE_SIZE + 1) }).statusCode).toBe(400);
    });

    it('rejects an unknown sort key rather than silently browsing by relevance', () => {
        expect(rejectionBody({ sortBy: 'cheapest' }).statusCode).toBe(400);
    });

    it('rejects a non-numeric time filter', () => {
        expect(rejectionBody({ maxPrepTime: 'soon' }).statusCode).toBe(400);
    });
});

/*
 * ── THE REJECTION MUST TAKE THE SAME PATH AS EVERY OTHER ROUTE'S ──
 *
 * This is the assertion the old class-validator suite structurally could not make. `ApiExceptionFilter` reads
 * `errors` to produce `VALIDATION_FAILED` + `details.fields`; a `message[]` body (class-validator's shape) misses
 * that branch and publishes `BAD_REQUEST`. Asserting the KEY here — rather than the filter's output — keeps the
 * test at this unit's boundary; `tests/apiException.filter.test.ts` owns the other half.
 */
describe('the search query contract — the rejection the filter can read', () => {
    it('carries its issues on `errors`, the key ApiExceptionFilter maps to VALIDATION_FAILED', () => {
        const body = rejectionBody({ pageSize: '999' });

        expect(Array.isArray(body.errors)).toBe(true);
        expect((body.errors as unknown[]).length).toBeGreaterThan(0);
    });

    it('names the offending field in the issue path, so details.fields can identify it', () => {
        const body = rejectionBody({ maxPrepTime: '-5' });
        const paths = (body.errors as { path?: unknown[] }[]).map((issue) => issue.path?.join('.'));

        expect(paths).toContain('maxPrepTime');
    });
});

/*
 * ── FORWARD-COMPATIBILITY: THIS READ QUERY IS `z.object`, NOT `z.strictObject` ──
 *
 * The fourth exemption GR-017 §17-c permits, for the reasons `listRecipesQuerySchema` states: Nest hands the pipe
 * the WHOLE query string, so a strict object would `400` on a cache-buster or an analytics tag, and a read has no
 * silent-partial-write to make visible. `contract/__tests__/contract.test.ts` pins the exempt set.
 */
describe('the search query contract — strictness', () => {
    it('ignores an unrecognized query parameter instead of rejecting the search', () => {
        expect(parse({ query: 'pasta', utm_source: 'newsletter' })).toEqual({ query: 'pasta' });
    });
});

describe('the search query contract — everything is optional', () => {
    it('accepts an empty bag: a bare search is a browse', () => {
        expect(parse({})).toEqual({});
    });
});
