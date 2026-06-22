import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { StringValue } from 'ms';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AppSetting,
  AppSettingSchema,
} from './schemas/app-setting.schema';
import {
  UserDeviceSession,
  UserDeviceSessionSchema,
} from './schemas/user-device-session.schema';
import {
  UserSessionEvent,
  UserSessionEventSchema,
} from './schemas/user-session-event.schema';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserDevicesService } from './user-devices.service';
import { UserSessionEventsService } from './user-session-events.service';
import { GlobalSecondCodeService } from './global-second-code.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => NotificationsModule),
    MongooseModule.forFeature([
      { name: AppSetting.name, schema: AppSettingSchema },
      { name: UserDeviceSession.name, schema: UserDeviceSessionSchema },
      { name: UserSessionEvent.name, schema: UserSessionEventSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>(
            'jwt.expiresIn',
            '7d',
          ) as StringValue,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UserDevicesService,
    UserSessionEventsService,
    GlobalSecondCodeService,
    JwtStrategy,
  ],
  exports: [AuthService, UserDevicesService, UserSessionEventsService, JwtModule],
})
export class AuthModule {}
