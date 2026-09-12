/**
 * OPERATOR RUNNER — the tolerance-band verification over the committed holdout (plan U6, KTD-E).
 *
 * Replays the SHIPPED artifact — `buildFoodnessPrompt` + `readFoodnessAnswer` through the real
 * `@kitchensink/bedrock` client — over `__fixtures__/foodnessHoldout.tsv`, and judges the profile
 * against the tolerance band: overall ≥ 97.5%, food-loss FN ≤ 12 (the report's 8 + 50%).
 *
 * ⚠️ Costs real money (~10k Nova Micro calls ≈ cents) and real time; resume-safe via the output TSV.
 * Usage: npx tsx scripts/foodnessHoldoutRun.ts <out.tsv> [--input <tsv>] [--band-only]
 *
 * @sideEffect ~10k Bedrock calls; appends to the output TSV.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import { readFoodnessAnswer } from '../src/parsing/foodnessAnswer.js';
import { FOODNESS_MODEL_ID, buildFoodnessPrompt } from '../src/parsing/foodnessPrompt.js';

const out = process.argv[2];

if (out === undefined) {
    throw new Error('usage: foodnessHoldoutRun.ts <out.tsv> [--input <tsv>]');
}

const inputFlag = process.argv.indexOf('--input');
const input =
    inputFlag >= 0
        ? (process.argv[inputFlag + 1] as string)
        : new URL('../src/parsing/__fixtures__/foodnessHoldout.tsv', import.meta.url).pathname;

interface Row {
    readonly kind: string;
    readonly label: boolean;
    readonly word: string;
}

const rows: Row[] = readFileSync(input, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
        const [kind, label, ...word] = line.split('\t');

        return { kind: kind ?? '?', label: label === 'true', word: word.join('\t') };
    });

const done = new Set(
    existsSync(out)
        ? readFileSync(out, 'utf8')
              .split('\n')
              .filter((line) => line.trim() !== '')
              .map((line) => line.split('\t').slice(5).join('\t'))
        : [],
);

const client = new BedrockRuntimeClient({ region: 'us-east-1' });

async function judgeOnce(word: string): Promise<{ isFood: boolean | null; taxonomy: string }> {
    const prompt = buildFoodnessPrompt(word);

    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            const response = await client.send(
                new ConverseCommand({
                    modelId: FOODNESS_MODEL_ID,
                    system: [{ text: prompt.systemPrompt }],
                    messages: [
                        ...prompt.fewShotTurns.flatMap((turn) => [
                            { role: 'user' as const, content: [{ text: turn.user }] },
                            { role: 'assistant' as const, content: [{ text: turn.assistant }] },
                        ]),
                        { role: 'user' as const, content: [{ text: prompt.userMessage }] },
                    ],
                    inferenceConfig: { temperature: prompt.temperature, maxTokens: prompt.maxOutputTokens },
                }),
            );
            const text = response.output?.message?.content?.map((piece) => piece.text ?? '').join('') ?? '';
            const reading = readFoodnessAnswer(text, response.stopReason ?? 'end_turn');

            if (reading.kind === 'judged') {
                return { isFood: reading.isFood, taxonomy: reading.taxonomy };
            }

            return { isFood: null, taxonomy: reading.reason };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (/Throttling|TooManyRequests|timeout|ECONN|503|429/i.test(message) && attempt < 5) {
                await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
                continue;
            }

            return { isFood: null, taxonomy: `ERROR:${message.slice(0, 60)}` };
        }
    }

    return { isFood: null, taxonomy: 'exhausted' };
}

const CONCURRENCY = 12;
let index = 0;
let processed = 0;

async function worker(): Promise<void> {
    for (;;) {
        const i = index;
        index += 1;

        if (i >= rows.length) {
            return;
        }

        const row = rows[i] as Row;

        if (done.has(row.word)) {
            continue;
        }

        const verdict = await judgeOnce(row.word);
        const correct = verdict.isFood === null ? 'NOJUDGE' : verdict.isFood === row.label ? 'OK' : 'WRONG';
        appendFileSync(
            out,
            [row.kind, correct, String(row.label), String(verdict.isFood), verdict.taxonomy, row.word].join('\t') +
                '\n',
        );
        processed += 1;

        if (processed % 500 === 0) {
            process.stdout.write(`  ${String(processed)} judged\n`);
        }
    }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
process.stdout.write(`done: ${String(processed)} new judgements -> ${out}\n`);
