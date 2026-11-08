/** A process environment, as the planning code reads it: values may be absent. Declared once. */
export type Env = Readonly<Record<string, string | undefined>>;
