/**
 * The remote probe words (owner ruling 2026-10-18): chosen and verified at SEED time, so catalog growth fails provision
 * loudly instead of silently breaking a Maestro flow.
 *
 * Everything here is pure, so each rule is a truth table: a predicate is asserted on BOTH sides of its boundary (two
 * items and three, a first item with the word and without), because a test that only shows the accepted case would
 * still pass if the rule were deleted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EMPTY_PROGRESSIVE_ANSWER, withProgressiveFrame } from '@kitchensink/food-service-client';
import type { ProgressiveAnswer, ProgressiveFrame } from '@kitchensink/food-service-client';

import { MAX_PROBE_SEARCHES } from '../src/ensureRemoteProbeWords.js';
import {
    AMBIGUITY_GATE_MEASUREMENT,
    SEED_WORLD,
    UNATTACHED_PROBE_INGREDIENT,
    CAP_FOOD_BASE_NAME,
    deriveAmbiguityProbe,
    deriveFixtureManifest,
} from '../src/fixtureManifest.js';
import {
    LEXICAL_SYNONYM_KEYS,
    MIN_AMBIGUITY_USDA_ITEMS,
    NO_MATCH_FOOD_NAME,
    PROBE_CANDIDATES,
    PROBE_ROLES,
    RESERVED_WORDS,
    candidatesFor,
    judgeProbe,
    observationOf,
    planNextProbe,
    type ObservedProbes,
    type ProbeObservation,
    type ProbeRole,
} from '../src/remoteProbeWords.js';

const answered = (items: readonly string[], catalogCount = 0, authoredCount = 0): ProbeObservation => ({
    kind: 'answered',
    catalogCount,
    authoredCount,
    items,
});
const names = (count: number, first = 'Thing'): readonly string[] =>
    Array.from({ length: count }, (_, index) => (index === 0 ? first : `Other ${String(index)}`));

describe('judgeProbe', () => {
    describe('append: at least three USDA items shown', () => {
        it.each([
            [2, 'rejected'],
            [3, 'accepted'],
            [10, 'accepted'],
        ] as const)('%i items is %s', (count, kind) => {
            expect(judgeProbe('append', 'paneer', answered(names(count))).kind).toBe(kind);
        });

        it('names the reason it rejects', () => {
            expect(judgeProbe('append', 'paneer', answered([]))).toEqual({
                kind: 'rejected',
                reason: 'too-few-usda-items',
            });
        });

        it('does not care what the database groups hold', () => {
            expect(judgeProbe('append', 'paneer', answered(names(3), 4, 2)).kind).toBe('accepted');
        });
    });

    describe('change: three shown AND the first item names the word', () => {
        it.each([
            ['Cheese, PANEER, fresh', 3, 'accepted'],
            ['Cheese, other', 3, 'rejected'],
            ['Cheese, paneer', 2, 'rejected'],
        ] as const)('first item %s with %i shown is %s', (first, count, kind) => {
            expect(judgeProbe('change', 'paneer', answered(names(count, first))).kind).toBe(kind);
        });

        it('rejects a word that only a LATER item carries, because the flow taps index 0', () => {
            expect(judgeProbe('change', 'paneer', answered(['Cheese, other', 'Paneer', 'Paneer 2']))).toEqual({
                kind: 'rejected',
                reason: 'first-item-lacks-word',
            });
        });

        it('reports too few items before it reports the first item', () => {
            expect(judgeProbe('change', 'paneer', answered(['Cheese, other'])).kind).toBe('rejected');
            expect(judgeProbe('change', 'paneer', answered(['Cheese, other']))).toEqual({
                kind: 'rejected',
                reason: 'too-few-usda-items',
            });
        });
    });

    describe('unresolved: nothing in our database, three or more USDA foods, and no food that would complete the placeholder', () => {
        const some = names(3, 'Cheese, halloumi, grilled');

        it('accepts empty catalog and authored groups with three foods that do not carry the word as their whole name', () => {
            expect(judgeProbe('unresolved', 'halloumi', answered(some)).kind).toBe('accepted');
        });

        it.each([
            [answered(some, 1, 0), 'catalog-holds-matches'],
            [answered(some, 0, 1), 'authored-food-present'],
            [answered(names(2, 'Cheese, halloumi'), 0, 0), 'too-few-usda-items'],
            [answered([], 0, 0), 'too-few-usda-items'],
        ] as const)('observation %# is rejected as %s', (observation, reason) => {
            expect(judgeProbe('unresolved', 'halloumi', observation)).toEqual({ kind: 'rejected', reason });
        });

        /**
         * ⛔ Owner ruling 2026-10-18 (Q3). "Find nutrition for halloumi" leaves a PENDING catalog root named `halloumi`.
         * A pick whose root name equals that key COMPLETES it, which is never attributed and never purged, so the
         * next run binds the word and the line never lands UNRESOLVED. A pick under any other name takes the insert
         * path, which is attributed and purgeable.
         */
        it.each([['Halloumi'], ['HALLOUMI'], ['  halloumi  '], ['halloumi']])(
            'rejects a shown food %j whose root key equals the word',
            (name) => {
                expect(judgeProbe('unresolved', 'halloumi', answered(['Cheese, other', name, 'Third thing']))).toEqual({
                    kind: 'rejected',
                    reason: 'item-would-complete-placeholder',
                });
            },
        );

        it('rejects it when the equal food is not the first one shown, because any shown food may be picked', () => {
            expect(judgeProbe('unresolved', 'halloumi', answered(['A thing', 'B thing', 'Halloumi'])).kind).toBe(
                'rejected',
            );
        });

        it('does NOT reject a food that merely contains the word', () => {
            expect(judgeProbe('unresolved', 'halloumi', answered(['Halloumi cheese', 'x', 'y'])).kind).toBe('accepted');
        });

        it.each([['Hal\u200bloumi'], ['halloumi\u00a0'], ['Halloumi\t']])(
            'compares the SANITISED name, as the pick does, so %j cannot hide an equal key',
            (name) => {
                expect(judgeProbe('unresolved', 'halloumi', answered([name, 'x', 'y'])).kind).toBe('rejected');
            },
        );

        it('does not reject a name that only differs by punctuation, because the sanitiser keeps it', () => {
            expect(judgeProbe('unresolved', 'halloumi', answered(['Halloumi,', 'x', 'y'])).kind).toBe('accepted');
        });
    });

    /**
     * `recipes/ambiguityReview` makes its two lines from this word (`deriveAmbiguityProbe`), each bound to the signer's
     * own food of that name, and picks a USDA food in EACH of its two legs. A pick adopts its hit into the catalog, and
     * the search then hides it (`remoteHitTriage.ts`), so the second leg needs a second food.
     */
    describe('ambiguity: no authored food, two or more USDA foods, and none that would complete a placeholder', () => {
        it('needs exactly two shown foods, one per leg', () => {
            expect(MIN_AMBIGUITY_USDA_ITEMS).toBe(2);
        });

        it.each([
            [0, 'rejected'],
            [1, 'rejected'],
            [2, 'accepted'],
            [9, 'accepted'],
        ] as const)('%i shown foods is %s', (count, kind) => {
            expect(judgeProbe('ambiguity', 'mirin', answered(names(count, 'Mirin seasoning'))).kind).toBe(kind);
        });

        it('names too few foods as the reason', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(['Mirin seasoning']))).toEqual({
                kind: 'rejected',
                reason: 'too-few-usda-items',
            });
        });

        it('rejects an authored food still there, because the last purge did not finish', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(names(5, 'Mirin seasoning'), 0, 1))).toEqual({
                kind: 'rejected',
                reason: 'authored-food-present',
            });
        });

        /** The lines are bound to an authored food, so a catalog match changes nothing the flow reads. */
        it('does NOT reject a word the catalog already matches', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(names(2, 'Mirin seasoning'), 4, 0)).kind).toBe('accepted');
        });

        /** The flow taps index 0 of `, from USDA`, then reads only the saved sentence and the count: never a name. */
        it('does NOT need the first food to name the word', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(['Rice wine seasoning', 'Other'])).kind).toBe('accepted');
        });

        /**
         * Only the foods the two legs TAP: leg 1 taps index 0, and its pick hides that hit, so leg 2's index 0 is the
         * food shown second. The catalog part lists RESOLVED roots only, so a placeholder is invisible to the probe, and
         * the exact-name check stands in for it on exactly the foods that can be picked.
         */
        it.each([['Mirin'], ['MIRIN'], ['  mirin  '], ['Mi\u200brin']])(
            'rejects a first-shown food %j whose root key equals the word, because leg 1 taps it',
            (name) => {
                expect(judgeProbe('ambiguity', 'mirin', answered([name, 'Aji-mirin', 'Other']))).toEqual({
                    kind: 'rejected',
                    reason: 'item-would-complete-placeholder',
                });
            },
        );

        it('rejects a second-shown food named the word, because leg 2 taps it once leg 1’s pick is hidden', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(['Aji-mirin', 'MIRIN', 'Other']))).toEqual({
                kind: 'rejected',
                reason: 'item-would-complete-placeholder',
            });
        });

        it('ACCEPTS a word whose only exact-name food is shown third, which no leg taps', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(['Aji-mirin', 'Mirin seasoning', 'MIRIN'])).kind).toBe(
                'accepted',
            );
        });

        it('does NOT reject a food that merely contains the word', () => {
            expect(judgeProbe('ambiguity', 'mirin', answered(['Mirin seasoning', 'Aji-mirin'])).kind).toBe('accepted');
        });
    });

    describe('noMatch: the source ANSWERED with nothing and both database groups are empty', () => {
        it.each([
            [answered([], 0, 0), 'accepted'],
            [answered(['A'], 0, 0), 'rejected'],
            [answered([], 1, 0), 'rejected'],
            [answered([], 0, 1), 'rejected'],
        ] as const)('observation %# is %s', (observation, kind) => {
            expect(judgeProbe('noMatch', NO_MATCH_FOOD_NAME, observation).kind).toBe(kind);
        });

        it('names an authored food that is still there as the reason, because the last purge did not finish', () => {
            expect(judgeProbe('noMatch', NO_MATCH_FOOD_NAME, answered([], 0, 1))).toEqual({
                kind: 'rejected',
                reason: 'authored-food-present',
            });
        });
    });

    describe('a transient outcome never rejects a word', () => {
        it.each(PROBE_ROLES)('%s: busy, limited and unavailable are undecided', (role) => {
            for (const cause of ['busy', 'limited', 'unavailable'] as const) {
                expect(judgeProbe(role, 'paneer', { kind: 'transient', cause })).toEqual({
                    kind: 'undecided',
                    cause,
                });
            }
        });
    });
});

describe('planNextProbe', () => {
    const candidates = {
        append: ['aaa', 'bbb'],
        change: ['ccc', 'ddd'],
        unresolved: ['hhh'],
        ambiguity: ['mmm', 'nnn'],
        noMatch: ['zzz'],
    } as const;
    const good: ProbeObservation = answered(['aaa x', 'b', 'c']);
    const bad: ProbeObservation = answered([]);

    it('starts with the first candidate of the first role', () => {
        expect(planNextProbe(candidates, {})).toEqual({ kind: 'search', role: 'append', term: 'aaa' });
    });

    it('stops at the first accepted word and never looks at a later candidate', () => {
        const plan = planNextProbe(candidates, { append: { aaa: good } });

        expect(plan).toEqual({ kind: 'search', role: 'change', term: 'ccc' });
    });

    it('falls to the next candidate when one is rejected', () => {
        expect(planNextProbe(candidates, { append: { aaa: bad } })).toEqual({
            kind: 'search',
            role: 'append',
            term: 'bbb',
        });
    });

    it('asks the SAME term again while its outcome is transient', () => {
        expect(planNextProbe(candidates, { append: { aaa: { kind: 'transient', cause: 'busy' } } })).toEqual({
            kind: 'search',
            role: 'append',
            term: 'aaa',
        });
    });

    it('reports exhaustion with every rejected word and its reason', () => {
        const observed: ObservedProbes = { append: { aaa: bad, bbb: answered(['x']) } };

        expect(planNextProbe(candidates, observed)).toEqual({
            kind: 'exhausted',
            role: 'append',
            rejections: [
                { word: 'aaa', reason: 'too-few-usda-items' },
                { word: 'bbb', reason: 'too-few-usda-items' },
            ],
        });
    });

    it('does not call a role exhausted while one candidate is still unasked', () => {
        expect(planNextProbe(candidates, { append: { aaa: bad } }).kind).toBe('search');
    });

    it('fails hard on the first unresolved candidate: that role has no fallback', () => {
        const hard = { ...candidates, unresolved: ['hhh'] };
        const observed: ObservedProbes = {
            append: { aaa: good },
            change: { ccc: answered(['CCC thing', 'b', 'c']) },
            unresolved: { hhh: answered(['Hhh', 'b', 'c']) },
        };

        expect(planNextProbe(hard, observed)).toEqual({
            kind: 'exhausted',
            role: 'unresolved',
            rejections: [{ word: 'hhh', reason: 'item-would-complete-placeholder' }],
        });
    });

    it('chooses one word per role once every role has an accepted one', () => {
        const observed: ObservedProbes = {
            append: { aaa: bad, bbb: good },
            change: { ccc: answered(['CCC thing', 'b', 'c']) },
            unresolved: { hhh: answered(['x', 'y', 'z']) },
            ambiguity: { mmm: answered(['Mmm', 'b']), nnn: answered(['n x', 'b']) },
            noMatch: { zzz: answered([]) },
        };

        expect(planNextProbe(candidates, observed)).toEqual({
            kind: 'chosen',
            words: { append: 'bbb', change: 'ccc', unresolved: 'hhh', ambiguity: 'nnn', noMatch: 'zzz' },
        });
    });

    it('falls back past an ambiguity word whose shown food would complete a placeholder', () => {
        const observed: ObservedProbes = {
            append: { aaa: good },
            change: { ccc: answered(['CCC thing', 'b', 'c']) },
            unresolved: { hhh: answered(['x', 'y', 'z']) },
            ambiguity: { mmm: answered(['MMM', 'b']) },
        };

        expect(planNextProbe(candidates, observed)).toEqual({ kind: 'search', role: 'ambiguity', term: 'nnn' });
    });

    it('never chooses a word whose latest outcome is transient', () => {
        const observed: ObservedProbes = {
            append: { aaa: good },
            change: { ccc: answered(['CCC thing', 'b', 'c']) },
            unresolved: { hhh: answered(['x', 'y', 'z']) },
            ambiguity: { mmm: answered(['m x', 'b']) },
            noMatch: { zzz: { kind: 'transient', cause: 'limited' } },
        };

        expect(planNextProbe(candidates, observed)).toEqual({ kind: 'search', role: 'noMatch', term: 'zzz' });
    });
});

describe('observationOf', () => {
    const frames = (...list: ProgressiveFrame[]): ProgressiveAnswer =>
        list.reduce(withProgressiveFrame, EMPTY_PROGRESSIVE_ANSWER);
    const database: ProgressiveFrame = {
        type: 'database',
        catalog: { outcome: 'answered', results: [] },
        authored: { outcome: 'answered', results: [] },
    };
    const usda = (items: readonly string[]): ProgressiveFrame => ({
        type: 'source',
        source: 'usda',
        outcome: 'answered',
        items: items.map((name) => ({ name, reference: `ref-${name}` })),
    });

    it('counts the database groups and lists the USDA names in the order shown', () => {
        expect(observationOf(frames(database, usda(['B', 'A']), { type: 'complete' }))).toEqual(answered(['B', 'A']));
    });

    it('counts what each database group showed', () => {
        const held: ProgressiveFrame = {
            type: 'database',
            catalog: { outcome: 'answered', results: [{ id: 'f1', name: 'Paneer', score: 1 }] },
            authored: {
                outcome: 'answered',
                results: [
                    { id: 'a1', name: 'Mine', score: 1 },
                    { id: 'a2', name: 'Mine 2', score: 1 },
                ],
            },
        };

        expect(observationOf(frames(held, usda([]), { type: 'complete' }))).toEqual(answered([], 1, 2));
    });

    it('is transient while the stream has not completed', () => {
        expect(observationOf(frames(database, usda(['A'])))).toEqual({ kind: 'transient', cause: 'unavailable' });
    });

    it('is transient when the database could not be read, because an unread group is not an empty one', () => {
        const unread = frames(
            { type: 'database', catalog: { outcome: 'unavailable' }, authored: { outcome: 'answered', results: [] } },
            usda([]),
            { type: 'complete' },
        );

        expect(observationOf(unread)).toEqual({ kind: 'transient', cause: 'unavailable' });
    });

    it.each(['busy', 'limited'] as const)('carries when a %s source may be asked again', (outcome) => {
        const answer = frames(
            database,
            { type: 'source', source: 'usda', outcome, retryAt: 5_000 },
            { type: 'complete' },
        );

        expect(observationOf(answer)).toEqual({ kind: 'transient', cause: outcome, retryAt: 5_000 });
    });

    it('is transient when USDA sent no frame at all', () => {
        expect(observationOf(frames(database, { type: 'complete' }))).toEqual({
            kind: 'transient',
            cause: 'unavailable',
        });
    });
});

describe('the candidate lists', () => {
    const wordsOf = (platform: 'android' | 'ios'): readonly string[] => [
        ...PROBE_CANDIDATES[platform].append,
        ...PROBE_CANDIDATES[platform].change,
        ...PROBE_CANDIDATES[platform].unresolved,
        ...PROBE_CANDIDATES[platform].ambiguity,
    ];
    /** The ambiguity probe as a reset makes it from a word: its lines' source lines are fixed, its food is the word. */
    const probeFor = (word: string) => deriveAmbiguityProbe(deriveFixtureManifest('run-1', 'android', 1), word);
    const sourceLineWords = (word: string): readonly string[] =>
        probeFor(word)
            .ingredients.flatMap((line) => (line.sourceLine ?? '').toLowerCase().split(/[^a-z]+/u))
            .filter((each) => each !== '');

    it('hands each platform its own lists plus the shared no-match name', () => {
        expect(candidatesFor('ios')).toEqual({ ...PROBE_CANDIDATES.ios, noMatch: [NO_MATCH_FOOD_NAME] });
    });

    it('shares no word between android and ios, so two lanes never search the same word at once', () => {
        const android = new Set(wordsOf('android'));

        expect(wordsOf('ios').filter((word) => android.has(word))).toEqual([]);
    });

    it.each(['android', 'ios'] as const)('%s: no word appears twice, or in both roles', (platform) => {
        expect(new Set(wordsOf(platform)).size).toBe(wordsOf(platform).length);
    });

    it.each(['android', 'ios'] as const)(
        '%s: every word is a lowercase letters-only single word of 4+ letters',
        (platform) => {
            for (const word of wordsOf(platform)) {
                expect(word).toMatch(/^[a-z]{4,}$/u);
            }
        },
    );

    it.each(['android', 'ios'] as const)('%s: has a fallback past the first candidate in each role', (platform) => {
        expect(PROBE_CANDIDATES[platform].append.length).toBeGreaterThan(1);
        expect(PROBE_CANDIDATES[platform].change.length).toBeGreaterThan(1);
        expect(PROBE_CANDIDATES[platform].ambiguity.length).toBeGreaterThan(1);
    });

    /**
     * ⛔ A source line that names the bound food AGREES with it, and an agreeing line is `verified`, never AMBIGUOUS:
     * the fixture would be inert and the reset would time out waiting for a verdict that cannot come.
     */
    it.each(['android', 'ios'] as const)(
        '%s: no ambiguity word appears in the probe’s source lines, which must name a DIFFERENT food',
        (platform) => {
            for (const word of PROBE_CANDIDATES[platform].ambiguity) {
                expect(sourceLineWords(word), word).not.toContain(word);
                expect(
                    probeFor(word).ingredients.some((line) => line.sourceLine?.toLowerCase().includes(word)),
                    word,
                ).toBe(false);
            }
        },
    );

    /**
     * ⛔ Sharing no WORD is not enough: the gate calls a line AMBIGUOUS only when it judges the food plainly NOT the line's
     * food, and a food the bound word is MADE of is judged otherwise. `2 tbsp olive oil` read RESOLVED against
     * `tzatziki` on pr-91 (2026-10-20), which failed iOS lane 1's reset. So every pair the probe can make must be one a
     * live stage MEASURED as AMBIGUOUS; a new word or a new source line fails here until it is measured.
     */
    it.each(['android', 'ios'] as const)(
        '%s: every ambiguity word was measured AMBIGUOUS against every probe source line',
        (platform) => {
            for (const word of PROBE_CANDIDATES[platform].ambiguity) {
                expect(AMBIGUITY_GATE_MEASUREMENT.words, word).toContain(word);

                for (const line of probeFor(word).ingredients) {
                    expect(AMBIGUITY_GATE_MEASUREMENT.ambiguousSourceLines, word).toContain(line.sourceLine);
                    expect(Object.keys(AMBIGUITY_GATE_MEASUREMENT.notAmbiguous), word).not.toContain(line.sourceLine);
                }
            }
        },
    );

    it('collides with nothing a flow already types: the probe food, the cap foods, kale, the seed world', () => {
        const seedWords = SEED_WORLD.flatMap((recipe) => recipe.ingredients.map((line) => line.name))
            .flatMap((name) => name.toLowerCase().split(/[^a-z]+/u))
            .filter((word) => word !== '');
        const forbidden = new Set([
            ...seedWords,
            ...UNATTACHED_PROBE_INGREDIENT.toLowerCase().split(' '),
            ...CAP_FOOD_BASE_NAME.toLowerCase().split(' '),
            // The ambiguity probe's own source lines ('chicken stock', 'cocoa powder'): a word sharing one would agree.
            ...sourceLineWords('placeholder'),
            ...RESERVED_WORDS,
        ]);

        for (const word of [...wordsOf('android'), ...wordsOf('ios')]) {
            expect(forbidden.has(word), word).toBe(false);
            // The probe food 'Flour' is typed as 'Flou' and 'Flo': a word that starts with either is matched by it.
            expect(word.startsWith('flo'), word).toBe(false);
        }
    });

    it('reserves the words other flows own', () => {
        expect(RESERVED_WORDS).toEqual(expect.arrayContaining(['flour', 'flou', 'flo', 'cap', 'probe', 'kale']));
    });

    it.each(['android', 'ios'] as const)(
        '%s: unresolved has exactly ONE candidate, because it never falls back',
        (platform) => {
            expect(PROBE_CANDIDATES[platform].unresolved).toHaveLength(1);
        },
    );

    it('keeps every unresolved candidate off the lexical tier’s synonym map, which would reformulate the query', () => {
        for (const platform of ['android', 'ios'] as const) {
            for (const word of PROBE_CANDIDATES[platform].unresolved) {
                expect(LEXICAL_SYNONYM_KEYS.includes(word), word).toBe(false);
            }
        }
    });

    it('LEXICAL_SYNONYM_KEYS is the lexical tier’s own map: a key added there fails here', () => {
        const source = readFileSync(
            fileURLToPath(
                new URL('../../../services/recipe-service/src/ingredients/resolution/lexicalTier.ts', import.meta.url),
            ),
            'utf8',
        );
        const block = /LEXICAL_SYNONYMS[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/u.exec(source)?.[1] ?? '';
        const keys = [...block.matchAll(/\[\s*'([^']+)'\s*,/gu)].map((match) => match[1]);

        expect([...LEXICAL_SYNONYM_KEYS].sort()).toEqual([...keys].sort());
        expect(keys.length).toBeGreaterThan(0);
    });

    // The USDA source matches a query on ANY of its words, so a two-word name is only as rare as its commoner word:
    // 'Maestro Zorbleflax' showed 11 branded USDA foods on pr-91 (2026-10-18), all on "Maestro", and provision refused
    // it. One invented token has no common word to match on.
    it('the no-match name is ONE invented token, so no single real word in it can match a food', () => {
        expect(NO_MATCH_FOOD_NAME).toMatch(/^[A-Z][a-z]+$/u);
        expect(NO_MATCH_FOOD_NAME).toBe('Zorbleflax');
        expect(RESERVED_WORDS.some((word) => NO_MATCH_FOOD_NAME.toLowerCase().startsWith(word))).toBe(false);
    });

    /**
     * The budget stops a source that never answers. It must not stop a stage that legitimately walks every fallback:
     * that stage's failure would then read as "the search budget ran out" rather than naming the words it rejected.
     */
    it.each(['android', 'ios'] as const)(
        '%s: the search budget covers every candidate of every role, with room for two retries',
        (platform) => {
            const total = Object.values(candidatesFor(platform)).reduce((sum, list) => sum + list.length, 0);

            expect(MAX_PROBE_SEARCHES).toBeGreaterThanOrEqual(total + 2);
        },
    );

    it('covers every role', () => {
        const roles: readonly ProbeRole[] = PROBE_ROLES;

        expect(Object.keys(candidatesFor('android')).sort()).toEqual([...roles].sort());
    });
});
