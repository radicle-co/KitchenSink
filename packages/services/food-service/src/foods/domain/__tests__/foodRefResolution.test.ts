/**
 * Unit tests for `foodRefResolution` — the pure answer `POST /api/v1/foods/refs/resolve` gives (curated plan
 * U8, roots slice; KTD-15), written RED-first from the plan and blueprint rather than from the code.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | U8: "the entry for an unknown id equals the entry for another user's private food" | the SAME ref over two fact maps deep-equals, and serializes byte-equal |
 * | U8: "a stranger resolving a private authored food's id gets the same not-found answer `GET /:id` gives" | the stranger's entry is `absent`, and so is every other concealed case |
 * | KTD-15: "the resolver applies the same `authorshipPolicy` as `GET /:id`" | the policy table below, private / promoted / catalog × author / stranger |
 * | blueprint: variant, unknown, `DELETING` and not-allowed-to-read are IDENTICAL `absent` entries | one assertion compares all four |
 * | blueprint: `WITHDRAWN` is `found`, with its name, to a reader the policy admits | author and promoted-stranger cases |
 * | blueprint: one entry per DISTINCT ref, in order of first appearance | repeats, interleaving, and `root:X` ≠ `variant:X` |
 * | wire: `visibility: 'private'` means "the caller authored it" | carried for the author's private food only; a promoted food read by a stranger carries none |
 */
import { describe, expect, it } from 'vitest';

import { AUTHOR_ID, STRANGER_ID, makeFoodRefFacts, makePrivateFoodRefFacts } from '../../__fixtures__/foodRefFacts.js';
import type { FoodRefFacts } from '../../dao/food.dao.js';
import type { ForwardOutcome } from '../../dao/foodForward.dao.js';
import type { VariantFacts } from '../../dao/foodVariant.dao.js';
import type { FoodRef } from '../../foods.schema.js';
import { refIdsToRead, resolveFoodRefs, type RefFacts } from '../foodRefResolution.js';

const FOOD_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';
const ROOT: FoodRef = { kind: 'root', id: FOOD_ID };

/** The facts the owner reader answers, holding these roots and nothing else. */
function factsOf(...rows: FoodRefFacts[]): RefFacts {
    return { roots: new Map(rows.map((row) => [row.id, row])), variants: new Map(), forwards: new Map() };
}

/** Resolve ONE ref against ONE row as `callerId`, returning its single entry. */
function resolveOne(row: FoodRefFacts | undefined, callerId: string, ref: FoodRef = ROOT): unknown {
    const entries = resolveFoodRefs([ref], row === undefined ? factsOf() : factsOf(row), callerId);

    expect(entries).toHaveLength(1);

    return entries[0];
}

describe('resolveFoodRefs — the authorship policy, exactly as GET /{id} applies it', () => {
    it('a catalog food is found by anyone, with its name and status and NO visibility marker', () => {
        for (const caller of [AUTHOR_ID, STRANGER_ID, 'svc_recipe']) {
            expect(resolveOne(makeFoodRefFacts(), caller)).toStrictEqual({
                outcome: 'found',
                ref: ROOT,
                name: 'Broccoli, raw',
                status: 'RESOLVED',
            });
        }
    });

    it.each(['PENDING', 'UNRESOLVED', 'AWAITING_RETRY', 'NOT_FOUND', 'FAILED'] as const)(
        'a catalog food that is %s is still found, reporting that status — the caller decides what it means',
        (status) => {
            expect(resolveOne(makeFoodRefFacts({ status }), STRANGER_ID)).toStrictEqual({
                outcome: 'found',
                ref: ROOT,
                name: 'Broccoli, raw',
                status,
            });
        },
    );

    it("the author finds their own private food, marked private — the one fact recipe's admission reads", () => {
        expect(resolveOne(makePrivateFoodRefFacts(), AUTHOR_ID)).toStrictEqual({
            outcome: 'found',
            ref: ROOT,
            name: 'Grandma’s spice mix',
            status: 'RESOLVED',
            visibility: 'private',
        });
    });

    it('⛔ a stranger gets ABSENT for a private food — never its name, never its status', () => {
        expect(resolveOne(makePrivateFoodRefFacts(), STRANGER_ID)).toStrictEqual({ outcome: 'absent', ref: ROOT });
    });

    it('⛔ a service principal is a stranger to every private food', () => {
        expect(resolveOne(makePrivateFoodRefFacts(), 'svc_recipe')).toStrictEqual({ outcome: 'absent', ref: ROOT });
    });

    it('⛔ a PROMOTED food read by a stranger is found WITHOUT a visibility marker (R51: private means "yours")', () => {
        const promoted = makePrivateFoodRefFacts({ visibility: 'promoted' });

        expect(resolveOne(promoted, STRANGER_ID)).toStrictEqual({
            outcome: 'found',
            ref: ROOT,
            name: 'Grandma’s spice mix',
            status: 'RESOLVED',
        });
    });

    it("the author's own PROMOTED food carries no marker either — the marker reports the stored visibility", () => {
        const promoted = makePrivateFoodRefFacts({ visibility: 'promoted' });

        expect(resolveOne(promoted, AUTHOR_ID)).not.toHaveProperty('visibility');
    });

    it('a WITHDRAWN private food is found by its author, WITH its name, so a cook is told which line lost it', () => {
        expect(resolveOne(makePrivateFoodRefFacts({ status: 'WITHDRAWN' }), AUTHOR_ID)).toStrictEqual({
            outcome: 'found',
            ref: ROOT,
            name: 'Grandma’s spice mix',
            status: 'WITHDRAWN',
            visibility: 'private',
        });
    });

    it('a WITHDRAWN promoted food is found by a stranger the policy admits', () => {
        const withdrawn = makePrivateFoodRefFacts({ status: 'WITHDRAWN', visibility: 'promoted' });

        expect(resolveOne(withdrawn, STRANGER_ID)).toMatchObject({ outcome: 'found', status: 'WITHDRAWN' });
    });

    it('⛔ a WITHDRAWN private food stays concealed from a stranger', () => {
        expect(resolveOne(makePrivateFoodRefFacts({ status: 'WITHDRAWN' }), STRANGER_ID)).toStrictEqual({
            outcome: 'absent',
            ref: ROOT,
        });
    });

    it('a food mid-erasure (DELETING) is absent even to its author — the store-internal status never leaves', () => {
        expect(resolveOne(makePrivateFoodRefFacts({ status: 'DELETING' }), AUTHOR_ID)).toStrictEqual({
            outcome: 'absent',
            ref: ROOT,
        });
    });

    it('a null name passes through as null — absence of a name is not absence of the food', () => {
        expect(resolveOne(makeFoodRefFacts({ name: null }), STRANGER_ID)).toMatchObject({
            outcome: 'found',
            name: null,
        });
    });
});

describe('resolveFoodRefs — no enumeration: every concealed case is the SAME entry', () => {
    it('⛔ an unknown id and a stranger’s private food answer deep-equal, byte-equal output', () => {
        const unknown = resolveFoodRefs([ROOT], factsOf(), STRANGER_ID);
        const concealed = resolveFoodRefs([ROOT], factsOf(makePrivateFoodRefFacts()), STRANGER_ID);

        expect(concealed).toStrictEqual(unknown);
        expect(JSON.stringify(concealed)).toBe(JSON.stringify(unknown));
    });

    it('⛔ a variant, an unknown root, a DELETING food and a concealed food are indistinguishable', () => {
        const variantRef: FoodRef = { kind: 'variant', id: FOOD_ID };
        const serialize = (entries: unknown[]): string[] => entries.map((entry) => JSON.stringify(entry));

        const unknownRoot = serialize(resolveFoodRefs([ROOT], factsOf(), AUTHOR_ID));
        const deleting = serialize(
            resolveFoodRefs([ROOT], factsOf(makePrivateFoodRefFacts({ status: 'DELETING' })), AUTHOR_ID),
        );
        const concealed = serialize(resolveFoodRefs([ROOT], factsOf(makePrivateFoodRefFacts()), STRANGER_ID));

        expect(deleting).toStrictEqual(unknownRoot);
        expect(concealed).toStrictEqual(unknownRoot);
        // The variant differs ONLY in the kind it echoes back — which the caller sent.
        expect(serialize(resolveFoodRefs([variantRef], factsOf(), AUTHOR_ID))).toStrictEqual([
            JSON.stringify({ outcome: 'absent', ref: variantRef }),
        ]);
    });

    it('⛔ a VARIANT ref never reads a root food’s facts, even when a root with that id exists', () => {
        const variantRef: FoodRef = { kind: 'variant', id: FOOD_ID };

        expect(resolveOne(makeFoodRefFacts(), AUTHOR_ID, variantRef)).toStrictEqual({
            outcome: 'absent',
            ref: variantRef,
        });
    });

    it('echoes ONLY { kind, id } — a stray property on the input ref cannot ride into the answer', () => {
        const widened = { kind: 'root' as const, id: FOOD_ID, ownerId: AUTHOR_ID };

        const [absent] = resolveFoodRefs([widened], factsOf(), STRANGER_ID);
        const [found] = resolveFoodRefs([widened], factsOf(makeFoodRefFacts()), STRANGER_ID);

        expect(absent?.ref).toStrictEqual({ kind: 'root', id: FOOD_ID });
        expect(found?.ref).toStrictEqual({ kind: 'root', id: FOOD_ID });
    });
});

describe('resolveFoodRefs — one entry per distinct ref, in order of first appearance', () => {
    const a = makeFoodRefFacts({ id: 'food-a', name: 'a' });
    const b = makeFoodRefFacts({ id: 'food-b', name: 'b' });

    it('collapses repeats and keeps first-appearance order, not the facts map’s order', () => {
        const refs: FoodRef[] = [
            { kind: 'root', id: 'food-b' },
            { kind: 'root', id: 'food-a' },
            { kind: 'root', id: 'food-b' },
            { kind: 'variant', id: 'v-1' },
            { kind: 'root', id: 'food-a' },
        ];

        const entries = resolveFoodRefs(refs, factsOf(a, b), STRANGER_ID);

        expect(entries.map((entry) => `${entry.ref.kind}:${entry.ref.id}`)).toStrictEqual([
            'root:food-b',
            'root:food-a',
            'variant:v-1',
        ]);
    });

    it('treats root:X and variant:X as two refs', () => {
        const entries = resolveFoodRefs(
            [
                { kind: 'root', id: 'food-a' },
                { kind: 'variant', id: 'food-a' },
            ],
            factsOf(a),
            STRANGER_ID,
        );

        expect(entries.map((entry) => entry.outcome)).toStrictEqual(['found', 'absent']);
    });

    it('answers an empty list with no entries', () => {
        expect(resolveFoodRefs([], factsOf(a), STRANGER_ID)).toStrictEqual([]);
    });
});

describe('refIdsToRead — the only ids the reader reads first', () => {
    // Rewritten for curated U8 S5: a variant ref is now read, from its own table.
    it('lists each root id and each variant id once, by kind, in first-appearance order', () => {
        expect(
            refIdsToRead([
                { kind: 'root', id: 'b' },
                { kind: 'variant', id: 'v-1' },
                { kind: 'root', id: 'a' },
                { kind: 'root', id: 'b' },
                { kind: 'variant', id: 'b' },
            ]),
        ).toStrictEqual({ roots: ['b', 'a'], variants: ['v-1', 'b'] });
    });

    it('is empty for no refs', () => {
        expect(refIdsToRead([])).toStrictEqual({ roots: [], variants: [] });
    });
});

const BRISKET = makeFoodRefFacts({ id: 'R-brisket', name: 'beef brisket' });
const FLAT: VariantFacts = {
    id: 'V-flat',
    rootId: 'R-brisket',
    retired: false,
    parts: [
        { attribute: 'cut', ordinal: 0, text: 'flat' },
        { attribute: 'trim', ordinal: 0, text: 'separable lean' },
    ],
};

/** Facts holding roots, variants and forwards. */
function worldOf(options: {
    roots?: readonly FoodRefFacts[];
    variants?: readonly VariantFacts[];
    forwards?: Readonly<Record<string, ForwardOutcome>>;
}): RefFacts {
    return {
        roots: new Map((options.roots ?? []).map((root) => [root.id, root])),
        variants: new Map((options.variants ?? []).map((variant) => [variant.id, variant])),
        forwards: new Map(Object.entries(options.forwards ?? {})),
    };
}

describe('resolveFoodRefs — the variant arm (curated U8 S5)', () => {
    const VARIANT_REF: FoodRef = { kind: 'variant', id: 'V-flat' };

    it('a live variant is found under its root’s name and status, carrying its root and parts', () => {
        expect(
            resolveFoodRefs([VARIANT_REF], worldOf({ roots: [BRISKET], variants: [FLAT] }), STRANGER_ID),
        ).toStrictEqual([
            {
                outcome: 'found',
                ref: VARIANT_REF,
                name: 'beef brisket',
                status: 'RESOLVED',
                variant: {
                    rootId: 'R-brisket',
                    parts: [
                        { attribute: 'cut', text: 'flat' },
                        { attribute: 'trim', text: 'separable lean' },
                    ],
                },
            },
        ]);
    });

    it('⛔ judges authorship on the variant’s ROOT: a stranger gets the unknown-id answer for a private root’s variant', () => {
        const privateRoot = makePrivateFoodRefFacts({ id: 'R-brisket' });
        const concealed = resolveFoodRefs(
            [VARIANT_REF],
            worldOf({ roots: [privateRoot], variants: [FLAT] }),
            STRANGER_ID,
        );
        const unknown = resolveFoodRefs([VARIANT_REF], worldOf({}), STRANGER_ID);

        expect(JSON.stringify(concealed)).toBe(JSON.stringify(unknown));
    });

    // Rewritten for curated U9 P0 (R29): this case used to answer `absent`, which took a withdrawn variant's line its
    // name, parts and numbers. The forward reader answers a retired id that nothing forwards with `hops: 0`.
    it('⛔ R29: a variant the seed retired with no successor is found AS ITSELF, with its parts and no forward', () => {
        const retired = { ...FLAT, retired: true };

        expect(
            resolveFoodRefs(
                [VARIANT_REF],
                worldOf({
                    roots: [BRISKET],
                    variants: [retired],
                    forwards: { 'V-flat': { resolved: true, id: 'V-flat', kind: undefined, hops: 0 } },
                }),
                STRANGER_ID,
            ),
        ).toStrictEqual([
            {
                outcome: 'found',
                ref: VARIANT_REF,
                name: 'beef brisket',
                status: 'RESOLVED',
                variant: {
                    rootId: 'R-brisket',
                    parts: [
                        { attribute: 'cut', text: 'flat' },
                        { attribute: 'trim', text: 'separable lean' },
                    ],
                },
            },
        ]);
    });

    it('⛔ R29: a retired variant whose root the seed ALSO retired with no successor is found, under that root', () => {
        expect(
            resolveFoodRefs(
                [VARIANT_REF],
                worldOf({
                    roots: [{ ...BRISKET, retired: true }],
                    variants: [{ ...FLAT, retired: true }],
                    forwards: { 'V-flat': { resolved: true, id: 'V-flat', kind: undefined, hops: 0 } },
                }),
                STRANGER_ID,
            ),
        ).toMatchObject([{ outcome: 'found', name: 'beef brisket', variant: { rootId: 'R-brisket' } }]);
    });

    it.each<[string, readonly FoodRefFacts[], ForwardOutcome | undefined]>([
        [
            'its root is mid-erasure (DELETING)',
            [{ ...BRISKET, status: 'DELETING' }],
            { resolved: true, id: 'V-flat', kind: undefined, hops: 0 },
        ],
        [
            'its root is authored, so it is not catalog data',
            [makePrivateFoodRefFacts({ id: 'R-brisket' })],
            { resolved: true, id: 'V-flat', kind: undefined, hops: 0 },
        ],
        ['its forward chain is a cycle', [BRISKET], { resolved: false, reason: 'cycle' }],
        ['its forward chain is too long', [BRISKET], { resolved: false, reason: 'depth' }],
        ['the reader followed no forward for it', [BRISKET], undefined],
    ])('a retired variant is absent when %s', (_, roots, forward) => {
        const world = worldOf({
            roots,
            variants: [{ ...FLAT, retired: true }],
            ...(forward === undefined ? {} : { forwards: { 'V-flat': forward } }),
        });

        // Judged as the root's AUTHOR too, so the authored row is refused for not being catalog, not for privacy.
        for (const caller of [STRANGER_ID, AUTHOR_ID]) {
            expect(resolveFoodRefs([VARIANT_REF], world, caller)).toStrictEqual([
                { outcome: 'absent', ref: VARIANT_REF },
            ]);
        }
    });

    it('a variant whose root is mid-erasure is absent', () => {
        const deleting = makeFoodRefFacts({ id: 'R-brisket', status: 'DELETING' });

        expect(
            resolveFoodRefs([VARIANT_REF], worldOf({ roots: [deleting], variants: [FLAT] }), STRANGER_ID),
        ).toStrictEqual([{ outcome: 'absent', ref: VARIANT_REF }]);
    });
});

describe('resolveFoodRefs — the forwarded arm (curated U8 S5, ADR-0050 §4)', () => {
    const OLD_REF: FoodRef = { kind: 'root', id: 'R-old' };
    const OLD = makeFoodRefFacts({ id: 'R-old', name: 'Beef, brisket, whole', retired: true });

    it('a retired root forwarded to a live root is found AS the target, naming where it went', () => {
        const entries = resolveFoodRefs(
            [OLD_REF],
            worldOf({
                roots: [OLD, BRISKET],
                forwards: { 'R-old': { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 } },
            }),
            STRANGER_ID,
        );

        expect(entries).toStrictEqual([
            {
                outcome: 'found',
                ref: OLD_REF,
                name: 'beef brisket',
                status: 'RESOLVED',
                forwardedTo: { kind: 'root', id: 'R-brisket' },
            },
        ]);
    });

    it('a retired root forwarded to a variant is found as that variant, under its root', () => {
        const [entry] = resolveFoodRefs(
            [OLD_REF],
            worldOf({
                roots: [OLD, BRISKET],
                variants: [FLAT],
                forwards: { 'R-old': { resolved: true, id: 'V-flat', kind: 'variant', hops: 2 } },
            }),
            STRANGER_ID,
        );

        expect(entry).toStrictEqual({
            outcome: 'found',
            ref: OLD_REF,
            name: 'beef brisket',
            status: 'RESOLVED',
            variant: {
                rootId: 'R-brisket',
                parts: [
                    { attribute: 'cut', text: 'flat' },
                    { attribute: 'trim', text: 'separable lean' },
                ],
            },
            forwardedTo: { kind: 'variant', id: 'V-flat' },
        });
    });

    it('a retired variant forwarded to a root is found as that root', () => {
        const ref: FoodRef = { kind: 'variant', id: 'V-old' };
        const [entry] = resolveFoodRefs(
            [ref],
            worldOf({
                roots: [BRISKET],
                variants: [{ ...FLAT, id: 'V-old', retired: true }],
                forwards: { 'V-old': { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 } },
            }),
            STRANGER_ID,
        );

        expect(entry).toMatchObject({
            outcome: 'found',
            name: 'beef brisket',
            forwardedTo: { kind: 'root', id: 'R-brisket' },
        });
        expect(entry).not.toHaveProperty('variant');
    });

    it('⛔ a cycle or an over-long chain is absent, never a throw', () => {
        for (const reason of ['cycle', 'depth'] as const) {
            expect(
                resolveFoodRefs(
                    [OLD_REF],
                    worldOf({ roots: [OLD], forwards: { 'R-old': { resolved: false, reason } } }),
                    STRANGER_ID,
                ),
            ).toStrictEqual([{ outcome: 'absent', ref: OLD_REF }]);
        }
    });

    it('a retired root whose forward the reader did not follow is absent — no answer is guessed', () => {
        expect(resolveFoodRefs([OLD_REF], worldOf({ roots: [OLD] }), STRANGER_ID)).toStrictEqual([
            { outcome: 'absent', ref: OLD_REF },
        ]);
    });

    it('⛔ a forward to a private root is judged on THAT root: a stranger gets the unknown-id answer', () => {
        const target = makePrivateFoodRefFacts({ id: 'R-private' });
        const concealed = resolveFoodRefs(
            [OLD_REF],
            worldOf({
                roots: [OLD, target],
                forwards: { 'R-old': { resolved: true, id: 'R-private', kind: 'root', hops: 1 } },
            }),
            STRANGER_ID,
        );

        expect(JSON.stringify(concealed)).toBe(JSON.stringify(resolveFoodRefs([OLD_REF], worldOf({}), STRANGER_ID)));
    });

    it('⛔ R29: a chain that ends at a variant the seed retired is found as that variant, naming it', () => {
        const ref: FoodRef = { kind: 'variant', id: 'V-old' };
        const [entry] = resolveFoodRefs(
            [ref],
            worldOf({
                roots: [BRISKET],
                variants: [
                    { ...FLAT, id: 'V-old', retired: true },
                    { ...FLAT, retired: true },
                ],
                forwards: { 'V-old': { resolved: true, id: 'V-flat', kind: 'variant', hops: 1 } },
            }),
            STRANGER_ID,
        );

        expect(entry).toMatchObject({
            outcome: 'found',
            name: 'beef brisket',
            variant: { rootId: 'R-brisket' },
            forwardedTo: { kind: 'variant', id: 'V-flat' },
        });
    });

    // Owner ruling 2026-10-01 ("Food doesn't just disappear"): a catalog ROOT the seed retired with no successor answers
    // as itself, as a variant does (U9 P0). This case was `absent` until then.
    it('⛔ a catalog root the seed retired with no successor (hops 0) is found AS ITSELF, with its own name', () => {
        expect(
            resolveFoodRefs(
                [OLD_REF],
                worldOf({
                    roots: [OLD],
                    forwards: { 'R-old': { resolved: true, id: 'R-old', kind: undefined, hops: 0 } },
                }),
                STRANGER_ID,
            ),
        ).toStrictEqual([{ outcome: 'found', ref: OLD_REF, name: 'Beef, brisket, whole', status: 'RESOLVED' }]);
    });

    it.each<[string, FoodRefFacts, string]>([
        ['authored and private', makePrivateFoodRefFacts({ id: 'R-old', retired: true }), AUTHOR_ID],
        [
            'authored and promoted',
            makePrivateFoodRefFacts({ id: 'R-old', retired: true, visibility: 'promoted' }),
            STRANGER_ID,
        ],
        ['mid-erasure (DELETING)', makeFoodRefFacts({ id: 'R-old', retired: true, status: 'DELETING' }), STRANGER_ID],
    ])('⛔ a retired root with no successor that is %s stays absent — concealment is unchanged', (_, root, caller) => {
        expect(
            resolveFoodRefs(
                [OLD_REF],
                worldOf({
                    roots: [root],
                    forwards: { 'R-old': { resolved: true, id: 'R-old', kind: undefined, hops: 0 } },
                }),
                caller,
            ),
        ).toStrictEqual([{ outcome: 'absent', ref: OLD_REF }]);
    });

    // Rewritten for the owner's 2026-10-01 ruling: a chain's end the seed retired with no successor answers for itself.
    it('⛔ a chain that ends at a root the seed retired with no successor is found as that root, naming it', () => {
        expect(
            resolveFoodRefs(
                [OLD_REF],
                worldOf({
                    roots: [OLD, { ...BRISKET, retired: true }],
                    forwards: { 'R-old': { resolved: true, id: 'R-brisket', kind: 'root', hops: 1 } },
                }),
                STRANGER_ID,
            ),
        ).toStrictEqual([
            {
                outcome: 'found',
                ref: OLD_REF,
                name: 'beef brisket',
                status: 'RESOLVED',
                forwardedTo: { kind: 'root', id: 'R-brisket' },
            },
        ]);
    });
});
