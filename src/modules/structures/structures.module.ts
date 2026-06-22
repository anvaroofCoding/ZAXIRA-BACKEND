import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Structure, StructureSchema } from './schemas/structure.schema';
import { StructuresController } from './structures.controller';
import { StructuresService } from './structures.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Structure.name, schema: StructureSchema },
    ]),
    forwardRef(() => UsersModule),
  ],
  controllers: [StructuresController],
  providers: [StructuresService],
  exports: [StructuresService, MongooseModule],
})
export class StructuresModule {}
