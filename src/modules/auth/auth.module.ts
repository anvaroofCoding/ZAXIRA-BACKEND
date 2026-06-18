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
  UserDeviceSession,
  UserDeviceSessionSchema,
} from './schemas/user-device-session.schema';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserDevicesService } from './user-devices.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => NotificationsModule),
    MongooseModule.forFeature([
      { name: UserDeviceSession.name, schema: UserDeviceSessionSchema },
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
  providers: [AuthService, UserDevicesService, JwtStrategy],
  exports: [AuthService, UserDevicesService, JwtModule],
})
export class AuthModule {}
