/**
 * W8-a.6 / FR-007b — DTO validation for the version `deviceLabel` write field.
 *
 * `deviceLabel` is OPTIONAL bounded free text, captured on create/update and recorded on the version
 * snapshot. It is user-controlled and later surfaced in the version history + conflict banner, so it is
 * bounded here (length + charset) as defense in depth over the render-time escaping that is the actual XSS
 * control. These cases pin the bound through the SAME `ValidationPipe` the controller uses.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CreateRecipeDto, DEVICE_LABEL_MAX_LENGTH } from '../create-recipe.dto.js';
import { UpdateRecipeDto } from '../update-recipe.dto.js';

/** The exact pipe the `RecipesController` applies (`@UsePipes(new ValidationPipe(...))`). */
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false });

const createMeta: ArgumentMetadata = { type: 'body', metatype: CreateRecipeDto };
const updateMeta: ArgumentMetadata = { type: 'body', metatype: UpdateRecipeDto };

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

describe('CreateRecipeDto.deviceLabel (W8-a.6 — bounded free text, value-or-omit)', () => {
    it.each([`Brandon's iPhone`, 'MacBook Pro (Work)', 'Pixel 8', 'iPad Air 2024'])(
        'accepts a realistic device name %s and keeps it on the instance',
        async (value) => {
            const dto = (await pipe.transform(createBody({ deviceLabel: value }), createMeta)) as CreateRecipeDto;

            expect(dto.deviceLabel).toBe(value);
        },
    );

    it('leaves deviceLabel undefined when absent (a device is never fabricated)', async () => {
        const dto = (await pipe.transform(createBody(), createMeta)) as CreateRecipeDto;

        expect(dto.deviceLabel).toBeUndefined();
    });

    it('rejects a label past the length cap', async () => {
        const tooLong = 'a'.repeat(DEVICE_LABEL_MAX_LENGTH + 1);

        await expect(pipe.transform(createBody({ deviceLabel: tooLong }), createMeta)).rejects.toThrow();
    });

    it.each(['<script>alert(1)</script>', 'has\ttab', 'emoji 🚀 here', 'semi;colon'])(
        'rejects a label with characters outside the safe charset (%s) — defense in depth over escaping',
        async (value) => {
            await expect(pipe.transform(createBody({ deviceLabel: value }), createMeta)).rejects.toThrow();
        },
    );
});

describe('UpdateRecipeDto.deviceLabel (W8-a.6)', () => {
    it('accepts a valid label on update', async () => {
        const dto = (await pipe.transform(
            { expectedVersion: 1, deviceLabel: 'Galaxy S24' },
            updateMeta,
        )) as UpdateRecipeDto;

        expect(dto.deviceLabel).toBe('Galaxy S24');
    });

    it('leaves deviceLabel undefined when omitted', async () => {
        const dto = (await pipe.transform({ expectedVersion: 1 }, updateMeta)) as UpdateRecipeDto;

        expect(dto.deviceLabel).toBeUndefined();
    });

    it('rejects markup in the label', async () => {
        await expect(
            pipe.transform({ expectedVersion: 1, deviceLabel: '<img src=x onerror=1>' }, updateMeta),
        ).rejects.toThrow();
    });
});
