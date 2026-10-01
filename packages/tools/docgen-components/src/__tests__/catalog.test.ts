/**
 * The CROSS-PLATFORM assembly — the decision that a `.tsx` / `.native.tsx` pair is ONE component with two
 * implementations, and the drift detector that keeps that claim honest.
 */
import { describe, expect, it } from 'vitest';

import { buildEntries } from '../catalog.js';
import type { ComponentGroup } from '../config.js';
import { makeImplementation, makeProp } from '../__fixtures__/implementation.js';

const GROUP: ComponentGroup = {
    id: 'design-system',
    title: 'Design system',
    packageName: '@commise/ui',
    packageDir: 'packages/apps/commise/ui',
    sourceRoots: ['packages/apps/commise/ui/src'],
    layer: 'design-system',
    platforms: ['web', 'native'],
};

const webLeaf = makeImplementation();
const nativeLeaf = makeImplementation({
    platform: 'native',
    sourcePath: 'packages/apps/commise/ui/src/button/Button.native.tsx',
    description: 'The native button.',
});

describe('buildEntries', () => {
    it('pairs the two leaves of one component into a single entry', () => {
        const [entry] = buildEntries(GROUP, [nativeLeaf, webLeaf]);

        expect(entry?.id).toBe('design-system/button/Button');
        expect(entry?.crossPlatform).toBe(true);
        expect(entry?.platforms).toEqual(['web', 'native']);
        expect(entry?.implementations).toHaveLength(2);
    });

    // The leaves genuinely differ, and flattening them would document half the system while looking complete.
    it('keeps each leaf whole, with its own description', () => {
        const [entry] = buildEntries(GROUP, [nativeLeaf, webLeaf]);

        expect(entry?.implementations.map((leaf) => leaf.description)).toEqual(['The button.', 'The native button.']);
    });

    it('orders web before native regardless of discovery order', () => {
        const [fromNative] = buildEntries(GROUP, [nativeLeaf, webLeaf]);
        const [fromWeb] = buildEntries(GROUP, [webLeaf, nativeLeaf]);

        expect(fromNative?.implementations.map((leaf) => leaf.platform)).toEqual(['web', 'native']);
        expect(fromWeb?.implementations.map((leaf) => leaf.platform)).toEqual(['web', 'native']);
    });

    // Two components of the same name in different features are different components.
    it('does not pair same-named components from different directories', () => {
        const other = makeImplementation({
            platform: 'native',
            dir: 'packages/apps/commise/ui/src/surface',
            sourcePath: 'packages/apps/commise/ui/src/surface/Button.native.tsx',
        });
        const entries = buildEntries(GROUP, [webLeaf, other]);

        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => entry.id)).toEqual([
            'design-system/button/Button',
            'design-system/surface/Button',
        ]);
    });

    it('flags a pair whose leaves declare different prop names', () => {
        const diverged = makeImplementation({
            platform: 'native',
            sourcePath: 'packages/apps/commise/ui/src/button/Button.native.tsx',
            props: [makeProp(), makeProp({ name: 'onPress' })],
        });

        expect(buildEntries(GROUP, [webLeaf, diverged])[0]?.propsDiverge).toBe(true);
    });

    // Names, not types: the two leaves legitimately type `onPress` differently, and calling that drift would
    // make the signal fire on every cross-platform component in the repository.
    it('does not flag a pair whose shared props are typed differently per platform', () => {
        const nativeTyped = makeImplementation({
            platform: 'native',
            sourcePath: 'packages/apps/commise/ui/src/button/Button.native.tsx',
            props: [makeProp({ type: '(event: GestureResponderEvent) => void' })],
        });

        expect(buildEntries(GROUP, [webLeaf, nativeTyped])[0]?.propsDiverge).toBe(false);
    });

    it('never reports divergence for a component with a single leaf', () => {
        expect(buildEntries(GROUP, [webLeaf])[0]?.propsDiverge).toBe(false);
    });

    it('collects @pattern tags from every leaf and classifies from the union of their signals', () => {
        const tagged = makeImplementation({
            platform: 'native',
            sourcePath: 'packages/apps/commise/ui/src/button/Button.native.tsx',
            moduleTags: [{ name: 'pattern', text: 'Adapter' }],
            docSignals: { presentational: false, orchestration: true },
        });
        const [entry] = buildEntries(GROUP, [webLeaf, tagged]);

        expect(entry?.patterns).toEqual(['Adapter']);
        expect(entry?.kind).toBe('orchestration');
    });

    it('drops the shared `src/` prefix from the id but keeps the path within the package', () => {
        const nested = makeImplementation({
            dir: 'packages/apps/commise/ui/src/surface/glass',
            sourcePath: 'packages/apps/commise/ui/src/surface/glass/GlassCard.tsx',
            name: 'GlassCard',
        });

        expect(buildEntries(GROUP, [nested])[0]?.id).toBe('design-system/surface/glass/GlassCard');
    });

    it('reports a component as undocumented only when NEITHER leaf carries any documentation', () => {
        const bare = makeImplementation({ moduleDoc: '', description: '' });
        const halfDocumented = makeImplementation({
            platform: 'native',
            sourcePath: 'packages/apps/commise/ui/src/button/Button.native.tsx',
            moduleDoc: '',
            description: '',
        });

        expect(buildEntries(GROUP, [bare])[0]?.documented).toBe(false);
        expect(buildEntries(GROUP, [webLeaf, halfDocumented])[0]?.documented).toBe(true);
    });
});
