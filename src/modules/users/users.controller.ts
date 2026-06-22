import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserSessionEventsService } from '../auth/user-session-events.service';
import { UserDevicesService } from '../auth/user-devices.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsEventsService } from '../notifications/notifications-events.service';
import { PERMISSION_CATALOG } from './constants/permission-catalog';
import { QueryUsersDto } from './dto/query-users.dto';
import {
  CreateUserPayload,
  CreateUserValidationPipe,
} from './pipes/create-user-validation.pipe';
import {
  UpdateUserPayload,
  UpdateUserValidationPipe,
} from './pipes/update-user-validation.pipe';
import { UsersService } from './users.service';
import { normalizePermissions } from './utils/permissions.util';
import { UserPermissionsMap } from './types/page-permission.type';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly notificationsEvents: NotificationsEventsService,
    private readonly userSessionEventsService: UserSessionEventsService,
    private readonly userDevicesService: UserDevicesService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  @Get('permission-catalog')
  getPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  @Get()
  async findAll(@Query() query: QueryUsersDto, @CurrentUser() user: JwtPayload) {
    if (query.forSelect === '1' || query.forSelect === 'true') {
      return this.usersService.findActiveLookup();
    }

    const result = await this.usersService.findAllPaginated(
      query,
      user.sub,
      user.role,
    );

    const canViewActivity = this.usersService.canViewUserActivity(user.role);

    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        ...(canViewActivity
          ? {
              isOnline: this.realtimeGateway.isUserOnline(item.id),
            }
          : {}),
      })),
    };
  }

  @Get(':id/faollik')
  async getSessionEvents(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.usersService.assertCanViewUserActivity(user.sub, user.role);
    await this.usersService.findByIdOrFailForActivity(id);

    return this.userSessionEventsService.findByUserPaginated(
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }

  @Get(':id/oxirgi-qurilma')
  async getLastDevice(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.assertCanViewUserActivity(user.sub, user.role);
    await this.usersService.findByIdOrFailForActivity(id);

    const device = await this.userDevicesService.getLastDeviceWithTelemetry(id);

    if (!device) {
      return null;
    }

    return {
      ...device,
      isOnline: this.realtimeGateway.isUserOnline(id),
      onlineDeviceIds: this.realtimeGateway.getOnlineDeviceIds(id),
    };
  }

  @Get(':id')
  findOne(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.findByIdOrFail(id, user.sub, user.role);
  }

  @Post()
  create(
    @Body(CreateUserValidationPipe) payload: object,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.createFromDto(
      payload as CreateUserPayload,
      user.sub,
      user.role,
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body(UpdateUserValidationPipe) payload: object,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    const dto = payload as UpdateUserPayload;
    let previousPermissions: UserPermissionsMap | undefined;

    if (dto.permissions !== undefined) {
      const existing = await this.usersService.findById(id);
      previousPermissions = normalizePermissions(
        existing?.permissions as UserPermissionsMap,
        { applyLegacy: false },
      );
    }

    const updatedUser = await this.usersService.updateFromDto(
      id,
      dto,
      currentUser.sub,
      currentUser.role,
    );

    if (dto.permissions !== undefined && previousPermissions) {
      await this.notificationsEvents.handlePermissionsUpdated(
        id,
        previousPermissions,
        normalizePermissions(updatedUser.permissions, { applyLegacy: false }),
      );
    }

    return updatedUser;
  }

  @Delete(':id/permanent')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  permanentRemove(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.permanentRemove(id, user.sub);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseMongoIdPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.remove(id, user.sub, user.role);
  }
}
