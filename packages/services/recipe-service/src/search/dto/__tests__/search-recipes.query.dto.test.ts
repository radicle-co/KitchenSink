/**
 * REQ-030f — unit tests for {@link SearchRecipesQueryDto}'s `maxCookTime` bound.
 *
 * Mirrors `maxPrepTime` / `maxTotalTime`: a non-negative integer, coerced from the query-string via
 * `@Type(() => Number)`, validated through the SAME `ValidationPipe` the controller applies (per the
 * sibling `recipes/dto/__tests__/numeric-bounds.dto.test.ts` pattern).
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { SearchRecipesQueryDto } from '../search-recipes.query.dto.js';

/** The exact pipe the `SearchController` applies for query params (coercion + validation). */
const pipe = new ValidationPipe({ transform: true });

const meta: ArgumentMetadata = { type: 'query', metatype: SearchRecipesQueryDto };

describe('SearchRecipesQueryDto.maxCookTime (REQ-030f)', () => {
    it('accepts a non-negative integer, coerced from the query-string', async () => {
        const dto = (await pipe.transform({ maxCookTime: '30' }, meta)) as SearchRecipesQueryDto;

        expect(dto.maxCookTime).toBe(30);
    });

    it('accepts zero (the lower bound)', async () => {
        const dto = (await pipe.transform({ maxCookTime: '0' }, meta)) as SearchRecipesQueryDto;

        expect(dto.maxCookTime).toBe(0);
    });

    it('rejects a negative value', async () => {
        await expect(pipe.transform({ maxCookTime: '-1' }, meta)).rejects.toThrow();
    });

    it('rejects a non-integer value', async () => {
        await expect(pipe.transform({ maxCookTime: '12.5' }, meta)).rejects.toThrow();
    });

    it('is optional — absent when not supplied', async () => {
        const dto = (await pipe.transform({}, meta)) as SearchRecipesQueryDto;

        expect(dto.maxCookTime).toBeUndefined();
    });
});
