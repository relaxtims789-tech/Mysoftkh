import { Module } from '@nestjs/common';
import {
  BranchesController, CompaniesController, DepartmentsController, HolidaysController, PositionsController, SchedulesController, SettingsController,
} from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [CompaniesController, SettingsController, BranchesController, DepartmentsController, PositionsController, SchedulesController, HolidaysController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
