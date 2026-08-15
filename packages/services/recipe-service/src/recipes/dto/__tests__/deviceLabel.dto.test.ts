/**
 * W8-a.6 / FR-007b — request validation for the version `deviceLabel` write field.
 *
 * `deviceLabel` is OPTIONAL bounded free text, captured on create/update and recorded on the version
 * snapshot. It is user-controlled and later surfaced in the version history + conflict banner, so it is
 * bounded here (length + charset) as defense in depth over the render-time escaping that is the actual XSS
 * control. These cases pin the bound through the SAME `ZodValidationPipe` the controller uses.
 *
 * ⚠️ The field is also, as of the §15.2 convergence, PUBLISHED on the request side. The server has always
 * accepted and persisted it, while the document listed it only on `RecipeVersion` (a response) and marked
 * both request bodies `additionalProperties: false` — so the contract forbade a field the service uses. The
 * `is published on the request contract` case below is what keeps that closed.
 */
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { MAX_RECIPE_DEVICE_LABEL_LENGTH } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto } from '../createRecipe.dto.js';
import { UpdateRecipeDto } from '../updateRecipe.dto.js';
import { createRecipeRequestSchema, updateRecipeRequestSchema } from '../../recipes.schema.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(ZodValidationPipe)`). */
const pipe = new ZodValidationPipe();

const createMeta = { type: 'body', metatype: CreateRecipeDto } as ArgumentMetadata;
const updateMeta = { type: 'body', metatype: UpdateRecipeDto } as ArgumentMetadata;

/** A minimal-but-valid create body; `over` layers deviceLabel (or anything) on top. */
function createBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Device Label DTO Recipe',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1 }],
        steps: [{ instruction: 'Mix.' }],
        ...over,
    };
}

/** Parse a create body through the real pipe. */
function create(over: Record<string, unknown> = {}): CreateRecipeDto {
    return pipe.transform(createBody(over), createMeta) as CreateRecipeDto;
}

describe('deviceLabel is PUBLISHED on both request bodies (the document used to forbid it)', () => {
    it('appears in the create request schema', () => {
        expect(Object.keys(createRecipeRequestSchema.shape)).toContain('deviceLabel');
    });

    it('appears in the update request schema', () => {
        expect(Object.keys(updateRecipeRequestSchema.shape)).toContain('deviceLabel');
    });

    it('takes its length bound from recipe-core, so the request and the RecipeVersion response agree', () => {
        // The bound lives once, in `recipe-core`'s `MAX_RECIPE_DEVICE_LABEL_LENGTH`, consumed by both
        // `recipeVersionSchema`/`versionConflictSideSchema` (responses) and the request schema here.
        expect(MAX_RECIPE_DEVICE_LABEL_LENGTH).toBe(80);
        expect(create({ deviceLabel: 'a'.repeat(MAX_RECIPE_DEVICE_LABEL_LENGTH) }).deviceLabel).toHaveLength(
            MAX_RECIPE_DEVICE_LABEL_LENGTH,
        );
    });
});

describe('CreateRecipeDto.deviceLabel (W8-a.6 — bounded free text, value-or-omit)', () => {
    it.each([`Brandon's iPhone`, 'MacBook Pro (Work)', 'Pixel 8', 'iPad Air 2024'])(
        'accepts a realistic device name %s and keeps it on the parsed body',
        (value) => {
            expect(create({ deviceLabel: value }).deviceLabel).toBe(value);
        },
    );

    it('leaves deviceLabel undefined when absent (a device is never fabricated)', () => {
        expect(create().deviceLabel).toBeUndefined();
    });

    it('rejects a label past the length cap', () => {
        expect(() => create({ deviceLabel: 'a'.repeat(MAX_RECIPE_DEVICE_LABEL_LENGTH + 1) })).toThrow();
    });

    it('rejects an empty label — "no device" is expressed by omitting the key', () => {
        expect(() => create({ deviceLabel: '' })).toThrow();
    });

    it.each(['<script>alert(1)</script>', 'has\ttab', 'emoji 🚀 here', 'semi;colon'])(
        'rejects a label with characters outside the safe charset (%s) — defense in depth over escaping',
        (value) => {
            expect(() => create({ deviceLabel: value })).toThrow();
        },
    );
});

describe('UpdateRecipeDto.deviceLabel (W8-a.6)', () => {
    it('accepts a valid label on update', () => {
        const dto = pipe.transform({ expectedVersion: 1, deviceLabel: 'Galaxy S24' }, updateMeta) as UpdateRecipeDto;

        expect(dto.deviceLabel).toBe('Galaxy S24');
    });

    it('leaves deviceLabel undefined when omitted', () => {
        expect((pipe.transform({ expectedVersion: 1 }, updateMeta) as UpdateRecipeDto).deviceLabel).toBeUndefined();
    });

    it('rejects markup in the label', () => {
        expect(() =>
            pipe.transform({ expectedVersion: 1, deviceLabel: '<img src=x onerror=1>' }, updateMeta),
        ).toThrow();
    });

    it('rejects a label past the length cap on update', () => {
        expect(() =>
            pipe.transform(
                { expectedVersion: 1, deviceLabel: 'a'.repeat(MAX_RECIPE_DEVICE_LABEL_LENGTH + 1) },
                updateMeta,
            ),
        ).toThrow();
    });
});
