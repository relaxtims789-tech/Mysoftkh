import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { clientIp } from './auth';

/** One line per API request: method, path, status, duration, user. Query strings are left out (they can hold dates/ids only, but keep logs lean). */
@Injectable()
export class RequestLogger implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (config.isTest) return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const user = (req as any).user?.id ?? '-';
      const path = req.originalUrl.split('?')[0];
      if (config.logFormat === 'json') {
        process.stdout.write(JSON.stringify({ t: new Date().toISOString(), method: req.method, path, status: res.statusCode, ms: Math.round(ms), user, ip: clientIp(req) }) + '\n');
      } else {
        const line = `${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms user=${user}`;
        if (res.statusCode >= 500) this.logger.error(line);
        else if (res.statusCode >= 400) this.logger.warn(line);
        else this.logger.log(line);
      }
    });
    next();
  }
}
