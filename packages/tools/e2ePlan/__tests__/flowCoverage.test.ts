import { describe, expect, it } from 'vitest';

import { flowCoverage } from '../src/flowCoverage.js';
import { maestroFlowGraph } from '../src/maestroFlows.js';

const DIR = 'm/.maestro';
const files: Record<string, string> = {
    [`${DIR}/a.yaml`]: 'appId: x\n---\n- runFlow: sub/signIn.yaml\n',
    [`${DIR}/b.yaml`]: 'appId: x\n---\n- tapOn: hi\n',
    [`${DIR}/sub/signIn.yaml`]: 'appId: x\n---\n- runFlow: deep.yaml\n',
    [`${DIR}/sub/deep.yaml`]: 'appId: x\n---\n- tapOn: hi\n',
};
const flows = maestroFlowGraph({
    dir: DIR,
    files: Object.keys(files),
    read: (path) => files[path] ?? '',
    topLevel: ['a', 'b'],
});
const idOf = (file: string): string => file.slice(`${DIR}/`.length).replace(/\.ya?ml$/u, '');

describe('flowCoverage', () => {
    const table = new Map<string, ReadonlySet<string>>([
        ['a', new Set(['AScreen'])],
        ['b', new Set(['BScreen'])],
        ['sub/signIn', new Set(['login'])],
        ['sub/deep', new Set(['deep'])],
    ]);

    it('adds the pass-through screens to every flow', () => {
        const coverage = flowCoverage({ flows, table, idOf, passThrough: ['HomeScreen'] });

        expect(coverage.get('b')).toEqual(new Set(['BScreen', 'HomeScreen']));
    });

    it('adds the rows of every sub-flow a flow runs, however deep', () => {
        const coverage = flowCoverage({ flows, table, idOf, passThrough: ['HomeScreen'] });

        expect(coverage.get('a')).toEqual(new Set(['AScreen', 'HomeScreen', 'login', 'deep']));
    });

    it('answers only the top-level flows', () => {
        expect([...flowCoverage({ flows, table, idOf, passThrough: [] }).keys()].sort()).toEqual(['a', 'b']);
    });
});
