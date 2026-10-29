import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine code; the client shows `message` to the user. */
export class AppError extends HttpException {
  constructor(status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super({ statusCode: status, code, message, ...(details ? { details } : {}) }, status);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) =>
  new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const unauthorized = (message = 'Please sign in again.', code = 'UNAUTHORIZED') => new AppError(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (message = 'You do not have permission to do this.', code = 'FORBIDDEN') => new AppError(HttpStatus.FORBIDDEN, code, message);
export const notFound = (what = 'Record') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: Record<string, unknown>) =>
  new AppError(HttpStatus.CONFLICT, code, message, details);

/** Maps a Postgres unique violation to a friendly 409. */
export function rethrowUnique(e: unknown, message: string): never {
  if ((e as any)?.code === '23505') throw conflict(message, 'DUPLICATE');
  throw e;
}
