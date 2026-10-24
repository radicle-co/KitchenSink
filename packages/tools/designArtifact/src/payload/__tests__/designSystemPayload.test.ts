import { describe, expect, it } from 'vitest';

import { buildTokens } from '../../tokens/buildTokens.js';
import { designSystemPayload } from '../designSystemPayload.js';
import type { DesignSystemInputs } from '../designSystemPayload.js';

const inputs: DesignSystemInputs = {
    readme: '# Commise\n\nBuilt from commit abc.\n',
    tokens: buildTokens(),
    fonts: [{ file: 'Inter_400Regular.ttf', bytes: new Uint8Array([1, 2]) }],
    licences: [{ file: 'OFL-Inter.txt', bytes: new Uint8Array([3]) }],
    bundleJs: '/* js */',
    bundleCss: '/* css */',
    declarations: '// d.ts\n',
    cards: [
        { name: 'Button', readme: 'Button readme', previewHtml: '<!-- button -->' },
        { name: 'Chip', readme: 'Chip readme', previewHtml: '<!-- chip -->' },
    ],
    coverHtml: '<!-- cover -->',
    now: '2026-10-16T12:00:00Z',
};

describe('designSystemPayload', () => {
    const files = designSystemPayload(inputs);

    it('lays the payload out exactly as the published design system is', () => {
        expect([...files.keys()].sort()).toEqual(
            [
                'README.md',
                'design-system.json',
                'tokens.json',
                'fonts/Inter_400Regular.ttf',
                'fonts/OFL-Inter.txt',
                'components/bundle.js',
                'components/bundle.css',
                'components/index.d.ts',
                'components/Button/README.md',
                'components/Button/preview.html',
                'components/Chip/README.md',
                'components/Chip/preview.html',
                'components/Cover/preview.html',
            ].sort(),
        );
    });

    it('passes text and bytes through unchanged', () => {
        expect(files.get('README.md')).toBe(inputs.readme);
        expect(files.get('components/bundle.js')).toBe('/* js */');
        expect(files.get('components/bundle.css')).toBe('/* css */');
        expect(files.get('components/index.d.ts')).toBe('// d.ts\n');
        expect(files.get('components/Button/preview.html')).toBe('<!-- button -->');
        expect(files.get('components/Cover/preview.html')).toBe('<!-- cover -->');
        expect(files.get('fonts/Inter_400Regular.ttf')).toEqual(new Uint8Array([1, 2]));
    });

    it('writes tokens.json from the tokens given', () => {
        expect(JSON.parse(String(files.get('tokens.json')))).toEqual(JSON.parse(JSON.stringify(inputs.tokens)));
    });

    it('writes the design-system index with the namespace, title, React 18 libraries and the injected instant', () => {
        const index = JSON.parse(String(files.get('design-system.json'))) as Record<string, unknown>;

        expect(index).toMatchObject({
            v: 3,
            namespace: 'Commise',
            title: 'KitchenSink Design System',
            libraries: [
                { name: 'react', version: '18' },
                { name: 'react-dom', version: '18' },
            ],
            createdOnFiles: { at: '2026-10-16T12:00:00Z' },
            lastChange: { at: '2026-10-16T12:00:00Z' },
        });
    });

    it('refuses two cards of one name instead of overwriting a preview', () => {
        expect(() => designSystemPayload({ ...inputs, cards: [inputs.cards[0]!, inputs.cards[0]!] })).toThrowError(
            /Button/u,
        );
    });
});
