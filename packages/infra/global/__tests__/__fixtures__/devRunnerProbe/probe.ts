/**
 * The fixture `serviceDevRunner.test.ts` points each candidate dev runner at.
 *
 * It reproduces, in the smallest form that can still fail, BOTH properties this monorepo needs from a local
 * runner — and it reports them as data rather than asserting, so the gate can fire the same probe at a
 * runner it expects to PASS and at one it expects to FAIL:
 *
 * 1. **Raw-TypeScript workspace resolution.** `@kitchensink/schema-recipe` maps `"."` to `./src/index.ts`
 *    (ADR-0014 — only `prod.package.json` points at `dist`). A runner that hands the file to plain `node`
 *    dies here with `ERR_MODULE_NOT_FOUND`, which is how `nest start` fails.
 * 2. **`emitDecoratorMetadata`.** `Consumer` takes its dependency by TYPE, with no `@Inject()` — exactly how
 *    NestJS providers are normally written. If the runner drops `design:paramtypes`, `paramTypes` comes back
 *    `undefined` and Nest would resolve that parameter as `undefined` at boot, which is how `tsx` fails.
 *
 * ⚠️ Do not add an assertion here. The negative control depends on this file exiting 0 while REPORTING the
 * defect; a probe that threw would make "the runner is broken" and "the probe is broken" indistinguishable.
 */
import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { CONTRACT_HASH } from '@kitchensink/schema-recipe';

@Injectable()
class Dependency {}

@Injectable()
class Consumer {
    public constructor(public readonly dependency: Dependency) {}
}

const reflected: unknown = Reflect.getMetadata('design:paramtypes', Consumer);

process.stdout.write(
    JSON.stringify({
        paramTypes: Array.isArray(reflected) ? reflected.length : undefined,
        resolvedWorkspaceImport: typeof CONTRACT_HASH === 'string' && CONTRACT_HASH.length > 0,
    }),
);
