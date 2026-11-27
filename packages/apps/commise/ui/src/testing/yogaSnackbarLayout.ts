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

/** The sizes of the text, which a layout engine cannot measure without a font. */
interface TextModel {
    /** Characters in the message. */
    readonly messageLength: number;
    /** Characters in Undo's label. */
    readonly labelLength: number;
    /** The system text scale, already capped. */
    readonly scale: number;
}

/** The result. */
export interface SnackbarLayout {
    readonly bar: LaidOutBox;
    readonly messageBox: LaidOutBox;
    /** The action's frame, in the bar's coordinates. */
    readonly actionFrame: LaidOutBox;
}

/** Half an em: the average width of a glyph. A model, since a test has no font to measure. */
const GLYPH_EM = 0.5;
const BODY_PT = 16;
const BODY_LINE_PT = 24;

/** Reads a length: `auto` and an unset value answer `undefined`. */
function lengthOf(value: string): { readonly points?: number; readonly percent?: number } {
    if (value === '' || value === 'auto' || value === 'none' || value === 'normal') {
        return {};
    }

    const number = Number.parseFloat(value);

    return value.endsWith('%') ? { percent: number } : { points: number };
}

/** A text measure: wraps by characters at the available width, as a paragraph does. */
function textMeasure(length: number, scale: number): Parameters<Node['setMeasureFunc']>[0] {
    const glyph = BODY_PT * scale * GLYPH_EM;
    const line = BODY_LINE_PT * scale;

    return (width) => {
        const whole = length * glyph;
        const fit = Math.min(Number.isFinite(width) ? width : whole, whole);
        const lines = Math.max(1, Math.ceil(whole / Math.max(fit, glyph)));

        return { width: fit, height: lines * line };
    };
}

/** Applies the flex style the parts declare to a node. */
function applyStyle(node: Node, element: HTMLElement): void {
    const read = (property: Parameters<typeof resolvedStyle>[1]): string => resolvedStyle(element, property);

    node.setFlexDirection(read('flexDirection') === 'row' ? Yoga.FLEX_DIRECTION_ROW : Yoga.FLEX_DIRECTION_COLUMN);
    node.setFlexWrap(read('flexWrap') === 'wrap' ? Yoga.WRAP_WRAP : Yoga.WRAP_NO_WRAP);
    node.setAlignItems(read('alignItems') === 'center' ? Yoga.ALIGN_CENTER : Yoga.ALIGN_STRETCH);
    node.setJustifyContent(read('justifyContent') === 'center' ? Yoga.JUSTIFY_CENTER : Yoga.JUSTIFY_FLEX_START);
    node.setFlexGrow(Number.parseFloat(read('flexGrow')) || 0);
    node.setFlexShrink(Number.parseFloat(read('flexShrink')));
    node.setGap(Yoga.GUTTER_COLUMN, Number.parseFloat(read('columnGap')) || 0);

    const edges = [
        [Yoga.EDGE_LEFT, 'paddingLeft'],
        [Yoga.EDGE_RIGHT, 'paddingRight'],
        [Yoga.EDGE_TOP, 'paddingTop'],
        [Yoga.EDGE_BOTTOM, 'paddingBottom'],
    ] as const;

    for (const [edge, property] of edges) {
        node.setPadding(edge, Number.parseFloat(read(property)) || 0);
    }

    if (read('marginLeft') === 'auto') {
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
 * @param text - The text sizes.
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
    messageBox.setMeasureFunc(textMeasure(text.messageLength, text.scale));
    label.setMeasureFunc(textMeasure(text.labelLength, text.scale));
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
