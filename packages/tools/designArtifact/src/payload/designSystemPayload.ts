/**
 * @module payload/designSystemPayload — assembles the Design System artifact's files from already-built parts.
 *
 * Pure: it only names where each part goes, so the layout the host reads (`components/<Name>/preview.html`,
 * `fonts/`, `design-system.json`) is stated once and tested as a table.
 */
import { designSystemIndex } from '../artifactFormat.js';
import { DesignArtifactError } from '../errors.js';
import type { ArtifactFiles } from '../write/artifactWriter.js';
import type { ArtifactTokens } from '../tokens/artifactTokens.js';

/** A binary file of the payload (a font, a licence). */
export interface BinaryFile {
    /** The file name inside its directory. */
    readonly file: string;
    readonly bytes: Uint8Array;
}

/** A built component card. */
export interface BuiltCard {
    readonly name: string;
    readonly readme: string;
    readonly previewHtml: string;
}

/** Everything the payload is made of. */
export interface DesignSystemInputs {
    /** The README with its build line already appended. */
    readonly readme: string;
    readonly tokens: ArtifactTokens;
    readonly fonts: readonly BinaryFile[];
    readonly licences: readonly BinaryFile[];
    readonly bundleJs: string;
    readonly bundleCss: string;
    readonly declarations: string;
    readonly cards: readonly BuiltCard[];
    readonly coverHtml: string;
    /** ISO-8601 build instant. */
    readonly now: string;
}

/** The title the host lists the design system under. */
export const DESIGN_SYSTEM_TITLE = 'KitchenSink Design System';

/**
 * The files of the design-system payload, relative to its `project/` directory.
 *
 * @param inputs - The built parts.
 * @returns Path to content.
 * @throws DesignArtifactError `duplicate-name` when two cards share a name.
 */
export function designSystemPayload(inputs: DesignSystemInputs): ArtifactFiles {
    const files = new Map<string, string | Uint8Array>([
        ['README.md', inputs.readme],
        ['tokens.json', `${JSON.stringify(inputs.tokens, null, 2)}\n`],
        [
            'design-system.json',
            `${JSON.stringify(
                designSystemIndex({
                    title: DESIGN_SYSTEM_TITLE,
                    now: inputs.now,
                    libraries: [
                        { name: 'react', version: '18' },
                        { name: 'react-dom', version: '18' },
                    ],
                }),
                null,
                2,
            )}\n`,
        ],
        ['components/bundle.js', inputs.bundleJs],
        ['components/bundle.css', inputs.bundleCss],
        ['components/index.d.ts', inputs.declarations],
        ['components/Cover/preview.html', inputs.coverHtml],
    ]);

    for (const { file, bytes } of [...inputs.fonts, ...inputs.licences]) {
        files.set(`fonts/${file}`, bytes);
    }

    for (const { name, readme, previewHtml } of inputs.cards) {
        if (files.has(`components/${name}/preview.html`) || name === 'Cover') {
            throw new DesignArtifactError('duplicate-name', `Two cards are named ${name}.`);
        }

        files.set(`components/${name}/README.md`, readme);
        files.set(`components/${name}/preview.html`, previewHtml);
    }

    return files;
}
