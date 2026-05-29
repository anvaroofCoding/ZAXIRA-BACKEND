import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { PURCHASE_REQUEST_STATUS_LABELS } from './enums/purchase-request-status.enum';
import { PurchaseRequestDocument } from './schemas/purchase-request.schema';

const FONT_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
);
const FONT_BOLD_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
);

interface DocumentContext {
  organizationName: string;
  request: PurchaseRequestDocument;
}

@Injectable()
export class PurchaseRequestDocumentService {
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

  private buildRows(ctx: DocumentContext) {
    const { request } = ctx;
    const applicantName =
      request.applicant.displayName || request.applicant.login;
    const structureName =
      request.applicantStructure?.fullName ?? '—';

    return {
      organizationName: ctx.organizationName,
      requestCode: request.requestCode,
      date: this.formatDate(request.createdAt),
      status: PURCHASE_REQUEST_STATUS_LABELS[request.status],
      applicantName,
      structureName,
      items: request.items.map((item, index) => ({
        index: index + 1,
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
      })),
      comment: request.comment?.trim() || '—',
      commissionMembers: request.commissionMembers.map(
        (member, index) =>
          `${index + 1}. ${member.displayName || member.login}`,
      ),
      bossName: request.boss.displayName || request.boss.login,
    };
  }

  async generatePdf(request: PurchaseRequestDocument): Promise<Buffer> {
    const ctx: DocumentContext = {
      organizationName: this.getOrganizationName(),
      request,
    };
    const data = this.buildRows(ctx);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 55, right: 55 },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('regular', FONT_PATH);
      doc.registerFont('bold', FONT_BOLD_PATH);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const centerX = doc.page.margins.left + pageWidth / 2;

      doc.font('bold').fontSize(11);
      doc.text(data.organizationName, doc.page.margins.left, 50, {
        width: pageWidth,
        align: 'center',
      });

      doc.moveDown(1.2);
      doc.fontSize(14).text('BUYURTMA', { align: 'center' });

      doc.moveDown(0.6);
      doc.font('regular').fontSize(11);
      doc.text(`№ ${data.requestCode}`, doc.page.margins.left, doc.y, {
        width: pageWidth / 2,
        align: 'left',
      });
      doc.text(data.date, doc.page.margins.left, doc.y - doc.currentLineHeight(), {
        width: pageWidth,
        align: 'right',
      });

      doc.moveDown(1.2);
      doc.text(`Ariza beruvchi: ${data.applicantName}`);
      doc.text(`Tarkibiy tuzilma: ${data.structureName}`);
      doc.moveDown(0.8);
      doc.text(
        'Quyidagi tovarlarni xarid qilish uchun ariza (buyurtma) beriladi:',
      );

      const tableTop = doc.y + 8;
      const colWidths = [28, 145, 200, 52];
      const rowHeight = 22;
      const headerHeight = 24;
      let y = tableTop;

      const drawRow = (
        cells: string[],
        isHeader = false,
        height = rowHeight,
      ) => {
        let x = doc.page.margins.left;
        cells.forEach((cell, index) => {
          doc.rect(x, y, colWidths[index], height).stroke();
          doc
            .font(isHeader ? 'bold' : 'regular')
            .fontSize(9)
            .text(cell, x + 4, y + 6, {
              width: colWidths[index] - 8,
              height: height - 8,
              ellipsis: true,
            });
          x += colWidths[index];
        });
        y += height;
      };

      drawRow(['T/R', 'Tovar nomi', 'Tovar xususiyati', 'Soni'], true, headerHeight);

      data.items.forEach((item) => {
        if (y + rowHeight > doc.page.height - 120) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        drawRow([
          String(item.index),
          item.name,
          item.characteristics,
          String(item.quantity),
        ]);
      });

      doc.x = doc.page.margins.left;
      doc.y = y + 14;
      doc.font('bold').fontSize(10).text('Izoh:', { continued: false });
      doc.font('regular').text(data.comment, { width: pageWidth });

      doc.moveDown(1);
      doc.font('bold').text('Komissiya a’zolari:');
      doc.font('regular');
      data.commissionMembers.forEach((line) => {
        doc.text(line);
      });

      doc.moveDown(1);
      doc.font('bold').text(`Boshliq: ${data.bossName}`);
      doc.moveDown(2.5);
      doc.font('regular').text('Imzo: _________________________', {
        align: 'left',
      });
      doc.text('Sana: «____» _____________ 20___ y.', {
        align: 'right',
        width: pageWidth,
      });

      doc.moveDown(1);
      doc
        .fontSize(9)
        .fillColor('#555555')
        .text(`Holat: ${data.status}`, centerX - pageWidth / 2, doc.y, {
          width: pageWidth,
          align: 'center',
        });

      doc.end();
    });
  }

  async generateDocx(request: PurchaseRequestDocument): Promise<Buffer> {
    const docx = (await import('docx')) as Record<string, unknown>;
    const AlignmentType = docx.AlignmentType as Record<string, string>;
    const Document = docx.Document as new (options: unknown) => unknown;
    const Packer = docx.Packer as { toBuffer: (file: unknown) => Promise<Buffer> };
    const Paragraph = docx.Paragraph as new (options: unknown) => unknown;
    const Table = docx.Table as new (options: unknown) => unknown;
    const TableCell = docx.TableCell as new (options: unknown) => unknown;
    const TableRow = docx.TableRow as new (options: unknown) => unknown;
    const TextRun = docx.TextRun as new (options: unknown) => unknown;
    const WidthType = docx.WidthType as Record<string, string>;

    const ctx: DocumentContext = {
      organizationName: this.getOrganizationName(),
      request,
    };
    const data = this.buildRows(ctx);

    const tableHeader = new TableRow({
      tableHeader: true,
      children: ['T/R', 'Tovar nomi', 'Tovar xususiyati', 'Soni'].map(
        (text) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold: true, size: 20 })],
              }),
            ],
          }),
      ),
    });

    const tableRows = data.items.map(
      (item) =>
        new TableRow({
          children: [
            String(item.index),
            item.name,
            item.characteristics,
            String(item.quantity),
          ].map(
            (text) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text, size: 20 })],
                  }),
                ],
              }),
          ),
        }),
    );

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: data.organizationName,
                  bold: true,
                  size: 24,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 240, after: 120 },
              children: [
                new TextRun({ text: 'BUYURTMA', bold: true, size: 32 }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `№ ${data.requestCode}`, size: 22 }),
                new TextRun({
                  text: `\t\t\t${data.date}`,
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 200 },
              children: [
                new TextRun({
                  text: `Ariza beruvchi: ${data.applicantName}`,
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Tarkibiy tuzilma: ${data.structureName}`,
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 160, after: 160 },
              children: [
                new TextRun({
                  text: 'Quyidagi tovarlarni xarid qilish uchun ariza (buyurtma) beriladi:',
                  size: 22,
                }),
              ],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [tableHeader, ...tableRows],
            }),
            new Paragraph({
              spacing: { before: 200 },
              children: [
                new TextRun({ text: 'Izoh: ', bold: true, size: 22 }),
                new TextRun({ text: data.comment, size: 22 }),
              ],
            }),
            new Paragraph({
              spacing: { before: 200 },
              children: [
                new TextRun({
                  text: 'Komissiya a’zolari:',
                  bold: true,
                  size: 22,
                }),
              ],
            }),
            ...data.commissionMembers.map(
              (line) =>
                new Paragraph({
                  children: [new TextRun({ text: line, size: 22 })],
                }),
            ),
            new Paragraph({
              spacing: { before: 200 },
              children: [
                new TextRun({
                  text: `Boshliq: ${data.bossName}`,
                  bold: true,
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 400 },
              children: [
                new TextRun({
                  text: 'Imzo: _________________________',
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Sana: «____» _____________ 20___ y.',
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 200 },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `Holat: ${data.status}`,
                  italics: true,
                  size: 18,
                  color: '666666',
                }),
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  buildFileName(request: PurchaseRequestDocument, extension: 'pdf' | 'docx') {
    return `buyurtma-${request.requestCode}.${extension}`;
  }
}
