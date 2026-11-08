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
        'top/viaDeep.yaml': '- runFlow: ../sub/outer.yaml\n',
        'top/viaBoth.yaml': '- runFlow: ../sub/outer.yaml\n- runFlow: ../sub/innerWhen.yaml\n',
        'sub/plain.yaml': '- tapOn: a\n',
        'sub/helperWhen.yaml': '- runFlow:\n    when:\n      visible: Save password\n    file: plain.yaml\n',
        'sub/outer.yaml': '- runFlow: innerWhen.yaml\n',
        'sub/innerWhen.yaml': '- tapOn:\n    text: x\n    optional: true\n',
    };
    const direct: Record<string, string[]> = {
        'top/plain.yaml': ['sub/plain.yaml'],
        'top/ownWhen.yaml': ['sub/plain.yaml'],
        'top/viaHelper.yaml': ['sub/helperWhen.yaml'],
        'top/viaDeep.yaml': ['sub/outer.yaml'],
        'top/viaBoth.yaml': ['sub/outer.yaml', 'sub/innerWhen.yaml'],
        'sub/helperWhen.yaml': ['sub/plain.yaml'],
        'sub/outer.yaml': ['sub/innerWhen.yaml'],
    };
    const everything = (file: string): string[] => [
        ...new Set((direct[file] ?? []).flatMap((child) => [child, ...everything(child)])),
    ];
    const flows = {
        tests: new Map(
            ['plain', 'ownWhen', 'viaHelper', 'viaDeep', 'viaBoth'].map((id) => [`top/${id}.yaml`, id] as const),
        ),
        runsOf: (file: string): readonly string[] => everything(file).sort(),
        runsDirectlyOf: (file: string): readonly string[] => direct[file] ?? [],
    };
    const read = (path: string): string => files[path] ?? '';

    it('counts a flow whose own file branches, and a flow that runs a helper that does, however deep', () => {
        expect(branchingFlows(flows, read)).toEqual(new Set(['ownWhen', 'viaHelper', 'viaDeep', 'viaBoth']));
    });

    it('does not count a flow that branches nowhere', () => {
        expect(branchingFlows(flows, read).has('plain')).toBe(false);
    });

    it('does not look inside an opaque helper: its own row answers for every branch it can take', () => {
        const opaque = new Set(['sub/helperWhen.yaml', 'sub/outer.yaml']);

        // viaHelper runs only the opaque helper. viaDeep runs only the opaque outer, whose inner branch is behind it.
        expect(branchingFlows(flows, read, opaque)).toEqual(new Set(['ownWhen', 'viaBoth']));
    });

    it('still counts a branching flow that a parent runs directly as well as through an opaque helper', () => {
        expect(branchingFlows(flows, read, new Set(['sub/outer.yaml'])).has('viaBoth')).toBe(true);
    });

    it('counts a flow that is opaque as a parent only through its own file', () => {
        // The opaque helper's own text is not read for its parents either.
        expect(branchingFlows(flows, read, new Set(['sub/helperWhen.yaml'])).has('viaHelper')).toBe(false);
    });
});
