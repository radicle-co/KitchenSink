/**
 * Proves the card API is typed against the real components, by compiling card sources that MUST NOT compile.
 * `@ts-expect-error` is banned here, so each bad card is a virtual file run through the TypeScript API with the
 * package's own tsconfig, and the test asserts the diagnostic is the one that names the mistake.
 */
import { join } from 'node:path';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '../src/config.js';

const VIRTUAL = join(PACKAGE_ROOT, 'content/designSystem/cards/Virtual/Virtual.card.tsx');
const HEAD = `import { defineCard } from '../../../../src/cards/defineCard.js';\n`;

let options: ts.CompilerOptions;
let baseProgram: ts.Program | undefined;

/** Type-checks `source` as if it were a card file; returns its diagnostics as `TSxxxx: message` lines. */
function diagnose(source: string): string[] {
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);

    host.getSourceFile = (fileName, languageVersion, ...rest) =>
        fileName === VIRTUAL
            ? ts.createSourceFile(fileName, HEAD + source, languageVersion, true, ts.ScriptKind.TSX)
            : original(fileName, languageVersion, ...rest);
    host.fileExists = (fileName) => fileName === VIRTUAL || ts.sys.fileExists(fileName);

    const program = ts.createProgram([VIRTUAL], options, host, baseProgram);

    baseProgram = program;

    return ts
        .getPreEmitDiagnostics(program, program.getSourceFile(VIRTUAL))
        .map((d) => `TS${String(d.code)}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

const card = (render: string, extra = `platforms: 'both',`, uses = `['Button']`): string =>
    `export default defineCard({ group: 'G', height: 100, ${extra} uses: ${uses}, render: ${render} });`;

beforeAll(() => {
    const configPath = join(PACKAGE_ROOT, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT);

    options = { ...parsed.options, noEmit: true, incremental: false };
});

describe('the card API rejects what the real components reject', () => {
    it('accepts a correct card (control: the harness reports nothing for valid source)', () => {
        expect(diagnose(card(`({ Button }) => <Button variant="primary" icon="plus">Go</Button>`))).toEqual([]);
    });

    it('rejects a variant the Button does not have', () => {
        const diagnostics = diagnose(card(`({ Button }) => <Button variant="loud" icon="plus">Go</Button>`));

        expect(diagnostics.join('\n')).toMatch(/"loud"/u);
    });

    it('rejects a glyph that is not an icon name', () => {
        const diagnostics = diagnose(card(`({ Button }) => <Button variant="primary" icon="nope">Go</Button>`));

        expect(diagnostics.join('\n')).toMatch(/"nope"/u);
    });

    it('rejects a primary button with no icon (the real discriminated union, not a loose prop bag)', () => {
        expect(diagnose(card(`({ Button }) => <Button variant="primary">Go</Button>`))).not.toEqual([]);
    });

    it('rejects a prop the Button does not take', () => {
        const diagnostics = diagnose(card(`({ Button }) => <Button variant="ghost" colour="red">Go</Button>`));

        expect(diagnostics.join('\n')).toMatch(/colour/u);
    });

    it('rejects a component the card did not list in uses', () => {
        const diagnostics = diagnose(card(`({ Button, Chip }) => <Chip />`, `platforms: 'both',`, `['Button']`));

        expect(diagnostics.join('\n')).toMatch(/Chip/u);
    });

    it('rejects a name that is not in the registry', () => {
        const diagnostics = diagnose(card(`() => null`, `platforms: 'both',`, `['Buttn']`));

        expect(diagnostics.join('\n')).toMatch(/Buttn/u);
    });

    it('rejects a single-platform card with no reason', () => {
        expect(diagnose(card(`() => null`, `platforms: 'web',`)).join('\n')).toMatch(/reason/u);
    });

    it('rejects a reason on a card that shows both platforms', () => {
        expect(diagnose(card(`() => null`, `platforms: 'both', reason: 'x',`)).join('\n')).toMatch(/reason|string/u);
    });

    it('rejects an unknown staging option', () => {
        expect(diagnose(card(`() => null`, `platforms: 'both', staging: { fullscreen: true },`)).join('\n')).toMatch(
            /fullscreen/u,
        );
    });

    it('lets renderNative pass the native-only ref to HeroButton', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['HeroButton'],
            render: ({ HeroButton }) => <HeroButton icon="plus" label="Add" onPress={() => undefined} />,
            renderNative: ({ HeroButton }) => <HeroButton icon="plus" label="Add" onPress={() => undefined} ref={() => undefined} /> });`;

        expect(diagnose(source)).toEqual([]);
    });

    it('rejects that ref in render, which draws the web column', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['HeroButton'],
            render: ({ HeroButton }) => <HeroButton icon="plus" label="Add" onPress={() => undefined} ref={() => undefined} /> });`;

        expect(diagnose(source).join('\n')).toMatch(/ref/u);
    });

    it('type-checks renderNative against the native components: a wrong prop still fails', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['HeroButton'],
            render: () => null,
            renderNative: ({ HeroButton }) => <HeroButton icon="nope" label="Add" onPress={() => undefined} /> });`;

        expect(diagnose(source).join('\n')).toMatch(/"nope"/u);
    });

    it('only lets renderNative mount the components the card declared', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['Button'],
            render: () => null,
            renderNative: ({ Button, Chip }) => <Chip /> });`;

        expect(diagnose(source).join('\n')).toMatch(/Chip/u);
    });

    it('lets afterRender return a promise, and nothing else', () => {
        const ok = card(`() => null`, `platforms: 'both', afterRender: async () => undefined,`);
        const bad = card(`() => null`, `platforms: 'both', afterRender: () => 3,`);

        expect(diagnose(ok)).toEqual([]);
        expect(diagnose(bad)).not.toEqual([]);
    });
});
