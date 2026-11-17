/**
 * The step-writing engine's first three stages across their real seams: the facts sheet check, the prompt builder,
 * a writer port, and the answer reader. Only the writer is a stub (the model is the one thing this tier does not
 * call). The engine has no database.
 *
 * What a unit test of one stage cannot show, and this does: the facts a recipe's sheet carries are the only thing the
 * writer is sent, and whatever the writer answers is read as data by the real reader, with the refusals the caller
 * counts.
 */
import { describe, expect, it } from 'vitest';

import { isFactsSheetInvalidError } from '../src/stepWriting/factsSheetInput.js';
import { parseStepAnswer } from '../src/stepWriting/stepAnswer.js';
import { buildStepPrompt } from '../src/stepWriting/stepPrompt.js';

import type { FactsSheet } from '../src/stepWriting/factsSheet.types.js';
import type { StepAnswer } from '../src/stepWriting/stepAnswer.js';
import type { StepPrompt } from '../src/stepWriting/stepPrompt.js';

/** The writer port: one prompt in, the model's raw reply out. */
type StepWriter = (prompt: StepPrompt) => Promise<string>;

/** The source recipe's own words. They exist only here, so a prompt that holds any of them has leaked. */
const SOURCE_WORDING = [
    'Preheat the oven to 400 degrees. Melt the butter in my grandmother skillet and let it foam for a minute.',
    'Roast the SENTINEL-chicken until the juices run clear, about twenty minutes.',
];

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

        const result = await writeSteps(SHEET, writer, 80);

        expect(result).toEqual({
            ok: true,
            steps: [
                { text: 'Heat the oven to 400 F and melt 2 tbsp butter in a skillet.', covers: [0] },
                { text: 'Roast the chicken thigh for 20 minutes until the juices run clear.', covers: [1] },
            ],
        });
        expect(received).toHaveLength(1);

        const sent = `${received[0]?.systemPrompt ?? ''}${received[0]?.userMessage ?? ''}`;

        for (const wording of SOURCE_WORDING) {
            expect(sent).not.toContain(wording);
        }

        expect(sent).not.toContain('SENTINEL');
        expect(sent).toContain('chicken thigh');
        expect(sent).toContain('"maxSeconds":1200');
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

    it('never calls the writer for a sheet that carries wording', async () => {
        const calls: StepPrompt[] = [];

        const writer: StepWriter = async (prompt) => {
            calls.push(prompt);

            return '{}';
        };

        const hostile: FactsSheet = { ...SHEET, ingredientNames: [SOURCE_WORDING[0] ?? ''] };

        await expect(writeSteps(hostile, writer, 80)).rejects.toSatisfy(isFactsSheetInvalidError);
        expect(calls).toHaveLength(0);
    });
});
