/**
 * THE USDA → COOK PHRASING INVERSION — turning a catalog description into the line a cook would write.
 *
 * DESIGN PATTERN: **pure Translator.** No I/O, no randomness, no clock: a description in, a noun phrase out.
 * It is separated from the corpus generator for the same reason `prompt.ts` is separated from the Bedrock
 * call — this is the part whose correctness can be pinned example-by-example, and it is the part that decides
 * whether the corpus measures the model or measures the generator.
 *
 * ## ⛔ THE PROBLEM THIS SOLVES
 *
 * USDA writes `Flour, wheat, all-purpose, enriched`: head noun first, then descriptors in decreasing order of
 * how much they identify the food. A cook writes `2 cups all-purpose wheat flour, sifted`: quantity, then
 * descriptors in the mirror order, then the head noun, then an optional preparation clause. The catalog and
 * the recipe are the SAME food written by two conventions, and the gate's whole job is to decide whether a
 * candidate from the first convention matches a line in the second.
 *
 * So the inversion is: reverse the descriptors, put the head last, and move the prepositional descriptors
 * (`with skin`, `without salt`) back behind the head where English puts them.
 *
 * ## ⚠️ WHY IT REFUSES MOST OF THE CATALOG, ON PURPOSE
 *
 * {@link isInvertibleUsdaName} accepts roughly a quarter of the seeded 8,094 rows. Three exclusions carry
 * their weight:
 *
 *  - **Branded rows** (`George Weston Bakeries, Thomas English Muffins`) have no cook phrasing to derive —
 *    a cook writes the brand, and the "inversion" would be a rearrangement of a trademark.
 *  - **Category heads** (`Snacks`, `Babyfood`, `Beverages`) are containers, not foods. They matter twice:
 *    their inversions read as nonsense, AND their head-sharing siblings are unrelated foods, which would turn
 *    the corpus's near-miss class into a gross-miss class and flatter every model on the number that decides.
 *  - **Parentheticals, semicolons, digits and long tails** are catalog bookkeeping (`raw (Alaska Native)`,
 *    `trimmed to 0 inch fat`), and a line built from them is not a line any cook wrote.
 *
 * A narrower pool that phrases faithfully is worth far more than a wide one that does not, because ground
 * truth here is by CONSTRUCTION: a phrasing that no longer names its row silently converts every model
 * disagreement into a "false disagree" that says nothing about the model.
 */

/** A head noun: one or two words, only the first of which may be capitalised. Rejects brands outright. */
const HEAD_SHAPE = /^[A-Za-z][a-z-]*(?: [a-z][a-z-]*)?$/u;

/** A descriptor: one to three lower-case words. Rejects digits, brackets, semicolons and trademarks. */
const DESCRIPTOR_SHAPE = /^[a-z][a-z-]*(?: [a-z][a-z-]*){0,2}$/u;

/** The most comma segments a description may carry and still read as head-plus-adjectives. */
const MAX_SEGMENTS = 4;

/**
 * Heads that name a CATALOG CONTAINER rather than a food.
 *
 * ⛔ Do not add a food kind here. `Soup`, `Cheese`, `Beef` and `Cookies` look like categories and are not:
 * `Soup, tomato` against `Soup, chicken noodle` is exactly the plausible-wrong-food contrast the bake-off
 * exists to measure, and excluding them would remove the hardest and most representative near misses.
 */
const CATEGORY_HEADS: ReadonlySet<string> = new Set([
    'alcoholic beverage',
    'alcoholic beverages',
    'babyfood',
    'beverages',
    'candies',
    'cereals ready-to-eat',
    'entrees',
    'fast foods',
    'formulated bar',
    'infant formula',
    'meal replacement',
    'nutritional supplement',
    'protein supplement',
    'restaurant',
    'school lunch',
    'snacks',
    'toppings',
    'usda commodity',
]);

/**
 * Segments that are USDA bookkeeping rather than anything a cook says.
 *
 * `dry heat` and `moist heat` are laboratory cooking methods; `solids and liquids` describes how a canned
 * product was assayed. Left in, they produce phrases ("solids and liquids water pack canned peaches") that no
 * human would write and that make the judging task about the phrasing rather than the food.
 */
const BOOKKEEPING_SEGMENTS: ReadonlySet<string> = new Set([
    'all types',
    'all varieties',
    'drained solids',
    'dry heat',
    'moist heat',
    'nfs',
    'not further specified',
    'solids and liquids',
    'undrained solids',
]);

/** Descriptor openings that belong BEHIND the head noun in English. */
const PREPOSITIONS = ['with ', 'without ', 'from ', 'in ', 'including ', 'made with '] as const;

/**
 * Function words that survive de-duplication.
 *
 * De-duplicating them would corrupt a legitimate phrase — "salt and pepper and vinegar" must not collapse to
 * "salt and pepper vinegar".
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set(['and', 'or', 'with', 'without', 'in', 'from', 'made']);

/**
 * Split a USDA description into its trimmed, non-empty comma segments.
 *
 * @param name - The catalog description.
 * @returns The segments, in catalog order. Pure.
 */
export function usdaSegments(name: string): string[] {
    return name
        .split(',')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== '');
}

/** Whether a descriptor belongs behind the head noun. */
function isPrepositional(descriptor: string): boolean {
    return PREPOSITIONS.some((preposition) => descriptor.startsWith(preposition));
}

/**
 * Whether this description can be turned into a line a cook would recognise.
 *
 * @param name - The catalog description.
 * @returns Whether {@link cookNounPhrase} may be applied to it. Pure.
 */
export function isInvertibleUsdaName(name: string): boolean {
    const segments = usdaSegments(name);

    if (segments.length < 2 || segments.length > MAX_SEGMENTS) {
        return false;
    }

    const head = segments[0] ?? '';

    if (!HEAD_SHAPE.test(head) || CATEGORY_HEADS.has(head.toLowerCase())) {
        return false;
    }

    return segments.slice(1).every((segment) => DESCRIPTOR_SHAPE.test(segment));
}

/**
 * Drop repeated CONTENT words, keeping the LAST occurrence.
 *
 * ⛔ LAST, not first, and the direction is the whole rule. The head noun is assembled last, so keeping the
 * last occurrence removes the redundant EARLIER copy and leaves the head intact:
 *
 *  - `Nuts, pine nuts, dried` → "dried pine nuts nuts" → **"dried pine nuts"**
 *  - `Wheat flour, whole-grain, soft wheat` → "soft wheat whole-grain wheat flour" → **"soft whole-grain wheat flour"**
 *  - `Salad dressing, italian dressing, reduced fat` → **"reduced fat italian salad dressing"**
 *
 * ⚠️ This REPLACED a first-wins dedupe plus a separate "drop the head when a descriptor names it" rule. That
 * pair had a defect the first live run exposed: `Rice mix, cheese flavor, dry mix, unprepared` matched the
 * head's last word (`mix`) against the descriptor `dry mix`, dropped the head, and emitted a line that never
 * said RICE. A line that does not name its food makes the corpus's `correct` label false, which is the one
 * thing the whole substitution rests on. One rule, in the right direction, closes it.
 *
 * @param words - The assembled words.
 * @returns The de-duplicated words. Pure.
 */
function dedupeContentWords(words: readonly string[]): string[] {
    const lastIndex = new Map<string, number>();

    words.forEach((word, index) => {
        if (!FUNCTION_WORDS.has(word)) {
            lastIndex.set(word, index);
        }
    });

    return words.filter((word, index) => FUNCTION_WORDS.has(word) || lastIndex.get(word) === index);
}

/**
 * The noun phrase a cook would write for a catalog row.
 *
 * ⚠️ Precondition: {@link isInvertibleUsdaName} is true for `name`. Applied to a name it rejects, the result
 * is defined but meaningless — the generator filters first, and its tests assert that it does.
 *
 * @param name - The catalog description.
 * @returns The cook's noun phrase, lower case and without a quantity. Pure.
 */
export function cookNounPhrase(name: string): string {
    const segments = usdaSegments(name);
    const head = (segments[0] ?? '').toLowerCase();
    const descriptors = segments
        .slice(1)
        .map((segment) => segment.toLowerCase())
        .filter((segment) => !BOOKKEEPING_SEGMENTS.has(segment));

    const trailing = descriptors.filter(isPrepositional).slice(0, 1);
    // ⛔ EVERY non-prepositional descriptor, not a truncated prefix. An earlier draft kept only the two most
    // identifying ones, on the theory that a cook does not recite a catalog entry. The first live run showed
    // what that costs: `Peppers, sweet, green, sauteed` became "green sweet peppers", so the line no longer
    // said SAUTEED while the candidate did — and a model contradicting it was RIGHT, while the corpus counted
    // the contradiction as a false disagree. Faithfulness beats fluency here, because the `correct` label is
    // true only if the line really names the row.
    const leading = descriptors.filter((descriptor) => !isPrepositional(descriptor)).reverse();

    const words = [...leading, head, ...trailing].join(' ').split(' ');

    return dedupeContentWords(words).join(' ');
}
