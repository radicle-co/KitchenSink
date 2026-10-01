/**
 * The seed's one refusal (plan U1): every rule the committed seed can break, collected and reported together.
 *
 * `SeedRule` is a closed union with one member per refusal, so a test asserts the NAMED cause rather than
 * message text, and a new refusal is a new member rather than a new sentence.
 */

/** Every rule a committed seed can break, one member per refusal. */
const SEED_RULES = [
    // One line of curatedCatalog.jsonl, or one part of catalogChanges.json, is not the format.
    'malformedRecord',
    // A part's attribute is missing, or is not in the closed vocabulary (KTD-7).
    'partWithoutAttribute',
    // A variant's parts are not in the attribute order (KTD-7, R6).
    'partsOutOfOrder',
    // A variant has no parts.
    'variantWithoutParts',
    // A curated root name or a variant part contains `"` or `″`.
    'inchMark',
    // A root with a USDA item carries `nutrition`; its numbers are its item's (R50).
    'nutritionBesideItem',
    // A root with no USDA item does not state its `nutrition`, not even `null` (R50).
    'nutritionMissing',
    // A variant carries `nutrition`; a variant's numbers are its own item's (R9).
    'nutritionOnVariant',
    // A root with no USDA item has variants (R4).
    'sourcelessRootWithVariants',
    // A root with no USDA item has an `fdc:` seed key, which would collide with a USDA item's key (KTD-8).
    'sourcelessRootKeyNotCurated',
    // A manufacturer label is missing, or has a malformed, URL, date, manufacturer, serving or value (KTD-20).
    'labelCitationIncomplete',
    // A label's serving is stated only in volume; nothing converts mL to g (KTD-20).
    'labelServingInVolume',
    // A label value names a (name, unit) pair outside LABEL_NUTRIENT_MAP.
    'labelNutrientUnknown',
    // A label states one nutrient twice.
    'labelNutrientRepeated',
    // A root cites a source the register does not admit (R50, R52).
    'citationSourceUnknown',
    // A USDA citation's key is not an `fdc:<id>` key.
    'citationKeyMalformed',
    // Two roots share a seed key (R3).
    'duplicateSeedKey',
    // Two roots share a name under `normalizeName`, the database's unique key.
    'duplicateName',
    // One item is owned twice: by a root and a variant, by two variants, or by an owner and a declared alias (R4).
    'itemOwnedTwice',
    // Two variants of one root have identical parts.
    'identicalVariantParts',
    // A merge, alias or exclusion is listed twice.
    'changeListedTwice',
    // A variant's (item, root) pair is not declared as a merge (R7).
    'mergeUndeclared',
    // A merge names no variant of the root it merges into (R7).
    'mergeWithoutVariant',
    // A merge absorbs a root with no USDA item (R4).
    'mergeAbsorbsSourcelessRoot',
    // A declared alias's `of` is neither a root's item nor a variant's item (R48).
    'aliasTargetUnknown',
    // An excluded item is also a root, variant, merge or alias (R51).
    'excludedItemPlaced',
    // A split's `newKey` is not a curated root (R7).
    'splitTargetUnknown',
    // A split lists an item its `newKey` root does not own (R7).
    'splitItemNotOwned',
    // A USDA item appears twice in the universe.
    'usdaItemRepeated',
    // A USDA item's description is blank, so its baseline root would have no name.
    'descriptionBlank',
    // A USDA item's publication date is not an ISO calendar date, so the election cannot compare it.
    'publicationDateNotIso',
    // An exclusion names an item outside the universe (R51).
    'exclusionOutsideUniverse',
    // A curated root, variant or alias names an item outside the universe (R48).
    'itemOutsideUniverse',
    // A curated root's or variant's item is not its R48 group's supplier (R48).
    'itemNotSupplier',
    // A declared alias's `from` is not its R48 group's supplier (R48).
    'aliasNotSupplier',
    // A root's committed citation is not `chooseCitation`'s choice from its candidates (KTD-22).
    'citationNotPolicyChoice',
    // A row of sourceCandidates.tsv is not the format (KTD-22).
    'candidateMalformed',
    // A candidate is listed twice for one root.
    'candidateRepeated',
    // An SR Legacy or Foundation candidate is not graded as the same substance (R50).
    'candidateStandInNotSameSubstance',
    // A root's two best candidates rank equally, so the policy cannot choose without file order (KTD-22).
    'candidateTie',
    // An extract line's basis is one its source's register declaration does not publish (R54).
    'extractBasisUndeclared',
    // A candidate names a root the seed does not hold, or one with its own USDA item.
    'candidateForUnknownRoot',
    // A candidate names an entry no committed extract, USDA item or root label holds.
    'candidateNotInExtract',
    // A cited Branded product's serving is not stated in grams, so its amounts are per 100 mL (KTD-20).
    'brandedServingNotGrams',
    // `foodPopularity.jsonl` weighs an item outside the universe (R45).
    'popularityItemUnknown',
] as const;

/** A rule a committed seed can break. */
export type SeedRule = (typeof SEED_RULES)[number];

const RULES: ReadonlySet<string> = new Set(SEED_RULES);

/**
 * Whether a value names a seed rule. Pure.
 *
 * @param value - Any value.
 * @returns `true` when the value is a member of {@link SEED_RULES}.
 */
export function isSeedRule(value: unknown): value is SeedRule {
    return typeof value === 'string' && RULES.has(value);
}

/** One broken rule, and where. */
export interface SeedIssue {
    /** The root key, item key or file position the issue is about. */
    readonly where: string;
    /** The rule it breaks. */
    readonly rule: SeedRule;
    /** A sentence for the person fixing it. */
    readonly detail: string;
}

/** Thrown when the committed seed breaks one or more rules. It carries every issue found, not the first. */
export class SeedRefusedError extends Error {
    /** Every issue, in the order found. */
    public readonly issues: readonly SeedIssue[];

    /**
     * @param issues - Every issue found; at least one.
     */
    public constructor(issues: readonly SeedIssue[]) {
        const shown = issues.slice(0, 20).map((issue) => `  ${issue.where} [${issue.rule}] ${issue.detail}`);
        const more = issues.length > shown.length ? [`  … and ${String(issues.length - shown.length)} more`] : [];

        super([`The seed is refused (${String(issues.length)} issue(s)):`, ...shown, ...more].join('\n'));
        this.name = 'SeedRefusedError';
        this.issues = issues;
        Object.setPrototypeOf(this, SeedRefusedError.prototype);
    }
}

/**
 * Type guard for {@link SeedRefusedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a seed refusal.
 */
export function isSeedRefusedError(error: unknown): error is SeedRefusedError {
    return error instanceof SeedRefusedError;
}
