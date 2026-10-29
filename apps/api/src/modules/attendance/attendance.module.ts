import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceSummaryService } from './summary.service';

@Module({
  imports: [DevicesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceSummaryService],
  exports: [AttendanceService, AttendanceSummaryService],
})
export class AttendanceModule {}
