import { Module } from '@nestjs/common';
import { SuperAdminSeed } from './seeds/super-admin.seed';
import { UsersModule } from '../modules/users/users.module';

@Module({
  imports: [UsersModule],
  providers: [SuperAdminSeed],
})
export class DatabaseModule {}
