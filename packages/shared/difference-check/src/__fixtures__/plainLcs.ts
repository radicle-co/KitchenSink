/**
 * The textbook longest-common-subsequence table: the oracle for the bit-parallel version, and the yardstick of the cost
 * tripwire. Quadratic in time, so only for short sequences and for measuring.
 *
 * @param first - One token sequence.
 * @param second - The other.
 * @returns The length of the longest common subsequence.
 */
export function plainLcs(first: readonly string[], second: readonly string[]): number {
    let previous = new Array<number>(second.length + 1).fill(0);

    for (const left of first) {
        const row = [0];

        second.forEach((right, column) => {
            row.push(
                left === right ? (previous[column] ?? 0) + 1 : Math.max(previous[column + 1] ?? 0, row[column] ?? 0),
            );
        });
        previous = row;
    }

    return previous[second.length] ?? 0;
}
