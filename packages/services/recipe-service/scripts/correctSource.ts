/**
 * `npm run correct-source --workspace=@kitchensink/recipe-service -- ...` — staff correct the confirmed source answer of one or more
 * recipes (ADR-0100). Read `docs/runbooks/sourceCorrection.md` first: the owner's request is confirmed through the mailbox challenge
 * BEFORE this runs, and the preview it prints is checked against the recipes the owner's reply names.
 *
 * The token is the staff caller's Clerk session token, read from `RECIPE_STAFF_TOKEN`. It is never taken from a flag, so it never
 * lands in shell history or a process list.
 *
 * @sideEffect Calls the recipe API, reads a line from the terminal, exits the process.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { SOURCE_CORRECTION_GROUNDS } from '@kitchensink/recipe-core';

import { sourceCorrectionRequestSchema } from '../src/recipes/recipes.schema.js';
import { runCorrection } from './correctSourceCommand.js';

const USAGE = `Usage: correct-source --base-url <url> --owner <accountId> --answer <authored|fromPerson|public_web|book|paid_site>
         [--citation <text or link>] [--ground ${SOURCE_CORRECTION_GROUNDS[0]}] --reason <text> <recipeId>...
Token: RECIPE_STAFF_TOKEN in the environment.`;

async function main(): Promise<number> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            'base-url': { type: 'string' },
            owner: { type: 'string' },
            answer: { type: 'string' },
            citation: { type: 'string' },
            ground: { type: 'string', default: SOURCE_CORRECTION_GROUNDS[0] },
            reason: { type: 'string' },
        },
    });
    const token = process.env['RECIPE_STAFF_TOKEN'];

    if (token === undefined || token === '' || values['base-url'] === undefined || positionals.length === 0) {
        console.error(USAGE);

        return 2;
    }

    // The same schema the service applies, so a bad answer is refused here, before any request.
    const parsed = sourceCorrectionRequestSchema.safeParse({
        ownerAccountId: values.owner,
        answer: { kind: values.answer, ...(values.citation === undefined ? {} : { citation: values.citation }) },
        ground: values.ground,
        reason: values.reason,
    });

    if (!parsed.success) {
        console.error(
            `${USAGE}\n${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')}`,
        );

        return 2;
    }

    const terminal = createInterface({ input: process.stdin, output: process.stdout });

    try {
        const { exitCode } = await runCorrection(
            {
                baseUrl: values['base-url'].replace(/\/$/u, ''),
                token,
                ownerAccountId: parsed.data.ownerAccountId,
                answer: parsed.data.answer,
                ground: parsed.data.ground,
                reason: parsed.data.reason,
                recipeIds: positionals,
            },
            {
                fetch,
                print: (line) => console.log(line),
                confirm: async (question) =>
                    (await terminal.question(`${question} Type "yes" to apply: `)).trim() === 'yes',
            },
        );

        return exitCode;
    } finally {
        terminal.close();
    }
}

process.exitCode = await main();
