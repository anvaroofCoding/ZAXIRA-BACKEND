import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SearchProductPricesDto } from './dto/search-product-prices.dto';
import { ProductPricesService } from './product-prices.service';

@Controller('product-prices')
@UseGuards(JwtAuthGuard)
export class ProductPricesController {
  constructor(private readonly productPricesService: ProductPricesService) {}

  @Post('search')
  search(@Body() body: Record<string, unknown>) {
    const dto = plainToInstance(SearchProductPricesDto, {
      name: body?.name,
      characteristics: body?.characteristics,
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      const messages = errors.flatMap((error) =>
        Object.values(error.constraints ?? {}),
      );
      throw new BadRequestException(messages);
    }

    return this.productPricesService.search(dto);
  }
}
