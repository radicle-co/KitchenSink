import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { oneOffStaging, planOneOffs, referenceProblems, stageOneOffs } from '../oneOffStage.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A temp folder standing for `.maestro`, holding one committed sub-flow, plus a folder of one-off sources. */
function world(): { maestroDir: string; sources: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'oneOff-'));
    dirs.push(root);
    const maestroDir = path.join(root, '.maestro');
    const sources = path.join(root, 'src');
    mkdirSync(maestroDir, { recursive: true });
    mkdirSync(sources, { recursive: true });
    writeFileSync(path.join(maestroDir, 'signinHome.yaml'), 'appId: x\n---\n- launchApp\n');

    return { maestroDir, sources };
}

const write = (dir: string, name: string, text = 'appId: x\n---\n- launchApp\n'): string => {
    const file = path.join(dir, name);
    writeFileSync(file, text);

    return file;
};

describe('planOneOffs', () => {
    it('names each flow oneOff/<runId>/<basename without .yaml>, from the basename alone', () => {
        const plan = planOneOffs(['/somewhere/else/shots.yaml', 'rel/two.yaml'], 'run1');

        expect(plan).toEqual([
            { id: 'oneOff/run1/shots', source: '/somewhere/else/shots.yaml', target: 'oneOff/run1/shots.yaml' },
            { id: 'oneOff/run1/two', source: 'rel/two.yaml', target: 'oneOff/run1/two.yaml' },
        ]);
    });

    it.each(['notes.txt', 'flow.yml', 'flow', '.hidden.yaml', 'two words.yaml', 'a$b.yaml'])(
        'refuses the file name %j and names it',
        (name) => {
            expect(() => planOneOffs([`/tmp/${name}`], 'run1')).toThrow(name);
        },
    );

    it('refuses two files with the same basename, because they would share one staged name', () => {
        expect(() => planOneOffs(['/a/x.yaml', '/b/x.yaml'], 'run1')).toThrow(/x\.yaml/u);
    });

    it.each(['', 'a/b', '..', 'a b'])('refuses the run id %j, which becomes a folder name', (runId) => {
        expect(() => planOneOffs(['/a/x.yaml'], runId)).toThrow(/run id/u);
    });
});

describe('referenceProblems: relative targets resolve from the staged folder', () => {
    const exists = (file: string): boolean => file === 'signinHome.yaml';

    it('accepts a target that exists under .maestro', () => {
        expect(referenceProblems('- runFlow: ../../signinHome.yaml\n', 'oneOff/run1', exists)).toEqual([]);
    });

    it('names a target that does not exist, with where it resolved', () => {
        const problems = referenceProblems('- runFlow: ../../missing.yaml\n', 'oneOff/run1', exists);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('../../missing.yaml');
        expect(problems[0]).toContain('missing.yaml');
    });

    it('refuses a target that leaves .maestro, and an absolute one, without asking whether it exists', () => {
        const asked: string[] = [];
        const problems = referenceProblems(
            '- runFlow: ../../../outside.yaml\n- runScript: /etc/passwd\n',
            'oneOff/run1',
            (file) => {
                asked.push(file);

                return true;
            },
        );

        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain('../../../outside.yaml');
        expect(problems[1]).toContain('/etc/passwd');
        expect(asked).toEqual([]);
    });

    it('reads media and script targets too', () => {
        expect(referenceProblems('- addMedia:\n    - ../../pic.png\n', 'oneOff/run1', exists)).toHaveLength(1);
    });
});

describe('referenceProblems: a target that climbs to exactly the parent of .maestro', () => {
    it('is refused even though the parent exists', () => {
        const problems = referenceProblems('- runFlow: ../../..\n', 'oneOff/run1', () => true);

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('outside .maestro/');
    });
});

describe('stageOneOffs', () => {
    it('refuses a run that names no file, so no wiring slip can fall back to the suite', () => {
        const { maestroDir } = world();

        expect(() => stageOneOffs({ maestroDir, paths: [], runId: 'run1' })).toThrow('no flow file');
    });

    it('copies each flow into oneOff/<runId>/ before anything runs, and removes the run folder afterwards', () => {
        const { maestroDir, sources } = world();
        const source = write(sources, 'shots.yaml', '- runFlow: ../../signinHome.yaml\n');
        const staged = stageOneOffs({ maestroDir, paths: [source], runId: 'run1' });

        expect(readFileSync(path.join(maestroDir, 'oneOff/run1/shots.yaml'), 'utf8')).toBe(
            '- runFlow: ../../signinHome.yaml\n',
        );
        expect(staged.ids).toEqual(['oneOff/run1/shots']);

        staged.remove();

        expect(existsSync(path.join(maestroDir, 'oneOff'))).toBe(false);
        expect(existsSync(path.join(maestroDir, 'signinHome.yaml'))).toBe(true);
    });

    it('sweeps the folders a killed run left behind, because finally never ran for it', () => {
        const { maestroDir, sources } = world();
        mkdirSync(path.join(maestroDir, 'oneOff/deadRun'), { recursive: true });
        writeFileSync(path.join(maestroDir, 'oneOff/deadRun/old.yaml'), 'x');

        stageOneOffs({ maestroDir, paths: [write(sources, 'a.yaml')], runId: 'run2' });

        expect(readdirSync(path.join(maestroDir, 'oneOff'))).toEqual(['run2']);
    });

    it('refuses a missing source and stages nothing, naming the path', () => {
        const { maestroDir, sources } = world();
        const missing = path.join(sources, 'gone.yaml');

        expect(() => stageOneOffs({ maestroDir, paths: [missing], runId: 'run1' })).toThrow(missing);
        expect(existsSync(path.join(maestroDir, 'oneOff'))).toBe(false);
    });

    it('refuses a flow whose relative target is missing, names the path and stages nothing', () => {
        const { maestroDir, sources } = world();
        const source = write(sources, 'a.yaml', '- runFlow: ../../nope.yaml\n');

        expect(() => stageOneOffs({ maestroDir, paths: [source], runId: 'run1' })).toThrow(/nope\.yaml/u);
        expect(existsSync(path.join(maestroDir, 'oneOff'))).toBe(false);
    });

    it('can be removed twice without failing', () => {
        const { maestroDir, sources } = world();
        const staged = stageOneOffs({ maestroDir, paths: [write(sources, 'a.yaml')], runId: 'run1' });

        staged.remove();

        expect(() => {
            staged.remove();
        }).not.toThrow();
    });
});

describe('oneOffStaging: how the door wires --one-off into the run', () => {
    it('gives a run with no --one-off no staging, so the changed-flow selection runs as before', () => {
        expect(oneOffStaging({ oneOffs: undefined, maestroDir: '/m', runId: 'run1' })).toEqual({});
    });

    it('stages exactly the paths named on the command line, under the run id', () => {
        const { maestroDir, sources } = world();
        const source = write(sources, 'shots.yaml', '- launchApp\n');
        const staging = oneOffStaging({ oneOffs: [source], maestroDir, runId: 'run1' });
        const staged = staging.stageOneOffs?.();

        expect(staged?.ids).toEqual(['oneOff/run1/shots']);
        staged?.remove();
    });
});
