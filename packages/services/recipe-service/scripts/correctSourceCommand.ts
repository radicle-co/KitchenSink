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
import type {
    SourceCorrectionPreview,
    SourceCorrectionRequest,
    SourceCorrectionResponse,
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

    return `${response.status} ${code}`;
}

/** One preview line: the id, title, owner, current answer and visibility. */
function previewLine(id: string, preview: SourceCorrectionPreview): string {
    const answer =
        preview.answer === null
            ? 'holds no source answer'
            : `${preview.answer.kind}${preview.answer.citation === null ? '' : ` (${preview.answer.citation})`}`;

    return `${id} | ${preview.title} | owner ${preview.ownerAccountId} | ${answer} | ${preview.visibility}`;
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
    const { baseUrl, token, ownerAccountId, recipeIds } = input;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const endpoint = (id: string) => `${baseUrl}/api/v1/recipes/${id}/source-correction`;
    const correctable: string[] = [];
    let failed = false;

    for (const id of recipeIds) {
        const response = await deps.fetch(`${endpoint(id)}?ownerAccountId=${encodeURIComponent(ownerAccountId)}`, {
            headers,
        });

        if (!response.ok) {
            failed = true;
            deps.print(`${id}: preview failed (${await failureOf(response)}), skipped`);

            continue;
        }

        const preview = (await response.json()) as SourceCorrectionPreview;

        deps.print(previewLine(id, preview));

        if (preview.answer === null) {
            failed = true;
            deps.print(`${id}: skipped, it holds no source answer to correct`);

            continue;
        }

        correctable.push(id);
    }

    if (correctable.length === 0) {
        deps.print('Nothing can be corrected.');

        return { exitCode: 1 };
    }

    if (
        !(await deps.confirm(
            `Correct ${correctable.length} recipe(s) to "${input.answer.kind}"? Check each line above against the owner's reply.`,
        ))
    ) {
        deps.print('Nothing was sent.');

        return { exitCode: failed ? 1 : 0 };
    }

    for (const id of correctable) {
        const response = await deps.fetch(endpoint(id), {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ownerAccountId,
                answer: input.answer,
                ground: input.ground,
                reason: input.reason,
            } satisfies SourceCorrectionRequest),
        });

        if (!response.ok) {
            failed = true;
            deps.print(`${id}: failed (${await failureOf(response)})`);

            continue;
        }

        const { result } = (await response.json()) as SourceCorrectionResponse;

        deps.print(`${id}: ${result === 'applied' ? 'applied' : 'already so'}`);
    }

    return { exitCode: failed ? 1 : 0 };
}
