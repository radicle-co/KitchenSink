/**
 * @module @kitchensink/docgen-components/config — the REGISTRY of what gets documented and where the derived
 * artifacts land.
 *
 * Pattern: **Registry**. One typed table of component groups replaces the per-call "which directory again?"
 * argument, so discovery, extraction, emission and the staleness guard all walk the SAME surface. A group
 * added here is documented, guarded and indexed by construction; there is no second list to keep in step.
 *
 * ⛔ Nothing in this module DESCRIBES a component or a token. It names packages and paths only. Every fact a
 * reader sees in the generated output is read out of the sources at generation time — see `extract.ts` and
 * `tokens.ts`. A description written here would be a second source of truth for something the code already
 * states, which is exactly the rot this artifact exists to avoid.
 */
import { resolve } from 'node:path';

/**
 * The repository root, derived from this module's own location
 * (`<repo>/packages/tools/docgen-components/src`). Deriving it beats an env var: the generator and its
 * staleness guard must agree on the root or the guard compares two different trees.
 */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

/** The platform a component leaf renders on. `.native.tsx` is React Native; a bare `.tsx` is the web/DOM leaf. */
export type Platform = 'web' | 'native';

/**
 * Where a group sits in the architecture. This is the primary axis a reader navigates by: the design system
 * is the reusable vocabulary, features are the domain surfaces built from it, and apps are the shells.
 */
export type GroupLayer = 'design-system' | 'feature' | 'app';

/** One documented package. */
export interface ComponentGroup {
    /** Stable slug — the filename of this group's catalogue and the key a consumer indexes by. */
    readonly id: string;
    /** Human-facing group name. */
    readonly title: string;
    /** The npm workspace name, e.g. `@commise/ui`. */
    readonly packageName: string;
    /** Repo-relative package root — the directory holding the `tsconfig.json` used to type the sources. */
    readonly packageDir: string;
    /** Repo-relative files or directories scanned for components. A path may be a directory or a single file. */
    readonly sourceRoots: readonly string[];
    /** Architectural layer. */
    readonly layer: GroupLayer;
    /** Platforms the package ships to — an app package ships to exactly one, shared packages to both. */
    readonly platforms: readonly Platform[];
}

/**
 * THE registry. Order is the reading order of the generated index: design system first (it is the vocabulary
 * everything else is written in), then the shared feature packages, then the two app shells.
 */
export const COMPONENT_GROUPS: readonly ComponentGroup[] = [
    {
        id: 'design-system',
        title: 'Design system',
        packageName: '@commise/ui',
        packageDir: 'packages/apps/commise/ui',
        sourceRoots: ['packages/apps/commise/ui/src'],
        layer: 'design-system',
        platforms: ['web', 'native'],
    },
    {
        id: 'features-recipes',
        title: 'Recipes feature',
        packageName: '@commise/features-recipes',
        packageDir: 'packages/apps/commise/features/recipes',
        sourceRoots: ['packages/apps/commise/features/recipes/src'],
        layer: 'feature',
        platforms: ['web', 'native'],
    },
    {
        id: 'features-account',
        title: 'Account feature',
        packageName: '@commise/features-account',
        packageDir: 'packages/apps/commise/features/account',
        sourceRoots: ['packages/apps/commise/features/account/src'],
        layer: 'feature',
        platforms: ['web', 'native'],
    },
    {
        id: 'web',
        title: 'Web app',
        packageName: '@commise/web',
        packageDir: 'packages/apps/commise/web',
        sourceRoots: ['packages/apps/commise/web/src'],
        layer: 'app',
        platforms: ['web'],
    },
    {
        id: 'mobile',
        title: 'Mobile app',
        packageName: '@commise/mobile',
        packageDir: 'packages/apps/commise/mobile',
        sourceRoots: ['packages/apps/commise/mobile/App.tsx', 'packages/apps/commise/mobile/src'],
        layer: 'app',
        platforms: ['native'],
    },
];

/** The design-system package, whose token modules `tokens.ts` reads its docblocks from. */
export const UI_TOKENS_DIR = 'packages/apps/commise/ui/src/tokens';

/** Repo-relative output directory for the component catalogue. */
export const COMPONENTS_OUT_DIR = 'docs/generated/components';

/** Repo-relative output directory for the design-token catalogue. */
export const DESIGN_OUT_DIR = 'docs/generated/design';

/**
 * The contract version of the emitted JSON. Consumers (the docs site) branch on it. Bump it when the shape
 * changes incompatibly — never when the CONTENT changes, which happens on every source edit.
 */
export const SCHEMA_VERSION = 1;
