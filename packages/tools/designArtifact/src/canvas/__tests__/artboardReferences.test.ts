import { describe, expect, it } from 'vitest';

import { artboardReferences } from '../artboardReferences.js';

describe('artboardReferences', () => {
    it.each([
        [
            'a web component',
            '<div component-from-global-scope="Commise.Button" icon="plus"></div>',
            [['web', 'Button']],
        ],
        [
            'a native component',
            '<div component-from-global-scope="Commise.Native.ScrollFrame"></div>',
            [['native', 'ScrollFrame']],
        ],
        ['single quotes', "<x component-from-global-scope='Commise.Chip'/>", [['web', 'Chip']]],
        [
            'the same name on both platforms is two references',
            '<a component-from-global-scope="Commise.Icon"/><b component-from-global-scope="Commise.Native.Icon"/>',
            [
                ['web', 'Icon'],
                ['native', 'Icon'],
            ],
        ],
        [
            'repeats collapse, first appearance orders',
            '<a component-from-global-scope="Commise.Icon"/><b component-from-global-scope="Commise.Button"/><c component-from-global-scope="Commise.Icon"/>',
            [
                ['web', 'Icon'],
                ['web', 'Button'],
            ],
        ],
        ['an attribute that is not a global-scope component is ignored', '<x data-name="Commise.Button"/>', []],
        ['a script mention is not an attribute reference', '<script>const C = window.Commise.Native;</script>', []],
        [
            'a lowercase name (a hook) is not a mounted component',
            '<x component-from-global-scope="Commise.useSnackbar"/>',
            [],
        ],
        ['nothing', '<p>hello</p>', []],
    ] as const)('%s', (_label, html, expected) => {
        expect(artboardReferences(html).map((r) => [r.platform, r.name])).toEqual(expected);
    });

    it('does not read "Native" as a web component name', () => {
        expect(artboardReferences('<x component-from-global-scope="Commise.Native"/>')).toEqual([]);
    });
});
