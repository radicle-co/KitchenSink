import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BundleRequest, Bundler } from '../src/bundle/bundler.js';
import { BOARDS, BOARDS_DIR } from '../src/canvas/boards.js';
import { CONTENT_DIR, UI_SRC } from '../src/config.js';
import type { CssCompiler } from '../src/css/cssCompiler.js';
import { DesignArtifactError, isDesignArtifactError } from '../src/errors.js';
import { buildArtifact, AUTH_FOOD_IMAGE } from '../src/buildArtifact.js';
import type { BuildPorts } from '../src/buildArtifact.js';
import type { Surface } from '../src/surface/discoverSurface.js';
import { memorySourceFiles } from '../src/sources/memorySourceFiles.js';
import type { ArtifactFiles, ArtifactWriter } from '../src/write/artifactWriter.js';
import { makeSurfaceEntry } from '../src/surface/__fixtures__/makeSurfaceEntry.js';

const CARDS = join(CONTENT_DIR, 'designSystem/cards');
const SHA = '0123456789abcdef0123456789abcdef01234567';

function without(
    omit: readonly string[],
    files: Record<string, string | Uint8Array>,
): Record<string, string | Uint8Array> {
    return Object.fromEntries(Object.entries(files).filter(([path]) => !omit.includes(path)));
}

interface Harness {
    readonly ports: BuildPorts;
    readonly events: string[];
    readonly writes: { readonly root: string; readonly files: ArtifactFiles }[];
}

function harness(
    overrides: Partial<BuildPorts> = {},
    extraFiles: Record<string, string | Uint8Array> = {},
    omit: readonly string[] = [],
): Harness {
    const events: string[] = [];
    const writes: { root: string; files: ArtifactFiles }[] = [];
    const bundler: Bundler = {
        bundle(request: BundleRequest) {
            events.push(`bundle:${request.platform}`);

            return Promise.resolve({
                script: `var ${request.globalName} = {};`,
                inputs: [`/ui/${request.platform}/A.tsx`],
            });
        },
    };
    const cssCompiler: CssCompiler = {
        compile() {
            events.push('css');

            return Promise.resolve('.x{}');
        },
    };
    const writer: ArtifactWriter = {
        write(root, files) {
            events.push(`write:${root}`);
            writes.push({ root, files });

            return Promise.resolve({ warnings: [] });
        },
    };
    const surface: Surface = {
        web: [
            makeSurfaceEntry('Button', { file: '/ui/Button.tsx' }),
            makeSurfaceEntry('Chip', { file: '/ui/Chip.tsx' }),
        ],
        native: [
            makeSurfaceEntry('Button', { file: '/ui/Button.native.tsx' }),
            makeSurfaceEntry('Chip', { file: '/ui/Chip.native.tsx' }),
        ],
    };
    const boardFiles = Object.fromEntries(BOARDS.map((b) => [join(BOARDS_DIR, b.file), `<!-- ${b.file} -->`]));
    const files = memorySourceFiles(
        without(omit, {
            [join(CONTENT_DIR, 'designSystem/README.md')]: '# Commise\n',
            [join(CONTENT_DIR, 'designSystem/cover.html')]: '<!-- cover -->',
            [join(CARDS, 'Button/README.md')]: 'Button readme',
            [join(CARDS, 'Button/Button.card.tsx')]: '',
            [join(CARDS, 'Chip/README.md')]: 'Chip readme',
            [join(CARDS, 'Chip/Chip.card.tsx')]: '',
            [`${UI_SRC}/button/props.ts`]: 'export type ButtonVariant = 1;\n',
            '/fonts/Inter_400Regular.ttf': new Uint8Array([1]),
            '/fonts/OFL.txt': 'licence',
            [AUTH_FOOD_IMAGE]: new Uint8Array([7]),
            ...boardFiles,
            ...extraFiles,
        }),
    );
    const ports: BuildPorts = {
        files,
        bundler,
        cssCompiler,
        writer,
        now: () => {
            events.push('clock');

            return '2026-10-16T12:00:00Z';
        },
        gitHead: () => {
            events.push('git');

            return Promise.resolve({ sha: SHA, date: '2026-10-15T09:00:00-04:00', dirty: false });
        },
        surface: () => {
            events.push('surface');

            return surface;
        },
        fonts: {
            files: () => [
                { family: 'Inter', weight: 400, file: 'Inter_400Regular.ttf', source: '/fonts/Inter_400Regular.ttf' },
            ],
            licences: () => [{ file: 'OFL-Inter.txt', source: '/fonts/OFL.txt' }],
        },
        compileCard: (file) => {
            events.push(`card:${file.split('/').pop() ?? ''}`);

            return Promise.resolve('var __card = {};');
        },
        loadCardSpec: (file) =>
            Promise.resolve({
                group: 'Actions',
                height: 200,
                platforms: 'both',
                uses: [file.split('/').pop()?.replace('.card.tsx', '') ?? ''],
            }),
        uncarded: {},
        designSystem: { artifact: 'https://claude.ai/artifact/XYZ', version: 'v1' },
        ...overrides,
    };

    return { ports, events, writes };
}

describe('buildArtifact over mocked ports', () => {
    it('reads the commit, builds everything, then writes the design system and the canvas, in that order', async () => {
        const { ports, events, writes } = harness();

        const result = await buildArtifact(ports, '/out');

        expect(events).toEqual([
            'git',
            'clock',
            'surface',
            'bundle:web',
            'bundle:native',
            'css',
            'card:Button.card.tsx',
            'card:Chip.card.tsx',
            'write:/out/designSystem/project',
            'write:/out/canvas/project',
        ]);
        expect(writes).toHaveLength(2);
        expect(result).toEqual({
            designSystemDir: '/out/designSystem/project',
            canvasDir: '/out/canvas/project',
            cards: 2,
            boards: 127,
            warnings: [],
        });
    });

    it('scans for utility classes the directories the bundles were built from, not a list kept by hand', async () => {
        const sheets: string[] = [];
        const { ports } = harness({
            cssCompiler: {
                compile(input) {
                    sheets.push(input.css);

                    return Promise.resolve('.x{}');
                },
            },
        });

        await buildArtifact(ports, '/out');

        expect(sheets).toHaveLength(1);
        expect(sheets[0]).toContain('@source "/ui/web"');
        expect(sheets[0]).toContain('@source "/ui/native"');
    });

    it('stamps the README with the commit it was built from', async () => {
        const { ports, writes } = harness();

        await buildArtifact(ports, '/out');

        expect(String(writes[0]?.files.get('README.md'))).toBe(
            '# Commise\n\nBuilt from commit 0123456789ab (2026-10-15T09:00:00-04:00).\n',
        );
    });

    it('hands up the warnings the writer gave, from both payloads', async () => {
        const { ports } = harness({
            writer: { write: (root) => Promise.resolve({ warnings: [`left over at ${root}.old`] }) },
        });

        const result = await buildArtifact(ports, '/out');

        expect(result.warnings).toEqual([
            'left over at /out/designSystem/project.old',
            'left over at /out/canvas/project.old',
        ]);
    });

    it('says in the README when the tree had uncommitted changes', async () => {
        const { ports, writes } = harness({
            gitHead: () => Promise.resolve({ sha: SHA, date: '2026-10-15T09:00:00-04:00', dirty: true }),
        });

        await buildArtifact(ports, '/out');

        expect(String(writes[0]?.files.get('README.md'))).toContain('plus uncommitted changes.');
    });

    it('records no design system on the canvas when none is given', async () => {
        const { ports, writes } = harness({ designSystem: undefined });

        await buildArtifact(ports, '/out');

        expect(JSON.parse(String(writes[1]?.files.get('canvas.json')))).toHaveProperty('designSystems', []);
    });

    it('builds one card page per card folder, carrying its README and its compiled script', async () => {
        const { ports, writes } = harness();

        await buildArtifact(ports, '/out');

        const design = writes[0]?.files;

        expect(design?.get('components/Button/README.md')).toBe('Button readme');
        expect(String(design?.get('components/Chip/preview.html'))).toContain('var __card = {};');
        expect(String(design?.get('components/Chip/preview.html'))).toContain('@dsCard group="Actions" height=200');
        expect(design?.get('components/Cover/preview.html')).toBe('<!-- cover -->');
        expect(String(design?.get('components/index.d.ts'))).toContain('ButtonVariant');
    });

    it('ships the same bundle to both payloads: the canvas boards run what the design system documents', async () => {
        const { ports, writes } = harness();

        await buildArtifact(ports, '/out');

        expect(writes[1]?.files.get('ds/commise/bundle.js')).toBe(writes[0]?.files.get('components/bundle.js'));
        expect(writes[1]?.files.get('ds/commise/bundle.css')).toBe(writes[0]?.files.get('components/bundle.css'));
        expect(writes[1]?.files.get('assets/authFood.jpg')).toEqual(new Uint8Array([7]));
    });

    it('uses the injected clock for both indexes, so the build is a function of its inputs', async () => {
        const { ports, writes } = harness();

        await buildArtifact(ports, '/out');

        expect(String(writes[0]?.files.get('design-system.json'))).toContain('"at": "2026-10-16T12:00:00Z"');
        expect(String(writes[1]?.files.get('canvas.json'))).toContain('"copiedAt": "2026-10-16T12:00:00Z"');
    });

    describe('fails closed: a step that fails writes nothing', () => {
        const failing = async (ports: BuildPorts, writes: Harness['writes']): Promise<unknown> => {
            const failure = await buildArtifact(ports, '/out').catch((error: unknown) => error);

            expect(writes).toEqual([]);

            return failure;
        };

        it('when the bundler fails', async () => {
            const h = harness({
                bundler: { bundle: () => Promise.reject(new DesignArtifactError('bundle-failed', 'boom')) },
            });

            expect(await failing(h.ports, h.writes)).toMatchObject({ code: 'bundle-failed' });
        });

        it('when a card does not compile', async () => {
            const h = harness({
                compileCard: () => Promise.reject(new DesignArtifactError('bundle-failed', 'bad card')),
            });

            expect(await failing(h.ports, h.writes)).toMatchObject({ message: 'bad card' });
        });

        it('when a card folder has no README', async () => {
            const h = harness({}, { [join(CARDS, 'Orphan/Orphan.card.tsx')]: '' });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('missing-card');
            expect(failure).toHaveProperty('message', expect.stringContaining('Orphan'));
        });

        it('when a card folder has no card file', async () => {
            const h = harness({}, { [join(CARDS, 'Bare/README.md')]: 'x' });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('missing-card');
            expect(failure).toHaveProperty('message', expect.stringContaining('Bare.card.tsx'));
        });

        it('when a card mounts a component the bundle does not export', async () => {
            const h = harness({
                loadCardSpec: () =>
                    Promise.resolve({ group: 'Actions', height: 200, platforms: 'both', uses: ['Ghost'] }),
            });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('surface-mismatch');
            expect(failure).toHaveProperty('message', expect.stringContaining('Button uses Ghost'));
        });

        it('when a canvas board mounts a component the bundle does not export', async () => {
            const board = join(BOARDS_DIR, 'Home.dc.html');
            const h = harness({}, { [board]: '<x component-from-global-scope="Commise.Native.Ghost">' });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('surface-mismatch');
            expect(failure).toHaveProperty(
                'message',
                expect.stringContaining('Home.dc.html mounts Commise.Native.Ghost'),
            );
        });

        it('when an exported component has neither a card nor an UNCARDED entry', async () => {
            const h = harness({
                surface: () => ({
                    web: [makeSurfaceEntry('Orphan', { file: '/ui/Orphan.tsx' })],
                    native: [],
                }),
            });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('surface-mismatch');
            expect(failure).toHaveProperty('message', expect.stringContaining('Orphan has no card'));
        });

        it('when a card is for a component that is no longer exported', async () => {
            const h = harness({
                surface: () => ({ web: [makeSurfaceEntry('Button', { file: '/ui/Button.tsx' })], native: [] }),
                loadCardSpec: () =>
                    Promise.resolve({ group: 'Actions', height: 200, platforms: 'web', uses: ['Button'], reason: 'x' }),
            });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('surface-mismatch');
            expect(failure).toHaveProperty('message', expect.stringContaining('Chip is a card for a component'));
        });

        it('when there are no cards at all: an empty design system is a broken checkout, not a build', async () => {
            const base = harness();
            const h = harness({
                files: {
                    ...base.ports.files,
                    list: (directory) => (directory === CARDS ? Promise.resolve([]) : base.ports.files.list(directory)),
                },
            });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('missing-card');
        });

        it('when the card directory is missing', async () => {
            const h = harness({}, {}, [
                join(CARDS, 'Button/README.md'),
                join(CARDS, 'Button/Button.card.tsx'),
                join(CARDS, 'Chip/README.md'),
                join(CARDS, 'Chip/Chip.card.tsx'),
            ]);
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('missing-source');
        });

        it('when the surface exports a name twice', async () => {
            const h = harness({
                surface: () => ({
                    web: [
                        makeSurfaceEntry('Sheet', { file: '/a/Sheet.tsx' }),
                        makeSurfaceEntry('Sheet', { file: '/b/Sheet.tsx' }),
                    ],
                    native: [],
                }),
            });
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('duplicate-name');
        });

        it('when a board file is missing', async () => {
            const h = harness({}, {}, [join(BOARDS_DIR, 'Home.dc.html')]);
            const failure = await failing(h.ports, h.writes);

            expect(isDesignArtifactError(failure) && failure.code).toBe('missing-source');
            expect(failure).toHaveProperty('message', expect.stringContaining('Home.dc.html'));
        });

        it('when git cannot say which commit this is', async () => {
            const h = harness({ gitHead: () => Promise.reject(new DesignArtifactError('missing-source', 'no git')) });

            expect(await failing(h.ports, h.writes)).toMatchObject({ message: 'no git' });
        });
    });

    it('does not write the canvas when the design system write fails', async () => {
        const writes: string[] = [];
        const { ports } = harness({
            writer: {
                write(root) {
                    writes.push(root);

                    return Promise.reject(new DesignArtifactError('write-failed', 'disk full'));
                },
            },
        });

        await expect(buildArtifact(ports, '/out')).rejects.toMatchObject({ code: 'write-failed' });
        expect(writes).toEqual(['/out/designSystem/project']);
    });
});
