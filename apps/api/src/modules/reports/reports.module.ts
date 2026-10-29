import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { OvertimeModule } from '../overtime/overtime.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [AttendanceModule, OvertimeModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
