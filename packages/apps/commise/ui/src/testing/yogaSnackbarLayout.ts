/**
 * @module testing/yogaSnackbarLayout — lays out a rendered native snackbar with the real Yoga layout engine, from the
 * styles the browser build resolves for each part, so a test can see where Undo lands and not only what style was
 * declared. A browser lays a wrapping row out the CSS way; Yoga does not (an item that may shrink stays on the line and
 * is squeezed), and a declared-style test cannot tell the two apart.
 *
 * `yoga-layout` is pinned to 3.2.1, the newest published 3.x, which is the closest to the Yoga that React Native 0.86
 * vendors in `node_modules/react-native/ReactCommon/yoga`. React Native's default conformance turns every erratum on
 * (`YogaLayoutableShadowNode::resolveErrata` answers `YGErrataAll`), so the config does the same. The npm build and the
 * vendored build can still differ in a detail, so a device run stays the authority.
 */
import Yoga, { type Config, type Node } from 'yoga-layout';

import { scaledLeading, scaledTypeSize } from '../text/scaledType.js';
import { bodyFontFace } from '../tokens/scale.js';
import { typeRole, type TypeRole } from '../tokens/typography.js';
import { asLoadedFace, measureTextWidth } from './measureText.js';
import { resolvedStyle } from './tamaguiTesting.native.js';

/** A laid-out box, in points. */
interface LaidOutBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** What the layout reads: the parts of the bar, as rendered. */
export interface SnackbarParts {
    /** The bar: the row that wraps. */
    readonly bar: HTMLElement;
    /** The box around the message. */
    readonly messageBox: HTMLElement;
    /** The box that holds Undo's button, at the end of its row. */
    readonly actionSlot: HTMLElement;
    /** Undo's frame: the touch target. */
    readonly actionFrame: HTMLElement;
}

/** The words, and the system text size they are drawn at. */
interface TextModel {
    /** The message. */
    readonly message: string;
    /** Undo's label. */
    readonly label: string;
    /** The system text scale (`useWindowDimensions().fontScale`); each role grows to its own cap. */
    readonly systemScale: number;
}

/** The result. */
export interface SnackbarLayout {
    readonly bar: LaidOutBox;
    readonly messageBox: LaidOutBox;
    /** The action's frame, in the bar's coordinates. */
    readonly actionFrame: LaidOutBox;
}

/** The roles the snackbar draws its two texts in. */
const MESSAGE_ROLE = 'body' satisfies TypeRole;
const LABEL_ROLE = 'label' satisfies TypeRole;

/** Reads a length: `auto` and an unset value answer `undefined`. */
function lengthOf(value: string): { readonly points?: number; readonly percent?: number } {
    if (value === '' || value === 'auto' || value === 'none' || value === 'normal') {
        return {};
    }

    const number = Number.parseFloat(value);

    return value.endsWith('%') ? { percent: number } : { points: number };
}

/**
 * A text measure in the real face: the words break at spaces, as a paragraph does, and each word is measured in the
 * role's own Inter face at the size and leading the design-system Text draws the role at.
 */
function textMeasure(
    words: string,
    role: 'body' | 'label',
    systemScale: number,
): Parameters<Node['setMeasureFunc']>[0] {
    const { weight } = typeRole[role];
    const face = asLoadedFace(bodyFontFace[weight]);
    const { fontSize } = scaledTypeSize(role, systemScale);
    const leading = scaledLeading(role, systemScale);
    const space = measureTextWidth(' ', face, fontSize);
    const wordWidths = words.split(' ').map((word) => measureTextWidth(word, face, fontSize));

    return (available) => {
        const limit = Number.isFinite(available) ? available : Number.POSITIVE_INFINITY;
        let lines = 1;
        let widest = 0;
        let current = 0;

        for (const width of wordWidths) {
            const next = current === 0 ? width : current + space + width;

            if (next > limit && current > 0) {
                lines += 1;
                current = width;
            } else {
                current = next;
            }

            widest = Math.max(widest, current);
        }

        return { width: widest, height: lines * leading };
    };
}

/** Looks a resolved value up in the values the harness can reproduce, and refuses any other. */
function supported<T>(property: string, value: string, table: Readonly<Record<string, T>>): T {
    const found = table[value];

    if (found === undefined) {
        throw new Error(`yogaSnackbarLayout cannot model ${property}=${JSON.stringify(value)}.`);
    }

    return found;
}

/** A number the style declares: an unset value answers the fallback, and anything that is not a number is refused. */
function numberOf(property: string, value: string, unset: number): number {
    if (value === '' || value === 'normal') {
        return unset;
    }

    const number = Number.parseFloat(value);

    if (Number.isNaN(number)) {
        throw new Error(`yogaSnackbarLayout cannot model ${property}=${JSON.stringify(value)}.`);
    }

    return number;
}

/** Applies the flex style the parts declare to a node. */
function applyStyle(node: Node, element: HTMLElement): void {
    const read = (property: Parameters<typeof resolvedStyle>[1]): string => resolvedStyle(element, property);

    node.setFlexDirection(
        supported('flexDirection', read('flexDirection'), {
            row: Yoga.FLEX_DIRECTION_ROW,
            column: Yoga.FLEX_DIRECTION_COLUMN,
            '': Yoga.FLEX_DIRECTION_COLUMN,
        }),
    );
    node.setFlexWrap(
        supported('flexWrap', read('flexWrap'), {
            wrap: Yoga.WRAP_WRAP,
            nowrap: Yoga.WRAP_NO_WRAP,
            '': Yoga.WRAP_NO_WRAP,
        }),
    );
    node.setAlignItems(
        supported('alignItems', read('alignItems'), {
            center: Yoga.ALIGN_CENTER,
            stretch: Yoga.ALIGN_STRETCH,
            normal: Yoga.ALIGN_STRETCH,
            '': Yoga.ALIGN_STRETCH,
        }),
    );
    node.setJustifyContent(
        supported('justifyContent', read('justifyContent'), {
            center: Yoga.JUSTIFY_CENTER,
            'flex-start': Yoga.JUSTIFY_FLEX_START,
            normal: Yoga.JUSTIFY_FLEX_START,
            '': Yoga.JUSTIFY_FLEX_START,
        }),
    );
    node.setFlexGrow(numberOf('flexGrow', read('flexGrow'), 0));
    node.setFlexShrink(numberOf('flexShrink', read('flexShrink'), 1));
    node.setGap(Yoga.GUTTER_COLUMN, numberOf('columnGap', read('columnGap'), 0));

    const edges = [
        [Yoga.EDGE_LEFT, 'paddingLeft'],
        [Yoga.EDGE_RIGHT, 'paddingRight'],
        [Yoga.EDGE_TOP, 'paddingTop'],
        [Yoga.EDGE_BOTTOM, 'paddingBottom'],
    ] as const;

    for (const [edge, property] of edges) {
        node.setPadding(edge, numberOf(property, read(property), 0));
    }

    if (supported('marginLeft', read('marginLeft'), { auto: true, '0': false, '0px': false, '': false })) {
        node.setMargin(Yoga.EDGE_LEFT, 'auto');
    }

    const { points: basis, percent: basisPercent } = lengthOf(read('flexBasis'));

    if (basis !== undefined) {
        node.setFlexBasis(basis);
    } else if (basisPercent !== undefined) {
        node.setFlexBasisPercent(basisPercent);
    }

    const min = lengthOf(read('minWidth'));
    const max = lengthOf(read('maxWidth'));
    const minHeight = lengthOf(read('minHeight'));

    if (min.points !== undefined) {
        node.setMinWidth(min.points);
    }

    if (max.points !== undefined) {
        node.setMaxWidth(max.points);
    } else if (max.percent !== undefined) {
        node.setMaxWidthPercent(max.percent);
    }

    if (minHeight.points !== undefined) {
        node.setMinHeight(minHeight.points);
    }
}

/** A box as the engine laid it out. */
function boxOf(node: Node, offset: { readonly left: number; readonly top: number }): LaidOutBox {
    const { left, top, width, height } = node.getComputedLayout();

    return { left: left + offset.left, top: top + offset.top, width, height };
}

/**
 * Lays the bar out the way React Native's Yoga would, in a container of the given width.
 *
 * @sideEffect Creates and frees native Yoga nodes.
 * @param parts - The rendered parts.
 * @param text - The words and the system text size.
 * @param barWidth - The width the bar is given, in points.
 * @returns Where the message box and Undo's frame land.
 */
export function layOutSnackbar(parts: SnackbarParts, text: TextModel, barWidth: number): SnackbarLayout {
    const config: Config = Yoga.Config.create();
    config.setErrata(Yoga.ERRATA_ALL);
    config.setPointScaleFactor(1);

    const bar = Yoga.Node.create(config);
    const messageBox = Yoga.Node.create(config);
    const actionSlot = Yoga.Node.create(config);
    const actionFrame = Yoga.Node.create(config);
    const label = Yoga.Node.create(config);

    applyStyle(bar, parts.bar);
    applyStyle(messageBox, parts.messageBox);
    applyStyle(actionSlot, parts.actionSlot);
    applyStyle(actionFrame, parts.actionFrame);
    bar.setWidth(barWidth);
    messageBox.setMeasureFunc(textMeasure(text.message, MESSAGE_ROLE, text.systemScale));
    label.setMeasureFunc(textMeasure(text.label, LABEL_ROLE, text.systemScale));
    actionFrame.insertChild(label, 0);
    actionSlot.insertChild(actionFrame, 0);
    bar.insertChild(messageBox, 0);
    bar.insertChild(actionSlot, 1);
    bar.calculateLayout(barWidth, undefined, Yoga.DIRECTION_LTR);

    const slot = boxOf(actionSlot, { left: 0, top: 0 });
    const result: SnackbarLayout = {
        bar: boxOf(bar, { left: 0, top: 0 }),
        messageBox: boxOf(messageBox, { left: 0, top: 0 }),
        actionFrame: boxOf(actionFrame, slot),
    };

    bar.freeRecursive();

    return result;
}
