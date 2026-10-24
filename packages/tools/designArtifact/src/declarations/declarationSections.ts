/**
 * @module declarations/declarationSections — reads the source files `components/index.d.ts` is made from.
 *
 * Every `@commise/ui` directory that has a `props.ts` contributes it whole (imports stripped), and every registered
 * product or chrome component contributes its exported types. Both lists come from files already in the tree: the
 * directory listing, and the surface registry the bundle is built from.
 *
 * @sideEffect Reads through the {@link SourceFiles} port.
 */
import { join, relative } from 'node:path';

import { COMMISE_ROOT, UI_SRC } from '../config.js';
import type { SourceFiles } from '../sources/sourceFiles.js';
import { CHROME_SURFACE, PRODUCT_SURFACE } from '../surface/productSurface.js';

import { exportedTypeDeclarations, stripImports } from './propsIndex.js';
import type { DeclarationSection } from './propsIndex.js';

const EXTENSION = /(?:\.native)?\.tsx?$/u;

/**
 * @param files - Where sources are read from.
 * @returns The sections, `@commise/ui` first (by directory name) and the product and chrome components after, in the
 * order the surface registers them.
 */
export async function declarationSections(files: SourceFiles): Promise<readonly DeclarationSection[]> {
    const sections: DeclarationSection[] = [];

    for (const directory of await files.list(UI_SRC)) {
        const props = join(UI_SRC, directory, 'props.ts');

        if (await files.exists(props)) {
            sections.push({ heading: `@commise/ui/${directory}`, source: stripImports(await files.text(props)) });
        }
    }

    const components = [...PRODUCT_SURFACE.web, ...CHROME_SURFACE.web, ...CHROME_SURFACE.native];

    for (const { file } of components) {
        if (await files.exists(file)) {
            sections.push({
                heading: relative(COMMISE_ROOT, file).replace(EXTENSION, ''),
                source: exportedTypeDeclarations(await files.text(file)),
            });
        }
    }

    return sections;
}
