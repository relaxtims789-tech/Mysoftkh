import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config';
import { badRequest } from '../../common/errors';
import { randomToken } from '../../common/crypto';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Detects the real image type from the file's first bytes (the client's MIME type is not trusted). */
function sniff(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Stores logos and profile photos under STORAGE_DIR/uploads with unguessable names; served at /uploads/. */
@Injectable()
export class UploadsService {
  saveImage(file: Express.Multer.File | undefined, kind: 'logo' | 'photo'): string {
    if (!file?.buffer?.length) throw badRequest('Choose an image file.', 'NO_FILE');
    if (file.buffer.length > MAX_IMAGE_BYTES) throw badRequest('The image is larger than 2 MB.', 'FILE_TOO_LARGE');
    const ext = sniff(file.buffer);
    if (!ext) throw badRequest('Only PNG, JPEG or WebP images are allowed.', 'BAD_FILE_TYPE');
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    const name = `${kind}-${randomToken(18)}.${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), file.buffer);
    return `/uploads/${name}`;
  }

  remove(url: string | null | undefined) {
    if (!url || !url.startsWith('/uploads/')) return;
    const name = path.basename(url);
    fs.rm(path.join(config.uploadsDir, name), { force: true }, () => undefined);
  }
}
