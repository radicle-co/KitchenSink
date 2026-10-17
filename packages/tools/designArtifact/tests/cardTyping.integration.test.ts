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

describe('the components no package exports are typed against their sources too', () => {
    /** Both columns state the same props: the native header is checked on its own (renderNative is required for it). */
    const header = (props: string): string =>
        `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['EditorHeader'],
            render: ({ EditorHeader }) => <EditorHeader ${props} />,
            renderNative: ({ EditorHeader }) => <EditorHeader ${props} /> });`;
    const goodHeader = `title="New recipe" status={undefined} closeLabel="Close" onClose={() => undefined}`;

    it('accepts the editor header with its real props (control)', () => {
        expect(diagnose(header(goodHeader))).toEqual([]);
    });

    it('rejects a prop the editor header does not take, in each column', () => {
        const diagnostics = diagnose(header(`${goodHeader} bogus="1"`));

        expect(diagnostics).toHaveLength(2);
        expect(diagnostics.join('\n')).toMatch(/bogus/u);
    });

    it('checks the native column against the native header: the web header’s placeRef is refused there only', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['EditorHeader'],
            render: ({ EditorHeader }) => <EditorHeader ${goodHeader} placeRef={() => undefined} />,
            renderNative: ({ EditorHeader }) => <EditorHeader ${goodHeader} placeRef={() => undefined} /> });`;
        const diagnostics = diagnose(source);

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics.join('\n')).toMatch(/placeRef/u);
    });

    it('rejects a prop of the wrong type on the editor header, and only that', () => {
        const diagnostics = diagnose(
            header(`title={3} status={undefined} closeLabel="Close" onClose={() => undefined}`),
        );

        expect(diagnostics).toEqual(Array(2).fill("TS2322: Type 'number' is not assignable to type 'string'."));
    });

    it('rejects an editor header missing a required prop', () => {
        expect(diagnose(header(`title="New recipe" status={undefined}`)).join('\n')).toMatch(/closeLabel|onClose/u);
    });

    const webOnly = `platforms: 'web', reason: 'desktop only',`;
    const sheetProps = `title="T" titleId="t" closeLabel="Close" keyboardOpen={false} onClose={() => undefined}`;

    it('accepts a sheet panel with its real props (control), and rejects one the panel does not take', () => {
        const sheet = (extra: string): string =>
            card(`({ SheetPanel }) => <SheetPanel ${sheetProps} ${extra}>x</SheetPanel>`, webOnly, `['SheetPanel']`);

        expect(diagnose(sheet(''))).toEqual([]);

        const diagnostics = diagnose(sheet('nope'));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics.join('\n')).toMatch(/'nope'/u);
    });

    it('rejects a spinner class that is not a string, and a spinner with none', () => {
        const spinner = (props: string): string =>
            card(`({ Spinner }) => <Spinner ${props} />`, webOnly, `['Spinner']`);

        expect(diagnose(spinner('className="spin"'))).toEqual([]);
        expect(diagnose(spinner('className={3}'))).toEqual([
            "TS2322: Type 'number' is not assignable to type 'string'.",
        ]);
        expect(diagnose(spinner('')).join('\n')).toMatch(/className/u);
    });

    const tabBar = (render: string, renderNative: string): string =>
        `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['HomeTabBar'],
            render: ${render}, renderNative: ${renderNative} });`;
    const chrome = `{ destinations: { home: 'Home', recipes: 'Recipes', discover: 'Discover', 'meal-plan': 'Plan', grocery: 'Shop' }, profileButton: 'Profile, {name}', profileButtonNoName: 'Profile', tabNavLabel: 'Tabs' }`;
    const webBar = `<HomeTabBar chrome={${chrome}} locale="en" liveCapabilities={[]} activeId="recipes" />`;
    const nativeBar = `<HomeTabBar chrome={${chrome}} liveCapabilities={[]} activeId="recipes" onPress={() => undefined} bottomInset={0} compact={false} leftInset={0} rightInset={0} />`;

    it('requires renderNative from a two-platform card that mounts a component whose native leaf differs', () => {
        const without = card(
            `({ EditorHeader }) => <EditorHeader ${goodHeader} />`,
            `platforms: 'both',`,
            `['EditorHeader']`,
        );
        const withNative = `export default defineCard({ group: 'G', height: 100, platforms: 'both', uses: ['EditorHeader'],
            render: ({ EditorHeader }) => <EditorHeader ${goodHeader} />,
            renderNative: ({ EditorHeader }) => <EditorHeader ${goodHeader} /> });`;

        expect(diagnose(without).join('\n')).toMatch(/renderNative/u);
        expect(diagnose(withNative)).toEqual([]);
    });

    it('does not ask renderNative of a card whose components are the same on both platforms', () => {
        expect(diagnose(card(`({ Button }) => <Button variant="ghost">Go</Button>`))).toEqual([]);
    });

    it('types the home tab bar per platform: the web bar in render, the mobile bar in renderNative', () => {
        expect(diagnose(tabBar(`({ HomeTabBar }) => ${webBar}`, `({ HomeTabBar }) => ${nativeBar}`))).toEqual([]);
    });

    it('rejects the mobile bar props in the web column, and only there', () => {
        const diagnostics = diagnose(tabBar(`({ HomeTabBar }) => ${nativeBar}`, `({ HomeTabBar }) => ${nativeBar}`));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics.join('\n')).toMatch(/onPress|bottomInset|locale/u);
    });

    it('rejects the web bar props in the native column, and only there', () => {
        const diagnostics = diagnose(tabBar(`({ HomeTabBar }) => ${webBar}`, `({ HomeTabBar }) => ${webBar}`));

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics.join('\n')).toMatch(/locale|onPress|bottomInset/u);
    });

    it('types a native-only card’s render against the NATIVE leaves (it draws only that column)', () => {
        const source = (bar: string): string =>
            `export default defineCard({ group: 'G', height: 100, platforms: 'native', reason: 'phone only',
                uses: ['HomeTabBar'], render: ({ HomeTabBar }) => ${bar} });`;

        expect(diagnose(source(nativeBar))).toEqual([]);
        expect(diagnose(source(webBar)).join('\n')).toMatch(/locale|onPress|bottomInset/u);
    });

    it('does not let a native-only card give a renderNative of its own (its render is already native)', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'native', reason: 'phone only',
            uses: ['HomeTabBar'], render: () => null, renderNative: () => null });`;

        expect(diagnose(source)).not.toEqual([]);
    });

    it('does not let a web-only card give a renderNative (no native column draws it)', () => {
        const source = `export default defineCard({ group: 'G', height: 100, platforms: 'web', reason: 'desktop only',
            uses: ['Button'], render: () => null, renderNative: () => null });`;

        expect(diagnose(source)).not.toEqual([]);
    });

    it('types the product copy a card reads: a real key passes, an invented one fails', () => {
        const source = (key: string): string =>
            card(
                `({ recipeFormMessages }) => <p>{recipeFormMessages.en.${key}}</p>`,
                `platforms: 'both',`,
                `['recipeFormMessages']`,
            );

        expect(diagnose(source('basicsHeading'))).toEqual([]);
        expect(diagnose(source('noSuchMessage')).join('\n')).toMatch(/noSuchMessage/u);
    });
});
