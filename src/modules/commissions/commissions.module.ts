import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { Commission, CommissionSchema } from './schemas/commission.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Commission.name, schema: CommissionSchema },
    ]),
    UsersModule,
  ],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService, MongooseModule],
})
export class CommissionsModule {}
