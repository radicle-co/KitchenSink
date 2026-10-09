/**
 * @module @commise/features-recipes/form — splitting pasted text into recipe steps (`docs/design/uiOverhaul/buildSpec.md`
 * §7.6). Shared by the web and native Paste steps sheets, so both read the same paste the same way.
 *
 * Pure and platform-agnostic: no React, no platform APIs.
 */

/**
 * A step number at the start of a line: digits, then `.`, `)` or `-`, then a space or the end of the line. The space
 * is what keeps `1.5 cups flour` and `2 eggs` out: an amount is followed by a digit or a word, never by a marker and a
 * space.
 */
const STEP_MARKER = /^\s*\d+\s*[.)-](?:\s+|$)/u;

/**
 * Split pasted text into step instructions: at blank lines and at a leading step number ("1.", "2)", "3 -"). A single
 * line break inside a step is kept, the marker is dropped, each step is trimmed, and empty steps are dropped. Pure.
 *
 * @param text - The pasted text, with any line endings.
 * @returns The steps, in order; empty when the text holds none.
 */
export function splitPastedSteps(text: string): string[] {
    const steps: string[][] = [];
    let current: string[] = [];

    const close = (): void => {
        if (current.length > 0) {
            steps.push(current);
        }

        current = [];
    };

    for (const line of text.split(/\r\n|\r|\n/u)) {
        if (line.trim() === '') {
            close();
        } else if (STEP_MARKER.test(line)) {
            close();
            current.push(line.replace(STEP_MARKER, ''));
        } else {
            current.push(line);
        }
    }

    close();

    return steps.map((lines) => lines.join('\n').trim()).filter((step) => step !== '');
}
