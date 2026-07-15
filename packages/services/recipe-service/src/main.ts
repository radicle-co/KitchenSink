import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { buildCorsOptions } from './config/cors.js';

/** Parse a comma-separated env allowlist into trimmed, non-empty entries (mirrors identity's parser). */
function parseCommaList(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    // Cross-origin browser calls from the web app need CORS; reuse the Clerk authorized-parties allowlist
    // as the origin allowlist (same trust boundary), mirroring the identity service. See config/cors.ts.
    app.enableCors(buildCorsOptions(parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES'])));

    await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
