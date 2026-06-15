import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { QueryProductsDto, SearchProductsDto } from './dto/query-products.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query() query: QueryProductsDto, @CurrentUser() user: JwtPayload) {
    return this.productsService.list(query, user.sub, user.role);
  }

  @Get('search')
  search(@Query() query: SearchProductsDto, @CurrentUser() user: JwtPayload) {
    return this.productsService.search(query, user.sub, user.role);
  }

  @Delete(':itemKey/archive')
  archive(@Param('itemKey') itemKey: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.archive(
      decodeURIComponent(itemKey),
      user.sub,
      user.role,
    );
  }
}
