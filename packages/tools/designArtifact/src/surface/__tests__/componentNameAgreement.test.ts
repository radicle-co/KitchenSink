import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportsAComponentName } from '@kitchensink/docgen-components';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { componentNamesOf } from '../discoverSurface.js';

let dir = '';

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nameAgreement-'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

function write(source: string): string {
    const file = join(dir, `f${String(Math.random()).slice(2)}.tsx`);

    writeFileSync(file, source);

    return file;
}

/**
 * "Is this export a component" has ONE definition (docgen's). Discovery picks FILES with it and the artifact
 * NAMES exports with it, so a file is selected exactly when it yields a name. A split definition drops a
 * component off the surface (selected, never named) or names one that nothing documents (named, never selected).
 */
describe('discovery and naming agree on what a component is', () => {
    it.each([
        ['a digit after the capital', 'export const X2 = () => null;', ['X2']],
        ['a run of capitals', 'export const IOSBadge = () => null;', []],
        ['a renamed export', 'const Inner = () => null;\nexport { Inner as Button };', ['Button']],
        ['a SCREAMING_SNAKE constant', 'export const STAR_PATH = "M0 0";', []],
    ])('%s', (_label, source, names) => {
        const file = write(source);

        expect(componentNamesOf(file)).toEqual(names);
        expect(exportsAComponentName(file)).toBe(names.length > 0);
    });
});
