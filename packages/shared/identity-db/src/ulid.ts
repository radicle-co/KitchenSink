import { isValid, ulid } from 'ulidx';

export type UserId = string & { __brand: 'UserId' };

export const newUserId = (): UserId => ulid() as UserId;

export const isUserId = (s: string): s is UserId => isValid(s);
