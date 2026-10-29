import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { config } from './config';
import { ensureSuperAdmin, runMigrations } from './database/migrate';
import { prepareDemoData } from './database/demo-data';
import { DemoService } from './modules/demo/demo.module';

/** Express-level setup shared by the server and the integration tests. */
export function configureApp(app: NestExpressApplication) {
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy === 'true');
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          // telegram-web-app.js is loaded only when the app runs as a Telegram Mini App.
          'script-src': ["'self'", 'https://telegram.org'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
          'connect-src': ["'self'"],
          'worker-src': ["'self'", 'blob:'],
          'media-src': ["'self'", 'blob:'],
          // Telegram Web shows Mini Apps in a frame; nobody else may frame the app.
          'frame-ancestors': ['https://web.telegram.org'],
          // ABA PayWay hosted checkout: the billing page posts a signed form there.
          'form-action': ["'self'", 'https://*.payway.com.kh', 'https://*.ababank.com'],
          'upgrade-insecure-requests': config.publicUrl.startsWith('https://') ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // Framing is controlled by frame-ancestors above (X-Frame-Options cannot allow one outside site).
      frameguard: false,
      // OpenStreetMap refuses map tiles requested without a Referer ("Access blocked"); send only our origin.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: config.publicUrl.startsWith('https://'),
    }),
  );
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    next();
  });
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '5mb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();
}

function setupDocs(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('MySoft QR and Phones Attendance API')
    .setDescription('Staff attendance with printed branch QR codes, employee smartphones, GPS geofencing and device binding. See docs/API.md for the scan flow.')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs/openapi.json' });
}

/** Serves uploaded images and the built web app (admin dashboard + employee PWA) from the same origin. */
function serveStatic(app: NestExpressApplication) {
  const server = app.getHttpAdapter().getInstance() as express.Express;
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  server.use('/uploads', express.static(config.uploadsDir, { immutable: true, maxAge: '365d', index: false, dotfiles: 'deny' }));

  const index = path.join(config.webDist, 'index.html');
  if (!fs.existsSync(index)) {
    new Logger('Web').warn(`Web app not built (${index} missing). Run "npm run build" at the repository root.`);
    return;
  }
  server.use(
    express.static(config.webDist, {
      index: false,
      setHeaders(res, file) {
        const name = path.basename(file);
        if (name === 'sw.js' || name === 'manifest.webmanifest') res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  // The public website may also be served on other addresses (WEBSITE_DOMAINS, e.g. mysoftkh.com). Sign-up, the dashboard,
  // the phone app and QR links always use the main address: sessions and registered phones belong to one address.
  const appHost = new URL(config.publicUrl).host.toLowerCase();
  server.use((req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (req.method === 'GET' && host && host !== appHost && /^\/(admin|app|manage|scan|signup)(\/|$)/.test(req.path)) {
      return res.redirect(302, config.publicUrl.replace(/\/$/, '') + req.originalUrl);
    }
    next();
  });
  server.get(/^(?!\/api\/|\/api$|\/uploads\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

async function bootstrap() {
  // Public demo: its own database, rebuilt with fresh sample data every night.
  if (config.demoMode) await prepareDemoData((m) => new Logger('Demo').log(m));
  if (process.env.AUTO_MIGRATE !== 'false') {
    const pool = new Pool({ connectionString: config.databaseUrl });
    await runMigrations(pool, (m) => new Logger('Migrate').log(m));
    await ensureSuperAdmin(pool, (m) => new Logger('Migrate').log(m));
    await pool.end();
  }

  const httpsOptions =
    config.httpsKeyFile && config.httpsCertFile
      ? { key: fs.readFileSync(config.httpsKeyFile), cert: fs.readFileSync(config.httpsCertFile) }
      : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions,
    logger: config.logFormat === 'json' ? ['error', 'warn', 'log'] : undefined,
  });
  configureApp(app);
  if (config.demoMode) {
    const demo = app.get(DemoService);
    app.use(demo.guard());
    await demo.ensurePayroll();
    demo.startNightlyReset();
  }
  if (process.env.API_DOCS !== 'false') setupDocs(app);
  serveStatic(app);
  await app.listen(config.port, '0.0.0.0');
  const scheme = httpsOptions ? 'https' : 'http';
  new Logger('Server').log(`QR and Phones Attendance running on ${scheme}://localhost:${config.port} (QR links use ${config.publicUrl}); API docs at /api/docs`);
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
