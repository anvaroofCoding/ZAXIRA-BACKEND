import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { PurchaseRequestsModule } from './modules/purchase-requests/purchase-requests.module';
import { WarehouseDispatchesModule } from './modules/warehouse-dispatches/warehouse-dispatches.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { StructuresModule } from './modules/structures/structures.module';
import { UsersModule } from './modules/users/users.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ChatModule } from './modules/chat/chat.module';
import { StocktakesModule } from './modules/stocktakes/stocktakes.module';
import { ProductPricesModule } from './modules/product-prices/product-prices.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('throttle.ttl', 60000),
          limit: configService.get<number>('throttle.limit', 120),
        },
      ],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('mongodbUri'),
        autoIndex: configService.get<string>('nodeEnv') !== 'production',
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    UsersModule,
    StructuresModule,
    PurchaseRequestsModule,
    WarehouseDispatchesModule,
    WarehouseModule,
    DashboardModule,
    ChatModule,
    StocktakesModule,
    ProductPricesModule,
    MediaModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
