import { Global, Module } from '@nestjs/common';
import { Db } from '../../database/db.service';
import { AuditController } from '../audit/audit.controller';
import { AuditService } from '../audit/audit.service';
import { UploadsService } from '../uploads/uploads.service';
import { CompanyContextService } from './company-context.service';
import { HealthController } from './health.controller';
import { TelegramService } from './telegram.service';

/** Shared services every feature module uses. */
@Global()
@Module({
  controllers: [AuditController, HealthController],
  providers: [Db, AuditService, CompanyContextService, UploadsService, TelegramService],
  exports: [Db, AuditService, CompanyContextService, UploadsService, TelegramService],
})
export class CoreModule {}
