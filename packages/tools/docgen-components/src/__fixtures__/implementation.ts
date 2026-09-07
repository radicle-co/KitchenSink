/**
 * @module fixtures/implementation — factories for the domain records, so the pure layers (`catalog`,
 * `findings`) can be driven without a TypeScript program.
 *
 * The extraction tier is tested against REAL `.tsx` files; these exist for the layers ABOVE it, where the
 * input is a domain record and building one from source would test the extractor a second time instead of
 * the rule under test.
 */
import type { ComponentEntry, ComponentImplementation, DocumentedProp } from '../model.js';

/**
 * Build a prop record.
 *
 * @param overrides - Fields to override.
 * @returns The prop.
 */
export function makeProp(overrides: Partial<DocumentedProp> = {}): DocumentedProp {
    return {
        name: 'label',
        type: 'string',
        typeDetail: null,
        required: true,
        defaultValue: null,
        description: 'The visible label.',
        declaredIn: 'packages/apps/commise/ui/src/button/props.ts',
        ...overrides,
    };
}

/**
 * Build a component leaf.
 *
 * @param overrides - Fields to override.
 * @returns The implementation.
 */
export function makeImplementation(overrides: Partial<ComponentImplementation> = {}): ComponentImplementation {
    return {
        name: 'Button',
        platform: 'web',
        sourcePath: 'packages/apps/commise/ui/src/button/Button.tsx',
        dir: 'packages/apps/commise/ui/src/button',
        moduleDoc: 'A pure presentational control.',
        moduleTags: [],
        description: 'The button.',
        tags: [],
        detectedBy: 'react-docgen-typescript',
        exportKind: 'named',
        props: [makeProp()],
        usesRefApi: [],
        booleanPropsSelectingSubtree: [],
        docSignals: { presentational: true, orchestration: false },
        ...overrides,
    };
}

/**
 * Build a component entry.
 *
 * @param overrides - Fields to override.
 * @returns The entry.
 */
export function makeEntry(overrides: Partial<ComponentEntry> = {}): ComponentEntry {
    const implementations = overrides.implementations ?? [makeImplementation()];

    return {
        id: 'design-system/button/Button',
        name: 'Button',
        group: 'design-system',
        packageName: '@commise/ui',
        layer: 'design-system',
        dir: 'packages/apps/commise/ui/src/button',
        kind: 'presentational',
        patterns: [],
        platforms: ['web'],
        crossPlatform: false,
        propsDiverge: false,
        documented: true,
        ...overrides,
        implementations,
    };
}
