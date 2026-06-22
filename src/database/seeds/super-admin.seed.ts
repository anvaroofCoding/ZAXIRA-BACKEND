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
    const secondCode = this.configService.get<string>(
      'superAdmin.secondCode',
      'admin-ikkinchi-kod',
    );

    const existing = await this.usersService.findByLogin(login);

    if (existing) {
      const ensured = await this.usersService.ensureSecondCode(
        existing.id,
        secondCode,
      );
      if (ensured) {
        this.logger.log(`Super admin "${login}" uchun ikkinchi kod qo‘yildi`);
      } else {
        this.logger.log(`Super admin "${login}" allaqachon mavjud`);
      }
    } else {
      await this.usersService.createUser({
        login,
        password,
        secondCode,
        role: UserRole.SUPER_ADMIN,
        displayName: 'Super Admin',
        permissions: undefined,
      });

      this.logger.log(`Super admin "${login}" yaratildi`);
    }

    const updatedPermissions =
      await this.usersService.backfillIshonchnomaPermissions();

    if (updatedPermissions > 0) {
      this.logger.log(
        `Ishonchnoma ruxsati ${updatedPermissions} ta foydalanuvchiga qo‘shildi`,
      );
    }

    const backfilledSecondCodes =
      await this.usersService.backfillMissingSecondCodes();

    if (backfilledSecondCodes > 0) {
      this.logger.log(
        `Ikkinchi kod ${backfilledSecondCodes} ta foydalanuvchiga qo‘yildi (login-ikkinchi-kod)`,
      );
    }
  }
}
