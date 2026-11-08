/** A process environment, as the planning code reads it: values may be absent. Declared once. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * An environment for a child process (`spawn`, `execFile`).
 *
 * Node types those options as `NodeJS.ProcessEnv`, which some packages tighten (Next's types require `NODE_ENV`), so an
 * {@link Env} does not assign to it. The one cast lives here instead of at every call.
 *
 * @param env - The environment to give the child.
 * @returns A copy.
 */
export const processEnv = (env: Env): NodeJS.ProcessEnv => ({ ...env }) as NodeJS.ProcessEnv;
