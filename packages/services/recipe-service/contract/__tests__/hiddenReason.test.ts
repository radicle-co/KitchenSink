/**
 * The published contract carries `hiddenReason` as an OPTIONAL, OPEN string (hiddenViews KTD-4, AE3c): an older client that
 * meets a reason a newer server invented must still parse the item, and a reply without it must still parse.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { recipeDetailSchema, recipeSchema } from '@kitchensink/schema-recipe';

const contract = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../schemas/recipe/contract.schema.json', import.meta.url)), 'utf8'),
) as { schemas?: Record<string, unknown>; $defs?: Record<string, unknown> };

describe('the published recipe contract: hiddenReason', () => {
    it('is listed in the generated JSON Schema as a plain string, never required and never an enum', () => {
        const text = JSON.stringify(contract);

        expect(text).toContain('"hiddenReason":{"type":"string"}');
        expect(text).not.toMatch(/"required":\[[^\]]*"hiddenReason"/);
    });

    it.each([
        ['list item', recipeSchema],
        ['detail', recipeDetailSchema],
    ] as const)('lets a %s schema keep a reason it does not know and parse one without', (_name, schema) => {
        const shape = schema.shape as Record<string, { safeParse: (value: unknown) => { success: boolean } }>;

        expect(shape['hiddenReason'].safeParse('futureReason').success).toBe(true);
        expect(shape['hiddenReason'].safeParse(undefined).success).toBe(true);
        expect(shape['hiddenReason'].safeParse(7).success).toBe(false);
    });
});
