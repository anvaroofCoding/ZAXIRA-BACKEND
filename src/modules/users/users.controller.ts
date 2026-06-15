import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
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
  ) {}

  @Get('permission-catalog')
  getPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  @Get()
  findAll(@Query() query: QueryUsersDto, @CurrentUser() user: JwtPayload) {
    if (query.forSelect === '1' || query.forSelect === 'true') {
      return this.usersService.findActiveLookup();
    }

    return this.usersService.findAllPaginated(query, user.sub, user.role);
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
        normalizePermissions(updatedUser.permissions),
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
