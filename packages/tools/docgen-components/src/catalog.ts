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
import type { ComponentEntry, ComponentImplementation, LayerSignals } from './model.js';

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
        const platforms = PLATFORM_ORDER.filter((platform) => leaves.some((leaf) => leaf.platform === platform));
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
