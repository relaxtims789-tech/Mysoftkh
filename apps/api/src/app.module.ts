import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { AuthGuard } from './common/auth';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RequestLogger } from './common/request-logger';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { CoreModule } from './modules/core/core.module';
import { CorrectionsModule } from './modules/corrections/corrections.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DevicesModule } from './modules/devices/devices.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LeaveModule } from './modules/leave/leave.module';
import { OvertimeModule } from './modules/overtime/overtime.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { BillingModule } from './modules/billing/billing.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { QrModule } from './modules/qr/qr.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { DemoModule } from './modules/demo/demo.module';
import { VisitorsModule } from './modules/visitors/visitors.module';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute }],
      skipIf: () => config.isTest && !process.env.TEST_THROTTLE,
    }),
    CoreModule,
    AuthModule,
    OrganizationModule,
    EmployeesModule,
    UsersModule,
    QrModule,
    DevicesModule,
    AttendanceModule,
    CorrectionsModule,
    LeaveModule,
    OvertimeModule,
    PayrollModule,
    BillingModule,
    TelegramModule,
    DashboardModule,
    ReportsModule,
    IntegrationsModule,
    DemoModule,
    VisitorsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogger).forRoutes('*');
  }
}
