import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../modules/users/users.service';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class SuperAdminSeed implements OnModuleInit {
  private readonly logger = new Logger(SuperAdminSeed.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const login = this.configService.get<string>('superAdmin.login', 'admin');
    const password = this.configService.get<string>(
      'superAdmin.password',
      '123123',
    );

    const existing = await this.usersService.findByLogin(login);

    if (existing) {
      this.logger.log(`Super admin "${login}" allaqachon mavjud`);
      return;
    }

    await this.usersService.createUser({
      login,
      password,
      role: UserRole.SUPER_ADMIN,
      displayName: 'Super Admin',
      permissions: undefined,
    });

    this.logger.log(`Super admin "${login}" yaratildi`);
  }
}
