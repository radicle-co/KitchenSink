/**
 * Trim, from both ends of a phrase, every character `isEdge` accepts.
 *
 * A scan, not a regex: `/[x]+$/` retries from every character of a long run, which is quadratic on text an
 * engine controls (CodeQL `js/polynomial-redos`).
 *
 * @param text - A phrase, as an engine wrote it.
 * @param isEdge - Whether one character is an edge to trim.
 * @returns The phrase without an edge character at either end. Pure.
 */
export function trimEdges(text: string, isEdge: (character: string) => boolean): string {
    const characters = Array.from(text);
    let start = 0;
    let end = characters.length;

    while (start < end && isEdge(characters[start] ?? '')) {
        start += 1;
    }

    while (end > start && isEdge(characters[end - 1] ?? '')) {
        end -= 1;
    }

    return characters.slice(start, end).join('');
}
