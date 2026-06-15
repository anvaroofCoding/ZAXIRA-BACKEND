import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { WAREHOUSE_DISPATCH_STATUS_LABELS } from './enums/warehouse-dispatch-status.enum';
import { WarehouseDispatchDocument } from './schemas/warehouse-dispatch.schema';

const FONT_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
);
const FONT_BOLD_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
);

@Injectable()
export class WarehouseDispatchDocumentService {
  constructor(private readonly configService: ConfigService) {}

  private getOrganizationName() {
    return this.configService.get<string>(
      'organization.fullName',
      '“ZAXIRA” axborot tizimi tashkiloti',
    );
  }

  private formatDate(value?: Date) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(value);
  }

  buildFileName(dispatch: WarehouseDispatchDocument, ext: 'pdf' | 'docx') {
    return `nakladnoy-${dispatch.dispatchCode}.${ext}`;
  }

  async generatePdf(dispatch: WarehouseDispatchDocument): Promise<Buffer> {
    const org = this.getOrganizationName();

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('regular', FONT_PATH);
      doc.registerFont('bold', FONT_BOLD_PATH);
      doc.font('bold').fontSize(14).text(org, { align: 'center' });
      doc.moveDown();
      doc.font('bold').fontSize(12).text('NAKLADNOY', { align: 'center' });
      doc.moveDown(1.5);

      doc.font('regular').fontSize(10);
      doc.text(`Nakladnoy raqami: ${dispatch.dispatchCode}`);
      doc.text(`Ariza ID: ${dispatch.requestCode}`);
      doc.text(
        `Qabul qiluvchi tuzilma: ${dispatch.targetStructure.fullName} (${dispatch.targetStructure.shortName})`,
      );
      doc.text(`Jo‘natilgan sana: ${this.formatDate(dispatch.dispatchedAt)}`);
      doc.text(
        `Rejalashtirilgan kelish: ${this.formatDate(dispatch.plannedArrivalAt)}`,
      );
      doc.text(`Holat: ${WAREHOUSE_DISPATCH_STATUS_LABELS[dispatch.status]}`);
      doc.text(
        `Jo‘natuvchi: ${dispatch.dispatchedBy.displayName || dispatch.dispatchedBy.login}`,
      );
      doc.moveDown();

      doc.font('bold').text('Tovarlar:');
      doc.moveDown(0.5);
      doc.font('regular');

      dispatch.items.forEach((item, index) => {
        doc.text(
          `${index + 1}. ${item.name} — ${item.characteristics} — ${item.quantityDispatched} ta`,
        );
      });

      doc.end();
    });
  }

  async generateDocx(dispatch: WarehouseDispatchDocument): Promise<Buffer> {
    const docx = (await import('docx')) as Record<string, unknown>;
    const Document = docx.Document as new (options: unknown) => unknown;
    const Packer = docx.Packer as {
      toBuffer: (file: unknown) => Promise<Buffer>;
    };
    const Paragraph = docx.Paragraph as new (options: unknown) => unknown;
    const Table = docx.Table as new (options: unknown) => unknown;
    const TableCell = docx.TableCell as new (options: unknown) => unknown;
    const TableRow = docx.TableRow as new (options: unknown) => unknown;
    const TextRun = docx.TextRun as new (options: unknown) => unknown;
    const WidthType = docx.WidthType as Record<string, string>;

    const org = this.getOrganizationName();
    const rows = dispatch.items.map(
      (item, index) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(String(index + 1))],
            }),
            new TableCell({
              children: [new Paragraph(item.name)],
            }),
            new TableCell({
              children: [new Paragraph(item.characteristics)],
            }),
            new TableCell({
              children: [new Paragraph(String(item.quantityDispatched))],
            }),
          ],
        }),
    );

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun({ text: org, bold: true, size: 28 })],
              alignment: 'center',
            }),
            new Paragraph({
              children: [
                new TextRun({ text: 'NAKLADNOY', bold: true, size: 24 }),
              ],
              alignment: 'center',
            }),
            new Paragraph({ text: '' }),
            new Paragraph({
              text: `Nakladnoy raqami: ${dispatch.dispatchCode}`,
            }),
            new Paragraph({ text: `Ariza ID: ${dispatch.requestCode}` }),
            new Paragraph({
              text: `Qabul qiluvchi: ${dispatch.targetStructure.fullName} (${dispatch.targetStructure.shortName})`,
            }),
            new Paragraph({
              text: `Jo‘natilgan sana: ${this.formatDate(dispatch.dispatchedAt)}`,
            }),
            new Paragraph({
              text: `Rejalashtirilgan kelish: ${this.formatDate(dispatch.plannedArrivalAt)}`,
            }),
            new Paragraph({ text: '' }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('T/R')] }),
                    new TableCell({ children: [new Paragraph('Tovar')] }),
                    new TableCell({ children: [new Paragraph('Xususiyat')] }),
                    new TableCell({ children: [new Paragraph('Soni')] }),
                  ],
                }),
                ...rows,
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }
}
