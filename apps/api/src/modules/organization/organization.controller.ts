import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { MAX_IMAGE_BYTES, UploadsService } from '../uploads/uploads.service';
import {
  BranchDto, CreateCompanyDto, HolidayDto, NamedDto, ScheduleDto, UpdateBranchDto, UpdateCompanyDto, UpdateRulesDto, UpdateScheduleDto,
} from './organization.dto';
import { OrganizationService } from './organization.service';

const uuid = new ParseUUIDPipe();
const imageUpload = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly org: OrganizationService, private readonly uploads: UploadsService) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'All companies (super admin).' })
  list() {
    return this.org.listCompanies();
  }

  @Post()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create a company with its rules, a default schedule and its first admin.' })
  create(@Body() dto: CreateCompanyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.createCompany(dto, u, clientIp(req));
  }

  @Get('current')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'The company the caller works in.' })
  current(@CurrentUser() u: AuthUser) {
    return this.org.getCompany(requireCompany(u));
  }

  @Put('current')
  @Roles('super_admin', 'company_admin')
  update(@Body() dto: UpdateCompanyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.updateCompany(requireCompany(u), dto, u, clientIp(req));
  }

  @Post('current/logo')
  @Roles('super_admin', 'company_admin')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(imageUpload)
  @ApiOperation({ summary: 'Upload the company logo (PNG/JPEG/WebP, max 2 MB). Printed on QR posters.' })
  async logo(@UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser, @Req() req: Request) {
    const url = this.uploads.saveImage(file, 'logo');
    const old = await this.org.setLogo(requireCompany(u), url, u, clientIp(req));
    this.uploads.remove(old);
    return { logo: url };
  }

  @Get(':id')
  @Roles('super_admin')
  get(@Param('id', uuid) id: string) {
    return this.org.getCompany(id);
  }

  @Put(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Edit or suspend a company (super admin).' })
  updateAny(@Param('id', uuid) id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.updateCompany(id, dto, u, clientIp(req));
  }
}

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly org: OrganizationService) {}

  @Get('attendance-rules')
  @Roles(...STAFF_ROLES)
  rules(@CurrentUser() u: AuthUser) {
    return this.org.getRules(requireCompany(u));
  }

  @Put('attendance-rules')
  @Roles('super_admin', 'company_admin')
  @ApiOperation({ summary: 'Turn GPS, device binding, lunch scans, overtime and scan limits on or off for the company.' })
  updateRules(@Body() dto: UpdateRulesDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.updateRules(requireCompany(u), dto, u, clientIp(req));
  }
}

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(@CurrentUser() u: AuthUser) {
    return this.org.listBranches(requireCompany(u));
  }

  @Get('allowance')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Active branches and how many the plan allows (limit null = unlimited).' })
  allowance(@CurrentUser() u: AuthUser) {
    return this.org.branchAllowance(requireCompany(u));
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.org.getBranch(requireCompany(u), id);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add a branch with its GPS location and allowed radius.' })
  create(@Body() dto: BranchDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.createBranch(requireCompany(u), dto, u, clientIp(req));
  }

  @Put(':id')
  @Roles(...ADMIN_ROLES)
  update(@Param('id', uuid) id: string, @Body() dto: UpdateBranchDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.updateBranch(requireCompany(u), id, dto, u, clientIp(req));
  }
}

function namedController(table: 'departments' | 'positions', tag: string) {
  @ApiTags(tag)
  @ApiBearerAuth()
  @Controller(table)
  class NamedController {
    constructor(readonly org: OrganizationService) {}

    @Get()
    @Roles(...STAFF_ROLES)
    list(@CurrentUser() u: AuthUser) {
      return this.org.listNamed(table, requireCompany(u));
    }

    @Post()
    @Roles(...ADMIN_ROLES)
    create(@Body() dto: NamedDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
      return this.org.saveNamed(table, requireCompany(u), null, dto, u, clientIp(req));
    }

    @Put(':id')
    @Roles(...ADMIN_ROLES)
    update(@Param('id', uuid) id: string, @Body() dto: NamedDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
      return this.org.saveNamed(table, requireCompany(u), id, dto, u, clientIp(req));
    }

    @Delete(':id')
    @Roles(...ADMIN_ROLES)
    remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
      return this.org.deleteNamed(table, requireCompany(u), id, u, clientIp(req));
    }
  }
  Object.defineProperty(NamedController, 'name', { value: `${tag}Controller` });
  return NamedController;
}

export const DepartmentsController = namedController('departments', 'Departments');
export const PositionsController = namedController('positions', 'Positions');

@ApiTags('Work schedules')
@ApiBearerAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(@CurrentUser() u: AuthUser) {
    return this.org.listSchedules(requireCompany(u));
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a work schedule (start/end, lunch, late-after, grace, working days).' })
  create(@Body() dto: ScheduleDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.saveSchedule(requireCompany(u), null, dto, u, clientIp(req));
  }

  @Put(':id')
  @Roles(...ADMIN_ROLES)
  update(@Param('id', uuid) id: string, @Body() dto: UpdateScheduleDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.saveSchedule(requireCompany(u), id, dto, u, clientIp(req));
  }
}

@ApiTags('Holidays')
@ApiBearerAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    const y = Number(year);
    return this.org.listHolidays(requireCompany(u), Number.isInteger(y) && y > 1900 && y < 3000 ? y : undefined);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  create(@Body() dto: HolidayDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.createHoliday(requireCompany(u), dto, u, clientIp(req));
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.org.deleteHoliday(requireCompany(u), id, u, clientIp(req));
  }
}
