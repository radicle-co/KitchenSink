/**
 * @module @kitchensink/docgen-components/model — the DOMAIN shape of the generated catalogue.
 *
 * Pattern: **Anti-Corruption Layer**. `react-docgen-typescript` and the TypeScript compiler are the two
 * upstreams; nothing outside `extract.ts` sees either one's vocabulary. The docs site codes against these
 * types (serialized as JSON), so a library swap is a change to one adapter rather than to every consumer.
 *
 * Every field here is DERIVED from a source file. There is no field a human fills in, and there must never
 * be: a description typed here would be a second, rotting copy of something the code already states.
 */
import type { GroupLayer, Platform } from './config.js';

/** A JSDoc tag as TypeScript parsed it — `@pattern Value Object` becomes `{ name: 'pattern', text: '…' }`. */
export interface DocTag {
    /** Tag name without the `@`. */
    readonly name: string;
    /** The tag's trailing text, empty when the tag carries none. */
    readonly text: string;
}

/**
 * The two layer words this repository's component docblocks actually use (CLAUDE.md's orchestration/render
 * split). Recorded as RAW SIGNALS rather than collapsed into one verdict, because a docblock that says "the
 * orchestrational half … hands them to the pure presentational dialog" contains both, and a consumer that
 * cannot see the ambiguity cannot flag it.
 */
export interface LayerSignals {
    readonly presentational: boolean;
    readonly orchestration: boolean;
}

/** One prop of one component. */
export interface DocumentedProp {
    readonly name: string;
    /** The resolved type as TypeScript prints it; `enum` for a union, whose members are in {@link typeDetail}. */
    readonly type: string;
    /** Union members when the type is a union, else `null`. */
    readonly typeDetail: readonly string[] | null;
    readonly required: boolean;
    /** The destructuring default, when the component declares one. */
    readonly defaultValue: string | null;
    /** The prop's own JSDoc, empty when it has none. */
    readonly description: string;
    /** Repo-relative file the prop is DECLARED in — a shared contract module, usually not the leaf. */
    readonly declaredIn: string | null;
}

/** How a component was found. Recorded because the library has a blind spot and silence would hide it. */
export type DetectionSource = 'react-docgen-typescript' | 'compiler-fallback';

/** One platform leaf of a component. */
export interface ComponentImplementation {
    readonly name: string;
    readonly platform: Platform;
    /** Repo-relative source path. */
    readonly sourcePath: string;
    /** Repo-relative directory holding the leaf — the pairing key for cross-platform siblings. */
    readonly dir: string;
    /** The file's own leading docblock, stripped of comment markers. Empty when the file has none. */
    readonly moduleDoc: string;
    readonly moduleTags: readonly DocTag[];
    /** The component declaration's own JSDoc summary. Empty when it has none. */
    readonly description: string;
    readonly tags: readonly DocTag[];
    readonly detectedBy: DetectionSource;
    readonly exportKind: 'named' | 'default';
    readonly props: readonly DocumentedProp[];
    /** Ref APIs the module reaches for, sorted. Refs are near-forbidden, so this is evidence, not trivia. */
    readonly usesRefApi: readonly string[];
    /** Boolean props used as the test of a conditional whose BOTH branches render JSX. */
    readonly booleanPropsSelectingSubtree: readonly string[];
    readonly docSignals: LayerSignals;
}

/** The layer a component sits in, as its own documentation states it. Never inferred from code shape. */
export type ComponentKind = 'presentational' | 'orchestration' | 'unclassified';

/** One component: its identity, and every platform leaf that implements it. */
export interface ComponentEntry {
    /** Stable id — `<group>/<path under the group's source root>/<name>`. */
    readonly id: string;
    readonly name: string;
    readonly group: string;
    readonly packageName: string;
    readonly layer: GroupLayer;
    /** Repo-relative directory. */
    readonly dir: string;
    readonly kind: ComponentKind;
    /** Patterns the component's own docblocks NAME via `@pattern`. Empty when it names none. */
    readonly patterns: readonly string[];
    readonly platforms: readonly Platform[];
    readonly crossPlatform: boolean;
    /** True when the leaves declare different prop names — a cross-platform contract that has drifted. */
    readonly propsDiverge: boolean;
    readonly documented: boolean;
    readonly implementations: readonly ComponentImplementation[];
}

/** How serious a finding is. `review` needs a human judgement; it is not an assertion of wrongdoing. */
export type FindingSeverity = 'violation' | 'gap' | 'review';

/** One rule hit against one component. */
export interface Finding {
    readonly rule: string;
    readonly severity: FindingSeverity;
    readonly component: string;
    readonly sourcePath: string;
    readonly message: string;
    /** The evidence the rule fired on — a prop name, a ref API, the divergent prop set. */
    readonly evidence: readonly string[];
}
