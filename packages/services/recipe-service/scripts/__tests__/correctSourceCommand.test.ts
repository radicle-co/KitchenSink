/**
 * The staff correction command (ADR-0100 runbook), against a STUBBED API. Every case reads the requests the stub saw, so a command
 * that sent before it was confirmed, sent after a decline, stopped at a failing id, or printed a wrong line fails here.
 */
import { describe, expect, it } from 'vitest';

import { runCorrection, type CorrectionDeps, type CorrectionInput } from '../correctSourceCommand.js';

const OWNER = '01JUOWNER000000000000000A1';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';

const INPUT: CorrectionInput = {
    baseUrl: 'https://recipe.example.com',
    token: 'staff-token',
    ownerAccountId: OWNER,
    answer: { kind: 'book', citation: 'Joy of Cooking' },
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'Owner asked by email.',
    recipeIds: [A, B],
};

const PREVIEW = (title: string) => ({
    title,
    ownerAccountId: OWNER,
    visibility: 'private',
    answer: { kind: 'webPage', citation: 'https://example.com/r' },
    sourceCorrected: false,
});

interface Seen {
    readonly method: string;
    readonly url: string;
    readonly auth: string | null;
    readonly body: unknown;
}

/** A stubbed API: `routes` answers `METHOD id` with a status and a body; anything else is a 404. */
function stub(routes: Record<string, { status: number; body: unknown }>) {
    const seen: Seen[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const id = /recipes\/([^/]+)\/source-correction/u.exec(url)?.[1] ?? '';
        const headers = new Headers(init?.headers);

        seen.push({
            method,
            url,
            auth: headers.get('authorization'),
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });

        const route = routes[`${method} ${id}`] ?? { status: 404, body: { code: 'RECIPE_NOT_FOUND', message: 'x' } };

        return new Response(JSON.stringify(route.body), { status: route.status });
    };

    return { seen, fetchStub };
}

function deps(fetchStub: typeof fetch, answer: boolean): CorrectionDeps & { printed: string[]; asked: string[] } {
    const printed: string[] = [];
    const asked: string[] = [];

    return {
        fetch: fetchStub,
        print: (line) => printed.push(line),
        confirm: async (question) => {
            asked.push(question);

            return answer;
        },
        printed,
        asked,
    };
}

const OK = {
    [`GET ${A}`]: { status: 200, body: PREVIEW('Soup') },
    [`GET ${B}`]: { status: 200, body: PREVIEW('Stew') },
    [`POST ${A}`]: { status: 200, body: { result: 'applied' } },
    [`POST ${B}`]: { status: 200, body: { result: 'unchanged' } },
};

describe('runCorrection', () => {
    it('previews EVERY id first, prints each title, owner, answer and visibility, and sends no correction until confirmed', async () => {
        const { seen, fetchStub } = stub(OK);
        const d = deps(fetchStub, false);

        await runCorrection(INPUT, d);

        expect(seen.map(({ method }) => method)).toEqual(['GET', 'GET']);
        expect(seen[0]?.url).toBe(
            `https://recipe.example.com/api/v1/recipes/${A}/source-correction?ownerAccountId=${OWNER}`,
        );

        const text = d.printed.join('\n');

        for (const expected of [A, 'Soup', 'Stew', OWNER, 'webPage', 'https://example.com/r', 'private']) {
            expect(text).toContain(expected);
        }
    });

    it('declining sends nothing and exits clean', async () => {
        const { seen, fetchStub } = stub(OK);
        const d = deps(fetchStub, false);

        const result = await runCorrection(INPUT, d);

        expect(seen.filter(({ method }) => method === 'POST')).toEqual([]);
        expect(result.exitCode).toBe(0);
        expect(d.printed.join('\n')).toContain('Nothing was sent.');
    });

    it('confirming sends ONE correction per id with the grant token and the confirmed owner, and prints one line per id', async () => {
        const { seen, fetchStub } = stub(OK);
        const d = deps(fetchStub, true);

        const result = await runCorrection(INPUT, d);
        const posts = seen.filter(({ method }) => method === 'POST');

        expect(posts).toHaveLength(2);
        expect(posts.map(({ auth }) => auth)).toEqual(['Bearer staff-token', 'Bearer staff-token']);
        expect(posts[0]?.body).toEqual({
            ownerAccountId: OWNER,
            answer: { kind: 'book', citation: 'Joy of Cooking' },
            ground: 'ownerConfirmedByAccountEmail',
            reason: 'Owner asked by email.',
        });
        expect(d.printed).toContain(`${A}: applied`);
        expect(d.printed).toContain(`${B}: already so`);
        expect(result.exitCode).toBe(0);
    });

    it('a failing id is reported with its code and does not stop the rest; the exit code says something failed', async () => {
        const { seen, fetchStub } = stub({
            ...OK,
            [`POST ${A}`]: { status: 403, body: { code: 'FORBIDDEN', message: 'no grant' } },
        });
        const d = deps(fetchStub, true);

        const result = await runCorrection(INPUT, d);

        expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(2);
        expect(d.printed).toContain(`${A}: failed (403 FORBIDDEN)`);
        expect(d.printed).toContain(`${B}: already so`);
        expect(result.exitCode).toBe(1);
    });

    it('an id whose preview fails is reported, is NOT corrected, and the others still are after confirmation', async () => {
        const { seen, fetchStub } = stub({
            ...OK,
            [`GET ${C}`]: { status: 404, body: { code: 'RECIPE_NOT_FOUND', message: 'x' } },
        });
        const d = deps(fetchStub, true);

        const result = await runCorrection({ ...INPUT, recipeIds: [A, C] }, d);

        expect(d.printed).toContain(`${C}: preview failed (404 RECIPE_NOT_FOUND), skipped`);
        expect(seen.filter(({ method }) => method === 'POST').map(({ url }) => url.includes(C))).toEqual([false]);
        expect(result.exitCode).toBe(1);
    });

    it('when no id can be corrected it asks nothing and sends nothing', async () => {
        const { seen, fetchStub } = stub({});
        const d = deps(fetchStub, true);

        const result = await runCorrection({ ...INPUT, recipeIds: [C] }, d);

        expect(d.asked).toEqual([]);
        expect(seen.filter(({ method }) => method === 'POST')).toEqual([]);
        expect(result.exitCode).toBe(1);
    });

    it('a recipe that holds no answer is shown as such and is not corrected', async () => {
        const { seen, fetchStub } = stub({
            ...OK,
            [`GET ${A}`]: { status: 200, body: { ...PREVIEW('Soup'), answer: null } },
        });
        const d = deps(fetchStub, true);

        await runCorrection({ ...INPUT, recipeIds: [A, B] }, d);

        expect(d.printed.join('\n')).toContain('holds no source answer');
        expect(seen.filter(({ method }) => method === 'POST').map(({ url }) => url.includes(A))).toEqual([false]);
    });

    it('never prints the token or the reason', async () => {
        const { fetchStub } = stub(OK);
        const d = deps(fetchStub, true);

        await runCorrection(INPUT, d);

        const text = d.printed.join('\n');

        expect(text).not.toContain('staff-token');
        expect(text).not.toContain('Owner asked by email.');
    });
});
