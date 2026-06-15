import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Structure, StructureSchema } from './schemas/structure.schema';
import { StructuresController } from './structures.controller';
import { StructuresService } from './structures.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Structure.name, schema: StructureSchema },
    ]),
  ],
  controllers: [StructuresController],
  providers: [StructuresService],
  exports: [StructuresService, MongooseModule],
})
export class StructuresModule {}
