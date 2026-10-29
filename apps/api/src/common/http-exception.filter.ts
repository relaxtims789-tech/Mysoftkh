import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

/** Every error leaves the API as { statusCode, code, message, details? }; internals are logged, never returned. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { statusCode: status, code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { statusCode: status, code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'object' && r && 'code' in r) {
        body = r as Record<string, unknown>;
      } else {
        const raw = typeof r === 'string' ? r : (r as any)?.message;
        // class-validator returns an array of messages
        const message = Array.isArray(raw) ? raw[0] : raw || exception.message;
        body = {
          statusCode: status,
          code: status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'NOT_FOUND' : status === 413 ? 'TOO_LARGE' : `HTTP_${status}`,
          message: status === 404 && !Array.isArray(raw) && /^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(String(message)) ? 'Not found.' : message,
          ...(Array.isArray(raw) && raw.length > 1 ? { details: { errors: raw } } : {}),
        };
      }
    } else if ((exception as any)?.type === 'entity.parse.failed') {
      status = HttpStatus.BAD_REQUEST;
      body = { statusCode: status, code: 'INVALID_JSON', message: 'The request body is not valid JSON.' };
    } else {
      this.logger.error(`${req.method} ${req.originalUrl}: ${(exception as Error)?.stack || exception}`);
    }

    res.status(status).json(body);
  }
}
