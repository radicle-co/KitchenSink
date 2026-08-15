/**
 * THE PIPE-BINDING INVENTORY — an exhaustive audit, over Nest's OWN route metadata, of every request input this
 * service accepts and what validates it.
 *
 * ── WHY REFLECTION AND NOT MORE CASES ──
 *
 * `docs/CODING_STANDARDS.md` §15.4(4) names the trap: **a `createZodDto` class carries NO `class-validator`
 * metadata, so under Nest's own `ValidationPipe` — or under `ZodValidationPipe` bound to the bare class token
 * instead of `APP_PIPE` — every DTO validates NOTHING while looking correctly wired.** `foods.dto.test.ts` proves
 * the DTOs reject bad input when driven through the real zod pipe, and `app.module.test.ts` proves the pipe is
 * bound globally. Both are about the routes that EXIST TODAY.
 *
 * The gap those leave is the next route. A handler added with `@Body() body: SomeInterface`, or with a plain class
 * DTO, or with an un-decorated `@Query()` bag, is invisible to every test above: it type-checks, it reads as
 * validated, and the globally-bound zod pipe passes it straight through because its metatype is not a zod DTO.
 * `@Body() body: unknown` on all three write routes is precisely the shape this service shipped with, and §15.4(3)
 * bans it — but a ban needs an enforcer.
 *
 * So these cases enumerate the handlers from `__routeArguments__` (what Nest itself dispatches on) crossed with
 * `design:paramtypes` (the emitted metatypes the pipe reads), and assert a CLOSED inventory: every body/query
 * parameter is a zod DTO, and every remaining raw input is on an explicit list whose validation is named and
 * behaviourally proven elsewhere. A new route is a failure here until it is either validated or listed.
 *
 * ⚠️ NON-VACUITY IS ASSERTED FIRST, deliberately. This suite reads Nest's internal metadata key, so a Nest upgrade
 * that renamed or relocated it would make every `for` loop below iterate zero times and pass. The first case fails
 * loudly in that world instead.
 *
 * ⚠️ ONE BLIND SPOT, recorded rather than implied: a CUSTOM param decorator registers under its own metadata key,
 * not one of Nest's `RouteParamtypes`, so it does not appear here. `ServiceErasureController`'s `@ServicePrincipal()`
 * is the only one, and it reads a value a GUARD verified and put on the request — not caller-supplied input — so its
 * absence is correct. A future custom decorator that reads the raw request would need adding to `CALLER_SUPPLIED`'s
 * collection, and the param COUNT asserted below is what makes that omission visible.
 *
 * DESIGN PATTERN: Specification over reflected metadata — `inputsOf` is the one parser, and each case is a separate
 * specification over the same collected set, so two cases cannot disagree about what the routes are.
 */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FoodsAdminController } from '../admin/foodsAdmin.controller.js';
import { AddFoodBodyDto, BatchAddFoodBodyDto, ResolveFoodBodyDto, SearchFoodQueryDto } from '../dto/foods.dto.js';
import { FoodsController } from '../foods.controller.js';
import { ServiceErasureController } from '../serviceErasure.controller.js';

/**
 * Nest's `RouteParamtypes` values for the decorators that carry CALLER-SUPPLIED data.
 *
 * Restated locally rather than deep-imported from `@nestjs/common/enums/route-paramtypes.enum` (an internal path),
 * and safe to restate because the non-vacuity case below proves the numbers still line up with reality: if Nest
 * renumbered them, no body/query/param would be found at all and that case fails.
 */
const CALLER_SUPPLIED: Readonly<Record<number, 'body' | 'query' | 'param' | 'headers'>> = {
    3: 'body',
    4: 'query',
    5: 'param',
    6: 'headers',
};

/** One caller-supplied handler parameter, as Nest will hand it to the validation pipe. */
interface RouteInput {
    /** `Controller.method` — the location a failure has to name to be actionable. */
    readonly where: string;
    /** Which decorator carried it. */
    readonly kind: 'body' | 'query' | 'param' | 'headers';
    /** The decorator's argument (`@Param('id')` → `'id'`), when it named one. */
    readonly data: string | undefined;
    /** The emitted metatype — what `ZodValidationPipe` receives as `metadata.metatype`. */
    readonly metatype: unknown;
}

/** A `createZodDto` class: a constructor carrying the zod schema the pipe validates against. */
function isZodDto(metatype: unknown): boolean {
    return typeof metatype === 'function' && (metatype as { schema?: unknown }).schema instanceof z.ZodType;
}

/** The metatype's display name, for the inventory's failure message. `undefined` when nothing was emitted. */
function metatypeName(metatype: unknown): string {
    return typeof metatype === 'function' ? metatype.name : String(metatype);
}

/**
 * Every caller-supplied input across a controller's handlers, read from Nest's own metadata.
 *
 * @param controller - The controller class.
 * @returns One entry per `@Body()`/`@Query()`/`@Param()`/`@Headers()` parameter, in no particular order.
 */
function inputsOf(controller: new (...args: never[]) => object): RouteInput[] {
    const methods = Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');

    return methods.flatMap((method) => {
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
            | Record<string, { index: number; data?: unknown }>
            | undefined;

        if (args === undefined) {
            return [];
        }

        // `design:paramtypes` is per-method on the PROTOTYPE and is what Nest reads to build `metadata.metatype`.
        const paramTypes = (Reflect.getMetadata('design:paramtypes', controller.prototype, method) ?? []) as unknown[];

        return Object.entries(args).flatMap(([key, value]) => {
            const kind = CALLER_SUPPLIED[Number(key.split(':')[0])];

            if (kind === undefined) {
                return [];
            }

            return [
                {
                    where: `${controller.name}.${method}`,
                    kind,
                    data: typeof value.data === 'string' ? value.data : undefined,
                    metatype: paramTypes[value.index],
                },
            ];
        });
    });
}

/** Every HTTP controller in this service. A new controller belongs here — that is the point of a closed audit. */
const CONTROLLERS = [FoodsController, FoodsAdminController, ServiceErasureController] as const;

const ALL_INPUTS = CONTROLLERS.flatMap((controller) => inputsOf(controller));

describe('route input validation — the closed inventory', () => {
    // Read this first. Every case below iterates `ALL_INPUTS`; if the reflection stopped working they would all
    // pass over an empty list. These figures are the tripwire.
    it('reads Nest route metadata at all (guards every other case in this file from vacuity)', () => {
        expect(ALL_INPUTS.length).toBeGreaterThanOrEqual(7);
        expect(ALL_INPUTS.filter((input) => input.kind === 'body')).toHaveLength(3);
        expect(ALL_INPUTS.filter((input) => input.kind === 'query')).toHaveLength(1);
        expect(ALL_INPUTS.filter((input) => input.kind === 'param')).toHaveLength(5);
        // Nothing reads a caller-supplied HEADER. §15.4(1) puts headers under the pipe too, so a new one has to
        // arrive as a zod DTO — and this assertion is what makes adding one a decision rather than an accident.
        expect(ALL_INPUTS.filter((input) => input.kind === 'headers')).toStrictEqual([]);
    });

    it('validates EVERY body and query with a zod DTO — no interface, no plain class, no `unknown`', () => {
        const unvalidated = ALL_INPUTS.filter(
            (input) => (input.kind === 'body' || input.kind === 'query') && !isZodDto(input.metatype),
        ).map((input) => `${input.where} (@${input.kind}) metatype=${String(input.metatype)}`);

        // `@Body() body: unknown` emits `Object` as its metatype, which `ZodValidationPipe` passes straight
        // through — the exact shape all three write routes shipped with, and what §15.4(3) bans.
        expect(unvalidated).toStrictEqual([]);
    });

    /**
     * THE RAW-INPUT LIST. A `@Param('id')` is a bare `String`, so the zod pipe passes it through by design (the
     * pipe is bound NON-strict precisely so it does — see `app.module.ts`), which means each one needs validation
     * of its own. Every entry here is validated by `FoodsController.requireId` → `isFoodId`, and each rejection is
     * proven behaviourally in `foods.controller.test.ts` (400 `INVALID_ID`, service never called).
     *
     * ⚠️ The list is EXHAUSTIVE AND EXACT, not a subset: a new raw parameter fails this case until its author adds
     * it here, which is the moment they have to say what validates it.
     *
     * Why the ids are not pipe-validated instead: FR-051 requires `403` to precede `400` on `POST
     * /{id}/refetch`, and a pipe runs BEFORE the handler that checks the `food:admin` scope — so moving id
     * validation into a DTO would invert that precedence. Recorded as the reason, not as an excuse: if the scope
     * check ever becomes a guard (guards run before pipes), the ids should become a DTO.
     */
    it('lists every raw (non-DTO) input explicitly, with its validator named', () => {
        const raw = ALL_INPUTS.filter((input) => !isZodDto(input.metatype))
            .map((input) => `${input.where}(@${input.kind} ${input.data ?? '*'}): ${metatypeName(input.metatype)}`)
            .sort();

        expect(raw).toStrictEqual([
            'FoodsController.getCandidates(@param id): String',
            'FoodsController.getFood(@param id): String',
            'FoodsController.getStatus(@param id): String',
            'FoodsController.patchResolve(@param id): String',
            'FoodsController.refetch(@param id): String',
        ]);
    });

    /**
     * THE TRAP, asserted for EVERY DTO rather than one of them.
     *
     * Without this the whole DTO suite would still pass if `AppModule`'s pipe were swapped for Nest's own — each
     * case there constructs `ZodValidationPipe` explicitly. This states why that substitution is not available:
     * there is no `class-validator` metadata for Nest's pipe to find, so it would validate nothing at all.
     */
    it.each([
        ['AddFoodBodyDto', AddFoodBodyDto],
        ['BatchAddFoodBodyDto', BatchAddFoodBodyDto],
        ['ResolveFoodBodyDto', ResolveFoodBodyDto],
        ['SearchFoodQueryDto', SearchFoodQueryDto],
    ])('%s carries NO class-validator metadata, and DOES carry its zod schema', (_label, dto) => {
        const metadataKeys = Reflect.getMetadataKeys(dto) as unknown[];

        expect(metadataKeys.some((key) => String(key).includes('class-validator'))).toBe(false);
        expect(isZodDto(dto)).toBe(true);
    });
});
