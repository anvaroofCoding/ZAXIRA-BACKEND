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

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseMongoIdPipe) id: string,
    @Body(UpdateUserValidationPipe) payload: object,
  ) {
    return this.usersService.updateFromDto(id, payload as UpdateUserPayload);
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
  remove(@Param('id', ParseMongoIdPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.remove(id, user.role);
  }
}
