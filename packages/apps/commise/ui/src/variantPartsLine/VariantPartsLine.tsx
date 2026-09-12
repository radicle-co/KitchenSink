/**
 * @module @commise/ui/variant-parts-line — the web line that shows a variant's parts with a middle dot between them
 * (`docs/design/ingredientSpecialization.md` §S4).
 *
 * The rules live here once, so no surface can regress on one of them:
 * - The parts keep wire order. The screen shows no comma; a visually hidden `,` after each dot makes a screen reader
 *   hear `flat half, select, braised`.
 * - The no-break space sits inside the hidden dot's span, so a dot never starts a line. Browsers compute the heard
 *   text as `flat half , select`: the hidden comma is laid out as a block, so a space comes before it. The space is
 *   not audible. A test finds a control by its own explicit name, never by a name built from this line.
 * - A measurement token (`1/8-inch`) is `nowrap`, so it never splits at its hyphen. Other words wrap at spaces, and
 *   `break-words` breaks an unbroken string only when it overflows. ⛔ Not `overflow-wrap: anywhere`: it lowers the
 *   line's minimum width, so in a flex row with no `min-w-0` the host column shrank to 71 px, the no-break space broke,
 *   and a dot started a line (E2 I8). A primitive must survive hosts it does not know.
 * - Each part is `lang="en"`: catalog text is English beside translated interface text (WCAG 3.1.2).
 * - ⛔ Nothing truncates: no clamp, no ellipsis, no maximum height.
 *
 * A presentational leaf: the caller maps the wire parts to their text and places the line.
 *
 * @pattern Value Object contract (`VariantPartsLineProps`) rendered as a pure `props → JSX` leaf, over the
 *   `isMeasurementToken` Specification it shares with the native leaf
 */
import { Fragment, type FC } from 'react';

import type { VariantPartsLineProps, VariantPartsTone } from './props.js';
import { PART_SEPARATOR, partRuns } from './variantPartsText.js';

const TONE_CLASS: Readonly<Record<VariantPartsTone, string>> = {
    // `slate` on white is 5.24:1.
    secondary: 'text-body-sm text-slate',
    primary: 'text-body-md text-charcoal',
};

/** The dotted line: phrasing content, so it fits inside a button, an option or a sentence. The caller places it. */
export const VariantPartsLine: FC<VariantPartsLineProps> = ({ parts, tone }) => (
    <span className={`break-words ${TONE_CLASS[tone]}`}>
        {parts.map((part, index) => (
            // The parts are never reordered and a label can repeat, so a part's position is its identity.
            <Fragment key={index}>
                {index === 0 ? null : (
                    <>
                        {/* The dot takes the text colour: `mist` is 1.90:1, and the dot does the separating. */}
                        <span aria-hidden="true">{PART_SEPARATOR}</span>
                        <span className="sr-only">,</span>{' '}
                    </>
                )}
                <span lang="en">
                    {partRuns(part).map((run, runIndex) =>
                        run.measurement ? (
                            <span key={runIndex} className="whitespace-nowrap">
                                {run.text}
                            </span>
                        ) : (
                            <Fragment key={runIndex}>{run.text}</Fragment>
                        ),
                    )}
                </span>
            </Fragment>
        ))}
    </span>
);
