/**
 * The step-writing engine's first three stages across their real seams, imported through the package's own export
 * map: the facts sheet check, the prompt builder, a writer port, and the answer reader. Only the writer is a stub (the
 * model is the one thing this tier does not call). The engine has no database.
 *
 * What a unit test of one stage cannot show, and this does: a sheet that carries extra fields (a title, a headnote,
 * the source's step text, planted fields inside nested facts) sends the writer none of them, and whatever the writer
 * answers is read as data by the real reader, with the refusals the caller counts. A broken export entry fails this
 * file at import.
 */
import { isFactsSheetInvalidError } from '@kitchensink/recipe-core/step-writing/facts-sheet-input';
import { parseStepAnswer } from '@kitchensink/recipe-core/step-writing/step-answer';
import { buildStepPrompt } from '@kitchensink/recipe-core/step-writing/step-prompt';
import { describe, expect, it } from 'vitest';

import type { FactsSheet } from '@kitchensink/recipe-core/step-writing/facts-sheet-types';
import type { StepAnswer } from '@kitchensink/recipe-core/step-writing/step-answer';
import type { StepPrompt } from '@kitchensink/recipe-core/step-writing/step-prompt';

/** The writer port: one prompt in, the model's raw reply out. */
type StepWriter = (prompt: StepPrompt) => Promise<string>;

/** The source's own words. They exist only in planted fields, so a prompt that holds any of them has leaked. */
const SENTINEL = 'SENTINEL-source-wording-4d2e';

const SHEET: FactsSheet = {
    language: 'en',
    ingredientNames: ['butter', 'chicken thigh'],
    steps: [
        {
            actions: ['preheat', 'melt'],
            amounts: [{ quantity: 2, unit: 'tbsp' }],
            temperatures: [{ value: 400, scale: 'F' }],
            durations: [],
            ingredients: ['butter'],
            equipment: ['oven', 'skillet'],
            safety: [],
        },
        {
            actions: ['roast'],
            amounts: [],
            temperatures: [],
            durations: [{ minSeconds: 1200, maxSeconds: 1200 }],
            ingredients: ['chicken thigh'],
            equipment: [],
            safety: [{ category: 'internalTemperature', facts: ['juices run clear'] }],
        },
    ],
};

/**
 * The same sheet with the source's wording planted where a careless caller or a careless builder would leave it:
 * beside the sheet, beside each step, and inside every kind of nested fact.
 */
function widened(): FactsSheet & { title: string; headnote: string; sourceAddress: string } {
    const plant = <T extends object>(fact: T): T & { text: string } => ({ ...fact, text: SENTINEL });

    return {
        ...SHEET,
        title: SENTINEL,
        headnote: SENTINEL,
        sourceAddress: SENTINEL,
        steps: SHEET.steps.map((step) => ({
            ...step,
            text: SENTINEL,
            amounts: step.amounts.map(plant),
            temperatures: step.temperatures.map(plant),
            durations: step.durations.map(plant),
            safety: step.safety.map(plant),
        })),
    };
}

/** The engine's first three stages, as a caller composes them. */
async function writeSteps(sheet: FactsSheet, writer: StepWriter, cap: number): Promise<StepAnswer> {
    return parseStepAnswer(await writer(buildStepPrompt(sheet)), cap);
}

describe('the engine round trip, with a stub writer', () => {
    it('sends the writer facts only, and reads its answer into steps that cover the source steps', async () => {
        const received: StepPrompt[] = [];

        const writer: StepWriter = async (prompt) => {
            received.push(prompt);

            return JSON.stringify({
                steps: [
                    { text: 'Heat the oven to 400 F and melt 2 tbsp butter in a skillet.', covers: [0] },
                    { text: 'Roast the chicken thigh for 20 minutes until the juices run clear.', covers: [1] },
                ],
            });
        };

        const result = await writeSteps(widened(), writer, 80);

        expect(result).toEqual({
            ok: true,
            steps: [
                { text: 'Heat the oven to 400 F and melt 2 tbsp butter in a skillet.', covers: [0] },
                { text: 'Roast the chicken thigh for 20 minutes until the juices run clear.', covers: [1] },
            ],
        });
        expect(received).toHaveLength(1);

        const sent = `${received[0]?.systemPrompt ?? ''}${received[0]?.userMessage ?? ''}`;

        expect(sent).not.toContain(SENTINEL);
        expect(sent).not.toContain('SENTINEL');
        expect(sent).toContain('chicken thigh');
        expect(sent).toContain('"maxSeconds":1200');
        expect(sent).toContain('"quantity":2');
        expect(sent).toContain('"scale":"F"');
        expect(sent).toContain('juices run clear');
    });

    it('turns a writer that wraps its answer, links out, or runs past the cap into the refusals the caller counts', async () => {
        const reply =
            (text: string): StepWriter =>
            async () =>
                text;
        const steps = [{ text: 'Melt the butter.', covers: [0] }];

        await expect(writeSteps(SHEET, reply(`Sure! ${JSON.stringify({ steps })}`), 80)).resolves.toEqual({
            refused: 'outsideList',
        });
        await expect(writeSteps(SHEET, reply('not json'), 80)).resolves.toEqual({ refused: 'unreadable' });
        await expect(
            writeSteps(SHEET, reply(JSON.stringify({ steps: [{ text: 'See www.evil.example', covers: [0] }] })), 80),
        ).resolves.toEqual({ refused: 'unsafeText' });
        await expect(writeSteps(SHEET, reply(JSON.stringify({ steps: [...steps, ...steps] })), 1)).resolves.toEqual({
            refused: 'overCap',
        });
    });

    it('never calls the writer for a sheet that carries wording in a field it reads', async () => {
        const calls: StepPrompt[] = [];

        const writer: StepWriter = async (prompt) => {
            calls.push(prompt);

            return '{}';
        };

        const hostile: FactsSheet = {
            ...SHEET,
            ingredientNames: [
                'Preheat the oven to 400 degrees. Melt the butter in my grandmother skillet and let it foam.',
            ],
        };

        await expect(writeSteps(hostile, writer, 80)).rejects.toSatisfy(isFactsSheetInvalidError);
        expect(calls).toHaveLength(0);
    });
});
