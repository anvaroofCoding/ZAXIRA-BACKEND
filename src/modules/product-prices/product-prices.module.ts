import { Module } from '@nestjs/common';
import { ProductPricesController } from './product-prices.controller';
import { ProductPricesService } from './product-prices.service';

@Module({
  controllers: [ProductPricesController],
  providers: [ProductPricesService],
  exports: [ProductPricesService],
})
export class ProductPricesModule {}
