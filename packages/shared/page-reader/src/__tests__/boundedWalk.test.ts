import { describe, expect, it } from 'vitest';

import { boundedWalk } from '../boundedWalk.js';
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from '../pageCaps.js';

interface Tree {
    readonly id: string;
    readonly kids: readonly Tree[];
}

const leaf = (id: string): Tree => ({ id, kids: [] });

/** A chain of `length` nodes: `n0` at depth 0, each the only child of the one before. */
function chain(length: number): Tree {
    let node = leaf(`n${length - 1}`);

    for (let index = length - 2; index >= 0; index -= 1) {
        node = { id: `n${index}`, kids: [node] };
    }

    return node;
}

/** Walk `roots`, descending into every node's kids, and say what was visited and at what depth. */
function walk(roots: readonly Tree[], startDepth?: number) {
    const visited: string[] = [];
    const outcome = boundedWalk(
        roots,
        (node, depth) => {
            visited.push(`${node.id}@${depth}`);

            return node.kids;
        },
        { startDepth },
    );

    return { visited, ...outcome };
}

describe('boundedWalk', () => {
    it('visits depth first, in order, each node at its depth', () => {
        const tree: Tree = { id: 'a', kids: [{ id: 'b', kids: [leaf('c')] }, leaf('d')] };

        expect(walk([tree, leaf('e')])).toEqual({ visited: ['a@0', 'b@1', 'c@2', 'd@1', 'e@0'], truncated: false });
    });

    it('visits nothing and is not truncated for no roots', () => {
        expect(walk([])).toEqual({ visited: [], truncated: false });
    });

    it('is not truncated by a walk of exactly the node cap', () => {
        const roots = Array.from({ length: MAX_WALK_NODES }, (_, index) => leaf(`r${index}`));

        const { visited, truncated } = walk(roots);

        expect(visited).toHaveLength(MAX_WALK_NODES);
        expect(truncated).toBe(false);
    });

    it('stops at the node cap and says so when one more node is left', () => {
        const roots = Array.from({ length: MAX_WALK_NODES + 1 }, (_, index) => leaf(`r${index}`));

        const { visited, truncated } = walk(roots);

        expect(visited).toHaveLength(MAX_WALK_NODES);
        expect(visited[MAX_WALK_NODES - 1]).toBe(`r${MAX_WALK_NODES - 1}@0`);
        expect(truncated).toBe(true);
    });

    it('stops at a raised node cap, not the default', () => {
        const roots = Array.from({ length: MAX_WALK_NODES + 1 }, (_, index) => leaf(`r${index}`));
        let visited = 0;

        const count = (): readonly Tree[] => {
            visited += 1;

            return [];
        };

        expect(boundedWalk(roots, count, { maxNodes: MAX_WALK_NODES + 1 }).truncated).toBe(false);
        expect(visited).toBe(MAX_WALK_NODES + 1);
        expect(boundedWalk(roots, () => [], { maxNodes: MAX_WALK_NODES }).truncated).toBe(true);
    });

    it('is not truncated by a chain that reaches exactly the depth cap', () => {
        const { visited, truncated } = walk([chain(MAX_WALK_DEPTH + 1)]);

        expect(visited).toHaveLength(MAX_WALK_DEPTH + 1);
        expect(truncated).toBe(false);
    });

    it('skips a node past the depth cap, says so, and carries on with its siblings', () => {
        const tooDeep: Tree = { id: 'deep', kids: [chain(MAX_WALK_DEPTH + 2)] };
        const { visited, truncated } = walk([tooDeep, leaf('after')]);

        expect(visited).toContain('after@0');
        expect(visited).not.toContain(`n${MAX_WALK_DEPTH}@${MAX_WALK_DEPTH + 1}`);
        expect(visited).toHaveLength(MAX_WALK_DEPTH + 2);
        expect(truncated).toBe(true);
    });

    it('starts the roots at the depth it is given', () => {
        expect(walk([{ id: 'a', kids: [leaf('b')] }], MAX_WALK_DEPTH)).toEqual({
            visited: [`a@${MAX_WALK_DEPTH}`],
            truncated: true,
        });
    });
});
