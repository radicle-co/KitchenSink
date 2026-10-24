/**
 * `ensureRemoteProbeWords` through the REAL `FoodServiceClient` over a mocked NDJSON body (owner ruling 2026-10-18).
 *
 * What a unit test of the planner cannot prove, and this does: that the client's real NDJSON reader, folded with its
 * own `withProgressiveFrame`, produces the observations the planner judges; that the term on the wire is the CANONICAL
 * one (the device's cache key); that a busy source is asked again, the same term, after its wait; that the search
 * budget stops a source that never answers; and that provision fails with the error the ruling asks for.
 *
 * It does NOT prove USDA answers as the candidates assume: only a run against a deployed stage does, which is the point
 * of choosing the words there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FoodServiceClient } from '@kitchensink/food-service-client';

import {
    MAX_PROBE_SEARCHES,
    ensureRemoteProbeWords,
    probePortOver,
    type EnsureRemoteProbeWordsDeps,
} from '../src/ensureRemoteProbeWords.js';
import { isRemoteProbeExhaustedError } from '../src/remoteProbeExhaustedError.js';
import { NO_MATCH_FOOD_NAME, candidatesFor } from '../src/remoteProbeWords.js';

/** The no-match name as the client sends it (lowercased), named once so the fake world follows the constant. */
const NO_MATCH_TERM = NO_MATCH_FOOD_NAME.toLowerCase();

const BASE = 'https://food.example.test';
const STAGE = 'pr-91';
const RUN_KEY = 'run-abc';
const candidates = candidatesFor('android');

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const database = (catalog: number, authored = 0): string =>
    line({
        type: 'database',
        catalog: {
            outcome: 'answered',
            results: Array.from({ length: catalog }, (_, index) => ({ id: `c${String(index)}`, name: 'C', score: 1 })),
        },
        authored: {
            outcome: 'answered',
            results: Array.from({ length: authored }, (_, index) => ({ id: `a${String(index)}`, name: 'A', score: 1 })),
        },
    });
const usda = (...names: string[]): string =>
    line({
        type: 'source',
        source: 'usda',
        outcome: 'answered',
        items: names.map((name) => ({ name, reference: `ref-${name}` })),
    });
const busy = (seconds: number): string =>
    line({ type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: seconds });
const COMPLETE = line({ type: 'complete' });
const body = (...parts: string[]): string => [...parts, COMPLETE].join('');
const THREE = (first: string): string => usda(first, 'Second thing', 'Third thing');
/** The android ambiguity role's first candidate, named once so the fake world follows the list. */
const AMBIGUITY_FIRST = candidates.ambiguity[0] ?? '';

/** The progressive terms asked, in order, as they went on the wire. */
let asked: string[];
/** The signer's own foods, by name. */
let authoredFoods: string[];
let sleeps: number[];
let logs: string[];

/** A client whose progressive route answers with `answerFor(term, nth)`; `authored/search` reads `authoredFoods`. */
function clientAnswering(answerFor: (term: string, nth: number) => Response | string): FoodServiceClient {
    const fetchDouble = vi.fn(async (url: string) => {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith('/health')) {
            return new Response(null, { status: 404 });
        }

        const term = parsed.searchParams.get('query') ?? '';

        if (parsed.pathname.endsWith('/foods/authored/search')) {
            return Response.json({
                results: authoredFoods
                    .filter((name) => name.includes(term))
                    .map((name) => ({ id: name, name, score: 1 })),
            });
        }

        asked.push(term);

        const answer = answerFor(term, asked.filter((each) => each === term).length);

        return typeof answer === 'string'
            ? new Response(answer, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } })
            : answer;
    });

    return new FoodServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchDouble as unknown as typeof fetch });
}

function depsOver(food: FoodServiceClient): EnsureRemoteProbeWordsDeps {
    return {
        port: probePortOver(food, Date.now),
        now: Date.now,
        sleep: async (milliseconds) => {
            // Never really sleeps. The clock stays real because the client reads `Date.now` for a frame's `retryAt`.
            sleeps.push(milliseconds);
        },
        authorFood: async (name) => {
            authoredFoods.push(name);
        },
        log: (text) => logs.push(text),
    };
}

const run = (food: FoodServiceClient) =>
    ensureRemoteProbeWords(depsOver(food), { candidates, runKey: RUN_KEY, stage: STAGE });

beforeEach(() => {
    asked = [];
    authoredFoods = [];
    sleeps = [];
    logs = [];
});

describe('ensureRemoteProbeWords — the choice', () => {
    it('asks each role once when the first candidate answers right, and stops (early stop)', async () => {
        const food = clientAnswering((term) =>
            term === 'paneer'
                ? body(database(0), THREE('Paneer, fresh'))
                : term === 'gochujang'
                  ? body(database(0), THREE('Gochujang sauce'))
                  : term === 'halloumi'
                    ? body(database(0), THREE('Halloumi cheese'))
                    : term === AMBIGUITY_FIRST
                      ? body(database(0), usda(`${AMBIGUITY_FIRST} seasoning`, 'Rice wine'))
                      : body(database(0), usda()),
        );

        const words = await run(food);

        expect(words).toEqual({
            appendWord: 'paneer',
            appendFood: 'paneer run-abc',
            changeWord: 'gochujang',
            unresolvedWord: 'halloumi',
            ambiguityWord: AMBIGUITY_FIRST,
            noMatchFood: NO_MATCH_FOOD_NAME,
        });
        // The canonical (lowercase) term, as the device's search puts it on the wire; nothing past the first winner.
        expect(asked).toEqual(['paneer', 'gochujang', 'halloumi', AMBIGUITY_FIRST, NO_MATCH_TERM]);
    });

    it('authors the append food as the signer AFTER the word is chosen, and confirms it with the authored search', async () => {
        const food = clientAnswering((term) =>
            term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} thing`)),
        );

        await run(food);

        expect(authoredFoods).toEqual(['paneer run-abc']);
        expect(logs.some((each) => each.includes('::warning::'))).toBe(false);
    });

    it('falls back past a rejected word and prints a ::warning:: naming it and why', async () => {
        const food = clientAnswering((term) => {
            if (term === 'paneer') {
                return body(database(0), usda('Only one'));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        const words = await run(food);

        expect(words.appendWord).toBe('tahini');
        expect(logs.find((each) => each.startsWith('::warning::'))).toContain('paneer (too-few-usda-items)');
    });

    it('rejects a change word whose FIRST food does not name it', async () => {
        const food = clientAnswering((term) => {
            if (term === 'gochujang') {
                return body(database(0), usda('Sauce', 'Gochujang paste', 'Gochujang red'));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        expect((await run(food)).changeWord).toBe('harissa');
    });
});

describe('ensureRemoteProbeWords — unresolved has no fallback and cannot complete the placeholder', () => {
    it('fails provision when a shown food would COMPLETE the "Find nutrition" placeholder, and tries no other word', async () => {
        const food = clientAnswering((term) =>
            term === 'halloumi'
                ? body(database(0), usda('Cheese, other', 'HALLOUMI', 'Third thing'))
                : term === NO_MATCH_TERM
                  ? body(database(0), usda())
                  : body(database(0), THREE(`${term} x`)),
        );

        const failure = await run(food).catch((error: unknown) => error);

        expect(isRemoteProbeExhaustedError(failure)).toBe(true);
        expect(failure).toMatchObject({
            role: 'unresolved',
            rejections: [{ word: 'halloumi', reason: 'item-would-complete-placeholder' }],
        });
        expect(asked.filter((term) => term === 'halloumi')).toHaveLength(1);
        expect(asked).not.toContain(NO_MATCH_TERM);
    });

    it('fails provision when our database already holds the word (the line would bind, not land UNRESOLVED)', async () => {
        const food = clientAnswering((term) =>
            term === 'halloumi' ? body(database(1), THREE('Halloumi cheese')) : body(database(0), THREE(`${term} x`)),
        );

        const failure = await run(food).catch((error: unknown) => error);

        expect(failure).toMatchObject({
            role: 'unresolved',
            rejections: [{ word: 'halloumi', reason: 'catalog-holds-matches' }],
        });
    });

    it('still retries a busy source for the unresolved word instead of failing it', async () => {
        const food = clientAnswering((term, nth) => {
            if (term === 'halloumi' && nth === 1) {
                return body(database(0), busy(1));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        expect((await run(food)).unresolvedWord).toBe('halloumi');
    });
});

/**
 * `recipes/ambiguityReview` makes its lines from the ambiguity word and picks a USDA food in each of its two legs, so the
 * word needs two shown foods, and a pick it makes must be one the purge can take back.
 */
describe('ensureRemoteProbeWords — the ambiguity word', () => {
    it('falls back past a word whose shown food would complete a placeholder, and warns naming it and why', async () => {
        const second = candidates.ambiguity[1] ?? '';
        const food = clientAnswering((term) => {
            if (term === AMBIGUITY_FIRST) {
                return body(database(0), usda('Seasoning, other', AMBIGUITY_FIRST.toUpperCase()));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        const words = await run(food);

        expect(words.ambiguityWord).toBe(second);
        expect(logs.find((each) => each.startsWith('::warning::') && each.includes('ambiguity'))).toContain(
            `${AMBIGUITY_FIRST} (item-would-complete-placeholder)`,
        );
    });

    it('takes a word with only two USDA foods and a catalog that already matches it', async () => {
        const food = clientAnswering((term) => {
            if (term === AMBIGUITY_FIRST) {
                return body(database(3), usda(`${AMBIGUITY_FIRST} seasoning`, 'Rice wine'));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        expect((await run(food)).ambiguityWord).toBe(AMBIGUITY_FIRST);
    });

    it('fails provision, naming the role and every word, when no candidate shows two USDA foods', async () => {
        const food = clientAnswering((term) => {
            if (candidates.ambiguity.includes(term)) {
                return body(database(0), usda(`${term} only`));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        const failure = await run(food).catch((error: unknown) => error);

        expect(isRemoteProbeExhaustedError(failure)).toBe(true);
        expect(failure).toMatchObject({
            role: 'ambiguity',
            exhaustion: 'candidates',
            rejections: candidates.ambiguity.map((word) => ({ word, reason: 'too-few-usda-items' })),
        });
        expect(asked).not.toContain(NO_MATCH_TERM);
    });
});

describe('ensureRemoteProbeWords — transient outcomes never reject a word', () => {
    it('asks a busy source again, the SAME term, after its retry wait', async () => {
        const food = clientAnswering((term, nth) => {
            if (term === 'paneer' && nth === 1) {
                return body(database(0), busy(7));
            }

            return term === NO_MATCH_TERM ? body(database(0), usda()) : body(database(0), THREE(`${term} x`));
        });

        const words = await run(food);

        expect(words.appendWord).toBe('paneer');
        expect(asked.slice(0, 2)).toEqual(['paneer', 'paneer']);
        expect(sleeps).toHaveLength(1);
        // The wait ends where the frame said (7 s after it arrived), not at a default or at the cap.
        expect(sleeps[0]).toBeGreaterThan(5_000);
        expect(sleeps[0]).toBeLessThanOrEqual(7_000);
    });

    it('stops at the search budget when a source never answers, and says so', async () => {
        const food = clientAnswering(() => body(database(0), busy(1)));

        const failure = await run(food).catch((error: unknown) => error);

        expect(isRemoteProbeExhaustedError(failure)).toBe(true);
        expect(failure).toMatchObject({ role: 'append', exhaustion: 'search-budget', rejections: [] });
        expect(asked).toHaveLength(MAX_PROBE_SEARCHES);
    });

    it('counts a refusal sent before any request against the budget too, so a held window cannot spin forever', async () => {
        const food = clientAnswering(
            () =>
                new Response(
                    JSON.stringify({
                        code: 'SEARCH_RATE_LIMITED',
                        message: 'limit',
                        details: { retryAfterSeconds: 30 },
                    }),
                    { status: 429, headers: { 'content-type': 'application/json' } },
                ),
        );

        const failure = await run(food).catch((error: unknown) => error);

        expect(failure).toMatchObject({ exhaustion: 'search-budget' });
        // Only the first reached the wire: the client holds the window itself and sends nothing while it is held.
        expect(asked).toHaveLength(1);
    });
});

describe('ensureRemoteProbeWords — exhaustion fails provision', () => {
    it('throws RemoteProbeExhaustedError naming the role, every rejected word with its reason, and the stage', async () => {
        const food = clientAnswering(() => body(database(0), usda('One')));

        const failure = await run(food).catch((error: unknown) => error);

        expect(isRemoteProbeExhaustedError(failure)).toBe(true);
        expect(failure).toMatchObject({ role: 'append', stage: STAGE, exhaustion: 'candidates' });
        expect((failure as Error).message).toContain('"append"');
        expect((failure as Error).message).toContain(STAGE);

        for (const word of candidates.append) {
            expect((failure as Error).message).toContain(`${word} (too-few-usda-items)`);
        }

        expect(asked).toEqual([...candidates.append]);
    });

    it('fails when an authored food named for the no-match name is still there (the last purge did not finish)', async () => {
        const food = clientAnswering((term) => {
            if (term === NO_MATCH_TERM) {
                return body(database(0, 1), usda());
            }

            return body(database(0), THREE(`${term} x`));
        });

        const failure = await run(food).catch((error: unknown) => error);

        expect(failure).toMatchObject({
            role: 'noMatch',
            rejections: [{ word: NO_MATCH_FOOD_NAME, reason: 'authored-food-present' }],
        });
    });
});
