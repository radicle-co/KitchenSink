/**
 * @module @kitchensink/docgen-components/findings — the RULE layer. Pure.
 *
 * Pattern: **Specification**. Each rule is a self-contained predicate over one entry, returning the findings
 * it can justify from evidence carried in the entry; {@link collectFindings} is a fold over the rule list.
 * Adding a rule is adding a function to one array, and no rule can see another's state.
 *
 * ⛔ A finding is a REPORT, never a repair. This generator reads `packages/apps/**` and writes nothing there;
 * a rule that fired and then "fixed" a component would be editing the source its own output is derived from.
 *
 * Severity says what the reader owes the row, and the distinction is load-bearing:
 *  - `violation` — the code does something CLAUDE.md names as near-forbidden. No judgement needed.
 *  - `gap` — documentation the standard requires is absent. Countable, and the count is the coverage number.
 *  - `review` — a CANDIDATE the generator cannot adjudicate. Calling these violations would be dishonest;
 *    hiding them would defeat the point. They are named as needing a human, and they say why.
 */
import type { ComponentEntry, ComponentImplementation, Finding } from './model.js';

/** A rule: everything it can justify about one component. */
type Rule = (entry: ComponentEntry) => readonly Finding[];

/** Build one finding against a specific leaf. */
function at(
    leaf: ComponentImplementation,
    entry: ComponentEntry,
    rule: string,
    severity: Finding['severity'],
    message: string,
    evidence: readonly string[],
): Finding {
    return { rule, severity, component: entry.id, sourcePath: leaf.sourcePath, message, evidence };
}

/** CLAUDE.md: a component's JSDoc names what it is. A file with no module docblock states nothing. */
const missingModuleDoc: Rule = (entry) =>
    entry.implementations
        .filter((leaf) => leaf.moduleDoc === '')
        .map((leaf) => at(leaf, entry, 'missing-module-doc', 'gap', 'the file has no module docblock', []));

/** The declaration's own JSDoc — the one-line summary a prop table is read under. */
const missingComponentDoc: Rule = (entry) =>
    entry.implementations
        .filter((leaf) => leaf.description === '')
        .map((leaf) =>
            at(leaf, entry, 'missing-component-doc', 'gap', 'the component declaration has no JSDoc summary', []),
        );

/** A prop with no description is a name and a type, which the type already said. */
const undocumentedProps: Rule = (entry) =>
    entry.implementations
        .map((leaf) => ({ leaf, names: leaf.props.filter((prop) => prop.description === '').map((prop) => prop.name) }))
        .filter(({ names }) => names.length > 0)
        .map(({ leaf, names }) =>
            at(leaf, entry, 'undocumented-prop', 'gap', 'props carry no JSDoc description', names),
        );

/** CLAUDE.md's orchestration/render split, which the docblock is supposed to state. */
const unclassifiedLayer: Rule = (entry) =>
    entry.kind !== 'unclassified'
        ? []
        : [
              at(
                  entry.implementations[0] as ComponentImplementation,
                  entry,
                  'unclassified-layer',
                  'gap',
                  'no docblock says whether this is a presentational or an orchestration component',
                  [],
              ),
          ];

/** Both layer words present — see `classify.ts` for why the collapse can over-classify, and who resolves it. */
const ambiguousLayerSignal: Rule = (entry) => {
    const ambiguous = entry.implementations.filter(
        (leaf) => leaf.docSignals.presentational && leaf.docSignals.orchestration,
    );

    return ambiguous.map((leaf) =>
        at(
            leaf,
            entry,
            'ambiguous-layer-signal',
            'review',
            'the docblock names BOTH layers; the catalogue resolved it to orchestration',
            [],
        ),
    );
};

/** CLAUDE.md: refs are near-forbidden — permitted only to wrap a genuinely external, non-declarative system. */
const refApi: Rule = (entry) =>
    entry.implementations
        .filter((leaf) => leaf.usesRefApi.length > 0)
        .map((leaf) =>
            at(
                leaf,
                entry,
                'ref-api',
                'violation',
                'refs are near-forbidden; permitted only to wrap an external non-declarative system',
                leaf.usesRefApi,
            ),
        );

/** CLAUDE.md: a boolean prop that switches BEHAVIOUR belongs in the orchestration layer. */
const booleanSubtreeSwitch: Rule = (entry) =>
    entry.implementations
        .filter((leaf) => leaf.booleanPropsSelectingSubtree.length > 0)
        .map((leaf) =>
            at(
                leaf,
                entry,
                'boolean-prop-selects-subtree',
                'review',
                'a boolean prop selects between two rendered subtrees — behaviour switch, or display derivation?',
                leaf.booleanPropsSelectingSubtree,
            ),
        );

/** §14: the two leaves of one cross-platform component must implement the same contract. */
const divergentContract: Rule = (entry) =>
    !entry.propsDiverge
        ? []
        : [
              at(
                  entry.implementations[0] as ComponentImplementation,
                  entry,
                  'cross-platform-props-diverge',
                  'review',
                  'the web and native leaves declare different prop names',
                  entry.implementations.map(
                      (leaf) => `${leaf.platform}: ${leaf.props.map((prop) => prop.name).join(' ') || '(none)'}`,
                  ),
              ),
          ];

/**
 * §14: every user-facing feature ships to BOTH platforms in the same release, so a lone leaf in a package
 * that serves both is worth a look.
 *
 * `review`, not `violation`, and deliberately so: a shared package legitimately holds web-only sub-parts (an
 * inline SVG has no native counterpart), and this rule cannot tell one of those from a native leaf somebody
 * forgot. It fires only in packages that actually ship to both platforms — an app shell is single-platform by
 * definition and is never asked about.
 */
const platformSingleton: Rule = (entry) => {
    const leaf = entry.implementations[0] as ComponentImplementation;

    return entry.crossPlatform
        ? []
        : [
              at(
                  leaf,
                  entry,
                  'platform-singleton',
                  'review',
                  'a package that ships to both platforms has only one leaf of this component',
                  [leaf.platform],
              ),
          ];
};

/** The rules that apply to every group. */
const UNIVERSAL_RULES: readonly Rule[] = [
    missingModuleDoc,
    missingComponentDoc,
    undocumentedProps,
    unclassifiedLayer,
    ambiguousLayerSignal,
    refApi,
    booleanSubtreeSwitch,
    divergentContract,
];

/**
 * Every finding for a set of components.
 *
 * @param entries - The components of one group.
 * @param groupIsCrossPlatform - Whether the group's package ships to both platforms.
 * @returns The findings, ordered by component then rule.
 */
export function collectFindings(entries: readonly ComponentEntry[], groupIsCrossPlatform: boolean): readonly Finding[] {
    const rules = groupIsCrossPlatform ? [...UNIVERSAL_RULES, platformSingleton] : UNIVERSAL_RULES;

    return entries
        .flatMap((entry) => rules.flatMap((rule) => rule(entry)))
        .sort(
            (left, right) =>
                left.component.localeCompare(right.component) ||
                left.rule.localeCompare(right.rule) ||
                left.sourcePath.localeCompare(right.sourcePath),
        );
}
