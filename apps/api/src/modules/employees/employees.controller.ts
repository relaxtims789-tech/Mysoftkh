import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ADMIN_ROLES, AuthUser, clientIp, CurrentUser, requireCompany, Roles, STAFF_ROLES } from '../../common/auth';
import { MAX_IMAGE_BYTES, UploadsService } from '../uploads/uploads.service';
import { EmployeeDto, EmployeeQuery, ImportEmployeesDto, UpdateEmployeeDto } from './employees.dto';
import { EmployeesService } from './employees.service';

const uuid = new ParseUUIDPipe();

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService, private readonly uploads: UploadsService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Search employees (managers see their departments only).' })
  list(@Query() q: EmployeeQuery, @CurrentUser() u: AuthUser) {
    return this.employees.list(requireCompany(u), u, q);
  }

  @Get(':id')
  @Roles(...STAFF_ROLES)
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.employees.get(requireCompany(u), id, u);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add an employee and their log-in (employee ID + temporary password).' })
  create(@Body() dto: EmployeeDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.create(requireCompany(u), dto, u, clientIp(req));
  }

  @Post('import')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add or update many employees at once (rows parsed from CSV).' })
  import(@Body() dto: ImportEmployeesDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.import(requireCompany(u), dto, u, clientIp(req));
  }

  @Put(':id')
  @Roles(...ADMIN_ROLES)
  update(@Param('id', uuid) id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.update(requireCompany(u), id, dto, u, clientIp(req));
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Disable an employee. Their attendance history is kept.' })
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.disable(requireCompany(u), id, u, clientIp(req));
  }

  @Post(':id/reset-device')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Unregister the employee\'s phone so they can register a new one.' })
  resetDevice(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.resetDevice(requireCompany(u), id, u, clientIp(req));
  }

  @Post(':id/reset-password')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Issue a temporary password; the employee must change it at next sign-in.' })
  resetPassword(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.employees.resetPassword(requireCompany(u), id, u, clientIp(req));
  }

  @Post(':id/photo')
  @Roles(...ADMIN_ROLES)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async photo(@Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser, @Req() req: Request) {
    const companyId = requireCompany(u);
    const url = this.uploads.saveImage(file, 'photo');
    const old = await this.employees.setPhoto(companyId, id, url, u, clientIp(req));
    this.uploads.remove(old);
    return { profilePhoto: url };
  }
}
