import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { runMigrations } from '../src/database/migrate';
import { hashPassword } from '../src/common/crypto';
import { scanMessage, registerMessage } from '../src/modules/devices/challenge.service';

export const PASSWORD = 'Test@12345';

export async function createApp() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(pool, () => undefined);
  await pool.query(
    `INSERT INTO users (company_id, username, email, name, role, password_hash) VALUES (NULL, 'root@test.local', 'root@test.local', 'Root', 'super_admin', $1)`,
    [await hashPassword(PASSWORD)],
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return { app, pool, http: () => request(app.getHttpServer()) };
}

export type Http = () => request.Agent | ReturnType<typeof request>;

export async function login(http: Http, body: { companyCode?: string; login: string; password: string }) {
  const res = await (http() as any).post('/api/auth/login').send(body);
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, user: res.body.user, cookie: res.headers['set-cookie'] as unknown as string[] };
}

/** A phone: a P-256 key pair like the one the PWA keeps in IndexedDB. */
export class FakePhone {
  readonly privateKey: crypto.KeyObject;
  readonly jwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  readonly id: string;

  constructor() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const j = publicKey.export({ format: 'jwk' }) as any;
    this.jwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
    this.id = crypto.createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x: j.x, y: j.y })).digest('base64url');
  }

  sign(message: string) {
    return crypto.sign('sha256', Buffer.from(message), { key: this.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  }

  async register(http: Http, token: string) {
    const { challenge } = (await (http() as any).get('/api/attendance/challenge').set('Authorization', `Bearer ${token}`)).body;
    return (http() as any)
      .post('/api/devices/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ publicKey: this.jwk, deviceName: 'Test phone', platform: 'Android', challenge, signature: this.sign(registerMessage(challenge)) });
  }

  /** Builds a signed scan body (fresh challenge unless one is given). */
  async scanBody(http: Http, token: string, p: { qrToken: string; latitude?: number; longitude?: number; accuracy?: number; type?: string; confirmEarly?: boolean }, challenge?: string) {
    challenge ??= (await (http() as any).get('/api/attendance/challenge').set('Authorization', `Bearer ${token}`)).body.challenge as string;
    const signature = this.sign(scanMessage({ challenge, ...p }));
    return { ...p, device: { id: this.id, challenge, signature } };
  }
}

/** Point `meters` north of (lat, lng). */
export function north(lat: number, lng: number, meters: number) {
  return { latitude: lat + meters / 111320, longitude: lng };
}
