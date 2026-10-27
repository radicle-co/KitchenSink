/**
 * A popup root states its own surface (`componentFixes.md` §10). On web, Radix portals a dialog, a popover and a menu to
 * `<body>`, out of the DOM tree of whatever opened them, so nothing the opener states can reach the popup: the root must
 * state its own tone, or every control inside reads the page's surface (the canvas) behind the popup. On native, React
 * context passes through a `Modal` (it is the React tree), so the popup root must state its tone or its controls read
 * the surface of the screen that opened it.
 *
 * The rule, read with the TypeScript parser: an app module that imports a Radix dialog, alert dialog, popover or dropdown
 * menu, or the `Modal` adapter (`@commise/ui/modal`, the one door to React Native's `Modal`, itself held by
 * `modalAdapterImports.test.ts`), must also use the surface recipe: `surfaceToneClass`, `SURFACE_TONE_CLASS`, `Surface`,
 * `SurfaceToneScope`, `surfaceFill` or `BottomSheetPanel` (the sheet root, which states `paperOverlay` itself, so
 * a module that only composes it states it by delegation); or, for a popup with no surface of its own (a lightbox, whose controls float over a
 * scrim), `FOCUS_RING_CLASS.floating`. A tooltip is not a surface (it is inverse and holds no control), so
 * `@radix-ui/react-tooltip` is not in the rule.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript minus tests and fixtures (`appSources.ts`).
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, parseModule } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The popup libraries whose content leaves the tree or opens in its own window. */
const RADIX_POPUPS = /^@radix-ui\/react-(?:dialog|alert-dialog|popover|dropdown-menu)$/u;

/** The adapter every native modal opens through: a relative path to it, or the package export. */
const MODAL_ADAPTER = /(?:^|\/)modal\/Modal(?:\.native)?\.js$|^@commise\/ui\/modal$/u;

/** The names that state a surface. */
const STATES_SURFACE = new Set([
    'surfaceToneClass',
    'SURFACE_TONE_CLASS',
    'Surface',
    'SurfaceToneScope',
    'surfaceFill',
    'BottomSheetPanel',
]);

/**
 * Whether a module opens a popup: it imports a Radix popup library, or `Modal` from React Native. Pure.
 *
 * @param file - The parsed module.
 */
function opensPopup(file: ts.SourceFile): boolean {
    return file.statements.some((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            return false;
        }

        const specifier = statement.moduleSpecifier.text;

        if (RADIX_POPUPS.test(specifier)) {
            return true;
        }

        const bindings = statement.importClause?.namedBindings;

        return (
            MODAL_ADAPTER.test(specifier) &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.some((element) => (element.propertyName ?? element.name).text === 'Modal')
        );
    });
}

/** Whether a module uses any of the names that state a surface, as an identifier (a comment does not count). Pure. */
function statesSurface(file: ts.SourceFile): boolean {
    let found = false;

    const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && STATES_SURFACE.has(node.text)) {
            found = true;
        }

        if (ts.isPropertyAccessExpression(node) && node.getText() === 'FOCUS_RING_CLASS.floating') {
            found = true;
        }

        ts.forEachChild(node, walk);
    };

    walk(file);

    return found;
}

/**
 * Whether a module opens a popup without stating a surface. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 */
export function popupWithoutSurface(fileName: string, source: string): boolean {
    const file = parseModule(fileName, source);

    return opensPopup(file) && !statesSurface(file);
}

describe('the popup surface reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly flagged: boolean }[] = [
        {
            shape: 'a Radix dialog with no surface',
            source: `import * as Dialog from '@radix-ui/react-dialog';\nexport const A = () => <Dialog.Content className="bg-white" />;`,
            flagged: true,
        },
        {
            shape: 'a Radix menu with no surface',
            source: `import * as DropdownMenu from '@radix-ui/react-dropdown-menu';\nexport const A = 1;`,
            flagged: true,
        },
        {
            shape: 'a Modal adapter user with no surface',
            source: `import { Modal } from '../modal/Modal.native.js';\nexport const A = 1;`,
            flagged: true,
        },
        {
            shape: 'a renamed Modal from the package export with no surface',
            source: `import { Modal as Window } from '@commise/ui/modal';\nexport const A = 1;`,
            flagged: true,
        },
        {
            shape: 'the adapter itself, which wraps React Native’s Modal and is held by another guard',
            source: `import { Modal as NativeModal } from 'react-native';\nexport const A = 1;`,
            flagged: false,
        },
        {
            shape: 'a lightbox whose controls float over a scrim',
            source: `import * as Dialog from '@radix-ui/react-dialog';\nexport const A = () => <Dialog.Close className={FOCUS_RING_CLASS.floating} />;`,
            flagged: false,
        },
        {
            shape: 'a module that uses some OTHER focus ring placement',
            source: `import * as Dialog from '@radix-ui/react-dialog';\nexport const A = () => <Dialog.Close className={FOCUS_RING_CLASS.offset} />;`,
            flagged: true,
        },
        {
            shape: 'a Radix dialog that states its tone',
            source: `import * as Dialog from '@radix-ui/react-dialog';\nimport { surfaceToneClass } from './surfaceToneClass.js';\nexport const A = () => <Dialog.Content className={surfaceToneClass('paper')} />;`,
            flagged: false,
        },
        {
            shape: 'a Modal that states its tone with the scope',
            source: `import { Modal } from '@commise/ui/modal';\nexport const A = () => <Modal><SurfaceToneScope tone="paper" /></Modal>;`,
            flagged: false,
        },
        {
            shape: 'a sheet that composes the sheet root, which states its own tone',
            source: `import { Modal } from '../modal/Modal.native.js';\nexport const A = () => <Modal><BottomSheetPanel /></Modal>;`,
            flagged: false,
        },
        {
            shape: 'a tooltip, which is not a surface',
            source: `import * as Tooltip from '@radix-ui/react-tooltip';\nexport const A = 1;`,
            flagged: false,
        },
        {
            shape: 'a module that only names the recipe in a comment',
            source: `import * as Dialog from '@radix-ui/react-dialog';\n// surfaceToneClass('paper') would go here\nexport const A = 1;`,
            flagged: true,
        },
        {
            shape: 'a module with neither a popup nor a surface',
            source: `import { View } from 'react-native';\nexport const A = 1;`,
            flagged: false,
        },
    ];

    for (const { shape, source, flagged } of cases) {
        it(`reads ${shape}`, () => {
            expect(popupWithoutSurface('fixture.tsx', source)).toBe(flagged);
        });
    }
});

describe('apps give every popup root a surface', () => {
    const modules = appSourceModules();

    it('discovers the popup roots, web and native (a vacuous pass would hide the rule)', () => {
        const popups = modules.filter((file) =>
            opensPopup(parseModule(file, readFileSync(path.join(repoRoot, file), 'utf8'))),
        );

        expect(popups).toContain('packages/apps/commise/ui/src/sheet/Sheet.tsx');
        expect(popups).toContain('packages/apps/commise/ui/src/confirmDialog/ConfirmDialog.tsx');
        expect(popups).toContain('packages/apps/commise/ui/src/popover/Popover.tsx');
        expect(popups).toContain('packages/apps/commise/ui/src/actionMenu/ActionMenu.tsx');
        expect(popups).toContain('packages/apps/commise/ui/src/sheet/FullScreenSheet.native.tsx');
        expect(popups).toContain('packages/apps/commise/ui/src/dialogFrame/DialogFrame.native.tsx');
        expect(popups).not.toContain('packages/apps/commise/ui/src/modal/Modal.native.tsx');
    });

    it('lets no module open a Radix popup or a Modal without stating a surface', () => {
        const offenders = modules.filter((file) =>
            popupWithoutSurface(file, readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        expect(offenders).toEqual([]);
    });
});
