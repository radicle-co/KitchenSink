/**
 * THE BREAKING-CHANGE CLASSIFIER — a pure function over two published contract fingerprints.
 *
 * It answers one question: **can the move from the first document to the second break a party that spoke the
 * first?** It reads `contract.schema.json` (see `contractFingerprint.ts`) and nothing else: no filesystem, no
 * git, no network, no zod. Two documents in, a list of classified changes out.
 *
 * ── WHY THIS IS HAND-WRITTEN, WHICH IS NORMALLY THE WRONG ANSWER ──
 *
 * `docs/CODING_STANDARDS.md` and the library-first gate both say: reach for the maintained package. There is
 * no maintained package to reach for. JSON Schema has **no official compatibility checker**, and the closest
 * candidate (`json-schema-diff`, v1.0.0) has incomplete keyword coverage — it can answer "no breaking change"
 * for a keyword it does not model. `oasdiff` is a Go binary that runs nowhere in this toolchain, and pointing
 * it at the DERIVED `openapi.yaml` would put that document on the gating path, which ADR-0014 §1 rejects.
 *
 * A differ that misses a keyword and reports "compatible" is a contract that lies — the exact failure ADR-0014
 * refuses. So the one property that matters most here is not coverage, it is **FAIL-CLOSED**: every keyword
 * this module does not model is compared for equality, and any difference is reported as a breaking,
 * explicitly `unclassified-change`. Silence is only ever earned. Adding a rule can therefore only ever make
 * the report MORE precise; it can never turn a reported break into silence by accident.
 *
 * ── WHAT IT CANNOT SEE (state this wherever this module is described) ──
 *
 * The input is JSON Schema derived from zod, and **`.refine()` / `.superRefine()` predicates do not project
 * into JSON Schema at all**. A business rule that lives inside a refinement — "endsAt must be after startsAt",
 * "this field is required only when `kind === 'x'`" — can be tightened to the point of rejecting every request
 * a client sends, and this classifier will report no change whatsoever. So will a `.transform()`. That is a
 * hard limit of the projection, not a gap to be closed here, and an artifact that hid it would be a false
 * guarantee. `packages/services/<service>`'s own tests are what cover refinement semantics.
 *
 * ── DIRECTION, AND WHY IT IS DELIBERATELY CONSERVATIVE ──
 *
 * One fingerprint holds both REQUEST and RESPONSE shapes, and nothing in JSON Schema says which is which. A
 * change that is safe for a response producer (a new required field) is a break for a request producer, so the
 * classifier answers for BOTH readings and reports the union: anything that could break either party is
 * breaking. The alternative — guessing the direction from an export's name — would be a gate whose correctness
 * depended on a naming convention.
 *
 * DESIGN PATTERN: Functional Core. Every export is a pure function; there is no I/O in this module.
 */

/** A JSON value, as it appears inside a JSON Schema document. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** A JSON object, as it appears inside a JSON Schema document. */
type JsonObject = { readonly [key: string]: JsonValue };

/**
 * A published contract fingerprint, as far as this module is concerned.
 *
 * Only `schemas` is read. The document's other members are provenance — the regenerate command, the blind-spot
 * note — and a change to them is not a change to the contract.
 */
export interface ContractDocument {
    /** Exported schema name → its JSON Schema projection. */
    readonly schemas: Readonly<Record<string, JsonValue>>;
}

/** What kind of difference one finding is. The name is the vocabulary a review uses. */
export type ContractChangeKind =
    | 'schema-removed'
    | 'schema-added'
    | 'property-removed'
    | 'property-added'
    | 'property-added-required'
    | 'property-now-required'
    | 'property-now-optional'
    | 'required-added'
    | 'required-removed'
    | 'enum-narrowed'
    | 'enum-widened'
    | 'enum-removed'
    | 'type-narrowed'
    | 'type-widened'
    | 'type-changed'
    | 'bound-tightened'
    | 'bound-loosened'
    | 'constraint-added'
    | 'constraint-changed'
    | 'constraint-removed'
    | 'additional-properties-closed'
    | 'additional-properties-opened'
    | 'union-member-removed'
    | 'union-member-added'
    | 'allof-member-added'
    | 'allof-member-removed'
    | 'tuple-arity-changed'
    | 'definition-removed'
    | 'definition-added'
    | 'ref-changed'
    | 'negation-changed'
    | 'schema-narrowed'
    | 'schema-widened'
    | 'annotation-changed'
    | 'unclassified-change';

/** One classified difference between two fingerprints. */
export interface ContractChange {
    /** Where it is, as a `/`-joined path rooted at the exported schema's name. */
    readonly path: string;
    /** What kind of difference it is. */
    readonly kind: ContractChangeKind;
    /** Whether it can break a party that spoke the previous document. */
    readonly breaking: boolean;
    /** The difference in words, naming the keyword and both values. */
    readonly detail: string;
}

/**
 * Keywords that carry no constraint: changing one cannot break anybody.
 *
 * `default` is here deliberately. It changes what a server assumes for an omitted value, which is a semantic
 * change worth reviewing — but every value a client could previously send is still accepted, so it is not a
 * compatibility break, and reporting it as one would train reviewers to ignore the report.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
    '$anchor',
    '$comment',
    '$id',
    '$schema',
    'default',
    'deprecated',
    'description',
    'examples',
    'id',
    'title',
]);

/** Bounds whose INCREASE tightens the schema (and whose appearance tightens it). */
const LOWER_BOUND_KEYWORDS: ReadonlySet<string> = new Set([
    'exclusiveMinimum',
    'minContains',
    'minItems',
    'minLength',
    'minProperties',
    'minimum',
]);

/** Bounds whose DECREASE tightens the schema (and whose appearance tightens it). */
const UPPER_BOUND_KEYWORDS: ReadonlySet<string> = new Set([
    'exclusiveMaximum',
    'maxContains',
    'maxItems',
    'maxLength',
    'maxProperties',
    'maximum',
]);

/**
 * Boolean keywords whose `true` is the strict reading.
 *
 * `writeOnly` belongs here for a reason worth stating: marking a field write-only removes it from every
 * response, so a reader that depended on it now gets nothing.
 */
const TIGHTENING_FLAG_KEYWORDS: ReadonlySet<string> = new Set(['readOnly', 'uniqueItems', 'writeOnly']);

/**
 * Constraints this module does not attempt to order: their APPEARANCE or any CHANGE is treated as tightening,
 * their removal as loosening.
 *
 * `multipleOf` is the clearest case for refusing to be clever: 4 → 2 is a widening, 3 → 2 is neither, and a
 * classifier that guessed would be wrong in the direction that matters.
 */
const OPAQUE_CONSTRAINT_KEYWORDS: ReadonlySet<string> = new Set([
    'contentEncoding',
    'contentMediaType',
    'format',
    'multipleOf',
    'pattern',
]);

/** Keywords handled by an explicit rule below. Everything else falls to the fail-closed sweep. */
const MODELLED_KEYWORDS: ReadonlySet<string> = new Set([
    ...ANNOTATION_KEYWORDS,
    ...LOWER_BOUND_KEYWORDS,
    ...UPPER_BOUND_KEYWORDS,
    ...TIGHTENING_FLAG_KEYWORDS,
    ...OPAQUE_CONSTRAINT_KEYWORDS,
    '$defs',
    '$ref',
    'additionalProperties',
    'allOf',
    'anyOf',
    'const',
    'contains',
    'definitions',
    'enum',
    'items',
    'not',
    'oneOf',
    'patternProperties',
    'prefixItems',
    'properties',
    'propertyNames',
    'required',
    'type',
]);

/** The composition keywords whose members are alternatives (any one may hold). */
const UNION_KEYWORDS: readonly string[] = ['anyOf', 'oneOf'];

/** Where the two `$defs` spellings live. */
const DEFINITION_KEYWORDS: readonly string[] = ['$defs', 'definitions'];

/**
 * Whether a value is a JSON object (and therefore a schema node rather than a boolean schema or a scalar).
 *
 * @param value - The value to test.
 * @returns True for a non-array object. Pure.
 */
function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural equality over JSON, with object key order ignored and array order respected.
 *
 * Key order is not semantic in JSON; array order is (`prefixItems` is positional), so the two are treated
 * differently on purpose.
 *
 * @param left - One value.
 * @param right - The other.
 * @returns True when they denote the same JSON. Pure.
 */
export function jsonEquals(left: JsonValue, right: JsonValue): boolean {
    if (left === right) {
        return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index] as JsonValue));
    }

    if (isJsonObject(left) && isJsonObject(right)) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();

        return (
            leftKeys.length === rightKeys.length &&
            leftKeys.every((key, index) => key === rightKeys[index]) &&
            leftKeys.every((key) => jsonEquals(left[key] as JsonValue, right[key] as JsonValue))
        );
    }

    return false;
}

/**
 * A canonical string for a JSON value, so members of a union can be compared as a multiset.
 *
 * @param value - The value to canonicalize.
 * @returns A stable string. Pure.
 */
function canonical(value: JsonValue): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }

    if (isJsonObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

/**
 * Read a schema node's `type` as a set.
 *
 * @param node - The schema node.
 * @returns The declared types, or undefined when the node declares none (which means "any").
 */
function typeSet(node: JsonObject): readonly string[] | undefined {
    const declared = node['type'];

    if (typeof declared === 'string') {
        return [declared];
    }

    if (Array.isArray(declared)) {
        return declared.filter((entry): entry is string => typeof entry === 'string');
    }

    return undefined;
}

/**
 * Read a schema node's allowed-value set, treating `const: X` as `enum: [X]`.
 *
 * ⚠️ THE NORMALIZATION IS LOAD-BEARING, not tidiness. zod emits `const` for a single literal and `enum` for a
 * union of them, so a union GAINING its second member changes the keyword from `const` to `enum`. Comparing the
 * two keywords independently would report that widening — the most common additive change a contract makes —
 * as a removed `const` plus an introduced `enum`, i.e. a false break.
 *
 * @param node - The schema node.
 * @returns The allowed values as canonical strings, or undefined when the node allows anything.
 */
function allowedValues(node: JsonObject): readonly string[] | undefined {
    const declared = node['enum'];

    if (Array.isArray(declared)) {
        return declared.map(canonical);
    }

    if ('const' in node) {
        return [canonical(node['const'] as JsonValue)];
    }

    return undefined;
}

/** A mutable collector, so the recursion can append without threading an accumulator through every rule. */
type Sink = ContractChange[];

/**
 * Append one finding.
 *
 * @param sink - The collector.
 * @param change - The finding.
 * @sideEffect Mutates `sink`, which is local to one {@link classifyContractChanges} call.
 */
function record(sink: Sink, change: ContractChange): void {
    sink.push(change);
}

/**
 * Compare one keyword that is present on at most one side, or on both.
 *
 * @param options - The keyword, its two values, the node path and the verdicts to record.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareConstraintKeyword(
    options: {
        readonly keyword: string;
        readonly previous: JsonValue | undefined;
        readonly next: JsonValue | undefined;
        readonly path: string;
        readonly onTighten: ContractChangeKind;
        readonly onLoosen: ContractChangeKind;
        readonly tightens: (previous: JsonValue, next: JsonValue) => boolean;
    },
    sink: Sink,
): void {
    const { keyword, previous, next, path } = options;

    if (previous === undefined && next === undefined) {
        return;
    }

    if (previous === undefined) {
        record(sink, {
            path,
            kind: options.onTighten,
            breaking: true,
            detail: `\`${keyword}\` appeared (${JSON.stringify(next)}), which only narrows what is accepted`,
        });

        return;
    }

    if (next === undefined) {
        record(sink, {
            path,
            kind: options.onLoosen,
            breaking: false,
            detail: `\`${keyword}\` was removed (was ${JSON.stringify(previous)})`,
        });

        return;
    }

    if (jsonEquals(previous, next)) {
        return;
    }

    const tightened = options.tightens(previous, next);

    record(sink, {
        path,
        kind: tightened ? options.onTighten : options.onLoosen,
        breaking: tightened,
        detail: `\`${keyword}\` ${JSON.stringify(previous)} → ${JSON.stringify(next)}`,
    });
}

/**
 * Compare every bound, flag and opaque constraint on a node.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareScalarConstraints(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    for (const keyword of [...LOWER_BOUND_KEYWORDS].sort()) {
        compareConstraintKeyword(
            {
                keyword,
                previous: previous[keyword],
                next: next[keyword],
                path,
                onTighten: 'bound-tightened',
                onLoosen: 'bound-loosened',
                tightens: (before, after) => Number(after) > Number(before),
            },
            sink,
        );
    }

    for (const keyword of [...UPPER_BOUND_KEYWORDS].sort()) {
        compareConstraintKeyword(
            {
                keyword,
                previous: previous[keyword],
                next: next[keyword],
                path,
                onTighten: 'bound-tightened',
                onLoosen: 'bound-loosened',
                tightens: (before, after) => Number(after) < Number(before),
            },
            sink,
        );
    }

    for (const keyword of [...TIGHTENING_FLAG_KEYWORDS].sort()) {
        compareConstraintKeyword(
            {
                keyword,
                previous: previous[keyword] === false ? undefined : previous[keyword],
                next: next[keyword] === false ? undefined : next[keyword],
                path,
                onTighten: 'constraint-added',
                onLoosen: 'constraint-removed',
                tightens: () => true,
            },
            sink,
        );
    }

    for (const keyword of [...OPAQUE_CONSTRAINT_KEYWORDS].sort()) {
        compareConstraintKeyword(
            {
                keyword,
                previous: previous[keyword],
                next: next[keyword],
                path,
                onTighten: 'constraint-added',
                onLoosen: 'constraint-removed',
                // A changed pattern/format/multipleOf is treated as tightening: it cannot be ordered without
                // deciding language inclusion, and guessing "compatible" is the failure this module exists to
                // avoid.
                tightens: () => true,
            },
            sink,
        );
    }
}

/**
 * Compare the `type` keyword as a set.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareType(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = typeSet(previous);
    const after = typeSet(next);

    if (before === undefined && after === undefined) {
        return;
    }

    if (before === undefined) {
        record(sink, {
            path,
            kind: 'type-narrowed',
            breaking: true,
            detail: `\`type\` appeared (${(after ?? []).join(' | ')}) where the value was previously unconstrained`,
        });

        return;
    }

    if (after === undefined) {
        record(sink, {
            path,
            kind: 'type-widened',
            breaking: false,
            detail: `\`type\` was removed (was ${before.join(' | ')})`,
        });

        return;
    }

    const lost = before.filter((entry) => !after.includes(entry));
    const gained = after.filter((entry) => !before.includes(entry));

    if (lost.length === 0 && gained.length === 0) {
        return;
    }

    if (lost.length > 0 && gained.length === 0) {
        record(sink, {
            path,
            kind: 'type-narrowed',
            breaking: true,
            detail: `\`type\` no longer admits ${lost.join(', ')}`,
        });

        return;
    }

    if (gained.length > 0 && lost.length === 0) {
        record(sink, {
            path,
            kind: 'type-widened',
            breaking: false,
            detail: `\`type\` also admits ${gained.join(', ')}`,
        });

        return;
    }

    record(sink, {
        path,
        kind: 'type-changed',
        breaking: true,
        detail: `\`type\` ${before.join(' | ')} → ${after.join(' | ')}`,
    });
}

/**
 * Compare the allowed-value set (`enum`, or a `const` normalized into one).
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareAllowedValues(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = allowedValues(previous);
    const after = allowedValues(next);

    if (before === undefined && after === undefined) {
        return;
    }

    if (before === undefined) {
        record(sink, {
            path,
            kind: 'enum-narrowed',
            breaking: true,
            detail: `the value is now restricted to ${(after ?? []).join(', ')}`,
        });

        return;
    }

    if (after === undefined) {
        record(sink, {
            path,
            kind: 'enum-removed',
            breaking: false,
            detail: `the restriction to ${before.join(', ')} was removed`,
        });

        return;
    }

    const lost = before.filter((entry) => !after.includes(entry));
    const gained = after.filter((entry) => !before.includes(entry));

    if (lost.length > 0) {
        record(sink, {
            path,
            kind: 'enum-narrowed',
            breaking: true,
            detail: `no longer admits ${lost.join(', ')}`,
        });

        return;
    }

    if (gained.length > 0) {
        record(sink, {
            path,
            kind: 'enum-widened',
            breaking: false,
            detail: `also admits ${gained.join(', ')}`,
        });
    }
}

/**
 * Compare an object node's properties and their optionality.
 *
 * A property that is added AND required is reported once, as `property-added-required`, rather than as an
 * addition plus a required-set change: two findings for one edit is how a report becomes unreadable.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareProperties(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = isJsonObject(previous['properties'] as JsonValue) ? (previous['properties'] as JsonObject) : {};
    const after = isJsonObject(next['properties'] as JsonValue) ? (next['properties'] as JsonObject) : {};
    const beforeRequired = new Set(
        (Array.isArray(previous['required']) ? previous['required'] : []).filter(
            (entry): entry is string => typeof entry === 'string',
        ),
    );
    const afterRequired = new Set(
        (Array.isArray(next['required']) ? next['required'] : []).filter(
            (entry): entry is string => typeof entry === 'string',
        ),
    );

    const names = [...new Set([...Object.keys(before), ...Object.keys(after), ...beforeRequired, ...afterRequired])]
        .sort()
        .values();

    for (const name of names) {
        const propertyPath = `${path}/properties/${name}`;
        const existedBefore = name in before;
        const existsAfter = name in after;

        if (existedBefore && !existsAfter) {
            record(sink, {
                path: propertyPath,
                kind: 'property-removed',
                breaking: true,
                detail: 'the property is no longer part of the published shape',
            });

            continue;
        }

        if (!existedBefore && existsAfter) {
            const required = afterRequired.has(name);

            record(sink, {
                path: propertyPath,
                kind: required ? 'property-added-required' : 'property-added',
                breaking: required,
                detail: required
                    ? 'a new REQUIRED property: a caller that produced the previous shape does not send it'
                    : 'a new optional property',
            });

            continue;
        }

        if (!existedBefore && !existsAfter) {
            // A name that appears only in `required`, with no `properties` entry — legal JSON Schema, and
            // still an optionality change.
            if (!beforeRequired.has(name) && afterRequired.has(name)) {
                record(sink, {
                    path: propertyPath,
                    kind: 'required-added',
                    breaking: true,
                    detail: 'the name became required although the node describes no such property',
                });
            } else if (beforeRequired.has(name) && !afterRequired.has(name)) {
                record(sink, {
                    path: propertyPath,
                    kind: 'required-removed',
                    breaking: false,
                    detail: 'the name is no longer required',
                });
            }

            continue;
        }

        if (!beforeRequired.has(name) && afterRequired.has(name)) {
            record(sink, {
                path: propertyPath,
                kind: 'property-now-required',
                breaking: true,
                detail: 'an optional property became required',
            });
        } else if (beforeRequired.has(name) && !afterRequired.has(name)) {
            record(sink, {
                path: propertyPath,
                kind: 'property-now-optional',
                breaking: false,
                detail: 'a required property became optional',
            });
        }

        compareNode(before[name] as JsonValue, after[name] as JsonValue, propertyPath, sink);
    }
}

/**
 * Compare `additionalProperties`, where ABSENT means `true`.
 *
 * Treating absence as "nothing to compare" would miss the single most common tightening a generated object can
 * make: an open object becoming closed.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareAdditionalProperties(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = 'additionalProperties' in previous ? (previous['additionalProperties'] as JsonValue) : true;
    const after = 'additionalProperties' in next ? (next['additionalProperties'] as JsonValue) : true;
    const keywordPath = `${path}/additionalProperties`;

    if (jsonEquals(before, after)) {
        return;
    }

    if (after === false) {
        record(sink, {
            path: keywordPath,
            kind: 'additional-properties-closed',
            breaking: true,
            detail: 'the object no longer accepts properties it does not name',
        });

        return;
    }

    if (before === false) {
        record(sink, {
            path: keywordPath,
            kind: 'additional-properties-opened',
            breaking: false,
            detail: 'the object now accepts properties it does not name',
        });

        return;
    }

    compareNode(before, after, keywordPath, sink);
}

/**
 * Compare a keyword whose value is a subschema (`items`, `contains`, `propertyNames`).
 *
 * @param keyword - The keyword.
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareSubschemaKeyword(
    keyword: string,
    previous: JsonObject,
    next: JsonObject,
    path: string,
    sink: Sink,
): void {
    const before = previous[keyword];
    const after = next[keyword];

    if (before === undefined && after === undefined) {
        return;
    }

    if (before === undefined) {
        record(sink, {
            path: `${path}/${keyword}`,
            kind: 'constraint-added',
            breaking: true,
            detail: `\`${keyword}\` appeared, constraining values that were previously unconstrained`,
        });

        return;
    }

    if (after === undefined) {
        record(sink, {
            path: `${path}/${keyword}`,
            kind: 'constraint-removed',
            breaking: false,
            detail: `\`${keyword}\` was removed`,
        });

        return;
    }

    compareNode(before, after, `${path}/${keyword}`, sink);
}

/**
 * Compare a union's members as a MULTISET first, pairing only what is left over.
 *
 * Comparing positionally alone would report a reordered union as two changes at every position, and a union's
 * member order carries no meaning. Pairing the leftovers is what keeps a genuinely EDITED branch reported as
 * the edit it is (a tightened bound inside branch 0) rather than as a removal plus an addition.
 *
 * @param keyword - `anyOf` or `oneOf`.
 * @param previous - The published members.
 * @param next - The regenerated members.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareUnionMembers(
    keyword: string,
    previous: readonly JsonValue[],
    next: readonly JsonValue[],
    path: string,
    sink: Sink,
): void {
    const nextCanonical = next.map(canonical);
    const previousCanonical = previous.map(canonical);
    const matchedNext = new Set<number>();
    const unmatchedPrevious: { readonly value: JsonValue; readonly index: number }[] = [];

    previousCanonical.forEach((signature, index) => {
        const match = nextCanonical.findIndex(
            (other, otherIndex) => other === signature && !matchedNext.has(otherIndex),
        );

        if (match === -1) {
            unmatchedPrevious.push({ value: previous[index] as JsonValue, index });

            return;
        }

        matchedNext.add(match);
    });

    const unmatchedNext = next.filter((_member, index) => !matchedNext.has(index));
    const paired = Math.min(unmatchedPrevious.length, unmatchedNext.length);

    for (let position = 0; position < paired; position += 1) {
        const left = unmatchedPrevious[position];

        compareNode(left?.value as JsonValue, unmatchedNext[position] as JsonValue, `${path}/${left?.index}`, sink);
    }

    const removed = unmatchedPrevious.length - paired;
    const added = unmatchedNext.length - paired;

    if (removed > 0) {
        record(sink, {
            path,
            kind: 'union-member-removed',
            breaking: true,
            detail: `\`${keyword}\` lost ${removed} alternative(s), so values it used to admit are now rejected`,
        });
    }

    if (added > 0) {
        record(sink, {
            path,
            kind: 'union-member-added',
            breaking: false,
            detail: `\`${keyword}\` gained ${added} alternative(s)`,
        });
    }
}

/**
 * Compare the composition keywords: `anyOf`/`oneOf` (alternatives) and `allOf` (conjunction).
 *
 * The two have opposite polarity, which is why they cannot share a rule: gaining an ALTERNATIVE widens, gaining
 * a CONJUNCT narrows.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareComposition(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    for (const keyword of UNION_KEYWORDS) {
        const before = previous[keyword];
        const after = next[keyword];

        if (before === undefined && after === undefined) {
            continue;
        }

        if (!Array.isArray(before) || !Array.isArray(after)) {
            compareSubschemaKeyword(keyword, previous, next, path, sink);

            continue;
        }

        compareUnionMembers(keyword, before, after, `${path}/${keyword}`, sink);
    }

    const beforeAll = previous['allOf'];
    const afterAll = next['allOf'];

    if (beforeAll === undefined && afterAll === undefined) {
        return;
    }

    if (!Array.isArray(beforeAll) || !Array.isArray(afterAll)) {
        compareSubschemaKeyword('allOf', previous, next, path, sink);

        return;
    }

    const compositionPath = `${path}/allOf`;
    const paired = Math.min(beforeAll.length, afterAll.length);

    for (let position = 0; position < paired; position += 1) {
        compareNode(
            beforeAll[position] as JsonValue,
            afterAll[position] as JsonValue,
            `${compositionPath}/${position}`,
            sink,
        );
    }

    if (afterAll.length > beforeAll.length) {
        record(sink, {
            path: compositionPath,
            kind: 'allof-member-added',
            breaking: true,
            detail: `\`allOf\` gained ${afterAll.length - beforeAll.length} conjunct(s); every one of them must now hold`,
        });
    }

    if (afterAll.length < beforeAll.length) {
        record(sink, {
            path: compositionPath,
            kind: 'allof-member-removed',
            breaking: false,
            detail: `\`allOf\` lost ${beforeAll.length - afterAll.length} conjunct(s)`,
        });
    }
}

/**
 * Compare a map of named subschemas (`$defs`, `definitions`, `patternProperties`).
 *
 * @param keyword - The map keyword.
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareSubschemaMap(keyword: string, previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = isJsonObject(previous[keyword] as JsonValue) ? (previous[keyword] as JsonObject) : {};
    const after = isJsonObject(next[keyword] as JsonValue) ? (next[keyword] as JsonObject) : {};
    const isDefinitions = DEFINITION_KEYWORDS.includes(keyword);

    for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        const entryPath = `${path}/${keyword}/${name}`;

        if (!(name in after)) {
            record(sink, {
                path: entryPath,
                kind: isDefinitions ? 'definition-removed' : 'constraint-removed',
                breaking: isDefinitions,
                detail: isDefinitions
                    ? 'a referenced definition disappeared, so anything pointing at it no longer resolves'
                    : `\`${keyword}\` entry removed`,
            });

            continue;
        }

        if (!(name in before)) {
            record(sink, {
                path: entryPath,
                kind: isDefinitions ? 'definition-added' : 'constraint-added',
                breaking: !isDefinitions,
                detail: isDefinitions ? 'a new definition' : `\`${keyword}\` entry added, constraining more keys`,
            });

            continue;
        }

        compareNode(before[name] as JsonValue, after[name] as JsonValue, entryPath, sink);
    }
}

/**
 * Compare two schema nodes, appending every difference found under `path`.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path, rooted at the exported schema's name.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareNode(previous: JsonValue, next: JsonValue, path: string, sink: Sink): void {
    if (jsonEquals(previous, next)) {
        return;
    }

    // A boolean schema — `true` admits everything, `false` admits nothing — so any move between the boolean
    // form and an object form is a straight widening or narrowing, and there is nothing to walk into.
    if (!isJsonObject(previous) || !isJsonObject(next)) {
        const previouslyAnything = previous === true;
        const previouslyNothing = previous === false;
        const nowAnything = next === true;
        const nowNothing = next === false;

        if (nowNothing || (previouslyAnything && isJsonObject(next))) {
            record(sink, {
                path,
                kind: 'schema-narrowed',
                breaking: true,
                detail: 'the node admits strictly less than it did',
            });

            return;
        }

        if (previouslyNothing || (nowAnything && isJsonObject(previous))) {
            record(sink, {
                path,
                kind: 'schema-widened',
                breaking: false,
                detail: 'the node admits strictly more than it did',
            });

            return;
        }

        record(sink, {
            path,
            kind: 'unclassified-change',
            breaking: true,
            detail: `the node is not a schema this classifier models: ${canonical(previous)} → ${canonical(next)}`,
        });

        return;
    }

    const previousRef = previous['$ref'];
    const nextRef = next['$ref'];

    if (!jsonEquals(previousRef ?? null, nextRef ?? null)) {
        record(sink, {
            path,
            kind: 'ref-changed',
            breaking: true,
            detail: `\`$ref\` ${JSON.stringify(previousRef ?? null)} → ${JSON.stringify(nextRef ?? null)}; nothing here can prove the new target compatible`,
        });
    }

    compareType(previous, next, path, sink);
    compareAllowedValues(previous, next, path, sink);
    compareScalarConstraints(previous, next, path, sink);
    compareProperties(previous, next, path, sink);
    compareAdditionalProperties(previous, next, path, sink);

    for (const keyword of ['items', 'contains', 'propertyNames']) {
        compareSubschemaKeyword(keyword, previous, next, path, sink);
    }

    comparePrefixItems(previous, next, path, sink);
    compareComposition(previous, next, path, sink);

    for (const keyword of [...DEFINITION_KEYWORDS, 'patternProperties']) {
        compareSubschemaMap(keyword, previous, next, path, sink);
    }

    compareNegation(previous, next, path, sink);
    compareAnnotations(previous, next, path, sink);
    reportUnmodelledKeywords(previous, next, path, sink);
}

/**
 * Compare `prefixItems`, whose order IS semantic.
 *
 * An arity change is reported as breaking in both directions on purpose: a shorter tuple drops a position a
 * reader consumed, a longer one demands a position a writer does not send, and this module cannot tell which
 * side of the wire a schema is on.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function comparePrefixItems(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = previous['prefixItems'];
    const after = next['prefixItems'];

    if (before === undefined && after === undefined) {
        return;
    }

    if (!Array.isArray(before) || !Array.isArray(after)) {
        compareSubschemaKeyword('prefixItems', previous, next, path, sink);

        return;
    }

    if (before.length !== after.length) {
        record(sink, {
            path: `${path}/prefixItems`,
            kind: 'tuple-arity-changed',
            breaking: true,
            detail: `the tuple's arity moved ${before.length} → ${after.length}`,
        });

        return;
    }

    before.forEach((member, index) => {
        compareNode(member, after[index] as JsonValue, `${path}/prefixItems/${index}`, sink);
    });
}

/**
 * Compare `not`, without trying to reason about its inverted polarity.
 *
 * Under `not`, tightening the inner schema LOOSENS the outer one, so every rule in this module reads backwards
 * there. Rather than maintain a second, inverted rule set for a keyword zod does not emit, any difference is
 * reported as breaking and left to a human.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareNegation(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const before = previous['not'];
    const after = next['not'];

    if (before === undefined && after === undefined) {
        return;
    }

    if (before !== undefined && after !== undefined && jsonEquals(before, after)) {
        return;
    }

    record(sink, {
        path: `${path}/not`,
        kind: 'negation-changed',
        breaking: true,
        detail: '`not` changed; its polarity is inverted, so this classifier defers to a human',
    });
}

/**
 * Report annotation edits, which are never breaking but are worth seeing in a review.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function compareAnnotations(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    for (const keyword of [...ANNOTATION_KEYWORDS].sort()) {
        const before = previous[keyword];
        const after = next[keyword];

        if (before === undefined && after === undefined) {
            continue;
        }

        if (before !== undefined && after !== undefined && jsonEquals(before, after)) {
            continue;
        }

        record(sink, {
            path,
            kind: 'annotation-changed',
            breaking: false,
            detail: `\`${keyword}\` ${JSON.stringify(before ?? null)} → ${JSON.stringify(after ?? null)}`,
        });
    }
}

/**
 * THE FAIL-CLOSED SWEEP — every keyword no rule above models.
 *
 * ⛔ Do not "tidy" this away, and do not add a keyword to {@link MODELLED_KEYWORDS} without adding the rule
 * that models it. This is the single property that separates this classifier from the incomplete differs
 * ADR-0014 rejects: a keyword nobody taught it about produces a LOUD breaking finding, not silence.
 *
 * @param previous - The published node.
 * @param next - The regenerated node.
 * @param path - The node's path.
 * @param sink - The collector.
 * @sideEffect Appends to `sink`.
 */
function reportUnmodelledKeywords(previous: JsonObject, next: JsonObject, path: string, sink: Sink): void {
    const keywords = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();

    for (const keyword of keywords) {
        if (MODELLED_KEYWORDS.has(keyword) || keyword.startsWith('x-')) {
            continue;
        }

        const before = previous[keyword];
        const after = next[keyword];

        if (before !== undefined && after !== undefined && jsonEquals(before, after)) {
            continue;
        }

        record(sink, {
            path,
            kind: 'unclassified-change',
            breaking: true,
            detail:
                `\`${keyword}\` changed and this classifier does not model it, so it is reported as breaking ` +
                'rather than assumed safe',
        });
    }
}

/**
 * Classify every difference between two published contract fingerprints.
 *
 * Findings come back in a deterministic order — exported schemas alphabetically, then the fixed keyword order
 * of the rules — so the same pair always produces the same report, and a report can be diffed against itself.
 *
 * @param previous - The fingerprint that is published today.
 * @param next - The fingerprint the generator just produced.
 * @returns Every classified difference. Pure.
 */
export function classifyContractChanges(previous: ContractDocument, next: ContractDocument): readonly ContractChange[] {
    const sink: Sink = [];
    const names = [...new Set([...Object.keys(previous.schemas), ...Object.keys(next.schemas)])].sort();

    for (const name of names) {
        const before = previous.schemas[name];
        const after = next.schemas[name];

        if (before !== undefined && after === undefined) {
            record(sink, {
                path: name,
                kind: 'schema-removed',
                breaking: true,
                detail: 'the published contract no longer exports this schema',
            });

            continue;
        }

        if (before === undefined && after !== undefined) {
            record(sink, {
                path: name,
                kind: 'schema-added',
                breaking: false,
                detail: 'a newly published schema',
            });

            continue;
        }

        compareNode(before as JsonValue, after as JsonValue, name, sink);
    }

    return sink;
}

/**
 * Whether any finding can break a party that spoke the previous document.
 *
 * @param changes - The classification.
 * @returns True when at least one change is breaking. Pure.
 */
export function hasBreakingChange(changes: readonly ContractChange[]): boolean {
    return changes.some((change) => change.breaking);
}

/**
 * The line every report carries, breaking or not.
 *
 * A clean report must never be read as "the contract is unchanged in every way that matters" — the projection
 * cannot see a refinement, so silence here is narrower than it looks.
 */
const BLIND_SPOT_NOTE =
    'Blind spot: a zod `.refine()`/`.superRefine()` predicate does not project into JSON Schema, so a rule ' +
    'changed inside one is invisible to this comparison.';

/**
 * Render a classification as an operator-facing report, breaking findings first.
 *
 * @param changes - The classification.
 * @returns A multi-line report. Pure.
 */
export function formatContractChanges(changes: readonly ContractChange[]): string {
    const breaking = changes.filter((change) => change.breaking);
    const compatible = changes.filter((change) => !change.breaking);

    if (changes.length === 0) {
        return ['No contract change detected in the published JSON Schema projection.', BLIND_SPOT_NOTE].join('\n');
    }

    const lines: string[] = [];

    if (breaking.length > 0) {
        lines.push(`${breaking.length} BREAKING change(s):`);
        lines.push(...breaking.map((change) => `  ✗ ${change.path} — ${change.kind}: ${change.detail}`));
    } else {
        lines.push('No BREAKING change detected.');
    }

    if (compatible.length > 0) {
        lines.push(`${compatible.length} compatible change(s):`);
        lines.push(...compatible.map((change) => `  · ${change.path} — ${change.kind}: ${change.detail}`));
    }

    lines.push(BLIND_SPOT_NOTE);

    return lines.join('\n');
}
