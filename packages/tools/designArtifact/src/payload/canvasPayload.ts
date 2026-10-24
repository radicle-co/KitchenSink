/**
 * @module payload/canvasPayload — assembles the screens canvas's files: the boards, `canvas.json`, and the copy of the
 * design system the boards load from `ds/commise/`.
 *
 * Pure. The boards read the design system from a copy beside them rather than from the design-system artifact, so a
 * canvas opens with no network and no dependency on that artifact staying published.
 */
import { NAMESPACE, canvasIndex } from '../artifactFormat.js';
import { canvasLayout } from '../canvas/canvasLayout.js';
import type { BoardSpec } from '../canvas/boards.js';
import { DesignArtifactError } from '../errors.js';
import type { ArtifactTokens } from '../tokens/artifactTokens.js';
import { tokensCss } from '../tokens/tokensCss.js';
import type { ArtifactFiles } from '../write/artifactWriter.js';

import { DESIGN_SYSTEM_TITLE } from './designSystemPayload.js';
import type { BinaryFile } from './designSystemPayload.js';
import type { DesignSystemReference } from './designSystemReference.js';

/** A board file as read. */
export interface BoardSource {
    readonly file: string;
    readonly html: string;
}

/** Everything the canvas payload is made of. */
export interface CanvasInputs {
    /** The board files as read, in any order. */
    readonly boards: readonly BoardSource[];
    /** The registry: what each board is and where it sits. */
    readonly specs: readonly BoardSpec[];
    readonly bundleJs: string;
    readonly bundleCss: string;
    readonly tokens: ArtifactTokens;
    readonly fonts: readonly BinaryFile[];
    readonly licences: readonly BinaryFile[];
    /** The photo the sign-in and sign-up boards show. */
    readonly authFood: Uint8Array;
    /** ISO-8601 build instant. */
    readonly now: string;
    /** The published design system the canvas was copied against; absent when none is recorded. */
    readonly designSystem?: DesignSystemReference | undefined;
}

const CANVAS_TITLE = 'Commise Screens';

/**
 * The files of the canvas payload, relative to its `project/` directory.
 *
 * @param inputs - The built parts.
 * @returns Path to content.
 * @throws DesignArtifactError `missing-source` when the registry names a board that was not read, or a board was read
 * that the registry does not place.
 */
export function canvasPayload(inputs: CanvasInputs): ArtifactFiles {
    const read = new Set(inputs.boards.map(({ file }) => file));
    const placed = new Set(inputs.specs.map(({ file }) => file));

    for (const file of placed) {
        if (!read.has(file)) {
            throw new DesignArtifactError('missing-source', `The board registry names ${file}, which was not read.`);
        }
    }

    for (const file of read) {
        if (!placed.has(file)) {
            throw new DesignArtifactError('missing-source', `${file} is a board file the registry does not place.`);
        }
    }

    const layout = canvasLayout(inputs.specs);
    const canvas = canvasIndex({
        title: CANVAS_TITLE,
        now: inputs.now,
        boards: layout.boards,
        notes: layout.notes,
        designSystem:
            inputs.designSystem === undefined
                ? undefined
                : {
                      title: DESIGN_SYSTEM_TITLE,
                      namespace: NAMESPACE.toLowerCase(),
                      artifact: inputs.designSystem.artifact,
                      version: inputs.designSystem.version,
                      copiedAt: inputs.now,
                  },
    });
    const files = new Map<string, string | Uint8Array>(inputs.boards.map(({ file, html }) => [file, html]));

    files.set('canvas.json', `${JSON.stringify(canvas, null, 2)}\n`);
    files.set('ds/commise/bundle.js', inputs.bundleJs);
    files.set('ds/commise/bundle.css', inputs.bundleCss);
    files.set('ds/commise/tokens.json', `${JSON.stringify(inputs.tokens, null, 2)}\n`);
    files.set('ds/commise/tokens.css', tokensCss(inputs.tokens));
    files.set('assets/authFood.jpg', inputs.authFood);

    for (const { file, bytes } of [...inputs.fonts, ...inputs.licences]) {
        files.set(`ds/commise/fonts/${file}`, bytes);
    }

    return files;
}
