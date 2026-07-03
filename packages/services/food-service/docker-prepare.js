import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkgPath = join(__dirname, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

// The dev package.json exports ./src (so consumers typecheck/test/bundle against source without a
// prior build); the runtime image needs the built ./dist instead, so rewrite every ./src export to the
// compiled ./dist path. nest build preserves the `src/` segment (outDir=dist, rootDir="."), so the
// entrypoint lives at ./dist/src/main.js — matching the ECS task command in food-service-stack.ts.
const rewrittenExports = {};
for (const [key, value] of Object.entries(pkg.exports || {})) {
    if (typeof value === 'string' && value.startsWith('./src/')) {
        rewrittenExports[key] = value.replace(/^\.\/src\//, './dist/src/').replace(/\.ts$/, '.js');
    } else {
        rewrittenExports[key] = value;
    }
}

const productionPkg = {
    ...pkg,
    exports: rewrittenExports,
    main: './dist/src/main.js',
    types: './dist/src/main.d.ts',
};

Reflect.deleteProperty(productionPkg, 'devDependencies');
Reflect.deleteProperty(productionPkg, 'scripts');

const outPath = join(__dirname, 'prod.package.json');
writeFileSync(outPath, JSON.stringify(productionPkg, null, 4) + '\n');
console.log(`Wrote production package.json to ${outPath}`);
