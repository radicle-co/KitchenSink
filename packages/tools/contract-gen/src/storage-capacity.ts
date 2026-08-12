/**
 * THE STORAGE-CAPACITY GATE — one invariant, asserted mechanically, for every service.
 *
 * > For every wire field that writes to a bounded column, the zod max must be ≤ what the column can
 * > physically store.
 *
 * ── WHY THIS EXISTS (it is a measured defect class, not a hypothetical) ──
 *
 * `POST /api/v1/recipes` with `servings: 9999999999` passed request validation and failed at the INSERT:
 * Postgres answered `22003 value "9999999999" is out of range for type integer`, the `ApiExceptionFilter`
 * collapsed the unrecognized throwable to a generic **500**, and the caller was told the server broke when
 * the truth is the caller sent a bad request. Five int-backed recipe fields shared that shape, and four
 * `numeric(8,2)` nutrition overrides had it too. The same failure reaches a WHERE clause, not just an
 * INSERT: `WHERE current_version = $1` with an out-of-range value is the identical `22003`.
 *
 * A bound is only as good as its weakest end, and the weak end here is invisible: nothing in a zod schema
 * mentions a column, and nothing in a column mentions a schema. This module makes the pair checkable.
 *
 * ── IT IS AN ASSERTION, NOT A DERIVATION (the constraint that shapes everything below) ──
 *
 * ⚠️ This module **reads both sides and compares them**. It does NOT generate zod from drizzle, and nothing
 * here lets a storage type become a wire type — that coupling is precisely what the §15 migration removed
 * (`RecipeSearchResponse.facets` used to take its wire type from `dal/search.dal.ts`). Consequently:
 *
 *  - it takes the drizzle tables as `unknown` and reads them STRUCTURALLY, through drizzle's own
 *    registered symbols (`Symbol.for('drizzle:Columns')`), so `@kitchensink/contract-gen` needs no
 *    `drizzle-orm` dependency — this package is imported by all three services and must not drag an ORM
 *    (nor, transitively, anything else) behind it;
 *  - it takes the zod schemas as `unknown` too, and reads their bounds through the PUBLIC
 *    `z.toJSONSchema` rather than zod's internals, which is also what makes `.optional()`/`.nullable()`/
 *    `.default()`/`z.coerce` unwrap correctly without a hand-rolled walker;
 *  - the MAPPING from wire field to column is supplied by the caller, per service, because that knowledge
 *    is genuinely the service's and cannot be inferred: two fields may write one column, and a column may
 *    be written by none.
 *
 * ── THE AUDIT IS EXHAUSTIVE OVER COLUMNS, WHICH IS WHERE ITS TEETH ARE ──
 *
 * {@link auditStorageCapacity} requires EVERY bounded column to be explicitly accounted for — either bound
 * to the wire fields that write it, or declared not-client-writable with a reason. A new `varchar(n)` or
 * `smallint` column therefore fails the gate the moment it is added, which is the only version of this
 * check that catches the NEXT instance rather than re-litigating the last one. Two symmetrical failures
 * keep the bookkeeping honest in the other direction: a `stale-account` entry (naming a column that is no
 * longer bounded, was renamed, or never existed) and a `duplicate-account` entry (two entries that could
 * disagree about one column).
 *
 * DESIGN PATTERN: Specification over two independently-parsed models. Every function here is PURE.
 */

/** The int4 ceiling — what a Postgres `integer` column can hold. */
export const INT4_MAX = 2_147_483_647;

/** The int2 ceiling — what a Postgres `smallint` column can hold. */
export const INT2_MAX = 32_767;

/**
 * The int8 ceiling — what a Postgres `bigint`/`bigserial` column can hold.
 *
 * ⚠️ The true ceiling is `2^63 - 1`, which is NOT representable as an IEEE-754 double — writing that literal
 * is a lint error (`no-loss-of-precision`) precisely because it would silently become something else. `2 ** 63`
 * is the nearest representable value and is what this audit compares against: the other operand is always a
 * wire bound, itself a JS number, so nothing can land in the one-ULP gap. A `bigint` literal was the
 * alternative and was rejected — it would make every comparison in this module mixed-type for the sake of a
 * value no contract expresses.
 *
 * It matters that this is a REAL ceiling rather than "unbounded": a `z.number()` with no maximum admits `1e300`,
 * which Postgres answers `22003` for on an int8 column exactly as it does on an int4 one.
 */
export const INT8_MAX = 2 ** 63;

/** What a column can physically store, reduced to the one axis a wire bound has to respect. */
export type ColumnCapacity =
    /** No ceiling this audit can express: `text`, `uuid`, `boolean`, `jsonb`, unqualified `numeric`, … */
    | { readonly kind: 'unbounded' }
    /** A numeric ceiling: the largest value the column accepts. */
    | { readonly kind: 'numeric'; readonly max: number }
    /** A character-length ceiling. */
    | { readonly kind: 'length'; readonly maxLength: number };

/** One bounded column in a service's schema — the unit the audit must account for. */
export interface BoundedColumn {
    /** The SQL table name (`recipes`), not the drizzle export name. */
    readonly table: string;
    /** The SQL column name (`prep_time_minutes`). */
    readonly column: string;
    /** The drizzle property name (`prepTimeMinutes`), for a reader tracing it back to the schema file. */
    readonly property: string;
    /** The column's SQL type as drizzle renders it (`integer`, `numeric(8, 2)`, `varchar(255)`). */
    readonly sqlType: string;
    /** Its physical ceiling. Never `unbounded` — an unbounded column is not collected. */
    readonly capacity: Exclude<ColumnCapacity, { kind: 'unbounded' }>;
}

/** The upper bound a zod schema actually promises, on the one axis that matters. */
export type WireUpperBound =
    | { readonly kind: 'numeric'; readonly max: number; readonly exclusive?: true }
    | { readonly kind: 'length'; readonly maxLength: number };

/** One wire field bound to a column: the field's published name and the schema that validates it. */
export interface WireField {
    /**
     * How the field is spelled in the contract, e.g. `CreateRecipeRequest.servings`. Used only in
     * messages, so it must be the spelling a reader can search for.
     */
    readonly field: string;
    /** The zod schema request validation enforces for it. */
    readonly schema: unknown;
}

/**
 * How one bounded column is accounted for. Exactly one of {@link ColumnAccount.fields} (the wire fields
 * that write it) or {@link ColumnAccount.why} (why nothing client-supplied does) must be present — the
 * audit throws on an entry that supplies neither, or an empty `fields` array, because both would assert
 * nothing while looking like bookkeeping.
 */
export interface ColumnAccount {
    /** The SQL table name. */
    readonly table: string;
    /** The SQL column name. */
    readonly column: string;
    /** The wire fields whose value lands in this column. Non-empty when present. */
    readonly fields?: readonly WireField[];
    /**
     * Why no client-supplied value reaches this column (server-assigned, trigger-maintained, bounded by a
     * service check that answers a specific status, …). Required, so an exemption stays a reviewed
     * decision rather than a silent hole.
     */
    readonly why?: string;
}

/** Input to {@link auditStorageCapacity}. */
export interface StorageCapacityAudit {
    /** A service's drizzle schema barrel (`import * as schema`); non-table exports are ignored. */
    readonly tables: Readonly<Record<string, unknown>>;
    /** One entry per bounded column. */
    readonly accounts: readonly ColumnAccount[];
}

/** Something the audit found wrong. Every kind is a failure; none is advisory. */
export type StorageCapacityFinding =
    /** A bounded column with no account entry — the case that catches a NEW column on arrival. */
    | { readonly kind: 'unaccounted-column'; readonly table: string; readonly column: string; readonly sqlType: string }
    /** An account entry for a column that is not bounded, was renamed, or does not exist. */
    | { readonly kind: 'stale-account'; readonly table: string; readonly column: string }
    /** Two account entries for one column. */
    | { readonly kind: 'duplicate-account'; readonly table: string; readonly column: string }
    /** A wire field with no upper bound at all, against a bounded column. */
    | {
          readonly kind: 'unbounded-wire-field';
          readonly table: string;
          readonly column: string;
          readonly sqlType: string;
          readonly field: string;
      }
    /** A wire bound of the wrong kind for the column (a string cap on an integer column, or the reverse). */
    | {
          readonly kind: 'bound-kind-mismatch';
          readonly table: string;
          readonly column: string;
          readonly sqlType: string;
          readonly field: string;
          readonly wire: WireUpperBound;
      }
    /** A wire bound above what the column can physically store — the 500-that-should-be-400. */
    | {
          readonly kind: 'exceeds-capacity';
          readonly table: string;
          readonly column: string;
          readonly sqlType: string;
          readonly field: string;
          readonly wireMax: number;
          readonly columnMax: number;
      };

/** drizzle's registered symbol for a table's column map. Registered, so `Symbol.for` reaches the same one. */
const DRIZZLE_COLUMNS = Symbol.for('drizzle:Columns');

/** drizzle's registered symbol for a table's SQL name. */
const DRIZZLE_NAME = Symbol.for('drizzle:Name');

/**
 * Column types with no ceiling this audit can express.
 *
 * `PgCustomColumn` is here deliberately: a `customType` renders an opaque SQL type this module cannot
 * interpret, and the only one in the repo is the trigger-maintained `tsvector`, which no wire field
 * writes. If a custom column ever DOES back a wire field, it must be given an explicit account entry —
 * which the exhaustiveness rule already forces.
 */
const UNBOUNDED_COLUMN_TYPES: readonly string[] = [
    'PgText',
    'PgUUID',
    'PgBoolean',
    'PgTimestamp',
    'PgTimestampString',
    'PgDate',
    'PgDateString',
    'PgTime',
    'PgJson',
    'PgJsonb',
    'PgReal',
    'PgDoublePrecision',
    'PgCustomColumn',
    'PgEnumColumn',
];

/**
 * Column types whose ceiling is the int4 one.
 *
 * `serial` IS an `integer` with a sequence default — it is NOT a wider type, and treating it as unbounded
 * because it is server-generated would confuse "nothing writes it" (an ACCOUNTING decision, recorded per
 * column with a reason) with "it has no ceiling" (a physical fact, decided here).
 */
const INT4_COLUMN_TYPES: readonly string[] = ['PgInteger', 'PgSerial'];

/** Column types whose ceiling is the int8 one — `bigint` in either JS representation, and `bigserial`. */
const INT8_COLUMN_TYPES: readonly string[] = ['PgBigInt64', 'PgBigSerial64'];

/** The runtime surface of a drizzle column this module reads. Structural on purpose — see the module doc. */
interface ColumnLike {
    readonly name?: unknown;
    readonly columnType?: unknown;
    readonly length?: unknown;
    readonly precision?: unknown;
    readonly scale?: unknown;
    readonly baseColumn?: unknown;
    readonly getSQLType?: unknown;
}

/**
 * The physical ceiling of one column.
 *
 * @param candidate - A drizzle column.
 * @returns Its {@link ColumnCapacity}. Pure.
 * @throws When the column's type is not recognized. Deliberate: assuming an unknown type is unbounded
 *   would let a future `bigint` or `char(n)` column through, taking its wire bound with it — the exact
 *   silence this gate exists to end. Extend the mapping instead.
 */
export function describeColumnCapacity(candidate: unknown): ColumnCapacity {
    const column = candidate as ColumnLike;
    const columnType = typeof column.columnType === 'string' ? column.columnType : '';

    // An array column stores its ELEMENT type, so the element's ceiling is the one a wire value must meet.
    if (columnType === 'PgArray') {
        return column.baseColumn === undefined ? { kind: 'unbounded' } : describeColumnCapacity(column.baseColumn);
    }

    if (INT4_COLUMN_TYPES.includes(columnType)) {
        return { kind: 'numeric', max: INT4_MAX };
    }

    if (columnType === 'PgSmallInt' || columnType === 'PgSmallSerial') {
        return { kind: 'numeric', max: INT2_MAX };
    }

    if (INT8_COLUMN_TYPES.includes(columnType)) {
        return { kind: 'numeric', max: INT8_MAX };
    }

    // `bigint({ mode: 'number' })`: drizzle already narrows the JS side to a safe integer, so that — not the
    // int8 ceiling — is the widest value that can reach the column through this column definition.
    if (columnType === 'PgBigInt53' || columnType === 'PgBigSerial53') {
        return { kind: 'numeric', max: Number.MAX_SAFE_INTEGER };
    }

    if (columnType === 'PgVarchar' || columnType === 'PgChar') {
        return typeof column.length === 'number' ? { kind: 'length', maxLength: column.length } : { kind: 'unbounded' };
    }

    if (columnType === 'PgNumeric') {
        return typeof column.precision === 'number'
            ? {
                  kind: 'numeric',
                  max: numericCeiling(column.precision, typeof column.scale === 'number' ? column.scale : 0),
              }
            : { kind: 'unbounded' };
    }

    if (UNBOUNDED_COLUMN_TYPES.includes(columnType)) {
        return { kind: 'unbounded' };
    }

    throw new Error(
        `Unrecognized drizzle column type \`${columnType || '(none)'}\` (SQL \`${sqlTypeOf(column)}\`). The ` +
            'storage-capacity gate refuses to guess: treating an unknown type as unbounded is how a bounded ' +
            'column slips through with an unbounded wire field. Add it to `describeColumnCapacity` — with its ' +
            'real ceiling if it has one, or to `UNBOUNDED_COLUMN_TYPES` if it genuinely has none.',
    );
}

/**
 * The largest value a `numeric(precision, scale)` column accepts.
 *
 * `10^(p-s) - 10^(-s)` rather than `10^(p-s)`, and the difference is load-bearing: Postgres ROUNDS to the
 * declared scale before checking range, so `numeric(8,2)` rejects `999999.996` (it rounds to `1000000.00`)
 * while accepting `999999.99`. The largest safely-representable value is therefore one step below the
 * power of ten — verified against a live PostgreSQL 16, where `999999.996` answers `22003 numeric field
 * overflow`.
 *
 * @param precision - Total significant digits.
 * @param scale - Digits after the decimal point.
 * @returns The ceiling. Pure.
 */
function numericCeiling(precision: number, scale: number): number {
    const integerDigits = precision - scale;
    const step = 10 ** -scale;

    return Number((10 ** integerDigits - step).toFixed(scale));
}

/**
 * The SQL type a column renders as, for messages.
 *
 * @param column - A drizzle column.
 * @returns The SQL type, or `(unknown)` when the column does not expose one. Pure.
 */
function sqlTypeOf(column: ColumnLike): string {
    return typeof column.getSQLType === 'function' ? String((column.getSQLType as () => unknown)()) : '(unknown)';
}

/**
 * Every BOUNDED column in a service's drizzle schema barrel.
 *
 * Non-table exports (value sets, row types, the `tsvector` custom-type helper) are skipped rather than
 * rejected, so a service can pass `import * as schema` without curating a list — a curated list is a thing
 * a contributor adding a table can forget, and a forgotten table is an unaudited column.
 *
 * @param tables - The schema barrel.
 * @returns The bounded columns, sorted by table then column so the output is order-independent. Pure.
 * @throws When a table holds a column whose type {@link describeColumnCapacity} does not recognize.
 */
export function collectBoundedColumns(tables: Readonly<Record<string, unknown>>): BoundedColumn[] {
    const found: BoundedColumn[] = [];

    for (const value of Object.values(tables)) {
        if (typeof value !== 'object' || value === null) {
            continue;
        }

        const holder = value as Record<symbol, unknown>;
        const columns = holder[DRIZZLE_COLUMNS];

        if (typeof columns !== 'object' || columns === null) {
            continue;
        }

        const tableName = String(holder[DRIZZLE_NAME]);

        for (const [property, candidate] of Object.entries(columns as Record<string, unknown>)) {
            const capacity = describeColumnCapacity(candidate);

            if (capacity.kind === 'unbounded') {
                continue;
            }

            const column = candidate as ColumnLike;

            found.push({
                table: tableName,
                column: typeof column.name === 'string' ? column.name : property,
                property,
                sqlType: sqlTypeOf(column),
                capacity,
            });
        }
    }

    return found.sort((left, right) =>
        left.table === right.table ? compare(left.column, right.column) : compare(left.table, right.table),
    );
}

/**
 * Compare two strings for a stable sort.
 *
 * @param left - The first string.
 * @param right - The second string.
 * @returns A negative, zero or positive ordering. Pure.
 */
function compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** The subset of a JSON Schema node this module reads. */
interface JsonSchemaNode {
    readonly type?: unknown;
    readonly maximum?: unknown;
    readonly exclusiveMaximum?: unknown;
    readonly maxLength?: unknown;
    readonly enum?: unknown;
    readonly const?: unknown;
    readonly items?: unknown;
    readonly anyOf?: unknown;
    readonly oneOf?: unknown;
}

/**
 * The upper bound a zod schema promises.
 *
 * Read through the PUBLIC `z.toJSONSchema` rather than zod's internals, which is both the library-first
 * choice and the reason `.optional()`, `.nullable()`, `.default()`, `.readonly()`, `z.coerce` and
 * `.brand()` all unwrap correctly with no walker of our own to keep in step with zod.
 *
 * Two conversions matter for the invariant:
 *
 *  - An ARRAY reports its ELEMENT's bound, because it is the element that lands in a column (a `text[]`
 *    column's ceiling is per-element too).
 *  - An ENUM reports the longest member's length. A `z.enum` against a `varchar(n)` column is genuinely
 *    bounded, and reporting it as unbounded would force a `why` exemption for a field that needs none.
 *
 * @param schema - A zod schema (taken as `unknown`: this module must not depend on a zod version's types).
 * @returns Its upper bound, or `undefined` when it promises none. Pure.
 * @throws When `schema` is not a zod schema `z.toJSONSchema` can convert.
 */
export function wireUpperBound(schema: unknown): WireUpperBound | undefined {
    return boundOfNode(toInputJsonSchema(schema));
}

/**
 * Convert a zod schema to its INPUT JSON Schema.
 *
 * `io: 'input'` is the correct direction — the invariant is about what a request is ALLOWED TO SEND, which
 * is the input side of a schema carrying a `.default()` or a coercion. `unrepresentable: 'any'` keeps a
 * field zod cannot express in JSON Schema from throwing; such a field simply reports no bound, which the
 * audit then treats as unbounded and fails loudly on.
 *
 * @param schema - A zod schema.
 * @returns The JSON Schema node.
 * @throws When the value is not a convertible zod schema.
 */
function toInputJsonSchema(schema: unknown): JsonSchemaNode {
    const candidate = schema as { toJSONSchema?: unknown };

    if (typeof candidate?.toJSONSchema !== 'function') {
        throw new Error(
            'wireUpperBound expected a zod schema (one exposing `toJSONSchema`). The storage-capacity audit ' +
                'binds a column to the zod that VALIDATES it — passing a type, a DTO class, or a plain object ' +
                'would silently assert nothing.',
        );
    }

    return (candidate.toJSONSchema as (options: unknown) => JsonSchemaNode)({
        io: 'input',
        unrepresentable: 'any',
        override: undefined,
    });
}

/**
 * The upper bound of a JSON Schema node, looking through union branches and array elements.
 *
 * @param node - The node.
 * @returns Its bound, or `undefined`. Pure.
 */
function boundOfNode(node: JsonSchemaNode | undefined): WireUpperBound | undefined {
    if (node === undefined || node === null) {
        return undefined;
    }

    const branches = node.anyOf ?? node.oneOf;

    if (Array.isArray(branches)) {
        // A `.nullable()` becomes `anyOf: [T, null]`. The widest non-null branch is the binding promise: if
        // ANY branch admits an over-large value, the request admits it.
        return widest(
            branches
                .filter((branch) => (branch as JsonSchemaNode)?.type !== 'null')
                .map((branch) => boundOfNode(branch as JsonSchemaNode)),
        );
    }

    if (node.type === 'array') {
        return boundOfNode(node.items as JsonSchemaNode | undefined);
    }

    if (typeof node.maximum === 'number') {
        return { kind: 'numeric', max: node.maximum };
    }

    if (typeof node.exclusiveMaximum === 'number') {
        return { kind: 'numeric', max: node.exclusiveMaximum, exclusive: true };
    }

    if (typeof node.maxLength === 'number') {
        return { kind: 'length', maxLength: node.maxLength };
    }

    const literals = Array.isArray(node.enum) ? node.enum : node.const === undefined ? undefined : [node.const];

    if (literals !== undefined && literals.every((value) => typeof value === 'string')) {
        return { kind: 'length', maxLength: Math.max(...literals.map((value) => (value as string).length)) };
    }

    return undefined;
}

/**
 * The widest of several bounds — `undefined` (unbounded) wins, because unbounded is the widest promise.
 *
 * @param bounds - The candidate bounds.
 * @returns The widest, or `undefined` when any branch is unbounded or the list is empty. Pure.
 */
function widest(bounds: readonly (WireUpperBound | undefined)[]): WireUpperBound | undefined {
    if (bounds.length === 0 || bounds.some((bound) => bound === undefined)) {
        return undefined;
    }

    return bounds.reduce((widestSoFar, bound) =>
        widestSoFar === undefined || bound === undefined
            ? undefined
            : ceilingOf(bound) > ceilingOf(widestSoFar)
              ? bound
              : widestSoFar,
    );
}

/**
 * The comparable numeric value of a bound.
 *
 * @param bound - The bound.
 * @returns Its ceiling as a number. Pure.
 */
function ceilingOf(bound: WireUpperBound): number {
    return bound.kind === 'numeric' ? bound.max : bound.maxLength;
}

/**
 * Audit a service's wire bounds against its columns' physical capacity.
 *
 * @param audit - The service's schema barrel and its per-column accounting.
 * @returns Every finding, in a stable order. An empty array means the invariant holds.
 * @throws When an account entry supplies neither `fields` nor `why`, or an EMPTY `fields` array — both
 *   look like bookkeeping and assert nothing, which is worse than an absent entry (an absent entry at
 *   least fails as `unaccounted-column`).
 */
export function auditStorageCapacity(audit: StorageCapacityAudit): readonly StorageCapacityFinding[] {
    const columns = collectBoundedColumns(audit.tables);
    const byKey = new Map(columns.map((column) => [`${column.table}.${column.column}`, column]));
    const findings: StorageCapacityFinding[] = [];
    const seen = new Set<string>();

    for (const account of audit.accounts) {
        const key = `${account.table}.${account.column}`;

        if (account.fields === undefined && account.why === undefined) {
            throw new Error(
                `Column account \`${key}\` supplies neither \`fields\` nor \`why\`. State the wire fields that ` +
                    'write it, or the reason nothing client-supplied does.',
            );
        }

        if (account.fields !== undefined && account.fields.length === 0) {
            throw new Error(
                `Column account \`${key}\` has an EMPTY \`fields\` array, which asserts nothing while looking ` +
                    'like it asserts something. Use `why` to record that no wire field writes it.',
            );
        }

        if (seen.has(key)) {
            findings.push({ kind: 'duplicate-account', table: account.table, column: account.column });
            continue;
        }

        seen.add(key);

        const column = byKey.get(key);

        if (column === undefined) {
            findings.push({ kind: 'stale-account', table: account.table, column: account.column });
            continue;
        }

        for (const field of account.fields ?? []) {
            findings.push(...checkField(column, field));
        }
    }

    for (const column of columns) {
        if (!seen.has(`${column.table}.${column.column}`)) {
            findings.push({
                kind: 'unaccounted-column',
                table: column.table,
                column: column.column,
                sqlType: column.sqlType,
            });
        }
    }

    return findings;
}

/**
 * Check one wire field against one column's capacity.
 *
 * @param column - The bounded column.
 * @param field - The wire field bound to it.
 * @returns The findings for this pair (empty when it fits). Pure.
 */
function checkField(column: BoundedColumn, field: WireField): readonly StorageCapacityFinding[] {
    const wire = wireUpperBound(field.schema);
    const context = { table: column.table, column: column.column, sqlType: column.sqlType, field: field.field };

    if (wire === undefined) {
        return [{ kind: 'unbounded-wire-field', ...context }];
    }

    if (wire.kind !== column.capacity.kind) {
        return [{ kind: 'bound-kind-mismatch', ...context, wire }];
    }

    const columnMax = column.capacity.kind === 'numeric' ? column.capacity.max : column.capacity.maxLength;
    // An EXCLUSIVE wire max of `n` admits everything below `n`, so it fits a ceiling of `n - 1` upward.
    const effectiveMax = wire.kind === 'numeric' && wire.exclusive === true ? wire.max - 1 : ceilingOf(wire);

    return effectiveMax <= columnMax
        ? []
        : [{ kind: 'exceeds-capacity', ...context, wireMax: effectiveMax, columnMax }];
}

/**
 * Render findings as the message a failing assertion prints.
 *
 * Each line names the table, the column, the SQL type and the wire field, because the fix is always at one
 * of those four and a finding that does not say which is a finding nobody acts on.
 *
 * @param findings - The findings.
 * @returns A multi-line message, or `''` when there are none. Pure.
 */
export function formatStorageCapacityFindings(findings: readonly StorageCapacityFinding[]): string {
    if (findings.length === 0) {
        return '';
    }

    return [
        `${findings.length} storage-capacity finding(s) — a wire bound must never exceed what its column can store:`,
        ...findings.map((finding) => `  ${describeFinding(finding)}`),
    ].join('\n');
}

/**
 * Render one finding.
 *
 * @param finding - The finding.
 * @returns A single line. Pure.
 */
function describeFinding(finding: StorageCapacityFinding): string {
    switch (finding.kind) {
        case 'unaccounted-column':
            return (
                `${finding.table}.${finding.column} (${finding.sqlType}) is BOUNDED but unaccounted for. Bind the ` +
                'wire field(s) that write it, or record why nothing client-supplied does.'
            );
        case 'stale-account':
            return (
                `${finding.table}.${finding.column} has an account entry but is not a bounded column — renamed, ` +
                'widened, or deleted? Drop or fix the entry.'
            );
        case 'duplicate-account':
            return `${finding.table}.${finding.column} has more than one account entry; two entries can disagree.`;
        case 'unbounded-wire-field':
            return (
                `${finding.field} has NO upper bound but writes ${finding.table}.${finding.column} ` +
                `(${finding.sqlType}). An out-of-range value would be a 500, not the 400 it is.`
            );
        case 'bound-kind-mismatch':
            return (
                `${finding.field} promises a ${finding.wire.kind} bound but writes ${finding.table}.` +
                `${finding.column} (${finding.sqlType}), whose ceiling is not of that kind.`
            );
        case 'exceeds-capacity':
            return (
                `${finding.field} admits up to ${finding.wireMax} but ${finding.table}.${finding.column} ` +
                `(${finding.sqlType}) holds at most ${finding.columnMax}. A value between them is a 500.`
            );
    }
}
