import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { ParseMongoIdPipe } from '../../common/pipes/parse-mongo-id.pipe';
import { WarehouseDispatchDocumentService } from './warehouse-dispatch-document.service';
import { WarehouseDispatchesService } from './warehouse-dispatches.service';

@Controller('public/nakladnoy')
export class WarehouseDispatchPublicController {
  constructor(
    private readonly warehouseDispatchesService: WarehouseDispatchesService,
    private readonly documentService: WarehouseDispatchDocumentService,
  ) {}

  @Get(':id/pdf')
  @SkipTransform()
  @Header('Content-Type', 'application/pdf')
  async viewNakladnoyPdf(@Param('id', ParseMongoIdPipe) id: string) {
    const dispatch = await this.warehouseDispatchesService.findByIdOrFail(id);
    const buffer = await this.documentService.generatePdf(dispatch);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${this.documentService.buildFileName(dispatch, 'pdf')}"`,
    });
  }
}
