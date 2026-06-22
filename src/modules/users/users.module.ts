import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { StructuresModule } from '../structures/structures.module';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => StructuresModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => AuthModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [UsersController],
  providers: [UsersService, RolesGuard],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
