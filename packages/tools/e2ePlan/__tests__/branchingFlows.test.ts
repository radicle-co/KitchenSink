import { describe, expect, it } from 'vitest';

import { branchingFlows, isBranching } from '../src/branchingFlows.js';

describe('isBranching', () => {
    it.each([
        ['a when: condition', '- runFlow:\n    when:\n      visible: Save\n    file: x.yaml\n'],
        ['a while: loop', '- repeat:\n    while:\n      visible: More\n    commands:\n      - tapOn: More\n'],
        ['an optional step', '- tapOn:\n    text: Allow\n    optional: true\n'],
    ])('is true for %s', (_name, yaml) => {
        expect(isBranching(yaml)).toBe(true);
    });

    it.each([
        ['plain steps', '- launchApp\n- tapOn: Home\n- assertVisible: Recipes\n'],
        ['an optional step set to false', '- tapOn:\n    text: Allow\n    optional: false\n'],
        ['a word in a string', '- inputText: "when: the cook"\n- inputText: "while: loops"\n'],
    ])('is false for %s', (_name, yaml) => {
        expect(isBranching(yaml)).toBe(false);
    });

    it('reads the config document before the --- as well as the commands', () => {
        expect(isBranching('appId: x\n---\n- tapOn:\n    text: a\n    optional: true\n')).toBe(true);
    });

    it('throws on text that is not YAML, rather than calling it plain', () => {
        expect(() => isBranching('a: [unclosed')).toThrow();
    });
});

describe('branchingFlows', () => {
    const files: Record<string, string> = {
        'top/plain.yaml': '- runFlow: ../sub/plain.yaml\n',
        'top/ownWhen.yaml': '- runFlow:\n    when:\n      visible: a\n    file: ../sub/plain.yaml\n',
        'top/viaHelper.yaml': '- runFlow: ../sub/helperWhen.yaml\n',
        'sub/plain.yaml': '- tapOn: a\n',
        'sub/helperWhen.yaml': '- runFlow:\n    when:\n      visible: Save password\n    file: plain.yaml\n',
    };
    const flows = {
        tests: new Map([
            ['top/plain.yaml', 'plain'],
            ['top/ownWhen.yaml', 'ownWhen'],
            ['top/viaHelper.yaml', 'viaHelper'],
        ]),
        runsOf: (file: string): readonly string[] =>
            ({
                'top/plain.yaml': ['sub/plain.yaml'],
                'top/ownWhen.yaml': ['sub/plain.yaml'],
                'top/viaHelper.yaml': ['sub/helperWhen.yaml', 'sub/plain.yaml'],
            })[file] ?? [],
    };

    it('counts a flow whose own file branches, and a flow that runs a helper that does', () => {
        expect(branchingFlows(flows, (path) => files[path] ?? '')).toEqual(new Set(['ownWhen', 'viaHelper']));
    });

    it('does not count a flow that branches nowhere', () => {
        expect(branchingFlows(flows, (path) => files[path] ?? '').has('plain')).toBe(false);
    });
});
