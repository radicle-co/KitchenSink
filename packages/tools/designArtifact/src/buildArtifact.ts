/**
 * @module buildArtifact — builds the two publish payloads, the Design System and the screens canvas, from source.
 *
 * Every step reads through a port, so the order of the steps and the "a failure writes nothing" guarantee are tested
 * with fakes. All parts are built in memory first and written only when every one succeeded; each payload is then
 * swapped into place by the writer, so a half-built artifact never reaches `dist/`.
 *
 * The one residual window: the design system is swapped in before the canvas is written. If the canvas write then
 * fails, `dist/designSystem` is the new build and `dist/canvas` is the previous one. Both are whole, and the error
 * names the one that failed.
 *
 * The surface checks are one of those filters and fail closed: a card, a board or an `UNCARDED` entry that disagrees
 * with what the bundle exports stops the build before anything is written, so a published artifact cannot claim a
 * component the bundle lacks.
 *
 * @pattern Pipes and Filters — git, surface, bundle, css, tokens, fonts, declarations, cards and the surface checks are
 * filters over ports; the two payload assemblers are the pure join at the end.
 */
import { join } from 'node:path';

import { bundleComponents } from './bundle/bundleComponents.js';
import type { Bundler } from './bundle/bundler.js';
import { BOARDS, BOARDS_DIR } from './canvas/boards.js';
import { cardPage } from './cards/cardPage.js';
import type { LoadedCardSpec } from './cards/loadCardSpec.js';
import { COMMISE_ROOT, CONTENT_DIR, DIST_DIR } from './config.js';
import { compileCss } from './css/compileCss.js';
import type { CssCompiler } from './css/cssCompiler.js';
import { declarationSections } from './declarations/declarationSections.js';
import { propsIndex } from './declarations/propsIndex.js';
import { DesignArtifactError } from './errors.js';
import type { FontFile, FontLicence } from './fonts/fontFile.js';
import { canvasPayload } from './payload/canvasPayload.js';
import type { BoardSource } from './payload/canvasPayload.js';
import { designSystemPayload } from './payload/designSystemPayload.js';
import type { BinaryFile, BuiltCard } from './payload/designSystemPayload.js';
import type { DesignSystemReference } from './payload/designSystemReference.js';
import { stampReadme } from './readme/stampReadme.js';
import type { GitHeadReader } from './sources/gitHead.js';
import type { SourceFiles } from './sources/sourceFiles.js';
import { assertDistinctNames } from './surface/assertDistinctNames.js';
import type { Surface } from './surface/discoverSurface.js';
import { assertSurfaceChecks } from './surface/surfaceChecks.js';
import type { CardClaim } from './surface/surfaceChecks.js';
import { buildTokens } from './tokens/buildTokens.js';
import type { ArtifactWriter } from './write/artifactWriter.js';

/** The design-system card folders: `<Name>/<Name>.card.tsx` and `<Name>/README.md`. */
export const CARDS_DIR = join(CONTENT_DIR, 'designSystem/cards');

const README_FILE = join(CONTENT_DIR, 'designSystem/README.md');
const COVER_FILE = join(CONTENT_DIR, 'designSystem/cover.html');

/** The photo the sign-in and sign-up boards show. The web app owns it; the canvas copies it at build time. */
export const AUTH_FOOD_IMAGE = join(COMMISE_ROOT, 'web/public/images/auth/authFood.jpg');

/** Where the build gets everything it does not compute. */
export interface BuildPorts {
    readonly files: SourceFiles;
    readonly bundler: Bundler;
    readonly cssCompiler: CssCompiler;
    readonly writer: ArtifactWriter;
    /** The build instant, ISO-8601. */
    readonly now: () => string;
    readonly gitHead: GitHeadReader;
    /** What the bundle exports. */
    readonly surface: () => Surface;
    readonly fonts: {
        readonly files: () => readonly FontFile[];
        readonly licences: () => readonly FontLicence[];
    };
    /** A card compiled for the browser. */
    readonly compileCard: (file: string) => Promise<string>;
    /** A card's metadata, and the components it mounts. */
    readonly loadCardSpec: (file: string) => Promise<LoadedCardSpec>;
    /** The components that deliberately have no card, each with its reason. */
    readonly uncarded: Readonly<Record<string, string>>;
    /** The design-system artifact the canvas links to; absent when none is recorded. */
    readonly designSystem: DesignSystemReference | undefined;
}

/** What was built and where. */
export interface BuildResult {
    readonly designSystemDir: string;
    readonly canvasDir: string;
    readonly cards: number;
    readonly boards: number;
    /** Things that did not stop the build but that a person should hear about. */
    readonly warnings: readonly string[];
}

async function binaries(
    files: SourceFiles,
    entries: readonly { readonly file: string; readonly source: string }[],
): Promise<readonly BinaryFile[]> {
    return Promise.all(entries.map(async ({ file, source }) => ({ file, bytes: await files.bytes(source) })));
}

/** A card page and what the card says about itself, for the surface checks. */
interface CardBuild {
    readonly built: readonly BuiltCard[];
    readonly claims: readonly CardClaim[];
}

/**
 * Builds every card folder; a folder missing its README or its card file is an error, not a skipped card, and so is no
 * card folder at all: the design system with no components is a broken checkout, and shipping it would replace the
 * published one with an empty shell.
 */
async function builtCards(ports: BuildPorts): Promise<CardBuild> {
    const cards: BuiltCard[] = [];
    const claims: CardClaim[] = [];
    const names = await ports.files.list(CARDS_DIR);

    if (names.length === 0) {
        throw new DesignArtifactError('missing-card', `${CARDS_DIR} holds no card folders.`);
    }

    for (const name of names) {
        const readme = join(CARDS_DIR, name, 'README.md');
        const source = join(CARDS_DIR, name, `${name}.card.tsx`);

        for (const required of [readme, source]) {
            if (!(await ports.files.exists(required))) {
                throw new DesignArtifactError(
                    'missing-card',
                    `Card ${name} has no ${required.split('/').pop() ?? ''}.`,
                );
            }
        }

        const script = await ports.compileCard(source);
        const spec = await ports.loadCardSpec(source);

        cards.push({ name, readme: await ports.files.text(readme), previewHtml: cardPage(spec, script) });
        claims.push({ name, uses: spec.uses, platforms: spec.platforms });
    }

    return { built: cards, claims };
}

/**
 * Builds both payloads and writes them under `outDir`.
 *
 * @param ports - Everything external.
 * @param outDir - Where `designSystem/project` and `canvas/project` go.
 * @returns The two directories and what they hold.
 * @throws DesignArtifactError from whichever step failed; nothing is written unless every step before the write
 * succeeded.
 * @sideEffect Writes `outDir/designSystem/project` and `outDir/canvas/project` through the writer.
 */
export async function buildArtifact(ports: BuildPorts, outDir: string = DIST_DIR): Promise<BuildResult> {
    const stamp = await ports.gitHead();
    const now = ports.now();
    const surface = assertDistinctNames(ports.surface());
    const { script: bundleJs, sourceRoots } = await bundleComponents(surface, ports.bundler);
    const bundleCss = await compileCss(ports.cssCompiler, sourceRoots);
    const tokens = buildTokens();
    const fonts = await binaries(ports.files, ports.fonts.files());
    const licences = await binaries(ports.files, ports.fonts.licences());
    const declarations = propsIndex(await declarationSections(ports.files));
    const { built: cards, claims } = await builtCards(ports);
    const readme = stampReadme(await ports.files.text(README_FILE), stamp);
    const coverHtml = await ports.files.text(COVER_FILE);
    const boards: BoardSource[] = [];

    for (const { file } of BOARDS) {
        boards.push({ file, html: await ports.files.text(join(BOARDS_DIR, file)) });
    }

    assertSurfaceChecks({ surface, cards: claims, boards, uncarded: ports.uncarded });

    const designSystem = designSystemPayload({
        readme,
        tokens,
        fonts,
        licences,
        bundleJs,
        bundleCss,
        declarations,
        cards,
        coverHtml,
        now,
    });
    const canvas = canvasPayload({
        boards,
        specs: BOARDS,
        bundleJs,
        bundleCss,
        tokens,
        fonts,
        licences,
        authFood: await ports.files.bytes(AUTH_FOOD_IMAGE),
        now,
        designSystem: ports.designSystem,
    });
    const designSystemDir = join(outDir, 'designSystem/project');
    const canvasDir = join(outDir, 'canvas/project');

    const designSystemWritten = await ports.writer.write(designSystemDir, designSystem);
    const canvasWritten = await ports.writer.write(canvasDir, canvas);

    return {
        designSystemDir,
        canvasDir,
        cards: cards.length,
        boards: boards.length,
        warnings: [...designSystemWritten.warnings, ...canvasWritten.warnings],
    };
}
