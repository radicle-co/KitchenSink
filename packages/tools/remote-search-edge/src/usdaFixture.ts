/**
 * @module usdaFixture — a deterministic double of the USDA FoodData Central endpoints the repo calls.
 *
 * Two services read USDA: the remote search service (`POST /foods/search`) and the food service, when a cook picks a
 * remote hit and its item is fetched (`GET /food/{fdcId}`, `POST /foods`). The local sandbox points BOTH here, so
 * nothing local reaches api.nal.usda.gov (a third-party API, with a real key behind it).
 *
 * It is not a catalog. It answers any query with the same few foods named for the query, because what the e2e tier
 * needs from USDA is a SHAPE: several foods, the first of which names the word typed, and none that would complete a
 * placeholder under the bare word (`remoteProbeWords.ts`'s `judgeProbe` is that shape's authority, and this module's
 * test runs it over every candidate word). The one exception is a word USDA does not know, so the create-a-food story
 * can reach its create offer.
 *
 * @pattern Test double — a pure, stateless-by-construction responder; the only memory is the ids it has listed
 */

/** Words USDA has no food for, lowercase. `Zorbleflax` is the name `createAuthoredFood.yaml` types. */
const UNKNOWN_TO_USDA: ReadonlySet<string> = new Set(['zorbleflax']);

/** The ways a food is named from the word searched; never the bare word (see the module note). */
const NAME_FORMS: readonly ((word: string) => string)[] = [
    (word) => `${word}, raw`,
    (word) => `${word}, dried`,
    (word) => `${word}, cooked`,
    (word) => `${word} sauce`,
    (word) => `${word}, canned`,
    (word) => `${word}, organic`,
];

/** Nutrient ids the catalog stores, and the per-100 g value each is given. */
const MACROS: readonly {
    readonly nutrientId: number;
    readonly nutrientName: string;
    readonly unitName: string;
    readonly value: number;
}[] = [
    { nutrientId: 1008, nutrientName: 'Energy', unitName: 'KCAL', value: 120 },
    { nutrientId: 1003, nutrientName: 'Protein', unitName: 'G', value: 4.5 },
    { nutrientId: 1004, nutrientName: 'Total lipid (fat)', unitName: 'G', value: 3.2 },
    { nutrientId: 1005, nutrientName: 'Carbohydrate, by difference', unitName: 'G', value: 18.4 },
];

/** A search hit, in the fields the live API sends that the repo reads. */
export interface FixtureSearchHit {
    readonly fdcId: number;
    readonly description: string;
    readonly dataType: 'SR Legacy';
}

/** A search answer. */
export interface FixtureSearchBody {
    readonly totalHits: number;
    readonly foods: readonly FixtureSearchHit[];
}

/** A food's detail, in the fields the repo reads. */
export interface FixtureFoodDetail {
    readonly fdcId: number;
    readonly description: string;
    readonly dataType: 'SR Legacy';
    readonly foodNutrients: readonly (typeof MACROS)[number][];
    readonly foodAttributes: readonly never[];
}

/** The double. */
export interface UsdaFixture {
    /** The foods a query finds. A food listed here can be fetched by {@link UsdaFixture.detail}. */
    search(query: string): FixtureSearchBody;
    /** A listed food's detail, or `undefined` for an id this double never listed. */
    detail(fdcId: number): FixtureFoodDetail | undefined;
}

/**
 * FNV-1a over the text: a stable 32-bit number, so a word's ids never depend on what was searched before it. Pure.
 *
 * @param text - The text.
 * @returns An unsigned 32-bit hash.
 */
function hashOf(text: string): number {
    let hash = 0x811c9dc5;

    for (const char of text) {
        hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
    }

    return hash;
}

/**
 * A word with its first letter raised, as USDA capitalises a description. Pure.
 *
 * @param word - One lowercase word.
 * @returns The word.
 */
function capitalised(word: string): string {
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
}

/**
 * Make a double. Each has its own memory of the ids it listed.
 *
 * @returns The double.
 */
export function createUsdaFixture(): UsdaFixture {
    const listed = new Map<number, string>();

    return {
        search(query) {
            const words = query
                .trim()
                .toLowerCase()
                .split(/\s+/u)
                .filter((word) => word !== '');

            if (words.length === 0 || words.some((word) => UNKNOWN_TO_USDA.has(word))) {
                return { totalHits: 0, foods: [] };
            }

            const subject = words.map(capitalised).join(' ');
            // Ids start high enough to be unlike a real catalog's, and step by form within a word's own block.
            const base = 9_000_000_000 + hashOf(words.join(' ')) * 10;
            const foods = NAME_FORMS.map((form, index) => {
                const food: FixtureSearchHit = {
                    fdcId: base + index,
                    description: form(subject),
                    dataType: 'SR Legacy',
                };

                listed.set(food.fdcId, food.description);

                return food;
            });

            return { totalHits: foods.length, foods };
        },
        detail(fdcId) {
            const description = listed.get(fdcId);

            return description === undefined
                ? undefined
                : { fdcId, description, dataType: 'SR Legacy', foodNutrients: MACROS, foodAttributes: [] };
        },
    };
}
