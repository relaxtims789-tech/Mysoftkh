import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth';
import { Db } from '../../database/db.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Liveness + database check (for Docker / uptime monitors).' })
  async health() {
    await this.db.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  }
}
