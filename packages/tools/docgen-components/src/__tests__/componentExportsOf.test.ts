import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { componentExportsOf, exportsAComponentName } from '../extract.js';

let dir = '';

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'componentExports-'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

function write(source: string): string {
    const file = join(dir, `f${String(Math.random()).slice(2)}.tsx`);

    writeFileSync(file, source);

    return file;
}

describe('componentExportsOf', () => {
    it.each([
        [
            'an exported function',
            'export function Button() { return null; }',
            [{ local: 'Button', exported: 'Button' }],
        ],
        ['an exported arrow const', 'export const Chip = () => null;', [{ local: 'Chip', exported: 'Chip' }]],
        ['an exported class', 'export class Panel {}', [{ local: 'Panel', exported: 'Panel' }]],
        ['a digit after the capital', 'export const X2 = () => null;', [{ local: 'X2', exported: 'X2' }]],
        [
            'several declarators in one statement',
            'export const Aa = 1, Bb = 2;',
            [
                { local: 'Aa', exported: 'Aa' },
                { local: 'Bb', exported: 'Bb' },
            ],
        ],
        [
            'a local exported through a list',
            'const Card = () => null;\nexport { Card };',
            [{ local: 'Card', exported: 'Card' }],
        ],
        [
            'a renamed export keeps both names',
            'const Inner = () => null;\nexport { Inner as Button };',
            [{ local: 'Inner', exported: 'Button' }],
        ],
        [
            'a renamed re-export',
            "export { Sheet as Drawer } from './Sheet.js';",
            [{ local: 'Sheet', exported: 'Drawer' }],
        ],
    ])('reads %s', (_label, source, expected) => {
        expect(componentExportsOf(write(source))).toEqual(expected);
    });

    it.each([
        ['a run of capitals', 'export const IOSBadge = () => null;'],
        ['a SCREAMING_SNAKE constant', 'export const STAR_PATH = "M0 0";'],
        ['a single capital letter', 'export const X = 1;'],
        ['a hook', 'export function useThing() { return 1; }'],
        ['a component renamed to a lowercase name', 'const Inner = () => null;\nexport { Inner as inner };'],
        ['an interface', 'export interface ButtonProps { a: string }'],
        ['a type alias', 'export type ButtonKind = "a";'],
        ['a type-only list export', 'type Kind = string;\nexport type { Kind };'],
        ['an inline type-only specifier', 'type Kind = string;\nexport { type Kind };'],
        ['a type-only re-export', "export type { Kind } from './kind.js';"],
        ['a default export', 'export default function Page() { return null; }'],
        ['a non-exported component', 'function Hidden() { return null; }'],
        ['a star re-export', "export * from './other.js';"],
    ])('names nothing for %s', (_label, source) => {
        expect(componentExportsOf(write(source))).toEqual([]);
    });

    it('lists an export once however many statements name it', () => {
        expect(componentExportsOf(write('export const Zed = 1;\nexport function Alpha() {}\nexport { Zed };'))).toEqual(
            [
                { local: 'Zed', exported: 'Zed' },
                { local: 'Alpha', exported: 'Alpha' },
            ],
        );
    });

    it('agrees with exportsAComponentName on every named export', () => {
        for (const source of [
            'export const X2 = () => null;',
            'export const IOSBadge = () => null;',
            'const Inner = () => null;\nexport { Inner as Button };',
            'export const STAR_PATH = "M0 0";',
        ]) {
            const file = write(source);

            expect(exportsAComponentName(file)).toBe(componentExportsOf(file).length > 0);
        }
    });
});
