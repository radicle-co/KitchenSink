/**
 * THE BREAKING-CHANGE CLASSIFIER's unit suite.
 *
 * The claim under test is one sentence: **given two published contract fingerprints, say whether the move from
 * the first to the second can break a party that spoke the first.** Everything here is written to fail if that
 * answer is weakened in either direction, because both directions are load-bearing:
 *
 *  - a MISSED break is a gate that lies (the specific failure `json-schema-diff` was rejected for), and
 *  - a FALSE break is how a gate gets switched off, so every non-breaking edit is pinned too.
 *
 * Each breaking family therefore appears TWICE — once as the mutation that must be reported, once as its
 * inverse that must not be. The `MUTATIONS` table is the mutation lens applied to the classifier itself: it is
 * a list of one-keyword edits to a single base schema, each with the verdict the classifier owes it.
 */
import { describe, expect, it } from 'vitest';

import {
    classifyContractChanges,
    formatContractChanges,
    hasBreakingChange,
    type ContractDocument,
    type ContractChange,
    type JsonValue,
} from '../contractCompatibility.js';

/** The object every mutation below is a one-keyword edit of. */
const BASE: JsonValue = {
    type: 'object',
    properties: {
        id: { type: 'string', minLength: 1, maxLength: 26 },
        size: { type: 'number', minimum: 0, maximum: 10 },
        tag: { type: 'string', enum: ['a', 'b'] },
    },
    required: ['id', 'size'],
    additionalProperties: false,
};

/**
 * Wrap a bare schema as a one-entry fingerprint document.
 *
 * @param schema - The schema to publish under the name `widget`.
 * @returns The document. Pure.
 */
function documentOf(schema: JsonValue): ContractDocument {
    return { schemas: { widget: schema } };
}

/**
 * Classify a single-schema before/after pair.
 *
 * @param previous - The published schema.
 * @param next - The regenerated schema.
 * @returns The changes. Pure.
 */
function classify(previous: JsonValue, next: JsonValue): readonly ContractChange[] {
    return classifyContractChanges(documentOf(previous), documentOf(next));
}

/**
 * Render changes as `kind@path` for order-independent assertions.
 *
 * @param changes - The classification.
 * @returns One string per change. Pure.
 */
function summarize(changes: readonly ContractChange[]): readonly string[] {
    return changes.map((change) => `${change.kind}@${change.path}`);
}

/**
 * Replace one property's schema in a copy of {@link BASE}.
 *
 * @param name - The property to replace.
 * @param schema - Its new schema.
 * @returns A new base object. Pure.
 */
function withProperty(name: string, schema: JsonValue): JsonValue {
    return {
        ...(BASE as Record<string, JsonValue>),
        properties: { ...(BASE as { properties: Record<string, JsonValue> }).properties, [name]: schema },
    };
}

/**
 * Replace one top-level keyword in a copy of {@link BASE}.
 *
 * @param keyword - The keyword to set.
 * @param value - Its new value.
 * @returns A new base object. Pure.
 */
function withKeyword(keyword: string, value: JsonValue): JsonValue {
    return { ...(BASE as Record<string, JsonValue>), [keyword]: value };
}

/** One mutation of {@link BASE}, and the verdict the classifier owes it. */
interface Mutation {
    /** What the edit is, in the words a reviewer would use. */
    readonly what: string;
    /** The mutated schema. */
    readonly mutant: JsonValue;
    /** Whether moving BASE → mutant may break a party that spoke BASE. */
    readonly breaking: boolean;
    /** The kind the classifier must report for it. */
    readonly kind: string;
}

const MUTATIONS: readonly Mutation[] = [
    // ── removal / addition of a property ──
    {
        what: 'a property is removed',
        mutant: {
            ...(BASE as Record<string, JsonValue>),
            properties: { size: { type: 'number' } },
            required: ['size'],
        },
        breaking: true,
        kind: 'property-removed',
    },
    {
        what: 'a new OPTIONAL property is added',
        mutant: withProperty('note', { type: 'string' }),
        breaking: false,
        kind: 'property-added',
    },
    {
        what: 'a new REQUIRED property is added',
        mutant: {
            ...(withProperty('note', { type: 'string' }) as Record<string, JsonValue>),
            required: ['id', 'size', 'note'],
        },
        breaking: true,
        kind: 'property-added-required',
    },
    // ── optionality ──
    {
        what: 'an existing optional property becomes required',
        mutant: withKeyword('required', ['id', 'size', 'tag']),
        breaking: true,
        kind: 'property-now-required',
    },
    {
        what: 'an existing required property becomes optional',
        mutant: withKeyword('required', ['id']),
        breaking: false,
        kind: 'property-now-optional',
    },
    // ── enums ──
    {
        what: 'an enum loses a member',
        mutant: withProperty('tag', { type: 'string', enum: ['a'] }),
        breaking: true,
        kind: 'enum-narrowed',
    },
    {
        what: 'an enum gains a member',
        mutant: withProperty('tag', { type: 'string', enum: ['a', 'b', 'c'] }),
        breaking: false,
        kind: 'enum-widened',
    },
    {
        what: 'an enum appears where the value was previously unconstrained',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 26, enum: ['x'] }),
        breaking: true,
        kind: 'enum-narrowed',
    },
    {
        what: 'an enum is dropped entirely',
        mutant: withProperty('tag', { type: 'string' }),
        breaking: false,
        kind: 'enum-removed',
    },
    // ── numeric bounds ──
    {
        what: 'a minimum is raised',
        mutant: withProperty('size', { type: 'number', minimum: 1, maximum: 10 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    {
        what: 'a minimum is lowered',
        mutant: withProperty('size', { type: 'number', minimum: -5, maximum: 10 }),
        breaking: false,
        kind: 'bound-loosened',
    },
    {
        what: 'a maximum is lowered',
        mutant: withProperty('size', { type: 'number', minimum: 0, maximum: 9 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    {
        what: 'a maximum is raised',
        mutant: withProperty('size', { type: 'number', minimum: 0, maximum: 99 }),
        breaking: false,
        kind: 'bound-loosened',
    },
    {
        what: 'an exclusive minimum appears where there was none',
        mutant: withProperty('size', { type: 'number', minimum: 0, maximum: 10, exclusiveMinimum: 0 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    // ── length / size bounds ──
    {
        what: 'a minLength is raised',
        mutant: withProperty('id', { type: 'string', minLength: 2, maxLength: 26 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    {
        what: 'a maxLength is lowered',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 10 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    {
        what: 'a maxLength is raised',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 64 }),
        breaking: false,
        kind: 'bound-loosened',
    },
    {
        what: 'a maxLength is removed',
        mutant: withProperty('id', { type: 'string', minLength: 1 }),
        breaking: false,
        kind: 'bound-loosened',
    },
    {
        what: 'a maxItems appears where there was none',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 26, maxItems: 3 }),
        breaking: true,
        kind: 'bound-tightened',
    },
    // ── type ──
    {
        what: 'a property is rewritten to the identical shape',
        mutant: withProperty('size', { type: 'number', minimum: 0, maximum: 10 }),
        breaking: false,
        kind: 'unchanged',
    },
    {
        what: 'a type changes outright',
        mutant: withProperty('id', { type: 'number', minLength: 1, maxLength: 26 }),
        breaking: true,
        kind: 'type-changed',
    },
    {
        what: 'a closed object opens',
        mutant: { ...(BASE as Record<string, JsonValue>), additionalProperties: true },
        breaking: false,
        kind: 'additional-properties-opened',
    },
    // ── opaque constraints ──
    {
        what: 'a pattern appears where there was none',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 26, pattern: '^[a-z]+$' }),
        breaking: true,
        kind: 'constraint-added',
    },
    {
        what: 'a format appears where there was none',
        mutant: withProperty('id', { type: 'string', minLength: 1, maxLength: 26, format: 'uuid' }),
        breaking: true,
        kind: 'constraint-added',
    },
    // ── annotations ──
    {
        what: 'a description is added',
        mutant: withKeyword('description', 'A widget.'),
        breaking: false,
        kind: 'annotation-changed',
    },
];

describe('classifyContractChanges — the mutation table', () => {
    it.each(MUTATIONS.map((mutation) => [mutation.what, mutation] as const))('%s', (_what, mutation) => {
        const changes = classify(BASE, mutation.mutant);

        expect(hasBreakingChange(changes)).toBe(mutation.breaking);

        if (mutation.kind === 'unchanged') {
            expect(changes).toStrictEqual([]);

            return;
        }

        expect(changes.map((change) => change.kind)).toContain(mutation.kind);
    });

    // The other half of the mutation lens: an IDENTICAL document must produce no findings at all. Without this,
    // a classifier that reported every node as changed would satisfy every "is breaking" case above.
    it('reports nothing at all when the two documents are identical', () => {
        expect(classify(BASE, BASE)).toStrictEqual([]);
    });

    it('reports nothing when only the key ORDER differs, since JSON object key order is not semantic', () => {
        const reordered: JsonValue = {
            additionalProperties: false,
            required: ['size', 'id'],
            properties: {
                tag: { enum: ['b', 'a'], type: 'string' },
                size: { maximum: 10, minimum: 0, type: 'number' },
                id: { maxLength: 26, minLength: 1, type: 'string' },
            },
            type: 'object',
        };

        expect(classify(BASE, reordered)).toStrictEqual([]);
    });
});

describe('classifyContractChanges — the published set', () => {
    it('treats a removed schema as breaking and names it', () => {
        const changes = classifyContractChanges(
            { schemas: { widget: BASE, gadget: { type: 'string' } } },
            { schemas: { widget: BASE } },
        );

        expect(summarize(changes)).toStrictEqual(['schema-removed@gadget']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('treats an added schema as non-breaking', () => {
        const changes = classifyContractChanges(
            { schemas: { widget: BASE } },
            { schemas: { widget: BASE, gadget: { type: 'string' } } },
        );

        expect(summarize(changes)).toStrictEqual(['schema-added@gadget']);
        expect(hasBreakingChange(changes)).toBe(false);
    });

    it('ignores the document metadata beside `schemas`, which is provenance rather than contract', () => {
        const previous = { schemas: { widget: BASE }, regenerate: 'old command' } as unknown as ContractDocument;
        const next = { schemas: { widget: BASE }, regenerate: 'new command' } as unknown as ContractDocument;

        expect(classifyContractChanges(previous, next)).toStrictEqual([]);
    });

    it('is deterministic: the same pair yields the same findings in the same order', () => {
        const previous = { schemas: { b: BASE, a: { type: 'string' }, c: { type: 'number' } } };
        const next = { schemas: { a: { type: 'number' }, b: withKeyword('required', ['id']) } };

        expect(summarize(classifyContractChanges(previous, next))).toStrictEqual(
            summarize(classifyContractChanges(previous, next)),
        );
        // Sorted by schema name, so a reviewer reads the same report every run.
        expect(summarize(classifyContractChanges(previous, next))[0]).toBe('type-changed@a');
    });
});

describe('classifyContractChanges — nesting', () => {
    it('finds a break inside an array item and reports its path', () => {
        const changes = classify(
            { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } }, required: [] } },
            { type: 'array', items: { type: 'object', properties: {}, required: [] } },
        );

        expect(summarize(changes)).toStrictEqual(['property-removed@widget/items/properties/a']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('finds a break several objects deep', () => {
        const nest = (leaf: JsonValue): JsonValue => ({
            type: 'object',
            properties: { outer: { type: 'object', properties: { inner: leaf } } },
        });

        const changes = classify(nest({ type: 'string' }), nest({ type: 'string', maxLength: 4 }));

        expect(summarize(changes)).toStrictEqual(['bound-tightened@widget/properties/outer/properties/inner']);
    });

    it('treats a union losing a member as breaking and gaining one as safe', () => {
        const lost = classify({ anyOf: [{ type: 'string' }, { type: 'null' }] }, { anyOf: [{ type: 'string' }] });
        const gained = classify({ anyOf: [{ type: 'string' }] }, { anyOf: [{ type: 'string' }, { type: 'null' }] });

        expect(summarize(lost)).toStrictEqual(['union-member-removed@widget/anyOf']);
        expect(hasBreakingChange(lost)).toBe(true);
        expect(summarize(gained)).toStrictEqual(['union-member-added@widget/anyOf']);
        expect(hasBreakingChange(gained)).toBe(false);
    });

    it('recurses into a union member that CHANGED rather than reporting a removal and an addition', () => {
        const changes = classify(
            { anyOf: [{ type: 'string', maxLength: 10 }, { type: 'null' }] },
            { anyOf: [{ type: 'string', maxLength: 5 }, { type: 'null' }] },
        );

        expect(summarize(changes)).toStrictEqual(['bound-tightened@widget/anyOf/0']);
    });

    it('does not care about union member ORDER', () => {
        expect(
            classify(
                { anyOf: [{ type: 'string' }, { type: 'null' }] },
                { anyOf: [{ type: 'null' }, { type: 'string' }] },
            ),
        ).toStrictEqual([]);
    });

    it('treats an allOf gaining a member as breaking, because every member must hold', () => {
        const changes = classify({ allOf: [{ type: 'object' }] }, { allOf: [{ type: 'object' }, { required: ['x'] }] });

        expect(summarize(changes)).toStrictEqual(['allof-member-added@widget/allOf']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('follows a definition and reports a break inside it', () => {
        const changes = classify(
            { $defs: { Node: { type: 'string' } }, $ref: '#/$defs/Node' },
            { $defs: { Node: { type: 'string', maxLength: 2 } }, $ref: '#/$defs/Node' },
        );

        expect(summarize(changes)).toStrictEqual(['bound-tightened@widget/$defs/Node']);
    });

    // A `$ref` that no longer resolves is a document that cannot be read at all, which is why a disappearing
    // definition is breaking even though nothing at the reference site moved.
    it('treats a disappearing definition as breaking', () => {
        const changes = classify(
            { $defs: { Node: { type: 'string' } }, $ref: '#/$defs/Node' },
            { $ref: '#/$defs/Node' },
        );

        expect(summarize(changes)).toStrictEqual(['definition-removed@widget/$defs/Node']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('treats a new definition as non-breaking', () => {
        const changes = classify(
            { $defs: { Node: { type: 'string' } }, $ref: '#/$defs/Node' },
            { $defs: { Node: { type: 'string' }, Other: { type: 'number' } }, $ref: '#/$defs/Node' },
        );

        expect(summarize(changes)).toStrictEqual(['definition-added@widget/$defs/Other']);
        expect(hasBreakingChange(changes)).toBe(false);
    });

    it('treats a repointed $ref as breaking, because nothing here can prove the new target compatible', () => {
        const changes = classify(
            { $defs: { A: { type: 'string' }, B: { type: 'string' } }, $ref: '#/$defs/A' },
            { $defs: { A: { type: 'string' }, B: { type: 'string' } }, $ref: '#/$defs/B' },
        );

        expect(summarize(changes)).toStrictEqual(['ref-changed@widget']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('recurses through additionalProperties when it carries a schema', () => {
        const changes = classify(
            { type: 'object', additionalProperties: { type: 'string' } },
            { type: 'object', additionalProperties: { type: 'string', maxLength: 3 } },
        );

        expect(summarize(changes)).toStrictEqual(['bound-tightened@widget/additionalProperties']);
    });
});

describe('classifyContractChanges — const, which is an enum of one', () => {
    // zod emits `const` for a single literal and `enum` for a union of them, so a union GAINING its second
    // member changes the KEYWORD. Comparing the two keywords independently would report that safe widening as
    // a break — a false positive on the single most common additive change a contract makes.
    it('treats a const widening into an enum that contains it as non-breaking', () => {
        const changes = classify({ const: 'a' }, { enum: ['a', 'b'] });

        expect(hasBreakingChange(changes)).toBe(false);
        expect(summarize(changes)).toStrictEqual(['enum-widened@widget']);
    });

    it('treats an enum narrowing to a const as breaking', () => {
        const changes = classify({ enum: ['a', 'b'] }, { const: 'a' });

        expect(hasBreakingChange(changes)).toBe(true);
        expect(summarize(changes)).toStrictEqual(['enum-narrowed@widget']);
    });

    it('treats a const changing to a different const as breaking', () => {
        expect(hasBreakingChange(classify({ const: 'a' }, { const: 'b' }))).toBe(true);
    });
});

describe('classifyContractChanges — type sets', () => {
    it('treats a type set losing a member as narrowing', () => {
        const changes = classify({ type: ['string', 'null'] }, { type: 'string' });

        expect(summarize(changes)).toStrictEqual(['type-narrowed@widget']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    it('treats a type set gaining a member as widening', () => {
        const changes = classify({ type: 'string' }, { type: ['string', 'null'] });

        expect(summarize(changes)).toStrictEqual(['type-widened@widget']);
        expect(hasBreakingChange(changes)).toBe(false);
    });

    it('treats a type appearing where there was none as narrowing', () => {
        expect(hasBreakingChange(classify({}, { type: 'string' }))).toBe(true);
    });

    it('treats a type disappearing as widening', () => {
        expect(hasBreakingChange(classify({ type: 'string' }, {}))).toBe(false);
    });
});

describe('classifyContractChanges — additionalProperties', () => {
    it('treats an open object closing as breaking', () => {
        const changes = classify(
            { type: 'object', additionalProperties: true },
            { type: 'object', additionalProperties: false },
        );

        expect(summarize(changes)).toStrictEqual(['additional-properties-closed@widget/additionalProperties']);
        expect(hasBreakingChange(changes)).toBe(true);
    });

    // An absent `additionalProperties` MEANS `true` in JSON Schema. A classifier that treated absence as
    // "no constraint to compare" would miss the most common tightening a generated object can make.
    it('treats an ABSENT additionalProperties becoming false as breaking', () => {
        const changes = classify({ type: 'object' }, { type: 'object', additionalProperties: false });

        expect(hasBreakingChange(changes)).toBe(true);
        expect(summarize(changes)).toStrictEqual(['additional-properties-closed@widget/additionalProperties']);
    });

    it('treats a closed object opening as non-breaking', () => {
        expect(hasBreakingChange(classify({ type: 'object', additionalProperties: false }, { type: 'object' }))).toBe(
            false,
        );
    });
});

describe('classifyContractChanges — boolean schemas', () => {
    it('treats `true` becoming `false` as breaking', () => {
        expect(hasBreakingChange(classify(true, false))).toBe(true);
    });

    it('treats `false` becoming a real schema as non-breaking, since nothing validated before', () => {
        expect(hasBreakingChange(classify(false, { type: 'string' }))).toBe(false);
    });

    it('treats `true` becoming a real schema as breaking, since anything validated before', () => {
        expect(hasBreakingChange(classify(true, { type: 'string' }))).toBe(true);
    });
});

describe('classifyContractChanges — FAIL CLOSED on a keyword it does not model', () => {
    // ⛔ THE PROPERTY THAT MADE US WRITE THIS RATHER THAN INSTALL ONE. A differ with incomplete keyword
    // coverage that answers "no breaking change" is a contract that lies. Any keyword this classifier does not
    // model must therefore be reported as breaking WHEN IT CHANGES, so silence is only ever earned.
    it('reports an unmodelled keyword changing as a breaking, explicitly unclassified change', () => {
        const changes = classify(
            { type: 'object', dependentRequired: { a: ['b'] } },
            { type: 'object', dependentRequired: { a: ['b', 'c'] } },
        );

        expect(summarize(changes)).toStrictEqual(['unclassified-change@widget']);
        expect(hasBreakingChange(changes)).toBe(true);
        expect(changes[0]?.detail).toContain('dependentRequired');
    });

    it('reports an unmodelled keyword appearing as breaking', () => {
        expect(hasBreakingChange(classify({ type: 'object' }, { type: 'object', if: { const: 1 } }))).toBe(true);
    });

    it('reports a change under `not` as breaking without trying to reason about the inverted polarity', () => {
        const changes = classify({ not: { type: 'string' } }, { not: { type: 'number' } });

        expect(hasBreakingChange(changes)).toBe(true);
        expect(summarize(changes)).toStrictEqual(['negation-changed@widget/not']);
    });

    it('says nothing about an unmodelled keyword that did NOT change', () => {
        const same: JsonValue = { type: 'object', dependentRequired: { a: ['b'] } };

        expect(classify(same, same)).toStrictEqual([]);
    });
});

describe('hasBreakingChange', () => {
    it('is false for no changes', () => {
        expect(hasBreakingChange([])).toBe(false);
    });

    it('is true when ANY change is breaking, even among many that are not', () => {
        const changes = classify(BASE, {
            ...(withKeyword('description', 'A widget.') as Record<string, JsonValue>),
            required: ['id'],
            properties: {
                ...(BASE as { properties: Record<string, JsonValue> }).properties,
                id: { type: 'string', minLength: 4, maxLength: 26 },
            },
        });

        expect(changes.filter((change) => !change.breaking).length).toBeGreaterThan(0);
        expect(hasBreakingChange(changes)).toBe(true);
    });
});

describe('formatContractChanges', () => {
    it('says so plainly when nothing changed', () => {
        expect(formatContractChanges([])).toContain('No contract change');
    });

    it('leads with the breaking changes and names each path and kind', () => {
        const report = formatContractChanges(
            classify(BASE, { ...(BASE as Record<string, JsonValue>), required: ['id', 'size', 'tag'] }),
        );

        expect(report).toContain('BREAKING');
        expect(report).toContain('property-now-required');
        expect(report).toContain('widget/properties/tag');
    });

    it('names the blind spot, so a clean report is never read as more than it is', () => {
        expect(formatContractChanges([])).toContain('refine');
    });
});
