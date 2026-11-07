import { describe, expect, it } from 'vitest';

import { flowReferences, maestroFlowGraph } from '../src/maestroFlows.js';

describe('flowReferences', () => {
    it('finds a runFlow written as a string', () => {
        expect(flowReferences('appId: x\n---\n- runFlow: common/a.yaml\n')).toEqual(['common/a.yaml']);
    });

    it('finds a runFlow written as a map with a file', () => {
        const text = 'appId: x\n---\n- runFlow:\n    file: common/a.yaml\n    env:\n      A: b\n';

        expect(flowReferences(text)).toEqual(['common/a.yaml']);
    });

    it('finds a file inside the commands and the when of a runFlow', () => {
        const text = [
            'appId: x',
            '---',
            '- runFlow:',
            '    when:',
            '      visible: Hi',
            '    commands:',
            '      - runFlow:',
            '          file: ../deep/b.yaml',
            '',
        ].join('\n');

        expect(flowReferences(text)).toEqual(['../deep/b.yaml']);
    });

    it('finds files in onFlowStart and onFlowComplete hooks of the config document', () => {
        const text =
            'appId: x\nonFlowStart:\n  - runFlow: hooks/start.yaml\nonFlowComplete:\n  - runScript: hooks/done.js\n---\n- tapOn: Go\n';

        expect([...flowReferences(text)].sort()).toEqual(['hooks/done.js', 'hooks/start.yaml']);
    });

    it('finds runScript as a string and as a map, and addMedia entries', () => {
        const text =
            'appId: x\n---\n- runScript: a.js\n- runScript:\n    file: b.js\n- addMedia:\n    - ../media/c.png\n';

        expect([...flowReferences(text)].sort()).toEqual(['../media/c.png', 'a.js', 'b.js']);
    });

    it('finds nothing in a flow that runs no other file', () => {
        expect(flowReferences('appId: x\n---\n- tapOn: Go\n- evalScript: ${1+1}\n')).toEqual([]);
    });

    it('throws on text that is not YAML, rather than reading it as a flow with no references', () => {
        expect(() => flowReferences('appId: [unclosed\n')).toThrow();
    });
});

const files: Readonly<Record<string, string>> = {
    '.maestro/home.yaml': 'appId: x\n---\n- runFlow: auth/signin.yaml\n',
    '.maestro/auth/signin.yaml':
        'appId: x\n---\n- runFlow:\n    file: ../common/tap.yaml\n- runScript: ../scripts/seed.js\n',
    '.maestro/common/tap.yaml': 'appId: x\n---\n- tapOn: Go\n',
    '.maestro/scripts/seed.js': 'output.x = 1',
    '.maestro/recipes/list.yaml': 'appId: x\n---\n- tapOn: Go\n',
    '.maestro/recipes/dangling.yaml': 'appId: x\n---\n- runFlow: ../common/missing.yaml\n',
};

describe('maestroFlowGraph', () => {
    const graph = maestroFlowGraph({
        dir: '.maestro',
        files: Object.keys(files),
        read: (path) => files[path] ?? '',
        topLevel: ['home', 'recipes/list', 'recipes/dangling'],
    });

    it('maps each top-level flow file to its id, and nothing else to a test', () => {
        expect([...graph.tests]).toEqual([
            ['.maestro/home.yaml', 'home'],
            ['.maestro/recipes/list.yaml', 'recipes/list'],
            ['.maestro/recipes/dangling.yaml', 'recipes/dangling'],
        ]);
    });

    it('finds the flow that runs a sub-flow, and the sub-flow that runs a script', () => {
        expect(graph.importersOf('.maestro/auth/signin.yaml')).toEqual(['.maestro/home.yaml']);
        expect(graph.importersOf('.maestro/scripts/seed.js')).toEqual(['.maestro/auth/signin.yaml']);
        expect(graph.importersOf('.maestro/common/tap.yaml')).toEqual(['.maestro/auth/signin.yaml']);
    });

    it('holds every file under the folder, and no other', () => {
        expect(graph.has('.maestro/scripts/seed.js')).toBe(true);
        expect(graph.has('src/App.tsx')).toBe(false);
    });

    it('reports a reference to a file that does not exist', () => {
        expect(graph.problems).toEqual([
            expect.stringContaining('.maestro/recipes/dangling.yaml runs ../common/missing.yaml'),
        ]);
    });

    it('reports a top-level flow that has no file', () => {
        const missing = maestroFlowGraph({ dir: '.maestro', files: [], read: () => '', topLevel: ['gone'] });

        expect(missing.problems).toEqual([expect.stringContaining('gone')]);
    });
});
