import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { buildQrPngBuffer } from '../../common/utils/qr-code.util';
import { UsersService } from '../users/users.service';
import { ApprovalDecision } from './enums/approval-decision.enum';
import { PurchaseRequestDocument } from './schemas/purchase-request.schema';
import {
  GenerateDocxOptions,
  GeneratePdfOptions,
  PurchaseRequestDocumentSource,
} from './types/purchase-request-document-source.type';
import {
  buildBuyerTitleLines,
  DOCUMENT_BUYER_TEXT_MAX_WIDTH_PT,
  estimateTextWidth,
} from './utils/document-text-layout.util';
import { resolveBossDocumentName } from './utils/resolve-boss-document-name.util';

const FONT_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
);
const FONT_BOLD_PATH = path.join(
  process.cwd(),
  'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
);

/** A4 (11906 DXA) − chap/o‘ng margin 850×2 */
const DOCX_CONTENT_WIDTH_DXA = 10206;
const BILDIRGI_TABLE_COLUMN_WEIGHTS = [28, 118, 168, 48, 48, 62];
const BILDIRGI_TABLE_COLUMN_WIDTHS = (() => {
  const totalWeight = BILDIRGI_TABLE_COLUMN_WEIGHTS.reduce(
    (sum, value) => sum + value,
    0,
  );
  const widths = BILDIRGI_TABLE_COLUMN_WEIGHTS.map((weight) =>
    Math.floor((weight / totalWeight) * DOCX_CONTENT_WIDTH_DXA),
  );
  const used = widths.reduce((sum, value) => sum + value, 0);
  widths[widths.length - 1] += DOCX_CONTENT_WIDTH_DXA - used;
  return widths;
})();

interface DocumentContext {
  organizationNameLatin: string;
  request: PurchaseRequestDocumentSource;
}

@Injectable()
export class PurchaseRequestDocumentService {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  private shouldAttachQr(request: PurchaseRequestDocumentSource) {
    return (
      request.bossDecision === ApprovalDecision.APPROVED &&
      Boolean(request.bossConfirmedAt)
    );
  }

  private async buildQrImageBuffer(targetUrl: string) {
    return buildQrPngBuffer(targetUrl, 240);
  }

  private async buildBossQrBuffer(request: PurchaseRequestDocumentSource) {
    if (!this.shouldAttachQr(request)) {
      return null;
    }

    return this.buildQrImageBuffer(this.buildPublicPdfUrl(request));
  }

  private buildPublicPdfUrl(request: PurchaseRequestDocumentSource) {
    const apiPublicUrl = this.configService
      .get<string>('apiPublicUrl', 'http://localhost:8000/api')
      .replace(/\/$/, '');
    return `${apiPublicUrl}/public/purchase-requests/${request.id}/pdf`;
  }

  private getOrganizationNameLatin() {
    return this.configService.get<string>(
      'organization.fullNameLatin',
      '"Toshkent metropoliteni" DUK',
    );
  }

  private buildRows(ctx: DocumentContext, bossName: string) {
    const { request } = ctx;
    const structureName = request.applicantStructure?.fullName ?? '—';
    const structureLeaderName =
      request.applicantStructure?.leaderName?.trim() || '—';
    return {
      requestCode: request.requestCode,
      recipientLine: `${ctx.organizationNameLatin} boshlig'i ${bossName}ga`,
      comment: request.comment?.trim() || '—',
      structureName,
      structureLeaderName,
      items: request.items.map((item, index) => ({
        index: index + 1,
        name: item.name,
        characteristics: item.characteristics,
        quantity: item.quantity,
        unit: item.unit?.trim() || '—',
        manufacturingCountry: item.manufacturingCountry?.trim() || '—',
      })),
    };
  }

  private placeTextFlushRight(
    doc: PDFKit.PDFDocument,
    text: string,
    y: number,
  ) {
    const textWidth = doc.widthOfString(text);
    const x = doc.page.width - doc.page.margins.right - textWidth;
    doc.text(text, x, y, { lineBreak: false });
  }

  private buildTableColumnWidths(pageWidth: number) {
    const weights = [28, 118, 168, 48, 48, 62];
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map((weight) =>
      Math.floor((weight / totalWeight) * pageWidth),
    );
    const used = widths.reduce((sum, value) => sum + value, 0);
    widths[widths.length - 1] += pageWidth - used;
    return widths;
  }

  private measureRowHeight(
    doc: PDFKit.PDFDocument,
    cells: string[],
    colWidths: number[],
    fontSize: number,
    isHeader: boolean,
    minHeight: number,
    padding: number,
  ) {
    doc.font(isHeader ? 'bold' : 'regular').fontSize(fontSize);

    let maxHeight = minHeight;
    cells.forEach((cell, index) => {
      const textWidth = Math.max(colWidths[index] - padding * 2, 12);
      const textHeight = doc.heightOfString(cell || ' ', {
        width: textWidth,
        lineGap: 1,
      });
      maxHeight = Math.max(maxHeight, textHeight + padding * 2);
    });

    return maxHeight;
  }

  private drawTableRow(
    doc: PDFKit.PDFDocument,
    cells: string[],
    colWidths: number[],
    y: number,
    options: {
      isHeader?: boolean;
      fontSize?: number;
      minHeight?: number;
      alignments?: ('left' | 'center' | 'right')[];
    },
  ) {
    const isHeader = options.isHeader ?? false;
    const fontSize = options.fontSize ?? 8.5;
    const minHeight = options.minHeight ?? (isHeader ? 24 : 22);
    const padding = 6;
    const height = this.measureRowHeight(
      doc,
      cells,
      colWidths,
      fontSize,
      isHeader,
      minHeight,
      padding,
    );

    let x = doc.page.margins.left;
    cells.forEach((cell, index) => {
      const width = colWidths[index] ?? 40;
      doc.lineWidth(0.75).rect(x, y, width, height).stroke();

      const align =
        options.alignments?.[index] ??
        (index === 0 || index === 3 || index === 4 ? 'center' : 'left');

      doc
        .font(isHeader ? 'bold' : 'regular')
        .fontSize(fontSize)
        .fillColor('#000000')
        .text(cell, x + padding, y + padding, {
          width: width - padding * 2,
          height: height - padding * 2,
          align,
          lineGap: 1,
        });

      x += width;
    });

    return y + height;
  }

  async generatePdf(
    request: PurchaseRequestDocumentSource,
    options: GeneratePdfOptions = {},
  ): Promise<Buffer> {
    const ctx: DocumentContext = {
      organizationNameLatin: this.getOrganizationNameLatin(),
      request,
    };
    const bossName = await resolveBossDocumentName(request.boss, this.usersService);
    const data = this.buildRows(ctx, bossName);
    const applicantQrBuffer = options.applicantQrUrl
      ? await this.buildQrImageBuffer(options.applicantQrUrl)
      : null;
    const bossQrBuffer = await this.buildBossQrBuffer(request);
    const qrBuffers = [applicantQrBuffer, bossQrBuffer].filter(
      (buffer): buffer is Buffer => Boolean(buffer),
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 48, bottom: 48, left: 50, right: 50 },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('regular', FONT_PATH);
      doc.registerFont('bold', FONT_BOLD_PATH);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const rowAlignments: ('left' | 'center' | 'right')[] = [
        'center',
        'left',
        'left',
        'center',
        'center',
        'left',
      ];
      const qrSize = qrBuffers.length ? 72 : 0;
      const qrRowWidth = qrBuffers.length > 1 ? qrSize * 2 + 12 : qrSize;
      const structureLineHeight = 14;
      const structureTextWidth = pageWidth * 0.72;
      const structureLines = buildBuyerTitleLines(
        data.structureName,
        structureTextWidth,
        (value) => {
          doc.font('regular').fontSize(10);
          return doc.widthOfString(value);
        },
      );
      const footerReserve =
        structureLines.length * structureLineHeight +
        (qrBuffers.length ? qrSize + 20 : 16) +
        24;

      let y = doc.page.margins.top;

      doc.font('bold').fontSize(11);
      doc.text(`№ ${data.requestCode}`, doc.page.margins.left, y, {
        lineBreak: false,
      });

      const recipientWidth = pageWidth * 0.58;
      const recipientX = doc.page.width - doc.page.margins.right - recipientWidth;
      doc.text(data.recipientLine, recipientX, y, {
        width: recipientWidth,
        align: 'right',
        lineGap: 1,
      });
      const recipientHeight = doc.heightOfString(data.recipientLine, {
        width: recipientWidth,
        lineGap: 1,
      });
      y += Math.max(16, recipientHeight) + 14;

      doc.font('bold').fontSize(14).text('Bildirgi', doc.page.margins.left, y, {
        width: pageWidth,
        align: 'center',
        lineBreak: false,
      });
      y += 22;

      doc.font('regular').fontSize(11).text(data.comment, doc.page.margins.left, y, {
        width: pageWidth,
        align: 'justify',
        lineGap: 1,
      });
      y = doc.y + 16;

      const colWidths = this.buildTableColumnWidths(pageWidth);
      y = this.drawTableRow(
        doc,
        [
          'T/R',
          'Mahsulot nomi',
          'Xususiyat',
          'Miqdor',
          'Birlik',
          'Davlat',
        ],
        colWidths,
        y,
        {
          isHeader: true,
          fontSize: 8.5,
          minHeight: 24,
          alignments: rowAlignments,
        },
      );

      data.items.forEach((item) => {
        const cells = [
          String(item.index),
          item.name,
          item.characteristics,
          String(item.quantity),
          item.unit,
          item.manufacturingCountry,
        ];
        const rowHeightEstimate = this.measureRowHeight(
          doc,
          cells,
          colWidths,
          8.5,
          false,
          22,
          6,
        );

        if (
          y + rowHeightEstimate >
          doc.page.height - doc.page.margins.bottom - footerReserve
        ) {
          doc.addPage();
          y = doc.page.margins.top;
        }

        y = this.drawTableRow(doc, cells, colWidths, y, {
          fontSize: 8.5,
          minHeight: 22,
          alignments: rowAlignments,
        });
      });

      y += 14;
      const structureBlockY = y;

      structureLines.forEach((line, index) => {
        const lineY = structureBlockY + index * structureLineHeight;
        const isLastLine = index === structureLines.length - 1;

        doc
          .font('regular')
          .fontSize(10)
          .text(line, doc.page.margins.left, lineY, {
            width: isLastLine ? structureTextWidth * 0.72 : structureTextWidth,
            align: 'left',
            lineGap: 1,
          });

        if (isLastLine) {
          doc.font('bold').fontSize(11);
          this.placeTextFlushRight(doc, data.structureLeaderName, lineY);
        }
      });

      if (qrBuffers.length) {
        const qrY =
          structureBlockY +
          structureLines.length * structureLineHeight +
          10;
        const qrStartX =
          doc.page.width - doc.page.margins.right - qrRowWidth;

        qrBuffers.forEach((buffer, index) => {
          doc.image(buffer, qrStartX + index * (qrSize + 12), qrY, {
            fit: [qrSize, qrSize],
          });
        });
      }

      doc.end();
    });
  }

  async generateDocx(
    request: PurchaseRequestDocumentSource,
    options: GenerateDocxOptions = {},
  ): Promise<Buffer> {
    const docx = (await import('docx')) as Record<string, unknown>;
    const AlignmentType = docx.AlignmentType as Record<string, string>;
    const BorderStyle = docx.BorderStyle as Record<string, string>;
    const Document = docx.Document as new (options: unknown) => unknown;
    const Packer = docx.Packer as {
      toBuffer: (file: unknown) => Promise<Buffer>;
    };
    const Paragraph = docx.Paragraph as new (options: unknown) => unknown;
    const Table = docx.Table as new (options: unknown) => unknown;
    const TableCell = docx.TableCell as new (options: unknown) => unknown;
    const TableRow = docx.TableRow as new (options: unknown) => unknown;
    const TextRun = docx.TextRun as new (options: unknown) => unknown;
    const ImageRun = docx.ImageRun as new (options: unknown) => unknown;
    const WidthType = docx.WidthType as Record<string, string>;
    const TabStopType = docx.TabStopType as Record<string, string>;
    const VerticalAlign = docx.VerticalAlign as Record<string, string>;
    const TableLayoutType = docx.TableLayoutType as Record<string, string>;

    const ctx: DocumentContext = {
      organizationNameLatin: this.getOrganizationNameLatin(),
      request,
    };
    const bossName = await resolveBossDocumentName(request.boss, this.usersService);
    const data = this.buildRows(ctx, bossName);
    const applicantQrBuffer = options.applicantQrUrl
      ? await this.buildQrImageBuffer(options.applicantQrUrl)
      : null;
    const bossQrBuffer = await this.buildBossQrBuffer(request);
    const qrImages = [applicantQrBuffer, bossQrBuffer].filter(
      (buffer): buffer is Buffer => Boolean(buffer),
    );
    const structureTitleLines = buildBuyerTitleLines(
      data.structureName,
      DOCUMENT_BUYER_TEXT_MAX_WIDTH_PT,
      estimateTextWidth,
    );

    const cellBorder = {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    };

    const makeCell = (
      text: string,
      columnIndex: number,
      options: { bold?: boolean; alignment?: string } = {},
    ) =>
      new TableCell({
        width: {
          size: BILDIRGI_TABLE_COLUMN_WIDTHS[columnIndex],
          type: WidthType.DXA,
        },
        borders: cellBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: options.alignment ?? AlignmentType.LEFT,
            children: [
              new TextRun({
                text,
                bold: options.bold ?? false,
                size: 20,
              }),
            ],
          }),
        ],
      });

    const headerColumns = [
      { text: 'T/R', alignment: AlignmentType.CENTER },
      { text: 'Mahsulot nomi', alignment: AlignmentType.LEFT },
      { text: 'Xususiyat', alignment: AlignmentType.LEFT },
      { text: 'Miqdor', alignment: AlignmentType.CENTER },
      { text: 'Birlik', alignment: AlignmentType.CENTER },
      { text: 'Davlat', alignment: AlignmentType.LEFT },
    ];

    const tableHeader = new TableRow({
      tableHeader: true,
      children: headerColumns.map((column, index) =>
        makeCell(column.text, index, {
          bold: true,
          alignment: column.alignment,
        }),
      ),
    });

    const rowAlignments = [
      AlignmentType.CENTER,
      AlignmentType.LEFT,
      AlignmentType.LEFT,
      AlignmentType.CENTER,
      AlignmentType.CENTER,
      AlignmentType.LEFT,
    ];

    const tableRows = data.items.map((item) =>
      new TableRow({
        children: [
          String(item.index),
          item.name,
          item.characteristics,
          String(item.quantity),
          item.unit,
          item.manufacturingCountry,
        ].map((text, index) =>
          makeCell(text, index, { alignment: rowAlignments[index] }),
        ),
      }),
    );

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1134,
                right: 850,
                bottom: 1134,
                left: 850,
              },
            },
          },
          children: [
            new Paragraph({
              tabStops: [
                {
                  type: TabStopType.RIGHT,
                  position: 9360,
                },
              ],
              children: [
                new TextRun({ text: `№ ${data.requestCode}`, bold: true, size: 22 }),
                new TextRun({ text: '\t', size: 22 }),
                new TextRun({ text: data.recipientLine, bold: true, size: 22 }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 240, after: 120 },
              children: [
                new TextRun({ text: 'Bildirgi', bold: true, size: 32 }),
              ],
            }),
            new Paragraph({
              spacing: { before: 120, after: 420 },
              children: [new TextRun({ text: data.comment, size: 22 })],
            }),
            new Table({
              width: { size: DOCX_CONTENT_WIDTH_DXA, type: WidthType.DXA },
              columnWidths: BILDIRGI_TABLE_COLUMN_WIDTHS,
              layout: TableLayoutType.FIXED,
              borders: cellBorder,
              rows: [tableHeader, ...tableRows],
            }),
            ...structureTitleLines.slice(0, -1).map(
              (line) =>
                new Paragraph({
                  spacing: { before: 120 },
                  children: [new TextRun({ text: line, size: 22 })],
                }),
            ),
            new Paragraph({
              tabStops: [
                {
                  type: TabStopType.RIGHT,
                  position: 9360,
                },
              ],
              spacing: { before: structureTitleLines.length > 1 ? 60 : 220 },
              children: [
                new TextRun({
                  text: structureTitleLines[structureTitleLines.length - 1] ?? '',
                  size: 22,
                }),
                new TextRun({ text: '\t', size: 22 }),
                new TextRun({
                  text: data.structureLeaderName,
                  bold: true,
                  size: 24,
                }),
              ],
            }),
            ...(qrImages.length
              ? [
                  new Paragraph({
                    spacing: { before: 120 },
                    alignment: AlignmentType.LEFT,
                    children: qrImages.map(
                      (buffer) =>
                        new ImageRun({
                          type: 'png',
                          data: buffer,
                          transformation: {
                            width: 92,
                            height: 92,
                          },
                        }),
                    ),
                  }),
                ]
              : []),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  buildFileName(request: PurchaseRequestDocumentSource, extension: 'pdf' | 'docx') {
    return `bildirgi-${request.requestCode}.${extension}`;
  }
}
