/**
 * The curated seed's committed format: `curatedCatalog.jsonl` and `catalogChanges.json` (plan U1, KTD-16).
 *
 * @pattern Parser — the zod schemas below ARE the pattern (the two root arms, and the discriminated union of a
 * root's nutrition), so nothing is layered on top; this module only maps each zod issue to the named
 * {@link SeedRule} it breaks and adds the checks that span records.
 *
 * It parses; it does not decide what the seed MEANS against USDA. Every rule that needs the USDA baseline (is
 * this item its group's supplier? is this exclusion in the universe?) lives in `seedImage.ts`.
 *
 * ⚠️ The file is deliberately NOT named `*.schema.ts`: `contract-gen` sweeps that suffix into the food
 * service's published wire contract, and this format is not on the wire (KTD-15).
 *
 * ## `catalogChanges.json` is CUMULATIVE against the USDA baseline
 *
 * It states every declared change from the baseline to the curated seed, not the changes since the last
 * commit, so the same committed files always compose the same seed on a fresh preview database (R35, KTD-11).
 * The consequence is a deliberate double entry: every variant appears in the catalog AND as a `merges` row,
 * and the two are checked against each other in both directions.
 */
import { z } from 'zod';

import { REGISTERED_SOURCE_IDS } from '../../../sources/sourceRegister.js';
import { normalizeName } from '../../foodName.js';
import { LABEL_NUTRIENT_MAP } from '../../nutrition/labelNutrientMap.js';
import { attributeRank, variantAttributeSchema } from '../../domain/variantAttribute.js';
import {
    isCuratedKey,
    isFdcKey,
    isSeedKey,
    type CuratedKey,
    type FdcKey,
    type ItemKey,
    type SeedKey,
} from '../catalogKey.js';
import {
    SeedRefusedError,
    isSeedRefusedError,
    isSeedRule,
    type SeedIssue,
    type SeedRule,
} from './curatedSeedFormat.errors.js';
import { CITATION_MATCHES } from './citationPrecedence.js';

/** The committed catalog's file name, used in a refusal's `where` when a line has no readable key. */
const CATALOG_FILE = 'curatedCatalog.jsonl';
/** The committed change file's name, used in a refusal's `where` for a structural fault. */
const CHANGES_FILE = 'catalogChanges.json';

/** `"` and `″` are never written in a curated name or a part: the seed writes `-inch` (R5, naming rule 9). */
const INCH_MARK = /["″]/;

/** A non-negative plain decimal, the form a label value is committed in. */
const DECIMAL = /^\d+(\.\d+)?$/;

/** The `(name, unit)` pairs a label value may name: exactly {@link LABEL_NUTRIENT_MAP}'s. */
const LABEL_PAIRS: ReadonlySet<string> = new Set(
    Object.values(LABEL_NUTRIENT_MAP).map(({ name, unit }) => `${name}\u0000${unit}`),
);

const fdcKeySchema = z.custom<FdcKey>(isFdcKey, { message: 'must be an fdc:<id> key' });
const seedKeySchema = z.custom<SeedKey>(isSeedKey, { message: 'must be an fdc:<id> or curated:<slug> key' });
const curatedKeySchema = z.custom<CuratedKey>(isCuratedKey, { message: 'must be a curated:<slug> key' });

/** Text a person reads, with no inch mark. */
const quoteFreeTextSchema = z
    .string()
    .min(1)
    .refine((text) => !INCH_MARK.test(text), { message: 'contains " or ″', params: { rule: 'inchMark' } });

const rootNameSchema = quoteFreeTextSchema.refine((name) => normalizeName(name) !== '', {
    message: 'has no visible characters',
});

const partSchema = z.strictObject({ attribute: variantAttributeSchema, text: quoteFreeTextSchema });

const variantSchema = z
    .strictObject({ item: fdcKeySchema, parts: z.array(partSchema).min(1) })
    .superRefine((variant, ctx) => {
        const outOfOrder = variant.parts.findIndex(
            (part, index) =>
                index > 0 &&
                attributeRank(part.attribute) < attributeRank(variant.parts[index - 1]?.attribute ?? part.attribute),
        );

        if (outOfOrder > 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['parts', outOfOrder],
                message: `'${variant.parts[outOfOrder]?.attribute ?? ''}' follows '${variant.parts[outOfOrder - 1]?.attribute ?? ''}'`,
                params: { rule: 'partsOutOfOrder' },
            });
        }
    });

/**
 * A citation of one registered source's entry (R50, KTD-22): the source, its own key for the entry, and how well the
 * entry matches the root. A USDA key is an `fdc:<id>` key, so every USDA dataset is cited the same way.
 */
const sourceItemSchema = z
    .strictObject({
        source: z.enum(REGISTERED_SOURCE_IDS),
        key: z.string().min(1),
        match: z.enum(CITATION_MATCHES),
    })
    .superRefine((citation, ctx) => {
        if (citation.source === 'usda' && !isFdcKey(citation.key)) {
            ctx.addIssue({
                code: 'custom',
                path: ['key'],
                message: `'${citation.key}' is not an fdc:<id> key`,
                params: { rule: 'citationKeyMalformed' },
            });
        }
    });

const labelValueSchema = z.strictObject({
    name: z.string().min(1),
    unit: z.string().min(1),
    amount: z.string().regex(DECIMAL, 'must be a plain decimal'),
});

const manufacturerLabelSchema = z
    .strictObject({
        source: z.literal('manufacturerLabel'),
        url: z.url({ protocol: /^https$/ }),
        retrievedOn: z.iso.date(),
        manufacturer: z.string().min(1),
        serving: z.strictObject({
            label: z.string().min(1),
            grams: z
                .string()
                .regex(DECIMAL, 'must be a plain decimal')
                .refine((grams) => Number(grams) > 0, 'must be more than zero'),
        }),
        perServing: z.array(labelValueSchema).min(1),
    })
    .superRefine((label, ctx) => {
        const seen = new Set<string>();

        label.perServing.forEach((value, index) => {
            const pair = `${value.name}\u0000${value.unit}`;
            const path = ['perServing', index];
            const what = `${value.name} (${value.unit})`;

            if (!LABEL_PAIRS.has(pair)) {
                ctx.addIssue({
                    code: 'custom',
                    path,
                    message: `${what} is not a label nutrient`,
                    params: { rule: 'labelNutrientUnknown' },
                });
            } else if (seen.has(pair)) {
                ctx.addIssue({
                    code: 'custom',
                    path,
                    message: `${what} is printed twice`,
                    params: { rule: 'labelNutrientRepeated' },
                });
            }

            seen.add(pair);
        });
    });

const rootNutritionSchema = z.discriminatedUnion('source', [sourceItemSchema, manufacturerLabelSchema]);

const itemRootSchema = z.strictObject({
    seedKey: seedKeySchema,
    name: rootNameSchema,
    synonyms: z.array(z.string().min(1)),
    item: fdcKeySchema,
    variants: z.array(variantSchema),
});

const sourcelessRootSchema = z.strictObject({
    seedKey: curatedKeySchema,
    name: rootNameSchema,
    synonyms: z.array(z.string().min(1)),
    item: z.null(),
    variants: z.array(variantSchema).max(0),
    nutrition: rootNutritionSchema.nullable(),
});

/** `catalogChanges.json`. */
const catalogChangesSchema = z.strictObject({
    merges: z.array(z.strictObject({ from: seedKeySchema, into: seedKeySchema })),
    aliases: z.array(z.strictObject({ from: fdcKeySchema, of: fdcKeySchema })),
    exclusions: z.array(fdcKeySchema),
    splits: z.array(
        z.strictObject({ from: seedKeySchema, newKey: seedKeySchema, items: z.array(seedKeySchema).min(1) }),
    ),
});

/** A variant part: one attribute and its text. */
export type CuratedPart = z.infer<typeof partSchema>;
/** A variant: its own USDA item and its parts, in attribute order. */
export type CuratedVariant = z.infer<typeof variantSchema>;
/** A root's numbers cited from one registered source's entry (R50, KTD-22). */
export type SourceItemCitation = z.infer<typeof sourceItemSchema>;
/** A root's numbers cited from a manufacturer's Nutrition Facts label (R50, KTD-20). */
export type ManufacturerLabel = z.infer<typeof manufacturerLabelSchema>;
/** The cited source of a sourceless root's numbers. */
export type RootNutrition = z.infer<typeof rootNutritionSchema>;
/** A root that stands for its own USDA item; its numbers are that item's. */
export type ItemRoot = z.infer<typeof itemRootSchema>;
/** A root that stands for no USDA item (naming rule 1c). */
export type SourcelessRoot = z.infer<typeof sourcelessRootSchema>;
/**
 * One line of `curatedCatalog.jsonl`: a root that stands for a USDA item, or one that stands for none. The
 * arm is read off `item` (`parseCatalogLine`), so a line is validated against exactly one arm and its issues
 * name one cause.
 */
export type CuratedRoot = ItemRoot | SourcelessRoot;
/** The cumulative declared changes from the baseline. */
export type CatalogChanges = z.infer<typeof catalogChangesSchema>;

/** The parsed committed seed. */
export interface CuratedSeed {
    /** The curated roots, in file order. */
    readonly roots: readonly CuratedRoot[];
    /** The declared changes. */
    readonly changes: CatalogChanges;
}

/** A record-shaped JSON value, for inspecting a line before and beside its parse. */
type JsonRecord = Readonly<Record<string, unknown>>;

/**
 * Whether a parsed JSON value is an object (not an array, not null). Pure.
 *
 * @param value - Any value.
 * @returns `true` for a plain JSON object.
 */
function isJsonRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Name the rule one zod issue on a catalog line breaks. Pure.
 *
 * @param issue - The zod issue.
 * @param key - For an unrecognized-keys issue, the one key being named; otherwise `undefined`.
 * @param line - The raw line, to tell a missing field from a malformed one.
 * @returns The rule.
 */
function ruleForCatalogIssue(issue: z.core.$ZodIssue, key: string | undefined, line: JsonRecord): SeedRule {
    const carried: unknown = issue.code === 'custom' ? issue.params?.['rule'] : undefined;

    if (isSeedRule(carried)) {
        return carried;
    }

    const [head, second, third] = issue.path;
    const depth = issue.path.length;

    if (issue.code === 'unrecognized_keys') {
        if (key === 'nutrition' && depth === 0) {
            return 'nutritionBesideItem';
        }

        if (key === 'nutrition' && head === 'variants' && depth === 2) {
            return 'nutritionOnVariant';
        }

        return key === 'milliliters' && head === 'nutrition' && second === 'serving'
            ? 'labelServingInVolume'
            : 'malformedRecord';
    }

    if (head === 'variants') {
        if (depth === 1 && issue.code === 'too_big') {
            return 'sourcelessRootWithVariants';
        }

        if (issue.path.at(-1) === 'attribute') {
            return 'partWithoutAttribute';
        }

        return issue.path.at(-1) === 'parts' && issue.code === 'too_small' ? 'variantWithoutParts' : 'malformedRecord';
    }

    if (head === 'nutrition') {
        if (depth === 1 && !Object.hasOwn(line, 'nutrition')) {
            return 'nutritionMissing';
        }

        const nutrition = line['nutrition'];

        if (second === 'source' && depth === 2) {
            return 'citationSourceUnknown';
        }

        if (!isJsonRecord(nutrition) || nutrition['source'] !== 'manufacturerLabel') {
            return 'malformedRecord';
        }

        const serving = nutrition['serving'];
        const inVolumeOnly = isJsonRecord(serving) && Object.hasOwn(serving, 'milliliters');

        return second === 'serving' && third === 'grams' && inVolumeOnly
            ? 'labelServingInVolume'
            : 'labelCitationIncomplete';
    }

    return head === 'seedKey' && line['item'] === null && isFdcKey(line['seedKey'])
        ? 'sourcelessRootKeyNotCurated'
        : 'malformedRecord';
}

/**
 * Parse one catalog line against the arm its `item` selects. Pure.
 *
 * @param text - The line.
 * @param lineNumber - Its 1-based line number.
 * @returns The root, or the issues that refuse it (one per rule).
 */
function parseCatalogLine(text: string, lineNumber: number): { root: CuratedRoot } | { issues: SeedIssue[] } {
    const position = `${CATALOG_FILE}:${String(lineNumber)}`;
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch (error) {
        return { issues: [{ where: position, rule: 'malformedRecord', detail: `is not JSON (${String(error)})` }] };
    }

    if (!isJsonRecord(value)) {
        return { issues: [{ where: position, rule: 'malformedRecord', detail: 'is not a JSON object' }] };
    }

    const where = isSeedKey(value['seedKey']) ? value['seedKey'] : position;
    const parsed = (value['item'] === null ? sourcelessRootSchema : itemRootSchema).safeParse(value);

    if (parsed.success) {
        return { root: parsed.data };
    }

    const byRule = new Map<SeedRule, SeedIssue>();

    for (const issue of parsed.error.issues) {
        const keys: readonly (string | undefined)[] = issue.code === 'unrecognized_keys' ? issue.keys : [undefined];

        for (const key of keys) {
            const rule = ruleForCatalogIssue(issue, key, value);
            const at = [...issue.path, ...(key === undefined ? [] : [key])].join('.') || '(root)';

            if (!byRule.has(rule)) {
                byRule.set(rule, { where, rule, detail: `${at}: ${issue.message}` });
            }
        }
    }

    return { issues: [...byRule.values()] };
}

/**
 * The checks that span the catalog's lines: keys, names, item ownership and identical parts. Pure.
 *
 * @param roots - The roots that parsed.
 * @returns The issues found.
 */
function checkCatalogRecords(roots: readonly CuratedRoot[]): SeedIssue[] {
    const issues: SeedIssue[] = [];
    const keys = new Set<SeedKey>();
    const names = new Map<string, SeedKey>();
    const owners = new Map<ItemKey, SeedKey>();

    for (const root of roots) {
        const where = root.seedKey;

        if (keys.has(root.seedKey)) {
            issues.push({ where, rule: 'duplicateSeedKey', detail: 'another root has this seed key' });
        }

        keys.add(root.seedKey);

        const name = normalizeName(root.name);
        const namedBy = names.get(name);

        if (namedBy !== undefined) {
            issues.push({ where, rule: 'duplicateName', detail: `'${root.name}' is also the name of ${namedBy}` });
        } else {
            names.set(name, root.seedKey);
        }

        for (const item of [
            ...(root.item === null ? [] : [root.item]),
            ...root.variants.map((variant) => variant.item),
        ]) {
            const owner = owners.get(item);

            if (owner === undefined) {
                owners.set(item, root.seedKey);
            } else {
                issues.push({ where, rule: 'itemOwnedTwice', detail: `${item} is also owned by ${owner}` });
            }
        }

        const signatures = new Map<string, FdcKey>();

        for (const variant of root.variants) {
            const signature = JSON.stringify(variant.parts.map((part) => [part.attribute, part.text]));
            const twin = signatures.get(signature);

            if (twin === undefined) {
                signatures.set(signature, variant.item);
            } else {
                issues.push({
                    where,
                    rule: 'identicalVariantParts',
                    detail: `${variant.item} has the parts of ${twin}`,
                });
            }
        }
    }

    return issues;
}

/**
 * Parse `curatedCatalog.jsonl`. Every line is checked, and every issue is collected before refusing. Pure.
 *
 * @param text - The file's text: one root per line, each line ending in a newline.
 * @returns The roots, in file order.
 * @throws {SeedRefusedError} with every issue found.
 */
export function parseCuratedCatalog(text: string): readonly CuratedRoot[] {
    const lines = text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
    const roots: CuratedRoot[] = [];
    const issues: SeedIssue[] = [];

    lines.forEach((line, index) => {
        if (line === '') {
            issues.push({ where: `${CATALOG_FILE}:${String(index + 1)}`, rule: 'malformedRecord', detail: 'is blank' });

            return;
        }

        const parsed = parseCatalogLine(line, index + 1);

        if ('root' in parsed) {
            roots.push(parsed.root);
        } else {
            issues.push(...parsed.issues);
        }
    });

    issues.push(...checkCatalogRecords(roots));

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    return roots;
}

/**
 * Parse `catalogChanges.json`. Pure.
 *
 * @param text - The file's text.
 * @returns The declared changes.
 * @throws {SeedRefusedError} with every issue found: a structural fault, or a change listed twice.
 */
export function parseCatalogChanges(text: string): CatalogChanges {
    let value: unknown;

    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new SeedRefusedError([
            { where: CHANGES_FILE, rule: 'malformedRecord', detail: `is not JSON (${String(error)})` },
        ]);
    }

    const parsed = catalogChangesSchema.safeParse(value);

    if (!parsed.success) {
        throw new SeedRefusedError(
            parsed.error.issues.map((issue) => ({
                where: CHANGES_FILE,
                rule: 'malformedRecord' as const,
                detail: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
            })),
        );
    }

    const issues: SeedIssue[] = [];
    const sources = new Set<SeedKey>();

    for (const from of [
        ...parsed.data.merges.map((merge) => merge.from),
        ...parsed.data.aliases.map((alias) => alias.from),
    ]) {
        if (sources.has(from)) {
            issues.push({
                where: from,
                rule: 'changeListedTwice',
                detail: 'is listed as a merge or alias source twice',
            });
        }

        sources.add(from);
    }

    const excluded = new Set<FdcKey>();

    for (const item of parsed.data.exclusions) {
        if (excluded.has(item)) {
            issues.push({ where: item, rule: 'changeListedTwice', detail: 'is excluded twice' });
        }

        excluded.add(item);
    }

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    return parsed.data;
}

/**
 * Check the catalog against its cumulative changes: every variant is a declared merge and every merge is a
 * variant (both directions), aliases name an owned item, exclusions are placed nowhere, and splits name items
 * their new root owns. Pure.
 *
 * ⚠️ Splits are validated, never ignored, but what a split MEANS in a cumulative file is not yet settled: the
 * committed file declares none, and the moves between two curated versions are read by U5's diff.
 *
 * @param roots - The parsed roots.
 * @param changes - The parsed changes.
 * @returns The issues found.
 */
function checkCatalogAgainstChanges(roots: readonly CuratedRoot[], changes: CatalogChanges): SeedIssue[] {
    const issues: SeedIssue[] = [];
    const owned = new Map<ItemKey, CuratedRoot>();
    const variantPairs = new Set<string>();
    const sourceless = new Set<SeedKey>();
    const byKey = new Map<SeedKey, CuratedRoot>(roots.map((root) => [root.seedKey, root]));

    for (const root of roots) {
        owned.set(root.item ?? root.seedKey, root);

        if (root.item === null) {
            sourceless.add(root.seedKey);
        }

        for (const variant of root.variants) {
            owned.set(variant.item, root);
            variantPairs.add(`${variant.item}\u0000${root.seedKey}`);
        }
    }

    const mergePairs = new Set(changes.merges.map((merge) => `${merge.from}\u0000${merge.into}`));

    for (const root of roots) {
        for (const variant of root.variants) {
            if (!mergePairs.has(`${variant.item}\u0000${root.seedKey}`)) {
                issues.push({
                    where: root.seedKey,
                    rule: 'mergeUndeclared',
                    detail: `variant ${variant.item} has no merge row`,
                });
            }
        }
    }

    for (const merge of changes.merges) {
        if (sourceless.has(merge.from)) {
            issues.push({ where: merge.from, rule: 'mergeAbsorbsSourcelessRoot', detail: `merges into ${merge.into}` });
        } else if (!variantPairs.has(`${merge.from}\u0000${merge.into}`)) {
            issues.push({
                where: merge.from,
                rule: 'mergeWithoutVariant',
                detail: `is not a variant of ${merge.into}`,
            });
        }
    }

    for (const alias of changes.aliases) {
        if (!owned.has(alias.of)) {
            issues.push({
                where: alias.from,
                rule: 'aliasTargetUnknown',
                detail: `${alias.of} is no root's or variant's item`,
            });
        }

        const owner = owned.get(alias.from);

        if (owner !== undefined) {
            issues.push({
                where: alias.from,
                rule: 'itemOwnedTwice',
                detail: `is a declared alias and owned by ${owner.seedKey}`,
            });
        }
    }

    const placed = new Set<ItemKey>([
        ...owned.keys(),
        ...changes.aliases.map((alias) => alias.from),
        ...changes.merges.map((merge) => merge.from),
    ]);

    for (const item of changes.exclusions) {
        if (placed.has(item)) {
            issues.push({
                where: item,
                rule: 'excludedItemPlaced',
                detail: 'is excluded and also a root, variant, merge or alias',
            });
        }
    }

    for (const split of changes.splits) {
        const root = byKey.get(split.newKey);

        if (root === undefined) {
            issues.push({
                where: split.newKey,
                rule: 'splitTargetUnknown',
                detail: `split from ${split.from} names no root`,
            });
            continue;
        }

        for (const item of split.items) {
            if (owned.get(item) !== root) {
                issues.push({ where: item, rule: 'splitItemNotOwned', detail: `is not owned by ${split.newKey}` });
            }
        }
    }

    return issues;
}

/**
 * Parse a refusable input, recording its issues rather than throwing them.
 *
 * @param parse - The parse.
 * @param issues - Where a refusal's issues go.
 * @returns The parsed value, or `undefined` when refused.
 */
function collecting<T>(parse: () => T, issues: SeedIssue[]): T | undefined {
    try {
        return parse();
    } catch (error) {
        if (!isSeedRefusedError(error)) {
            throw error;
        }

        issues.push(...error.issues);

        return undefined;
    }
}

/**
 * Parse the committed curated seed: the catalog, the changes, and the checks between them. Pure.
 *
 * The two files are cross-checked only when both parse cleanly, so one fault (a root that did not parse) is
 * not reported a second time as the merges that name it.
 *
 * @param input - The two files' text.
 * @param input.catalogText - `curatedCatalog.jsonl`.
 * @param input.changesText - `catalogChanges.json`.
 * @returns The curated seed.
 * @throws {SeedRefusedError} with every issue found in both files and between them.
 */
export function parseCuratedSeed(input: { readonly catalogText: string; readonly changesText: string }): CuratedSeed {
    const issues: SeedIssue[] = [];
    const roots = collecting(() => parseCuratedCatalog(input.catalogText), issues);
    const changes = collecting(() => parseCatalogChanges(input.changesText), issues);

    if (roots !== undefined && changes !== undefined) {
        issues.push(...checkCatalogAgainstChanges(roots, changes));
    }

    if (issues.length > 0 || roots === undefined || changes === undefined) {
        throw new SeedRefusedError(issues);
    }

    return { roots, changes };
}
