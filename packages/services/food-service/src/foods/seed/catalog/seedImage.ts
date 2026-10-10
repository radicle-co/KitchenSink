/**
 * The seed image: the curated seed composed over the USDA baseline (plan U1, U23, R4, R9, R48, R50, R51, KTD-22).
 *
 * @pattern Functional core — a pure function of the committed inputs; `seedSources.ts` is its one I/O door
 *
 * The image is what a seeded database must hold: every root (curated, or an untouched baseline root) and every
 * item with its source rows and portions. The refusals that need the baseline live here; the ones that need only the
 * committed files live in `curatedSeedFormat.ts`.
 *
 * Every non-excluded universe item ends up as a source of exactly one image item:
 *
 * - its group's supplier is a root's item, a variant's item, or an untouched baseline root's item;
 * - a group's other members are that item's `derivedAlias` sources (R48);
 * - a declared alias (naming rule 28a) is a `declaredAlias` source of its `of` item, and its own group's other
 *   members come with it.
 */
import type { LineageKey } from '@kitchensink/usda-client';

import type { CanonicalNutrient } from '../../../sources/foodSourceAdapter.js';
import { SOURCE_REGISTER } from '../../../sources/sourceRegister.js';
import { normalizeName } from '../../foodName.js';
import { LABEL_NUTRIENT_MAP } from '../../nutrition/labelNutrientMap.js';
import { INFOODS } from '../../nutrition/nutrientIdentity.js';
import type { BrandedProduct } from '../archive/brandedExtract.js';
import type { ExtractLine } from '../archive/sourceExtract.js';
import { fdcIdOf, isFdcKey, type FdcKey, type ItemKey, type SeedKey } from '../catalogKey.js';
import { DATASET_SOURCE, TABLE_DATASET_SOURCE, type TableDataset } from '../citationDatasets.js';
import {
    buildBaselineSeed,
    rankBySupply,
    statesEnergy,
    type BaselineSeed,
    type UsdaItemFacts,
} from './baselineSeed.js';
import { brandedPer100g, labelPer100g, toPer100g, type NamedAmount, type Per100gValues } from './basisConversion.js';
import { chooseCitation, type CitationCandidate, type CitationMatch } from './citationPrecedence.js';
import { SeedRefusedError, isSeedRefusedError, type SeedIssue, type SeedRule } from './curatedSeedFormat.errors.js';
import type {
    CuratedRoot,
    CuratedSeed,
    CuratedVariant,
    ManufacturerLabel,
    SourcelessRoot,
} from './curatedSeedFormat.js';
import type { SourceCandidate } from './sourceCandidates.js';

/** Everything the image is composed from, already parsed. */
export interface SeedInputs {
    /** Every SR Legacy and current Foundation item. */
    readonly usdaItems: readonly UsdaItemFacts[];
    /** The committed curated seed. */
    readonly curated: CuratedSeed;
    /** The committed Branded extract, keyed by item key. */
    readonly branded: ReadonlyMap<FdcKey, BrandedProduct>;
    /** Every committed table extract, by dataset, then by the dataset's key. FNDDS's keys are `fdc:<id>`. */
    readonly extracts: ReadonlyMap<TableDataset, ReadonlyMap<string, ExtractLine>>;
    /** Every candidate source of every root with no USDA item (KTD-22). */
    readonly candidates: readonly SourceCandidate[];
}

/** Where a root's numbers come from (R50). */
export type RootNumbers =
    | { readonly from: 'item' }
    | {
          readonly from: 'usdaStandIn';
          readonly item: FdcKey;
          readonly match: CitationMatch;
          /** The stand-in's nutrient rows: it may be a declared alias source, which no image item owns. */
          readonly nutrients: readonly CanonicalNutrient[];
      }
    | {
          readonly from: 'usdaBranded';
          readonly product: BrandedProduct;
          readonly match: CitationMatch;
          /** The product's values per 100 g, zeros dropped (KTD-20, OQ-2): the only values a later step can store. */
          readonly per100g: readonly NamedAmount[];
      }
    | {
          readonly from: 'extract';
          readonly dataset: TableDataset;
          /** The cited line as the source published it, for the citation. */
          readonly line: ExtractLine;
          readonly match: CitationMatch;
          /** The line per 100 g, with each conversion recorded: the only values a later step can store (KTD-24). */
          readonly per100g: Per100gValues;
      }
    | {
          readonly from: 'manufacturerLabel';
          readonly label: ManufacturerLabel;
          /** The printed values per 100 g, zeros dropped (KTD-20, OQ-2): the only values a later step can store. */
          readonly per100g: readonly NamedAmount[];
      }
    | { readonly from: 'none' };

/** One root of the image. */
export interface SeedImageRoot {
    /** The frozen seed key (KTD-8). */
    readonly seedKey: SeedKey;
    /** The display name: curated, or the supplier's USDA description. */
    readonly name: string;
    /** The curated synonyms; none for a baseline root. */
    readonly synonyms: readonly string[];
    /** The root's item: its USDA item, or its own seed key when it stands for none (KTD-6). */
    readonly item: ItemKey;
    /** The curated variants; none for a baseline root. */
    readonly variants: readonly CuratedVariant[];
    /** Where its numbers come from. */
    readonly numbers: RootNumbers;
    /** Whether the curated seed states it, or the baseline does. */
    readonly origin: 'curated' | 'baseline';
}

/** One source row of an item. */
export interface SeedImageSource {
    /** The USDA item. */
    readonly item: FdcKey;
    /** Why it is a source: it supplies the numbers, shares the description (R48), or is declared (rule 28a). */
    readonly role: 'supplier' | 'derivedAlias' | 'declaredAlias';
    /** The USDA item's lineage key (R19): its Foundation NDB number, or `null`. */
    readonly lineageKey: LineageKey | null;
}

/** One food group an item holds (owner, 2026-10-01), and the source row that states it. */
export interface SeedImageCategory {
    /** USDA's food group, as `food_category.csv` names it. */
    readonly name: string;
    /** The source that states it: the first in source order, supplier first. */
    readonly source: FdcKey;
}

/** One portion of an item, and the source row it came from. */
export interface SeedImagePortion {
    /** The portion label. */
    readonly label: string;
    /** Its weight in grams, as a decimal string. */
    readonly gramWeight: string;
    /** The source row it came from. */
    readonly source: FdcKey;
}

/** One item of the image. */
export interface SeedImageItem {
    /** Its source rows, the supplier first. None for a sourceless root's item. */
    readonly sources: readonly SeedImageSource[];
    /** The union of its sources' portions (R9). */
    readonly portions: readonly SeedImagePortion[];
    /** The union of its sources' food groups, each held once. */
    readonly categories: readonly SeedImageCategory[];
    /** Its supplier's nutrient rows per 100 g: the numbers its owner stores (R9). None for a sourceless root's item. */
    readonly nutrients: readonly CanonicalNutrient[];
}

/** What a seeded catalog must hold. */
export interface SeedImage {
    /** Every root, curated first in file order, then baseline roots by FDC id. */
    readonly roots: ReadonlyMap<SeedKey, SeedImageRoot>;
    /** Every item a root or variant owns. */
    readonly items: ReadonlyMap<ItemKey, SeedImageItem>;
}

/**
 * The serving units that mean a Branded product's amounts are per 100 g (the extract's `g`, `GRM`, `GM`).
 * Any other unit is a volume, whose amounts are per 100 mL, and nothing converts mL to g (KTD-20).
 */
const GRAM_SERVING_UNITS: ReadonlySet<string> = new Set(['g', 'grm', 'gm']);

/** A label's energy row, named once in the label map (U5). */
const CALORIES = LABEL_NUTRIENT_MAP.calories;

/**
 * Check one placed item against its R48 group.
 *
 * @param baseline - The baseline.
 * @param item - The placed item.
 * @param where - The key the issue names.
 * @param kind - Whether it is owned (a root's or variant's item) or a declared alias.
 * @returns The issue, if the item is outside the universe or not its group's supplier.
 */
function placementIssue(
    baseline: BaselineSeed,
    item: FdcKey,
    where: string,
    kind: 'owned' | 'alias',
): SeedIssue | undefined {
    const supplier = baseline.supplierOf.get(item);

    if (supplier === undefined) {
        return { where, rule: 'itemOutsideUniverse', detail: `${item} is not an SR Legacy or current Foundation item` };
    }

    if (supplier !== item) {
        return {
            where,
            rule: kind === 'alias' ? 'aliasNotSupplier' : 'itemNotSupplier',
            detail: `${item} shares its description with ${supplier}, which supplies the numbers`,
        };
    }

    return undefined;
}

/** Numbers a citation supplies: every shape but a root's own item and no numbers. */
type CitedNumbers = Exclude<RootNumbers, { readonly from: 'item' } | { readonly from: 'none' }>;

/** A candidate resolved against its dataset, carrying the numbers it would supply. */
interface ResolvedCandidate extends CitationCandidate {
    readonly numbers: CitedNumbers;
}

/** Why a candidate does not resolve. */
interface Unresolved {
    readonly rule: SeedRule;
    readonly detail: string;
}

/** What the image resolves a candidate against. */
interface EntryContext {
    readonly baseline: BaselineSeed;
    readonly branded: ReadonlyMap<FdcKey, BrandedProduct>;
    readonly extracts: ReadonlyMap<TableDataset, ReadonlyMap<string, ExtractLine>>;
}

/**
 * Whether an extract line has an energy value, in kcal or in kJ. Pure.
 *
 * @param line - The line.
 * @returns `true` when either is present.
 */
function lineHasEnergy(line: ExtractLine): boolean {
    return line.values[INFOODS.energyKcal] !== undefined || line.values[INFOODS.energyKj] !== undefined;
}

/**
 * Resolve a table candidate against its dataset's extract. Pure.
 *
 * @param dataset - The table dataset.
 * @param candidate - The candidate.
 * @param context - The extracts.
 * @returns The candidate with its numbers, or why it does not resolve.
 */
function resolveTableCandidate(
    dataset: TableDataset,
    candidate: SourceCandidate,
    context: EntryContext,
): ResolvedCandidate | Unresolved {
    const line = context.extracts.get(dataset)?.get(candidate.key);

    if (line === undefined) {
        return { rule: 'candidateNotInExtract', detail: `${dataset} ${candidate.key} is in no committed extract` };
    }

    if (line.basis === 'per100mL' && SOURCE_REGISTER[TABLE_DATASET_SOURCE[dataset]].basis !== 'per100gDrinksPer100mL') {
        return {
            rule: 'extractBasisUndeclared',
            detail: `${dataset} ${candidate.key} is per 100 mL, and its source publishes every value per 100 g`,
        };
    }

    return {
        ...candidate,
        numbers: { from: 'extract', dataset, line, match: candidate.match, per100g: toPer100g(line) },
        hasEnergy: lineHasEnergy(line),
    };
}

/**
 * Resolve one candidate of a root against its stated dataset, and only that dataset. Pure.
 *
 * @param root - The root the candidate is for.
 * @param candidate - The candidate.
 * @param context - The baseline, the Branded extract and the table extracts.
 * @returns The candidate with its numbers and energy, or why it does not resolve.
 */
function resolveCandidate(
    root: SourcelessRoot,
    candidate: SourceCandidate,
    context: EntryContext,
): ResolvedCandidate | Unresolved {
    const { dataset, key, match } = candidate;

    switch (dataset) {
        case 'label': {
            const label = root.nutrition?.source === 'manufacturerLabel' ? root.nutrition : undefined;

            return label?.url === key
                ? {
                      ...candidate,
                      numbers: { from: 'manufacturerLabel', label, per100g: labelPer100g(label) },
                      hasEnergy: label.perServing.some(
                          (value) => value.name === CALORIES.name && value.unit === CALORIES.unit,
                      ),
                  }
                : { rule: 'candidateNotInExtract', detail: `the root states no label at ${key}` };
        }

        case 'usdaBranded': {
            const product = isFdcKey(key) ? context.branded.get(key) : undefined;

            if (product === undefined) {
                return { rule: 'candidateNotInExtract', detail: `${key} is not in the Branded extract` };
            }

            return GRAM_SERVING_UNITS.has(product.serving_size_unit.toLowerCase())
                ? {
                      ...candidate,
                      numbers: { from: 'usdaBranded', product, match, per100g: brandedPer100g(product) },
                      hasEnergy: statesEnergy(product.nutrients),
                  }
                : {
                      rule: 'brandedServingNotGrams',
                      detail: `${key} is served in '${product.serving_size_unit}', so its amounts are not per 100 g`,
                  };
        }

        case 'usdaSrFoundation': {
            const facts = isFdcKey(key) ? context.baseline.universe.get(key) : undefined;

            if (facts === undefined) {
                return { rule: 'candidateNotInExtract', detail: `${key} is no SR Legacy or current Foundation item` };
            }

            const supplier = context.baseline.supplierOf.get(facts.key);

            return supplier === facts.key
                ? {
                      ...candidate,
                      numbers: { from: 'usdaStandIn', item: facts.key, match, nutrients: facts.nutrients },
                      hasEnergy: facts.hasEnergy,
                  }
                : { rule: 'itemNotSupplier', detail: `${key} is not its group's supplier, ${String(supplier)}` };
        }

        default:
            return resolveTableCandidate(dataset, candidate, context);
    }
}

/**
 * The text that names a candidate or a citation in an issue. Pure.
 *
 * @param citation - A dataset or source, a key and a match.
 * @returns `name key (match)`.
 */
function describeCitation(citation: { readonly name: string; readonly key: string; readonly match?: string }): string {
    return `${citation.name} ${citation.key}${citation.match === undefined ? '' : ` (${citation.match})`}`;
}

/**
 * Whether a root's committed nutrition cites the policy's choice. Pure.
 *
 * @param nutrition - The committed nutrition.
 * @param chosen - The policy's choice, if any.
 * @returns True when both name the same source, key and match, or both name nothing.
 */
function citesChoice(nutrition: SourcelessRoot['nutrition'], chosen: ResolvedCandidate | undefined): boolean {
    if (nutrition === null || chosen === undefined) {
        return nutrition === null && chosen === undefined;
    }

    if (nutrition.source === 'manufacturerLabel') {
        return chosen.dataset === 'label' && chosen.key === nutrition.url;
    }

    return (
        DATASET_SOURCE[chosen.dataset] === nutrition.source &&
        chosen.key === nutrition.key &&
        chosen.match === nutrition.match
    );
}

/**
 * Resolve every curated root's numbers through the citation policy (KTD-22). Pure.
 *
 * A root with its own item takes the item's numbers. A root with none takes the numbers of `chooseCitation`'s choice
 * among its candidates, and its committed citation must name that choice.
 *
 * @param roots - The curated roots.
 * @param candidates - The committed candidates.
 * @param context - The baseline and the extracts.
 * @returns The numbers of every root that resolved, and the issues: a candidate for an unknown root, a candidate that
 *   does not resolve, a tie, or a citation that is not the policy's choice.
 */
function citeRoots(
    roots: readonly CuratedRoot[],
    candidates: readonly SourceCandidate[],
    context: EntryContext,
): { readonly numbers: ReadonlyMap<SeedKey, RootNumbers>; readonly issues: readonly SeedIssue[] } {
    const issues: SeedIssue[] = [];
    const numbers = new Map<SeedKey, RootNumbers>();
    const sourceless = new Set(roots.filter((root) => root.item === null).map((root) => root.seedKey));
    const byRoot = new Map<string, SourceCandidate[]>();

    for (const candidate of candidates) {
        if (sourceless.has(candidate.seedKey)) {
            byRoot.set(candidate.seedKey, [...(byRoot.get(candidate.seedKey) ?? []), candidate]);
        } else {
            issues.push({
                where: candidate.seedKey,
                rule: 'candidateForUnknownRoot',
                detail: 'the seed holds no root with this key and no USDA item',
            });
        }
    }

    for (const root of roots) {
        if (root.item !== null) {
            numbers.set(root.seedKey, { from: 'item' });
            continue;
        }

        const resolved: ResolvedCandidate[] = [];

        for (const candidate of byRoot.get(root.seedKey) ?? []) {
            const entry = resolveCandidate(root, candidate, context);

            if ('rule' in entry) {
                issues.push({ where: root.seedKey, rule: entry.rule, detail: entry.detail });
            } else {
                resolved.push(entry);
            }
        }

        const choice = chooseCitation(resolved);

        if (choice.kind === 'tie') {
            issues.push({
                where: root.seedKey,
                rule: 'candidateTie',
                detail: `${choice.candidates.map((tied) => describeCitation({ ...tied, name: tied.dataset })).join(' and ')} rank equally; grade the one not meant lower`,
            });
            continue;
        }

        const chosen = choice.kind === 'chosen' ? choice.candidate : undefined;

        if (citesChoice(root.nutrition, chosen)) {
            numbers.set(root.seedKey, chosen?.numbers ?? { from: 'none' });
            continue;
        }

        const committed = root.nutrition;
        const committedText =
            committed === null
                ? 'no numbers'
                : committed.source === 'manufacturerLabel'
                  ? describeCitation({ name: 'label', key: committed.url })
                  : describeCitation({ ...committed, name: committed.source });

        issues.push({
            where: root.seedKey,
            rule: 'citationNotPolicyChoice',
            detail: `cites ${committedText}, but the policy chooses ${chosen === undefined ? 'no numbers' : describeCitation({ ...chosen, name: chosen.dataset })}`,
        });
    }

    return { numbers, issues };
}

/**
 * Union the food groups of an item's sources. An item holds a group once, since `food_category_assignment` keys on
 * (item, group), and the first source in source order that states it is the one cited. Pure.
 *
 * @param sources - The item's sources, the supplier first.
 * @param facts - The facts of every source.
 * @returns The groups, in source order.
 */
function unionCategories(sources: readonly SeedImageSource[], facts: readonly UsdaItemFacts[]): SeedImageCategory[] {
    const groups = new Map<FdcKey, string | null>(facts.map((fact) => [fact.key, fact.foodGroup]));
    const categories = new Map<string, SeedImageCategory>();

    for (const { item } of sources) {
        const name = groups.get(item) ?? null;

        if (name !== null && !categories.has(name)) {
            categories.set(name, { name, source: item });
        }
    }

    return [...categories.values()];
}

/**
 * Union the portions of an item's sources (R9). For each label, the highest-ranked source that has it
 * contributes ALL of its rows with that label, and no other source contributes that label. So the supplier
 * wins a clash, and a single source's repeated labels survive: USDA publishes them, and `food_portions` has no
 * uniqueness on (item, label). Pure.
 *
 * @param ranked - The sources' facts, the supplier first, then in the election's order.
 * @returns The portions, in source order, then file order.
 */
function unionPortions(ranked: readonly UsdaItemFacts[]): SeedImagePortion[] {
    const claimedBy = new Map<string, FdcKey>();
    const portions: SeedImagePortion[] = [];

    for (const source of ranked) {
        for (const portion of source.portions) {
            const owner = claimedBy.get(portion.label) ?? source.key;

            claimedBy.set(portion.label, owner);

            if (owner === source.key) {
                portions.push({ label: portion.label, gramWeight: portion.gramWeight, source: source.key });
            }
        }
    }

    return portions;
}

/**
 * Compose one USDA-backed item from its group and the declared aliases of it.
 *
 * @param baseline - The baseline.
 * @param item - The item: its group's supplier.
 * @param declaredAliases - The declared alias sources whose `of` is this item.
 * @returns The item.
 */
function composeItem(baseline: BaselineSeed, item: FdcKey, declaredAliases: readonly FdcKey[]): SeedImageItem {
    const groupOf = (supplier: FdcKey): readonly UsdaItemFacts[] => {
        const group = baseline.groups.get(supplier);

        if (group === undefined) {
            throw new Error(`Unreachable: ${supplier} was checked to supply a group.`);
        }

        return group.members;
    };

    const own = groupOf(item);
    const sources: SeedImageSource[] = own.map((member) => ({
        item: member.key,
        role: member.key === item ? 'supplier' : 'derivedAlias',
        lineageKey: member.lineageKey,
    }));
    const facts: UsdaItemFacts[] = [...own];

    for (const alias of declaredAliases) {
        const members = groupOf(alias);

        const declared = members.filter((member) => member.key === alias);
        const derived = members.filter((member) => member.key !== alias);

        sources.push(
            ...declared.map((member) => ({
                item: member.key,
                role: 'declaredAlias' as const,
                lineageKey: member.lineageKey,
            })),
            ...derived.map((member) => ({
                item: member.key,
                role: 'derivedAlias' as const,
                lineageKey: member.lineageKey,
            })),
        );
        facts.push(...members);
    }

    const supplier = facts.filter((fact) => fact.key === item);

    return {
        sources,
        portions: unionPortions([...supplier, ...rankBySupply(facts.filter((fact) => fact.key !== item))]),
        categories: unionCategories(sources, facts),
        nutrients: supplier.flatMap((fact) => fact.nutrients),
    };
}

/**
 * Compose the seed image, or refuse the seed with every issue found. Pure.
 *
 * @param inputs - The parsed committed inputs.
 * @returns The image.
 * @throws {SeedRefusedError} for a baseline refusal, an exclusion outside the universe, an item that is not
 *   its group's supplier or not in the universe, a candidate its dataset does not hold, a tie, a citation that is not
 *   the policy's choice (KTD-22), or a seed key or name the image holds twice.
 */
export function composeSeedImage(inputs: SeedInputs): SeedImage {
    const { curated, branded, extracts, candidates } = inputs;
    const issues: SeedIssue[] = [];
    const exclusions = new Set<FdcKey>(curated.changes.exclusions);
    const universe = new Set<FdcKey>(inputs.usdaItems.map((item) => item.key));

    for (const item of exclusions) {
        if (!universe.has(item)) {
            issues.push({
                where: item,
                rule: 'exclusionOutsideUniverse',
                detail: 'names no SR Legacy or current Foundation item',
            });
        }
    }

    let baseline: BaselineSeed;

    try {
        baseline = buildBaselineSeed(inputs.usdaItems, exclusions);
    } catch (error) {
        throw isSeedRefusedError(error) ? new SeedRefusedError([...issues, ...error.issues]) : error;
    }

    const cited = citeRoots(curated.roots, candidates, { baseline, branded, extracts });
    const curatedRoots: SeedImageRoot[] = [];

    issues.push(...cited.issues);
    const touched = new Set<FdcKey>(curated.changes.aliases.map((alias) => alias.from));

    for (const root of curated.roots) {
        const owned = [...(root.item === null ? [] : [root.item]), ...root.variants.map((variant) => variant.item)];

        for (const item of owned) {
            touched.add(item);

            const issue = placementIssue(baseline, item, root.seedKey, 'owned');

            if (issue !== undefined) {
                issues.push(issue);
            }
        }

        const numbers = cited.numbers.get(root.seedKey);

        // A root with no numbers here was refused in `cited.issues`.
        if (numbers !== undefined) {
            curatedRoots.push({
                seedKey: root.seedKey,
                name: root.name,
                synonyms: root.synonyms,
                item: root.item ?? root.seedKey,
                variants: root.variants,
                numbers,
                origin: 'curated',
            });
        }
    }

    for (const alias of curated.changes.aliases) {
        const issue = placementIssue(baseline, alias.from, alias.from, 'alias');

        if (issue !== undefined) {
            issues.push(issue);
        }
    }

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    const roots = new Map<SeedKey, SeedImageRoot>(curatedRoots.map((root) => [root.seedKey, root]));

    const untouched = [...baseline.groups.values()]
        .filter((group) => !touched.has(group.supplier.key))
        .sort((left, right) => fdcIdOf(left.supplier.key) - fdcIdOf(right.supplier.key));

    for (const group of untouched) {
        const seedKey = group.supplier.key;

        if (roots.has(seedKey)) {
            issues.push({
                where: seedKey,
                rule: 'duplicateSeedKey',
                detail: `is also the key of the untouched baseline root '${group.name}'`,
            });
            continue;
        }

        roots.set(seedKey, {
            seedKey,
            name: group.name,
            synonyms: [],
            item: seedKey,
            variants: [],
            numbers: { from: 'item' },
            origin: 'baseline',
        });
    }

    const names = new Map<string, SeedImageRoot>();

    for (const root of roots.values()) {
        const name = normalizeName(root.name);
        const other = names.get(name);

        if (other === undefined) {
            names.set(name, root);
        } else {
            // Curated roots come first, so a curated root is always `other`: name the one a person can fix.
            const [fix, keep] = other.origin === 'curated' ? [other, root] : [root, other];

            issues.push({
                where: fix.seedKey,
                rule: 'duplicateName',
                detail: `'${fix.name}' collides with ${keep.seedKey} '${keep.name}'`,
            });
        }
    }

    if (issues.length > 0) {
        throw new SeedRefusedError(issues);
    }

    const declaredAliases = new Map<FdcKey, FdcKey[]>();

    for (const alias of curated.changes.aliases) {
        declaredAliases.set(alias.of, [...(declaredAliases.get(alias.of) ?? []), alias.from]);
    }

    const items = new Map<ItemKey, SeedImageItem>();

    for (const root of roots.values()) {
        for (const item of [root.item, ...root.variants.map((variant) => variant.item)]) {
            items.set(
                item,
                isFdcKey(item)
                    ? composeItem(baseline, item, declaredAliases.get(item) ?? [])
                    : { sources: [], portions: [], categories: [], nutrients: [] },
            );
        }
    }

    const lineageIssues = sharedLineageIssues(items);

    if (lineageIssues.length > 0) {
        throw new SeedRefusedError(lineageIssues);
    }

    return { roots, items };
}

/**
 * Refuse a lineage key two sources hold. A lineage names one live food (R19), so the owner reader could not tell
 * which item a newer USDA version of it belongs to. Pure.
 *
 * @param items - The image's items.
 * @returns One issue per source after the first that holds a key, in item-key order.
 */
function sharedLineageIssues(items: ReadonlyMap<ItemKey, SeedImageItem>): SeedIssue[] {
    const holders = new Map<LineageKey, FdcKey>();
    const issues: SeedIssue[] = [];

    for (const key of [...items.keys()].sort()) {
        for (const { item, lineageKey } of items.get(key)?.sources ?? []) {
            const holder = lineageKey === null ? undefined : holders.get(lineageKey);

            if (holder !== undefined) {
                issues.push({
                    where: key,
                    rule: 'lineageKeyShared',
                    detail: `${item} holds ${String(lineageKey)}, which ${holder} already holds`,
                });
            } else if (lineageKey !== null) {
                holders.set(lineageKey, item);
            }
        }
    }

    return issues;
}
