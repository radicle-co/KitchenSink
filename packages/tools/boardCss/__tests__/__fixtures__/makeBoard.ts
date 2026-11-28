/** A board for a test: the given `<style>` text, body and script, in the shape the builders write. */
interface BoardParts {
    readonly css: string;
    readonly body: string;
    readonly script: string;
}

export function makeBoard(overrides: Partial<BoardParts> = {}): string {
    const { css, body, script }: BoardParts = { css: '', body: '<div class="used">x</div>', script: '', ...overrides };

    return `<html><head><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;
}
