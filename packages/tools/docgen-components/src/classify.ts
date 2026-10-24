/**
 * @module @kitchensink/docgen-components/classify — pure derivations over documentation TEXT.
 *
 * ⛔ Nothing here infers a component's layer from its CODE SHAPE. "It calls `useState`, so it must be
 * orchestration" is a guess that would be presented as a fact, and a wrong guess in generated documentation
 * is worse than an admitted gap — it is a second source of truth that contradicts the docblock beside it.
 * What these functions do is READ what the docblock says, and record `unclassified` when it says nothing.
 * That silence is the coverage number the findings layer reports.
 */
import type { ComponentKind, DocTag, LayerSignals } from './model.js';

/** Words a docblock uses for the orchestration half of the orchestration/render split. */
const ORCHESTRATION_WORDS = /\borchestrat(?:ion|ional|ing|es|or)\b/i;

/** Words a docblock uses for the render half. */
const PRESENTATIONAL_WORDS = /\bpresentational\b/i;

/**
 * The raw layer words present in a piece of documentation.
 *
 * @param documentation - Concatenated module docblock and component description.
 * @returns Which layer words appear.
 */
export function layerSignalsOf(documentation: string): LayerSignals {
    return {
        presentational: PRESENTATIONAL_WORDS.test(documentation),
        orchestration: ORCHESTRATION_WORDS.test(documentation),
    };
}

/**
 * Collapse layer signals into the kind a reader navigates by.
 *
 * ORCHESTRATION WINS when both words appear, and the reason is asymmetric: an orchestrator's docblock names
 * the presentational leaf it delegates to (that IS the split it is describing), while a presentational leaf
 * has no reason to name an orchestrator. The residual error — a render component whose docblock mentions the
 * orchestration layer above it — is not hidden: {@link LayerSignals} travels with the entry, and the findings
 * layer raises `ambiguous-layer-signal` on exactly those, so a human resolves them instead of a regex.
 *
 * @param signals - The raw signals.
 * @returns The component kind.
 */
export function kindFromSignals(signals: LayerSignals): ComponentKind {
    if (signals.orchestration) {
        return 'orchestration';
    }

    return signals.presentational ? 'presentational' : 'unclassified';
}

/**
 * The design patterns a component's documentation NAMES, via `@pattern` tags.
 *
 * Only the explicit tag counts. Matching pattern names out of prose was tried and rejected: "Provider",
 * "Command" and "State" occur constantly in ordinary sentences about React, so prose matching manufactures a
 * pattern register nobody wrote. An empty list here is a real finding against CLAUDE.md's requirement that a
 * component's JSDoc name the pattern it implements — and it stays a finding rather than being papered over.
 *
 * @param tagSets - Tag lists from every leaf of the component.
 * @returns The distinct pattern names, sorted.
 */
export function patternsFrom(tagSets: readonly (readonly DocTag[])[]): readonly string[] {
    const patterns = new Set<string>();

    for (const tags of tagSets) {
        for (const tag of tags) {
            if (tag.name === 'pattern' && tag.text !== '') {
                patterns.add(tag.text);
            }
        }
    }

    return [...patterns].sort();
}
