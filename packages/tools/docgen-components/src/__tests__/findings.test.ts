/**
 * The RULE layer. Each rule is asserted in BOTH directions — it fires on the shape it names, and it stays
 * silent on the shape it does not. A rule tested only for firing is a rule that could return every component
 * and still look correct.
 */
import { describe, expect, it } from 'vitest';

import { collectFindings } from '../findings.js';
import { makeEntry, makeImplementation, makeProp } from '../__fixtures__/implementation.js';

/** Rules fired for an entry, in a cross-platform package unless stated otherwise. */
function rulesFor(entry: Parameters<typeof collectFindings>[0][number], crossPlatformGroup = true): string[] {
    return collectFindings([entry], crossPlatformGroup).map((finding) => finding.rule);
}

describe('collectFindings', () => {
    it('is silent on a fully documented, single-platform-package component', () => {
        expect(rulesFor(makeEntry({ crossPlatform: true }), false)).toEqual([]);
    });

    it('reports a file with no module docblock', () => {
        expect(rulesFor(makeEntry({ implementations: [makeImplementation({ moduleDoc: '' })] }), false)).toContain(
            'missing-module-doc',
        );
    });

    it('reports a component declaration with no JSDoc summary', () => {
        expect(rulesFor(makeEntry({ implementations: [makeImplementation({ description: '' })] }), false)).toContain(
            'missing-component-doc',
        );
    });

    it('names the undocumented props as evidence rather than just counting them', () => {
        const entry = makeEntry({
            implementations: [
                makeImplementation({
                    props: [
                        makeProp(),
                        makeProp({ name: 'busy', description: '' }),
                        makeProp({ name: 'icon', description: '' }),
                    ],
                }),
            ],
        });
        const finding = collectFindings([entry], false).find((item) => item.rule === 'undocumented-prop');

        expect(finding?.evidence).toEqual(['busy', 'icon']);
    });

    it('reports a component whose docblocks state no layer', () => {
        expect(rulesFor(makeEntry({ kind: 'unclassified' }), false)).toContain('unclassified-layer');
    });

    it('reports a docblock naming both layers, so the collapse can be checked by a human', () => {
        const entry = makeEntry({
            implementations: [makeImplementation({ docSignals: { presentational: true, orchestration: true } })],
        });

        expect(rulesFor(entry, false)).toContain('ambiguous-layer-signal');
    });

    it('reports ref usage as a violation, naming which ref API', () => {
        const entry = makeEntry({ implementations: [makeImplementation({ usesRefApi: ['useRef'] })] });
        const finding = collectFindings([entry], false).find((item) => item.rule === 'ref-api');

        expect(finding?.severity).toBe('violation');
        expect(finding?.evidence).toEqual(['useRef']);
    });

    // `review`, not `violation`: selecting between two subtrees can be legitimate display derivation, and
    // asserting otherwise would put a false accusation in generated documentation.
    it('reports a subtree-selecting boolean prop as needing review, not as a violation', () => {
        const entry = makeEntry({
            implementations: [makeImplementation({ booleanPropsSelectingSubtree: ['compactMode'] })],
        });
        const finding = collectFindings([entry], false).find((item) => item.rule === 'boolean-prop-selects-subtree');

        expect(finding?.severity).toBe('review');
        expect(finding?.evidence).toEqual(['compactMode']);
    });

    it('reports a diverged cross-platform contract with both prop sets as evidence', () => {
        const entry = makeEntry({
            propsDiverge: true,
            crossPlatform: true,
            implementations: [
                makeImplementation({ props: [makeProp({ name: 'href' })] }),
                makeImplementation({ platform: 'native', props: [makeProp({ name: 'onPress' })] }),
            ],
        });
        const finding = collectFindings([entry], true).find((item) => item.rule === 'cross-platform-props-diverge');

        expect(finding?.evidence).toEqual(['web: href', 'native: onPress']);
    });

    // §14 asks the question only of packages that actually ship to both platforms. An app shell is
    // single-platform by definition, and asking it would put 178 meaningless rows in the report.
    it('asks about a lone platform leaf only in a package that ships to both', () => {
        const lone = makeEntry({ crossPlatform: false, platforms: ['web'] });

        expect(rulesFor(lone, true)).toContain('platform-singleton');
        expect(rulesFor(lone, false)).not.toContain('platform-singleton');
    });

    it('stays silent about a paired component in a cross-platform package', () => {
        const paired = makeEntry({
            crossPlatform: true,
            platforms: ['web', 'native'],
            implementations: [makeImplementation(), makeImplementation({ platform: 'native' })],
        });

        expect(rulesFor(paired, true)).not.toContain('platform-singleton');
    });

    it('orders findings by component so the report is stable between runs', () => {
        const findings = collectFindings(
            [makeEntry({ id: 'z/Z', kind: 'unclassified' }), makeEntry({ id: 'a/A', kind: 'unclassified' })],
            false,
        );

        expect(findings.map((finding) => finding.component)).toEqual(['a/A', 'z/Z']);
    });
});
