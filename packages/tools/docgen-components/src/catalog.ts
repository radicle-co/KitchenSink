/**
 * @module @kitchensink/docgen-components/catalog — assembles platform LEAVES into COMPONENTS. Pure.
 *
 * ## The cross-platform decision, and why it is one entry rather than two
 *
 * `Button.tsx` and `Button.native.tsx` are two files, one component. A caller writes
 * `import { Button } from '@commise/ui/button'` and the bundler picks the leaf; there is no situation in
 * which a reader wants "the web Button" as a separate thing from "the native Button", and emitting them as
 * two entries would put the design system's 8 components on the page as 15 unrelated ones.
 *
 * ⛔ It is NOT flattened, either. The two leaves are kept whole inside the entry, each with its OWN docblock,
 * its own props and its own findings — because they genuinely differ (the native Button paints a gradient and
 * ignores `type`; the web one submits a form) and a catalogue that showed only one of them would be
 * documenting half the system while looking complete. So: one entry, `platforms: ['web', 'native']`, two
 * implementations, and `propsDiverge` when the two leaves stop declaring the same contract — which is the
 * cross-platform drift `docs/CODING_STANDARDS.md` §14 exists to prevent, made visible.
 *
 * Pairing is by DIRECTORY + component NAME, never by filename alone: two components called `Header` in
 * different features are different components, and a `.native.tsx` leaf always sits beside its sibling.
 */
import { kindFromSignals, patternsFrom } from './classify.js';
import type { ComponentGroup, Platform } from './config.js';
import { DocgenError } from './errors.js';
import type { ComponentEntry, ComponentImplementation, LayerSignals } from './model.js';

/** The one `@platform` value: a bare file whose imports resolve per platform. */
const SHARED_PLATFORM = 'shared';

/** Platform order used everywhere, so two entries never disagree about which leaf comes first. */
const PLATFORM_ORDER: readonly Platform[] = ['web', 'native'];

/**
 * The id-visible path of a directory within its group — the `src/` prefix every package shares carries no
 * information and is dropped.
 *
 * @param dir - Repo-relative directory of the leaf.
 * @param packageDir - Repo-relative package root.
 * @returns The path segment used in the component id, possibly empty.
 */
function idPath(dir: string, packageDir: string): string {
    const withinPackage = dir === packageDir ? '' : dir.slice(packageDir.length + 1);

    return withinPackage.startsWith('src/') ? withinPackage.slice(4) : withinPackage === 'src' ? '' : withinPackage;
}

/**
 * Whether a leaf's own docblock says the one file serves both platforms.
 *
 * A suffix-less file whose imports resolve per platform (the house `Sheet`, say) has no `.native.tsx` twin to pair
 * with. The docblock declares it with `@platform shared`; the generator reads that and never infers it from imports.
 * The tag's whole text must be `shared`. The docblock parser ends a tag only at the next tag, so prose written after
 * it would leave the description with no signal; it is refused instead, and the message says to write the tag last.
 * Any other value (`web`, a typo) is refused too.
 *
 * @param leaf - One leaf.
 * @returns Whether it declares itself shared.
 * @throws {DocgenError} When the leaf carries an `@platform` tag whose text is not exactly `shared`.
 */
function isSharedLeaf(leaf: ComponentImplementation): boolean {
    const tags = [...leaf.moduleTags, ...leaf.tags].filter((tag) => tag.name === 'platform');

    for (const tag of tags) {
        const text = tag.text.trim();
        const value = text.split(/\s/)[0] ?? '';

        if (value !== SHARED_PLATFORM) {
            throw new DocgenError(
                `${leaf.sourcePath}: unknown @platform value ${JSON.stringify(value)}; ` +
                    `the only value is "${SHARED_PLATFORM}"`,
            );
        }

        if (text !== SHARED_PLATFORM) {
            throw new DocgenError(
                `${leaf.sourcePath}: text after @platform ${SHARED_PLATFORM} leaves the description; ` +
                    'write the tag last, after the layer line',
            );
        }
    }

    return tags.length > 0;
}

/**
 * Read every leaf's `@platform` tag, then refuse a `shared` claim that the entry's own leaves disprove.
 *
 * Every leaf is validated before the entry is classified, so a bad value throws wherever its leaf sits and the result
 * never depends on file order.
 *
 * @param group - The group the component belongs to.
 * @param leaves - Every leaf of one component.
 * @returns Whether the component's one file serves both platforms.
 * @throws {DocgenError} For an unknown `@platform` value, a shared leaf beside a `.native` leaf, or a shared leaf in a
 * group that ships to fewer than two platforms.
 */
function sharedClaimOf(group: ComponentGroup, leaves: readonly ComponentImplementation[]): boolean {
    const declaresShared = leaves.map(isSharedLeaf);
    const shared = leaves.find((_leaf, index) => declaresShared[index]);
    const twin = leaves.find((leaf) => leaf.platform === 'native');

    if (shared !== undefined && twin !== undefined) {
        throw new DocgenError(
            `${shared.sourcePath}: declares @platform ${SHARED_PLATFORM} but has the native twin ${twin.sourcePath}`,
        );
    }

    if (shared !== undefined && group.platforms.length < 2) {
        throw new DocgenError(
            `${shared.sourcePath}: declares @platform ${SHARED_PLATFORM} but its group ships to ` +
                `${group.platforms.join(' and ')} only`,
        );
    }

    return shared !== undefined;
}

/**
 * Whether two leaves declare different prop NAMES.
 *
 * Names rather than types on purpose: the two leaves legitimately type the same prop differently (a web
 * `onPress` is a DOM handler, a native one is not), but a prop PRESENT on one leaf and absent on the other is
 * a contract that has drifted, and no caller of the shared import can be correct about it.
 *
 * @param implementations - Every leaf of one component.
 * @returns Whether the leaves' prop-name sets differ.
 */
function propsDiverge(implementations: readonly ComponentImplementation[]): boolean {
    if (implementations.length < 2) {
        return false;
    }

    const signatures = implementations.map((leaf) =>
        leaf.props
            .map((prop) => prop.name)
            .sort()
            .join(','),
    );

    return new Set(signatures).size > 1;
}

/**
 * OR the layer signals across every leaf — one leaf documenting the split documents the component.
 *
 * @param implementations - Every leaf of one component.
 * @returns The combined signals.
 */
function combinedSignals(implementations: readonly ComponentImplementation[]): LayerSignals {
    return {
        presentational: implementations.some((leaf) => leaf.docSignals.presentational),
        orchestration: implementations.some((leaf) => leaf.docSignals.orchestration),
    };
}

/**
 * Assemble a group's leaves into components.
 *
 * @param group - The group being documented.
 * @param implementations - Every leaf discovered in that group.
 * @returns The components, ordered by id.
 */
export function buildEntries(
    group: ComponentGroup,
    implementations: readonly ComponentImplementation[],
): readonly ComponentEntry[] {
    const buckets = new Map<string, ComponentImplementation[]>();

    for (const leaf of implementations) {
        const key = `${leaf.dir}::${leaf.name}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(leaf);
        buckets.set(key, bucket);
    }

    const entries: ComponentEntry[] = [];

    for (const bucket of buckets.values()) {
        const leaves = [...bucket].sort(
            (left, right) => PLATFORM_ORDER.indexOf(left.platform) - PLATFORM_ORDER.indexOf(right.platform),
        );
        const first = leaves[0] as ComponentImplementation;
        const shared = sharedClaimOf(group, leaves);

        const platforms = PLATFORM_ORDER.filter(
            (platform) => shared || leaves.some((leaf) => leaf.platform === platform),
        );
        const path = idPath(first.dir, group.packageDir);
        const signals = combinedSignals(leaves);

        entries.push({
            id: `${group.id}/${path === '' ? '' : `${path}/`}${first.name}`,
            name: first.name,
            group: group.id,
            packageName: group.packageName,
            layer: group.layer,
            dir: first.dir,
            kind: kindFromSignals(signals),
            patterns: patternsFrom(leaves.flatMap((leaf) => [leaf.moduleTags, leaf.tags])),
            platforms,
            crossPlatform: platforms.length > 1,
            propsDiverge: propsDiverge(leaves),
            documented: leaves.some((leaf) => leaf.moduleDoc !== '' || leaf.description !== ''),
            implementations: leaves,
        });
    }

    return entries.sort((left, right) => left.id.localeCompare(right.id));
}
