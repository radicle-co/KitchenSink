import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { compileBrowserScript } from '../compileBrowserScript.js';

const dirs: string[] = [];

function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'compileBrowserScript-'));

    dirs.push(dir);

    for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text);
    }

    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('compileBrowserScript', () => {
    it('bundles the entry and what it imports into one classic script with no import left', () => {
        const dir = project({
            'entry.ts': "import { twice } from './twice.js';\nwindow.answer = twice(21);\n",
            'twice.ts': 'export function twice(n: number): number {\n    return n * 2;\n}\n',
        });
        const script = compileBrowserScript(join(dir, 'entry.ts'));
        const window: Record<string, unknown> = {};

        expect(script).not.toMatch(/^\s*(import|export)\s/mu);
        runInNewContext(script, { window });

        expect(window['answer']).toBe(42);
    });

    it('wraps the script so its names do not leak into the page', () => {
        const dir = project({ 'entry.ts': 'const secret = 1;\nwindow.seen = secret;\n' });
        const context: Record<string, unknown> = { window: {} };

        runInNewContext(compileBrowserScript(join(dir, 'entry.ts')), context);

        expect('secret' in context).toBe(false);
    });

    it('throws bundle-failed naming the file for source that does not compile', () => {
        const dir = project({ 'entry.ts': 'const = ;\n' });

        expect(() => compileBrowserScript(join(dir, 'entry.ts'))).toThrow(
            expect.objectContaining({ name: 'DesignArtifactError', code: 'bundle-failed' }),
        );

        try {
            compileBrowserScript(join(dir, 'entry.ts'));
        } catch (error) {
            expect(isDesignArtifactError(error)).toBe(true);
            expect(String(error)).toContain('entry.ts');
        }
    });

    it('throws bundle-failed for an entry that does not exist', () => {
        expect(() => compileBrowserScript(join(tmpdir(), 'compileBrowserScriptMissing.ts'))).toThrow(
            expect.objectContaining({ code: 'bundle-failed' }),
        );
    });
});
