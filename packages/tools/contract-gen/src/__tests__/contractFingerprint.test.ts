/**
 * THE PUBLISHED-CONTRACT FINGERPRINT's unit suite.
 *
 * The artifact under test is `packages/schemas/<service>/contract.schema.json` — the JSON Schema projection of
 * every zod schema a schema package exports, committed so that the NEXT generation can be compared against it.
 *
 * Three properties carry the whole thing, and each is pinned here:
 *
 *  1. **It is derived from the published zod, and covers all of it.** A fingerprint that quietly skipped an
 *     export would gate nothing while looking like a gate, so an empty projection is a refusal rather than an
 *     empty file.
 *  2. **It is byte-deterministic.** Committed generated output is only checkable by regenerate-and-diff, which
 *     means insertion order must never reach the bytes.
 *  3. **It states its own blind spot.** `.refine()` does not project, and the suite PROVES that rather than
 *     asserting it in prose — see `the blind spot, demonstrated`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { classifyContractChanges, hasBreakingChange } from '../contractCompatibility.js';
import {
    buildContractFingerprint,
    serializeContractFingerprint,
    sortJsonKeysDeep,
    CONTRACT_FINGERPRINT_FILENAME,
    type ContractFingerprint,
} from '../contractFingerprint.js';

const METADATA = {
    schemaPackageName: '@kitchensink/schema-widget',
    regenerateCommand: 'npm run contract:generate --workspace=@kitchensink/widget-service',
};

/**
 * Build a fingerprint from a module-namespace-shaped object.
 *
 * @param exports - What the schema package's `schemas.ts` exports.
 * @returns The fingerprint.
 */
function build(exports: Readonly<Record<string, unknown>>): ContractFingerprint {
    return buildContractFingerprint(exports, METADATA);
}

describe('buildContractFingerprint', () => {
    it('projects every exported zod schema under its export name', () => {
        const fingerprint = build({
            widgetSchema: z.object({ id: z.string() }),
            gadgetSchema: z.string(),
        });

        expect(Object.keys(fingerprint.schemas)).toStrictEqual(['gadgetSchema', 'widgetSchema']);
        expect(fingerprint.schemas['gadgetSchema']).toMatchObject({ type: 'string' });
        expect(fingerprint.schemas['widgetSchema']).toMatchObject({
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        });
    });

    it('ignores exports that are not zod schemas', () => {
        const fingerprint = build({
            widgetSchema: z.object({ id: z.string() }),
            MAX_WIDGETS: 10,
            WIDGET_KINDS: { a: 'a', b: 'b' },
            makeWidgetSchema: () => z.object({}),
        });

        expect(Object.keys(fingerprint.schemas)).toStrictEqual(['widgetSchema']);
    });

    // A projection that covered nothing would be committed, diffed, and pass forever. It has to refuse.
    it('refuses to publish a fingerprint with no schemas in it', () => {
        expect(() => build({ MAX_WIDGETS: 10 })).toThrow(/no zod schema/iu);
    });

    // The whole projection hangs on `instanceof`. If two copies of zod are ever installed, every schema from
    // the other copy would silently fall out of the fingerprint and the artifact would shrink without a word.
    it('refuses an export that is zod-SHAPED but is not this zod, naming it', () => {
        const foreign = {
            _zod: { def: { type: 'string' } },
            parse: (): void => undefined,
            safeParse: (): void => undefined,
        };

        expect(() => build({ widgetSchema: z.string(), strangerSchema: foreign })).toThrow(/strangerSchema/u);
        expect(() => build({ widgetSchema: z.string(), strangerSchema: foreign })).toThrow(/second copy of zod/iu);
    });

    // `io: 'output'` is the ruling, and it is observable: a `.default()` is OPTIONAL on the way in and
    // GUARANTEED on the way out. A fingerprint taken in the input direction would describe a different contract.
    it('projects in the OUTPUT direction, so a defaulted field is required', () => {
        const fingerprint = build({ widgetSchema: z.object({ tier: z.string().default('free') }) });

        expect(fingerprint.schemas['widgetSchema']).toMatchObject({ required: ['tier'] });
    });

    it('records a schema JSON Schema cannot represent instead of dropping it, naming the export', () => {
        const fingerprint = build({
            widgetSchema: z.object({ id: z.string() }),
            derivedSchema: z.string().transform((value) => value.length),
        });

        expect(Object.keys(fingerprint.schemas)).toContain('derivedSchema');
        expect(JSON.stringify(fingerprint.schemas['derivedSchema'])).toMatch(/unrepresentable/u);
    });

    // The recorded marker must not be a keyword the classifier waves through: a schema that STOPS being
    // representable has to surface as something a human looks at.
    it('makes a schema becoming unrepresentable a breaking finding rather than an annotation', () => {
        const before = build({ widgetSchema: z.string() });
        const after = build({ widgetSchema: z.string().transform((value) => value.length) });

        expect(hasBreakingChange(classifyContractChanges(before, after))).toBe(true);
    });

    it('carries the provenance a reader of the committed file needs', () => {
        const fingerprint = build({ widgetSchema: z.string() });

        expect(fingerprint.regenerate).toBe(METADATA.regenerateCommand);
        expect(fingerprint.contract).toBe(METADATA.schemaPackageName);
        expect(fingerprint.$comment).toMatch(/DO NOT EDIT/u);
    });

    // ⛔ Without this the committed JSON Schema reads as ADR-0014's REJECTED alternative — "derive the types
    // THROUGH OpenAPI" — returning by the back door.
    it('states in the artifact itself that it generates nothing', () => {
        expect(build({ widgetSchema: z.string() }).notCodegen).toMatch(/generates nothing/iu);
    });

    it('states the refinement blind spot in the artifact itself', () => {
        expect(build({ widgetSchema: z.string() }).blindTo).toMatch(/refine/u);
    });
});

describe('the blind spot, demonstrated', () => {
    // ⛔ THIS TEST EXISTS TO FAIL IF THE LIMITATION IS EVER QUIETLY DROPPED FROM THE DOCS. A `.refine()`
    // predicate does not project into JSON Schema at all, so a business rule can be tightened to the point of
    // rejecting every request a client sends and this artifact reports nothing. It is named, in the module, in
    // the artifact and in ADR-0014 — because an artifact that hides its blind spot is a false guarantee.
    it('cannot see a refinement being added, and reports the contract as unchanged', () => {
        const loose = z.object({ start: z.number(), end: z.number() });
        const strict = loose.refine((value) => value.end > value.start, 'end must follow start');

        const before = build({ windowSchema: loose });
        const after = build({ windowSchema: strict });

        expect(after.schemas['windowSchema']).toStrictEqual(before.schemas['windowSchema']);
        expect(classifyContractChanges(before, after)).toStrictEqual([]);
    });
});

describe('sortJsonKeysDeep', () => {
    it('sorts object keys at every depth', () => {
        expect(JSON.stringify(sortJsonKeysDeep({ b: 1, a: { d: 2, c: 3 } }))).toBe('{"a":{"c":3,"d":2},"b":1}');
    });

    // Array order IS semantic in JSON Schema (`prefixItems` is positional), so it must survive untouched.
    it('leaves array order alone while sorting the objects inside it', () => {
        expect(JSON.stringify(sortJsonKeysDeep({ list: [{ b: 1, a: 2 }, 'z', 'a'] }))).toBe(
            '{"list":[{"a":2,"b":1},"z","a"]}',
        );
    });

    it('passes scalars and null through', () => {
        expect(sortJsonKeysDeep(null)).toBeNull();
        expect(sortJsonKeysDeep(4)).toBe(4);
    });
});

describe('serializeContractFingerprint', () => {
    it('emits 4-space JSON with a trailing newline, like every other file in this repo', () => {
        const text = serializeContractFingerprint(build({ widgetSchema: z.string() }));

        expect(text.endsWith('}\n')).toBe(true);
        expect(text).toContain('\n    "contract": "@kitchensink/schema-widget"');
    });

    it('sorts every key, so a property added in the middle of a zod object moves one line', () => {
        const text = serializeContractFingerprint(
            build({ widgetSchema: z.object({ zebra: z.string(), apple: z.string() }) }),
        );

        expect(text.indexOf('"apple"')).toBeLessThan(text.indexOf('"zebra"'));
    });

    // Regenerate-and-diff is the gate. It means nothing unless a no-change regeneration is byte-identical, and
    // the most likely source of a spurious diff is the order the exports happened to be enumerated in.
    it('is byte-identical regardless of the order the exports were enumerated in', () => {
        const a = z.object({ id: z.string() });
        const b = z.string();

        expect(serializeContractFingerprint(build({ aSchema: a, bSchema: b }))).toBe(
            serializeContractFingerprint(build({ bSchema: b, aSchema: a })),
        );
    });

    it('is byte-identical across two builds of the same input', () => {
        const exports = { widgetSchema: z.object({ id: z.string(), size: z.number().max(10) }) };

        expect(serializeContractFingerprint(build(exports))).toBe(serializeContractFingerprint(build(exports)));
    });

    it('round-trips through JSON into something the classifier accepts', () => {
        const text = serializeContractFingerprint(build({ widgetSchema: z.object({ id: z.string() }) }));
        const parsed = JSON.parse(text) as ContractFingerprint;

        expect(classifyContractChanges(parsed, build({ widgetSchema: z.object({ id: z.string() }) }))).toStrictEqual(
            [],
        );
    });
});

describe('CONTRACT_FINGERPRINT_FILENAME', () => {
    it('is the name the drift gate and every reader look for', () => {
        expect(CONTRACT_FINGERPRINT_FILENAME).toBe('contract.schema.json');
    });
});
