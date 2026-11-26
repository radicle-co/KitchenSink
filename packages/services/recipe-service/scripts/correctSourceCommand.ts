/**
 * The staff source-correction command, as a function over its inputs (ADR-0100, `docs/runbooks/sourceCorrection.md`).
 *
 * @pattern Command — preview every id, confirm once, then one request per id
 *
 * The order is the safety: every id is READ first (`GET`), the table of what would change is printed, and NOTHING is sent until the
 * operator confirms it against the recipes the owner's confirmation names. Declining sends nothing. One request per id, one result
 * line per id, and a failing id does not stop the rest. The token and the reason are never printed.
 *
 * Everything outside it (the network, the prompt, the output) is passed in, so the whole flow runs against a stub.
 */
import {
    sourceCorrectionPreviewSchema,
    sourceCorrectionResponseSchema,
    type SourceCorrectionPreview,
    type SourceCorrectionRequest,
} from '../src/recipes/recipes.schema.js';

/** What the command is asked to do. */
export interface CorrectionInput {
    readonly baseUrl: string;
    /** The staff caller's session token. Never printed. */
    readonly token: string;
    readonly ownerAccountId: string;
    readonly answer: SourceCorrectionRequest['answer'];
    readonly ground: SourceCorrectionRequest['ground'];
    /** Kept by the service for audit. Never printed. */
    readonly reason: string;
    readonly recipeIds: readonly string[];
}

/** What the command reaches out to. */
export interface CorrectionDeps {
    readonly fetch: typeof fetch;
    readonly print: (line: string) => void;
    readonly confirm: (question: string) => Promise<boolean>;
}

/** How the run ended: `1` when any id could not be previewed or corrected. */
export interface CorrectionResult {
    readonly exitCode: 0 | 1;
}

/** The code of an error body, or `unknown`: the whole of what a failure line says. */
async function failureOf(response: Response): Promise<string> {
    const body: unknown = await response.json().catch(() => undefined);
    const code = typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : 'unknown';

    return `${String(response.status)} ${code}`;
}

/** The current answer as one phrase: its kind, and its citation in brackets when it has one. */
function answerLine(answer: SourceCorrectionPreview['answer']): string {
    if (answer === null) {
        return 'holds no source answer';
    }

    const citation = answer.citation === null ? '' : ` (${answer.citation})`;

    return `${answer.kind}${citation}`;
}

/** One preview line: the id, title, owner, current answer and visibility. */
function previewLine(id: string, preview: SourceCorrectionPreview): string {
    const answer = answerLine(preview.answer);

    return `${id} | ${preview.title} | owner ${preview.ownerAccountId} | ${answer} | ${preview.visibility}`;
}

/**
 * Read one recipe's preview and print its line.
 *
 * @returns `true` when the recipe holds an answer that can be corrected; `false` when it was skipped, with the reason printed.
 * @sideEffect Calls the API and prints.
 */
async function previewOne(id: string, input: CorrectionInput, deps: CorrectionDeps): Promise<boolean> {
    const response = await deps.fetch(
        `${endpointOf(input, id)}?ownerAccountId=${encodeURIComponent(input.ownerAccountId)}`,
        {
            headers: headersOf(input),
        },
    );

    if (!response.ok) {
        deps.print(`${id}: preview failed (${await failureOf(response)}), skipped`);

        return false;
    }

    const parsed = sourceCorrectionPreviewSchema.safeParse(await response.json().catch(() => undefined));

    if (!parsed.success) {
        deps.print(`${id}: preview unreadable, skipped`);

        return false;
    }

    deps.print(previewLine(id, parsed.data));

    if (parsed.data.answer === null) {
        deps.print(`${id}: skipped, it holds no source answer to correct`);

        return false;
    }

    return true;
}

/**
 * Send one correction and print its result line.
 *
 * @returns `true` when the service answered with a readable result.
 * @sideEffect Calls the API and prints.
 */
async function sendOne(id: string, input: CorrectionInput, deps: CorrectionDeps): Promise<boolean> {
    const response = await deps.fetch(endpointOf(input, id), {
        method: 'POST',
        headers: headersOf(input),
        body: JSON.stringify({
            ownerAccountId: input.ownerAccountId,
            answer: input.answer,
            ground: input.ground,
            reason: input.reason,
        } satisfies SourceCorrectionRequest),
    });

    if (!response.ok) {
        deps.print(`${id}: failed (${await failureOf(response)})`);

        return false;
    }

    const reply = sourceCorrectionResponseSchema.safeParse(await response.json().catch(() => undefined));

    if (!reply.success) {
        deps.print(`${id}: reply unreadable`);

        return false;
    }

    deps.print(`${id}: ${reply.data.result === 'applied' ? 'applied' : 'already so'}`);

    return true;
}

/** The request headers: the staff token and JSON. */
function headersOf(input: CorrectionInput): Record<string, string> {
    return { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' };
}

/** The correction endpoint of one recipe. */
function endpointOf(input: CorrectionInput, id: string): string {
    return `${input.baseUrl}/api/v1/recipes/${id}/source-correction`;
}

/**
 * Run a correction.
 *
 * @param input - The ids, the confirmed owner and the new answer.
 * @param deps - The network, the prompt and the output.
 * @returns The exit code.
 * @sideEffect Calls the API and prints; sends a correction only after `confirm` answers yes.
 */
export async function runCorrection(input: CorrectionInput, deps: CorrectionDeps): Promise<CorrectionResult> {
    const correctable: string[] = [];
    let failed = false;

    for (const id of input.recipeIds) {
        if (await previewOne(id, input, deps)) {
            correctable.push(id);
        } else {
            failed = true;
        }
    }

    if (correctable.length === 0) {
        deps.print('Nothing can be corrected.');

        return { exitCode: 1 };
    }

    const question = `Correct ${String(correctable.length)} recipe(s) to "${input.answer.kind}"? Check each line above against the owner's reply.`;

    if (!(await deps.confirm(question))) {
        deps.print('Nothing was sent.');

        return { exitCode: failed ? 1 : 0 };
    }

    for (const id of correctable) {
        if (!(await sendOne(id, input, deps))) {
            failed = true;
        }
    }

    return { exitCode: failed ? 1 : 0 };
}
