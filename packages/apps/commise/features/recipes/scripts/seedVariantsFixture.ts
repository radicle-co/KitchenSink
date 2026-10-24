/**
 * The derivation behind `src/details/__fixtures__/seedVariants.ts`: the live variants of the six roots
 * `docs/design/ingredientSpecialization.md` §S8.3 names, in the wire shape, from the committed curated seed.
 *
 * The seed carries no calories. A root's calories come from the `<script id="seed">` block of the design mockup, the
 * USDA figures it was drawn with, and only for a root that block covers in full. Every match is exact: an item, or the
 * ordered part texts. A mockup row that matches no variant, or a variant matched twice, is refused rather than guessed.
 *
 * Pure: it takes the two files' text. `generateSeedVariants.ts` owns the reading, the formatting and the writing, and
 * `__tests__/seedVariantsFixture.test.ts` holds the committed file to this derivation.
 *
 * @module
 */
import type { VariantView } from '@kitchensink/food-service-client';
import { z } from 'zod';

/** The committed curated seed, from the repository root. */
export const SEED_PATH = 'packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl';

/** The design mockup whose seed block carries the calories, from the repository root. */
export const MOCKUP_PATH = 'docs/design/variantDetailsMockup.html';

/** The generated fixture, from the repository root. */
export const FIXTURE_PATH = 'packages/apps/commise/features/recipes/src/details/__fixtures__/seedVariants.ts';

/** The roots the fixture holds, each under its export's name, in the order the file declares them. */
export const SEED_VARIANT_ROOTS: readonly { readonly exportName: string; readonly rootName: string }[] = [
    { exportName: 'BONELESS_SKINLESS_CHICKEN_THIGHS', rootName: 'boneless skinless chicken thighs' },
    { exportName: 'BONELESS_SKINLESS_CHICKEN_BREASTS', rootName: 'boneless skinless chicken breasts' },
    { exportName: 'BEEF_BRISKET', rootName: 'beef brisket' },
    { exportName: 'GROUND_BEEF', rootName: 'ground beef' },
    { exportName: 'BEEF_CHUCK_ROAST', rootName: 'beef chuck roast' },
    { exportName: 'BEEF_RIBEYE_STEAK', rootName: 'beef ribeye steak' },
];

/** The fixture: each configured root's live variants, under its export's name. */
export type SeedVariantFixtures = Readonly<Record<string, readonly VariantView[]>>;

/** The slice of a seed row this derivation reads. */
const seedRowSchema = z.object({
    name: z.string(),
    variants: z.array(
        z.object({
            item: z.string(),
            parts: z.array(z.object({ attribute: z.string(), text: z.string() })).min(1),
        }),
    ),
});

type SeedRow = z.infer<typeof seedRowSchema>;

/** One mockup entry: a root, its stated variant count, and its rows' calories. */
const mockupEntrySchema = z.object({
    food: z.string(),
    n: z.number().int(),
    groups: z.array(
        z.object({
            rows: z.array(z.object({ item: z.string().optional(), parts: z.array(z.string()), cal: z.number() })),
        }),
    ),
});

type MockupEntry = z.infer<typeof mockupEntrySchema>;

/** The mockup's seed block: root entries by key, beside a `macros` table this derivation does not read. */
const mockupSeedSchema = z.record(z.string(), z.unknown());

/** The JSON island the mockup's seed block sits in. */
const MOCKUP_SEED_BLOCK = /<script id="seed" type="application\/json">([\s\S]*?)<\/script>/u;

/**
 * The seed's rows, by name.
 *
 * @param seedJsonl - The seed file's text: one JSON row per line.
 * @returns Each row, keyed by its name. Pure.
 * @throws {Error} when a line is not a seed row, or two rows share a name.
 */
function seedRowsByName(seedJsonl: string): ReadonlyMap<string, SeedRow> {
    const rows = new Map<string, SeedRow>();

    for (const line of seedJsonl.split('\n')) {
        if (line.trim() === '') {
            continue;
        }

        const row = seedRowSchema.parse(JSON.parse(line));

        if (rows.has(row.name)) {
            throw new Error(`The seed names "${row.name}" twice`);
        }

        rows.set(row.name, row);
    }

    return rows;
}

/**
 * The mockup's root entries, by root name, with the key each sits under.
 *
 * @param mockupHtml - The mockup file's text.
 * @returns Each entry and its key, keyed by root name. Pure.
 * @throws {Error} when the mockup has no seed block, or an entry other than `macros` is not a root entry.
 */
function mockupEntriesByRoot(mockupHtml: string): ReadonlyMap<string, { key: string; entry: MockupEntry }> {
    const block = MOCKUP_SEED_BLOCK.exec(mockupHtml)?.[1];

    if (block === undefined) {
        throw new Error(`${MOCKUP_PATH} has no <script id="seed"> block`);
    }

    const entries = new Map<string, { key: string; entry: MockupEntry }>();

    for (const [key, value] of Object.entries(mockupSeedSchema.parse(JSON.parse(block)))) {
        if (key === 'macros') {
            continue;
        }

        const entry = mockupEntrySchema.parse(value);
        entries.set(entry.food, { key, entry });
    }

    return entries;
}

/**
 * Each variant's calories from a mockup entry, or none when the entry does not cover the root in full.
 *
 * @param variants - The root's variants, in seed order.
 * @param mockupEntry - The root's mockup entry and its key, when it has one.
 * @returns The calories, index for index with `variants`, or `undefined` for no calories. Pure.
 * @throws {Error} when a row matches no variant, or a variant is matched by no row or by more than one.
 */
function caloriesOf(
    variants: SeedRow['variants'],
    mockupEntry: { key: string; entry: MockupEntry } | undefined,
): readonly number[] | undefined {
    if (mockupEntry === undefined) {
        return undefined;
    }

    const { key, entry } = mockupEntry;
    const rows = entry.groups.flatMap((group) => group.rows);

    if (rows.length !== entry.n || entry.n !== variants.length) {
        return undefined;
    }

    const calories = new Map<number, number>();

    for (const row of rows) {
        const index = variants.findIndex((variant) =>
            row.item === undefined
                ? JSON.stringify(variant.parts.map((part) => part.text)) === JSON.stringify(row.parts)
                : variant.item === row.item,
        );

        if (index === -1) {
            throw new Error(`The mockup's "${key}" row ${JSON.stringify(row.parts)} matches no seed variant`);
        }

        calories.set(index, row.cal);
    }

    // As many rows as variants: a variant two rows match leaves another unmatched, which this refuses.
    return variants.map((variant, index) => {
        const cal = calories.get(index);

        if (cal === undefined) {
            throw new Error(`The mockup's "${key}" entry gives seed variant ${variant.item} no calories`);
        }

        return cal;
    });
}

/**
 * Derive the fixture from the seed and the mockup.
 *
 * @param seedJsonl - The curated seed's text.
 * @param mockupHtml - The design mockup's text.
 * @returns Each configured root's live variants, under its export's name. Pure.
 * @throws {Error} when a configured root is not in the seed, or the mockup's calories cannot be matched exactly.
 */
export function deriveSeedVariants(seedJsonl: string, mockupHtml: string): SeedVariantFixtures {
    const rows = seedRowsByName(seedJsonl);
    const mockup = mockupEntriesByRoot(mockupHtml);

    return Object.fromEntries(
        SEED_VARIANT_ROOTS.map(({ exportName, rootName }) => {
            const row = rows.get(rootName);

            if (row === undefined) {
                throw new Error(`"${rootName}" is not in the seed`);
            }

            const calories = caloriesOf(row.variants, mockup.get(rootName));

            return [
                exportName,
                row.variants.map((variant, index): VariantView => {
                    const view: VariantView = {
                        id: variant.item,
                        parts: variant.parts.map(({ attribute, text }) => ({ attribute, text })),
                    };
                    const caloriesPer100g = calories?.[index];

                    return caloriesPer100g === undefined ? view : { ...view, caloriesPer100g };
                }),
            ];
        }),
    );
}

/**
 * The fixture module's text, before formatting.
 *
 * @param fixtures - The derived fixture.
 * @returns The module's source. Pure.
 */
export function seedVariantsModuleText(fixtures: SeedVariantFixtures): string {
    const exports = SEED_VARIANT_ROOTS.map(({ exportName, rootName }) => {
        const variants = fixtures[exportName] ?? [];

        return [
            `/** \`${rootName}\`: ${String(variants.length)} live variants. */`,
            // One line: Prettier keeps an object expanded when its source breaks after `{`, so it picks the layout.
            `export const ${exportName}: readonly VariantView[] = ${JSON.stringify(variants)};`,
        ].join('\n');
    });

    return [
        '/**',
        ' * GENERATED by `npm run fixtures:generate --workspace=@commise/features-recipes`',
        ' * (`scripts/seedVariantsFixture.ts`). Do not edit it by hand:',
        ' * `scripts/__tests__/seedVariantsFixture.test.ts` fails when it and its sources disagree.',
        ' *',
        ' * Live variants of six roots from the committed curated seed, in the wire shape:',
        ` * \`${SEED_PATH}\`. They are the fixtures`,
        ' * `docs/design/ingredientSpecialization.md` §S8.3 names, so the grouping rule is tested on real data at its',
        ' * boundaries.',
        ' *',
        ` * Calories are the USDA values in \`${MOCKUP_PATH}\`, present only for the roots that file covers`,
        ' * in full. The others carry parts only: their tests are about structure, which calories do not change.',
        ' */',
        "import type { VariantView } from '@kitchensink/food-service-client';",
        '',
        exports.join('\n\n'),
        '',
    ].join('\n');
}
