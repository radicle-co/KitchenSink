/**
 * Window overlays open only through `OverlayHost`, and Tamagui overlay parts never open a window of their own.
 *
 * ⛔ WHY. An open `Modal` takes Android Back itself (`onRequestClose`). `OverlayHost` is the one place that turns that,
 * and every other dismiss route, into a single `DismissRequest` the host can veto; a sheet that opens the `Modal`
 * directly has a Back no guard can see, which is how a discard question gets skipped. A Tamagui `Portal`, or a
 * `modal` that is not the literal `false`, or a `native` prop on its Sheet or Dialog, would add a second window beside ours and bring back the Back and
 * screen-reader problems ADR-0080 rejected. A Tamagui overlay keeps no open state of its own (`defaultOpen`): the host
 * owns `open`, and a veto means leaving it true.
 *
 * ⛔ IT ENUMERATES NO FILE TO PASS. Candidates come from the filesystem and are read with the TypeScript parser. The one
 * list is `HOLDOUTS`, the files not yet moved onto the host: it only shrinks, and an entry that no longer opens the
 * Modal directly FAILS, so the list cannot rot.
 *
 * ✅ THE FIX FOR A FAILURE: render `OverlayHost` from `@commise/ui/overlay` instead of `Modal`, and give the Tamagui
 * part `open` and `onOpenChange` only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceFiles } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** The adapter, and the host that is its one renderer. */
const MODAL_ADAPTER = 'packages/apps/commise/ui/src/modal/Modal.native.tsx';
const HOST = 'packages/apps/commise/ui/src/overlay/OverlayHost.native.tsx';

/** Not yet moved onto the host (blueprint step 5: `PhotoCarousel` migrates last). Only ever shrinks. */
const HOLDOUTS: readonly string[] = ['packages/apps/commise/features/recipes/src/detail/PhotoCarousel.native.tsx'];

const MODAL_SPECIFIER = /(^@commise\/ui\/modal$)|((^|\/)modal\/Modal\.native\.js$)/;
const TAMAGUI_OVERLAY_PARTS = new Set(['Sheet', 'Dialog', 'AlertDialog', 'Popover']);
const FORBIDDEN_PROPS = new Set(['native', 'defaultOpen']);

/** Whether a source file imports the design-system `Modal` as a value. Pure. */
export function importsModal(source: string, fileName: string): boolean {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

    return file.statements.some(
        (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            MODAL_SPECIFIER.test(statement.moduleSpecifier.text) &&
            statement.importClause?.isTypeOnly !== true &&
            (statement.importClause?.namedBindings === undefined ||
                !ts.isNamedImports(statement.importClause.namedBindings) ||
                statement.importClause.namedBindings.elements.some(
                    (element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === 'Modal',
                )),
    );
}

/** Whether a JSX attribute is `={false}`. Pure. */
function isLiteralFalse(attribute: ts.JsxAttribute): boolean {
    const value = attribute.initializer;

    return (
        value !== undefined &&
        ts.isJsxExpression(value) &&
        value.expression !== undefined &&
        value.expression.kind === ts.SyntaxKind.FalseKeyword
    );
}

/** What a file does wrong with Tamagui's overlay parts: a Portal import, or a forbidden prop on a part. Pure. */
export function tamaguiOverlayViolations(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    const fromTamagui = new Set<string>();

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !/^(tamagui|@tamagui\/)/.test(statement.moduleSpecifier.text) ||
            statement.importClause?.isTypeOnly === true
        ) {
            continue;
        }

        const bindings = statement.importClause?.namedBindings;

        if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
                const imported = (element.propertyName ?? element.name).text;

                if (imported === 'Portal' || imported === 'PortalProvider') {
                    violations.push(`imports ${imported} from ${statement.moduleSpecifier.text}`);
                }

                if (TAMAGUI_OVERLAY_PARTS.has(imported)) {
                    fromTamagui.add(element.name.text);
                }
            }
        }
    }

    const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningLikeElement(node)) {
            const tag = node.tagName.getText(file).split('.')[0] ?? '';

            if (fromTamagui.has(tag)) {
                const name = node.tagName.getText(file);
                let modalIsFalse = false;

                for (const attribute of node.attributes.properties) {
                    if (!ts.isJsxAttribute(attribute)) {
                        continue;
                    }

                    const prop = attribute.name.getText(file);

                    if (FORBIDDEN_PROPS.has(prop)) {
                        violations.push(`<${name} ${prop}>`);
                    }

                    if (prop === 'modal') {
                        modalIsFalse = isLiteralFalse(attribute);

                        if (!modalIsFalse) {
                            violations.push(`<${name} modal> is not the literal {false}`);
                        }
                    }
                }

                // The root of a part decides whether a window opens; the default is not relied on.
                if (
                    !name.includes('.') &&
                    !modalIsFalse &&
                    !violations.includes(`<${name} modal> is not the literal {false}`)
                ) {
                    violations.push(`<${name}> does not set modal={false}`);
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return violations;
}

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

describe('the detectors read what they claim to (a vacuous pass would hide every rule below)', () => {
    it('sees a Modal import by package name, by relative path and renamed, but not a type-only one', () => {
        expect(importsModal("import { Modal } from '@commise/ui/modal';", 'a.tsx')).toBe(true);
        expect(importsModal("import { Modal } from '../modal/Modal.native.js';", 'a.tsx')).toBe(true);
        expect(importsModal("import { Modal as M } from '../modal/Modal.native.js';", 'a.tsx')).toBe(true);
        expect(importsModal("import type { ModalProps } from '../modal/Modal.native.js';", 'a.tsx')).toBe(false);
        expect(importsModal("import { type Modal } from '../modal/Modal.native.js';", 'a.tsx')).toBe(false);
    });

    it('sees a Portal import and a forbidden prop on a Tamagui part, but not on another element', () => {
        const bad = `import { Portal, Sheet as S, Dialog } from 'tamagui';
            const a = <S modal />; const b = <Dialog.Content native />; const c = <Dialog modal={false} defaultOpen />;`;
        const fine = `import { Sheet } from 'tamagui'; const a = <Sheet modal={false} open onOpenChange={f} />; const b = <Other modal />;`;

        expect(tamaguiOverlayViolations(bad, 'a.tsx')).toEqual([
            'imports Portal from tamagui',
            '<S modal> is not the literal {false}',
            '<Dialog.Content native>',
            '<Dialog defaultOpen>',
        ]);
        expect(tamaguiOverlayViolations(fine, 'a.tsx')).toEqual([]);
    });

    it('requires modal to be the literal false on a part root, never the default and never an expression', () => {
        const root = (attributes: string): readonly string[] =>
            tamaguiOverlayViolations(`import { Sheet } from 'tamagui'; const a = <Sheet ${attributes} />;`, 'a.tsx');

        expect(root('')).toEqual(['<Sheet> does not set modal={false}']);
        expect(root('modal')).toEqual(['<Sheet modal> is not the literal {false}']);
        expect(root('modal={true}')).toEqual(['<Sheet modal> is not the literal {false}']);
        expect(root('modal={flag}')).toEqual(['<Sheet modal> is not the literal {false}']);
        expect(root('modal={false}')).toEqual([]);
    });

    it('discovers the app sources, and finds the adapter and the host importing/rendering the Modal', () => {
        const files = appSourceFiles();

        expect(files).toContain(HOST);
        expect(importsModal(read(MODAL_ADAPTER), MODAL_ADAPTER)).toBe(false);
        expect(importsModal(read(HOST), HOST)).toBe(true);
    });
});

describe('window overlays open only through OverlayHost', () => {
    it('imports the design-system Modal nowhere except the host and the listed holdouts', () => {
        const offenders = appSourceFiles().filter(
            (file) =>
                file !== MODAL_ADAPTER && file !== HOST && !HOLDOUTS.includes(file) && importsModal(read(file), file),
        );

        expect(offenders).toEqual([]);
    });

    it('lists only holdouts that still open the Modal directly (the list cannot rot)', () => {
        const stale = HOLDOUTS.filter((file) => !importsModal(read(file), file));

        expect(stale).toEqual([]);
    });
});

describe('Tamagui overlay parts open no window and keep no open state', () => {
    it('has no Portal import, modal={false} on every part root, and no native or defaultOpen prop', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            tamaguiOverlayViolations(read(file), file).map((violation) => `${file}: ${violation}`),
        );

        expect(offenders).toEqual([]);
    });
});
