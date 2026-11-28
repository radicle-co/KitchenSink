/**
 * Generates the two files, formatted with the repo's prettier config so the output is byte-stable.
 *
 * @sideEffect Reads the prettier configuration from disk.
 */
import { format, resolveConfig } from 'prettier';

import { applyBlocks, renderBlocks, renderModel } from './render.js';

/** The inputs: where the files live (for their prettier config) and the document's current text. */
export interface GenerateInput {
    readonly docPath: string;
    readonly jsonPath: string;
    readonly doc: string;
}

/** The two files as the module says they should be. */
export interface GeneratedFiles {
    readonly doc: string;
    readonly json: string;
}

/**
 * @param input - The paths and the current document.
 * @returns The document with its blocks written, and the model JSON, both formatted.
 */
export async function generateFiles(input: GenerateInput): Promise<GeneratedFiles> {
    const [docConfig, jsonConfig] = await Promise.all([resolveConfig(input.docPath), resolveConfig(input.jsonPath)]);
    const doc = await format(applyBlocks(input.doc, renderBlocks()), { ...docConfig, filepath: input.docPath });
    const json = await format(JSON.stringify(renderModel()), { ...jsonConfig, filepath: input.jsonPath });

    return { doc, json };
}
