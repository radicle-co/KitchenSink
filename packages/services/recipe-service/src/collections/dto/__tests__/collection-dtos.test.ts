/**
 * The collections vertical's request DTOs are the AUTHORED zod contract, wired into Nest through
 * `nestjs-zod`'s `createZodDto`. These tests drive the REAL pipe — the one an inbound request goes
 * through — rather than the schemas directly, because a schema that is correct but unwired validates
 * nothing. They also replace `common/pipes/__tests__/zod-validation.pipe.test.ts`, whose
 * collections-specific coverage moves here verbatim now that the hand-rolled pipe is gone.
 *
 * THREE PROPERTIES CARRY MOST OF THE VALUE, and each is written to fail if the seam regresses:
 *
 *  1. **The DTO and the published schema are the SAME object** (`Dto.schema === …Schema`). This is the
 *     anti-drift assertion: `@kitchensink/schema-recipe` publishes those schemas verbatim, so identity
 *     makes it impossible to validate one shape server-side and publish another.
 *  2. **The wholly-optional bodies tolerate an ABSENT body.** `clone` and `pull-from-source` are callable
 *     with no payload at all (FR-011 / W8-a.8). That used to need a bespoke `optionalBody` wrapper around
 *     a hand-rolled pipe; it is now `.default({})` on the schema itself, which is both the enforcement AND
 *     what the published document says. The `undefined` cases below are what keep that true.
 *  3. **An empty-string `description` is a `400`, not a stored empty description.** The request bound and
 *     `@kitchensink/recipe-core`'s `collectionSchema` (which every collection-returning client method
 *     parses with) now agree at `min(1)`. Before they disagreed: the server accepted `''`, stored it, and
 *     echoed it back into a client parse that rejects it — a body the server could send and no client
 *     could read.
 */
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from 'nestjs-zod';
import type { ArgumentMetadata } from '@nestjs/common';

import { AddRecipeToCollectionDto } from '../add-recipe-to-collection.dto.js';
import { CloneCollectionDto } from '../clone-collection.dto.js';
import { CreateCollectionDto } from '../create-collection.dto.js';
import { ListCollectionsQueryDto } from '../list-collections.query.dto.js';
import { PullFromSourceDto } from '../pull-from-source.dto.js';
import { UpdateCollectionDto } from '../update-collection.dto.js';
import {
    MAX_COLLECTION_DESCRIPTION_LENGTH,
    MAX_COLLECTION_NAME_LENGTH,
    addRecipeToCollectionRequestSchema,
    cloneCollectionRequestSchema,
    createCollectionRequestSchema,
    listCollectionsQuerySchema,
    pullFromSourceRequestSchema,
    updateCollectionRequestSchema,
} from '../../collections.schema.js';

const pipe = new ZodValidationPipe();

const A_RECIPE_ID = '00000000-0000-4000-8000-000000000001';
const ANOTHER_RECIPE_ID = '00000000-0000-4000-8000-000000000002';

/** Build the `ArgumentMetadata` Nest hands a pipe for the given DTO class at the given binding. */
function metadata(metatype: unknown, type: ArgumentMetadata['type']): ArgumentMetadata {
    return { type, metatype } as ArgumentMetadata;
}

/** Run a body through the real pipe for the given DTO. */
function body(metatype: unknown, value: unknown): unknown {
    return pipe.transform(value, metadata(metatype, 'body'));
}

/** Run a query bag through the real pipe for the given DTO. */
function query(metatype: unknown, value: unknown): unknown {
    return pipe.transform(value, metadata(metatype, 'query'));
}

describe('CreateCollectionDto', () => {
    it('IS the published create schema, so the contract cannot be validated one way and published another', () => {
        expect(CreateCollectionDto.schema).toBe(createCollectionRequestSchema);
    });

    it('accepts a name-only body — description and visibility are optional (visibility defaults server-side)', () => {
        expect(body(CreateCollectionDto, { name: 'Weeknight Dinners' })).toEqual({ name: 'Weeknight Dinners' });
    });

    it('accepts a fully-specified body', () => {
        expect(body(CreateCollectionDto, { name: 'Bakes', description: 'Sweet things', visibility: 'public' })).toEqual(
            {
                name: 'Bakes',
                description: 'Sweet things',
                visibility: 'public',
            },
        );
    });

    it('rejects an empty name', () => {
        expect(() => body(CreateCollectionDto, { name: '' })).toThrow();
    });

    it('rejects a missing name', () => {
        expect(() => body(CreateCollectionDto, {})).toThrow();
    });

    it('rejects a name over the length cap', () => {
        expect(() => body(CreateCollectionDto, { name: 'x'.repeat(MAX_COLLECTION_NAME_LENGTH + 1) })).toThrow();
    });

    it('accepts a name exactly at the cap — the bound is inclusive, so the test would fail an off-by-one', () => {
        const name = 'x'.repeat(MAX_COLLECTION_NAME_LENGTH);

        expect(body(CreateCollectionDto, { name })).toEqual({ name });
    });

    it('rejects an EMPTY-STRING description — the server must not store a description no client can parse', () => {
        expect(() => body(CreateCollectionDto, { name: 'Bakes', description: '' })).toThrow();
    });

    it('rejects a description over the length cap', () => {
        expect(() =>
            body(CreateCollectionDto, {
                name: 'Bakes',
                description: 'x'.repeat(MAX_COLLECTION_DESCRIPTION_LENGTH + 1),
            }),
        ).toThrow();
    });

    it('rejects an unknown visibility literal', () => {
        expect(() => body(CreateCollectionDto, { name: 'Bakes', visibility: 'unlisted' })).toThrow();
    });

    // Was a STRIP assertion. The body is `z.strictObject` per GR-017 §17-c, so it is a `400`. Ownership still
    // comes from the verified token under either behaviour; the change is that the caller is told the field was
    // refused instead of receiving a `201` for a collection owned by someone other than the id they sent.
    it('REFUSES an ownerId a client tried to smuggle in — ownership comes from the verified token only', () => {
        expect(() => body(CreateCollectionDto, { name: 'Bakes', ownerId: 'someone-elses-ulid' })).toThrow();
        // The counterpart, so the rejection is not satisfied by a schema that refuses everything.
        expect(body(CreateCollectionDto, { name: 'Bakes' })).toEqual({ name: 'Bakes' });
    });
});

describe('UpdateCollectionDto', () => {
    it('IS the published update schema', () => {
        expect(UpdateCollectionDto.schema).toBe(updateCollectionRequestSchema);
    });

    it('accepts a single-field patch', () => {
        expect(body(UpdateCollectionDto, { name: 'Renamed' })).toEqual({ name: 'Renamed' });
    });

    it('rejects an EMPTY patch, naming the rule — a PATCH that changes nothing is a client bug, not a no-op', () => {
        try {
            body(UpdateCollectionDto, {});
            expect.unreachable('the empty patch should have been rejected');
        } catch (error) {
            expect(JSON.stringify(error)).toContain('At least one field must be provided.');
        }
    });

    /**
     * Rejected before AND after the `z.strictObject` sweep — but for a DIFFERENT, better reason, and the
     * improvement is worth pinning because it is a diagnostic one.
     *
     * It used to be stripped to `{}` and then rejected by the `.refine()`, so the caller was told "At least one
     * field must be provided" while having provided one. It is now an `unrecognized_keys` issue naming
     * `nickname`, which is what a caller can act on.
     */
    it('rejects a patch whose only key is unknown, and now says WHICH key rather than "provide a field"', () => {
        expect(() => body(UpdateCollectionDto, { nickname: 'nope' })).toThrow();

        let issues: readonly { readonly code?: string; readonly keys?: readonly string[] }[] = [];

        try {
            body(UpdateCollectionDto, { nickname: 'nope' });
        } catch (thrown) {
            const response = (thrown as { getResponse: () => unknown }).getResponse() as {
                errors?: readonly { readonly code?: string; readonly keys?: readonly string[] }[];
            };

            issues = response.errors ?? [];
        }

        expect(issues.flatMap((issue) => issue.keys ?? [])).toStrictEqual(['nickname']);
        expect(JSON.stringify(issues)).not.toContain('At least one field must be provided.');
    });

    it('rejects an unknown visibility literal', () => {
        expect(() => body(UpdateCollectionDto, { visibility: 'unlisted' })).toThrow();
    });

    it('accepts a visibility-only patch', () => {
        expect(body(UpdateCollectionDto, { visibility: 'public' })).toEqual({ visibility: 'public' });
    });

    it('rejects an empty-string description, exactly as create does', () => {
        expect(() => body(UpdateCollectionDto, { description: '' })).toThrow();
    });
});

describe('AddRecipeToCollectionDto', () => {
    it('IS the published add-recipe schema', () => {
        expect(AddRecipeToCollectionDto.schema).toBe(addRecipeToCollectionRequestSchema);
    });

    it('accepts a uuid recipeId', () => {
        expect(body(AddRecipeToCollectionDto, { recipeId: A_RECIPE_ID })).toEqual({ recipeId: A_RECIPE_ID });
    });

    it('rejects a non-uuid recipeId', () => {
        expect(() => body(AddRecipeToCollectionDto, { recipeId: 'not-a-uuid' })).toThrow();
    });

    it('rejects a missing recipeId', () => {
        expect(() => body(AddRecipeToCollectionDto, {})).toThrow();
    });
});

describe('ListCollectionsQueryDto', () => {
    it('IS the published list-query schema', () => {
        expect(ListCollectionsQueryDto.schema).toBe(listCollectionsQuerySchema);
    });

    it('applies the pagination defaults for an empty query', () => {
        expect(query(ListCollectionsQueryDto, {})).toEqual({ page: 1, pageSize: 20 });
    });

    it('coerces page/pageSize query STRINGS to numbers — a query bag is always strings on the wire', () => {
        expect(query(ListCollectionsQueryDto, { page: '2', pageSize: '5' })).toEqual({ page: 2, pageSize: 5 });
    });

    it('rejects a pageSize over the cap', () => {
        expect(() => query(ListCollectionsQueryDto, { pageSize: '500' })).toThrow();
    });

    it('rejects a page below 1', () => {
        expect(() => query(ListCollectionsQueryDto, { page: '0' })).toThrow();
    });

    it('rejects a non-numeric page', () => {
        expect(() => query(ListCollectionsQueryDto, { page: 'first' })).toThrow();
    });

    it('rejects a fractional pageSize rather than silently truncating it', () => {
        expect(() => query(ListCollectionsQueryDto, { pageSize: '2.5' })).toThrow();
    });
});

describe('CloneCollectionDto', () => {
    it('IS the published clone schema', () => {
        expect(CloneCollectionDto.schema).toBe(cloneCollectionRequestSchema);
    });

    it('tolerates an ABSENT body — a plain clone inherits the source’s name/description (FR-011)', () => {
        expect(body(CloneCollectionDto, undefined)).toEqual({});
    });

    it('tolerates an EMPTY body, which Express also produces for a bodyless POST', () => {
        expect(body(CloneCollectionDto, {})).toEqual({});
    });

    it('accepts name/description overrides', () => {
        expect(body(CloneCollectionDto, { name: 'My copy', description: 'Mine now' })).toEqual({
            name: 'My copy',
            description: 'Mine now',
        });
    });

    it('applies the SAME name cap as create — a clone can never carry a name create would have rejected', () => {
        expect(() => body(CloneCollectionDto, { name: 'x'.repeat(MAX_COLLECTION_NAME_LENGTH + 1) })).toThrow();
    });

    it('rejects an empty override name rather than cloning to a nameless collection', () => {
        expect(() => body(CloneCollectionDto, { name: '' })).toThrow();
    });
});

describe('PullFromSourceDto', () => {
    it('IS the published pull-commit schema', () => {
        expect(PullFromSourceDto.schema).toBe(pullFromSourceRequestSchema);
    });

    it('tolerates an ABSENT body — no echoed diff means apply directly, with no drift guard (W8-a.8)', () => {
        expect(body(PullFromSourceDto, undefined)).toEqual({});
    });

    it('accepts an echoed previewedDiff', () => {
        const previewedDiff = { added: [A_RECIPE_ID], removed: [], unchanged: [ANOTHER_RECIPE_ID] };

        expect(body(PullFromSourceDto, { previewedDiff })).toEqual({ previewedDiff });
    });

    it('rejects a previewedDiff missing a bucket — a partial diff cannot be compared for drift', () => {
        expect(() => body(PullFromSourceDto, { previewedDiff: { added: [A_RECIPE_ID] } })).toThrow();
    });

    it('rejects a previewedDiff whose bucket is not an array of strings', () => {
        expect(() => body(PullFromSourceDto, { previewedDiff: { added: [1], removed: [], unchanged: [] } })).toThrow();
    });
});
