import { BadRequestException, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

export class ParseMongoIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException('Noto‘g‘ri identifikator');
    }

    return value;
  }
}
