import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import {
  PDF_FONT_BOLD_PATH,
  PDF_FONT_REGULAR_PATH,
} from '../../common/utils/pdf-fonts.util';
import { WAREHOUSE_DISPATCH_STATUS_LABELS } from './enums/warehouse-dispatch-status.enum';
import { WarehouseDispatchDocument } from './schemas/warehouse-dispatch.schema';

/** A4 (11906 DXA) − chap/o‘ng margin 850×2 */
const DOCX_CONTENT_WIDTH_DXA = 10206;
const NAKLADNOY_EMPTY_TABLE_ROWS = 5;
const NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITH_CHARS = [32, 120, 168, 60];
const NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITHOUT_CHARS = [40, 200, 80];

const buildDocxColumnWidths = (weights: number[]) => {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((weight) =>
    Math.floor((weight / totalWeight) * DOCX_CONTENT_WIDTH_DXA),
  );
  const used = widths.reduce((sum, value) => sum + value, 0);
  widths[widths.length - 1] += DOCX_CONTENT_WIDTH_DXA - used;
  return widths;
};

const DOCX_TABLE_COLUMN_WIDTHS_WITH_CHARS = buildDocxColumnWidths(
  NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITH_CHARS,
);
const DOCX_TABLE_COLUMN_WIDTHS_WITHOUT_CHARS = buildDocxColumnWidths(
  NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITHOUT_CHARS,
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

  private formatStructureShortName(
    structure?: { shortName?: string; fullName?: string },
  ) {
    return structure?.shortName?.trim() || structure?.fullName?.trim() || '—';
  }

  private buildTableColumnWidths(pageWidth: number, showCharacteristics: boolean) {
    const weights = showCharacteristics
      ? NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITH_CHARS
      : NAKLADNOY_TABLE_COLUMN_WEIGHTS_WITHOUT_CHARS;
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
    const fontSize = options.fontSize ?? 9;
    const minHeight = options.minHeight ?? (isHeader ? 26 : 24);
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

      const defaultAlign =
        index === 0 || index === cells.length - 1 ? 'center' : 'left';
      const align = options.alignments?.[index] ?? defaultAlign;

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

  private drawPageBorder(doc: PDFKit.PDFDocument) {
    const inset = 18;
    doc
      .lineWidth(1)
      .rect(
        inset,
        inset,
        doc.page.width - inset * 2,
        doc.page.height - inset * 2,
      )
      .stroke();
  }

  private drawMetaField(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
  ) {
    doc.font('regular').fontSize(9.5).fillColor('#000000');
    const labelText = `${label}: `;
    const labelWidth = doc.widthOfString(labelText);
    doc.text(labelText, x, y, { lineBreak: false });
    doc
      .font('bold')
      .text(value, x + labelWidth, y, {
        width: Math.max(width - labelWidth, 40),
        lineBreak: false,
      });
  }

  private drawMetadataSection(
    doc: PDFKit.PDFDocument,
    dispatch: WarehouseDispatchDocument,
    y: number,
    pageWidth: number,
  ) {
    const leftX = doc.page.margins.left;
    const rightX = doc.page.margins.left + pageWidth / 2 + 8;
    const colWidth = pageWidth / 2 - 8;
    const lineHeight = 18;
    const senderName =
      dispatch.dispatchedBy.displayName || dispatch.dispatchedBy.login;

    const rows: Array<{ left?: [string, string]; right?: [string, string] }> = [
      {
        left: ['Nakladnoy raqami', dispatch.dispatchCode],
        right: ['Jo‘natilgan sana', this.formatDate(dispatch.dispatchedAt)],
      },
      {
        left: ['Ariza ID', dispatch.requestCode],
        right: [
          'Rejalashtirilgan kelish',
          this.formatDate(dispatch.plannedArrivalAt),
        ],
      },
      {
        left: [
          'Qabul qiluvchi tuzilma',
          this.formatStructureShortName(dispatch.targetStructure),
        ],
        right: ['Holat', WAREHOUSE_DISPATCH_STATUS_LABELS[dispatch.status]],
      },
    ];

    if (dispatch.sourceStructure) {
      rows.push({
        left: [
          'Jo‘natuvchi tuzilma',
          this.formatStructureShortName(dispatch.sourceStructure),
        ],
        right: ['Jo‘natuvchi', senderName],
      });
    } else {
      rows.push({
        left: ['Jo‘natuvchi', senderName],
      });
    }

    rows.forEach((row) => {
      if (row.left) {
        this.drawMetaField(doc, row.left[0], row.left[1], leftX, y, colWidth);
      }
      if (row.right) {
        this.drawMetaField(
          doc,
          row.right[0],
          row.right[1],
          rightX,
          y,
          colWidth,
        );
      }
      y += lineHeight;
    });

    return y;
  }

  private drawSignatureSection(
    doc: PDFKit.PDFDocument,
    y: number,
    pageWidth: number,
  ) {
    const leftX = doc.page.margins.left;
    const rightX = doc.page.margins.left + pageWidth / 2 + 8;
    const colWidth = pageWidth / 2 - 8;
    const lineHeight = 16;

    doc.font('regular').fontSize(9.5).fillColor('#000000');
    doc.text('Jo‘natuvchi: _________________________', leftX, y, {
      width: colWidth,
      lineBreak: false,
    });
    doc.text('Qabul qiluvchi: ______________________', rightX, y, {
      width: colWidth,
      lineBreak: false,
    });
    y += lineHeight + 4;

    doc.text('Imzo: _______________________________', leftX, y, {
      width: colWidth,
      lineBreak: false,
    });
    doc.text('Imzo: _______________________________', rightX, y, {
      width: colWidth,
      lineBreak: false,
    });

    return y + lineHeight;
  }

  buildFileName(dispatch: WarehouseDispatchDocument, ext: 'pdf' | 'docx') {
    return `nakladnoy-${dispatch.dispatchCode}.${ext}`;
  }

  async generatePdf(dispatch: WarehouseDispatchDocument): Promise<Buffer> {
    const org = this.getOrganizationName();
    const showCharacteristics = dispatch.items.some((item) =>
      item.characteristics?.trim(),
    );

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 56, bottom: 56, left: 58, right: 58 },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('regular', PDF_FONT_REGULAR_PATH);
      doc.registerFont('bold', PDF_FONT_BOLD_PATH);

      this.drawPageBorder(doc);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidths = this.buildTableColumnWidths(pageWidth, showCharacteristics);
      const rowAlignments: ('left' | 'center' | 'right')[] = showCharacteristics
        ? ['center', 'left', 'left', 'center']
        : ['center', 'left', 'center'];
      const headerCells = showCharacteristics
        ? ['T/R', 'Tovar nomi', 'Xususiyatlari', 'Soni']
        : ['T/R', 'Tovar nomi', 'Soni'];
      const footerReserve = 90;

      let y = doc.page.margins.top;

      doc
        .font('bold')
        .fontSize(12)
        .text(org, doc.page.margins.left, y, {
          width: pageWidth,
          align: 'center',
          lineGap: 1,
        });
      y = doc.y + 10;

      doc
        .font('bold')
        .fontSize(13)
        .text('NAKLADNOY', doc.page.margins.left, y, {
          width: pageWidth,
          align: 'center',
          lineBreak: false,
        });
      y += 24;

      y = this.drawMetadataSection(doc, dispatch, y, pageWidth);
      y += 14;

      y = this.drawTableRow(doc, headerCells, colWidths, y, {
        isHeader: true,
        fontSize: 9,
        minHeight: 26,
        alignments: rowAlignments,
      });

      dispatch.items.forEach((item, index) => {
        const cells = showCharacteristics
          ? [
              String(index + 1),
              item.name,
              item.characteristics?.trim() || '—',
              String(item.quantityDispatched),
            ]
          : [String(index + 1), item.name, String(item.quantityDispatched)];

        const rowHeightEstimate = this.measureRowHeight(
          doc,
          cells,
          colWidths,
          9,
          false,
          24,
          6,
        );

        if (
          y + rowHeightEstimate >
          doc.page.height - doc.page.margins.bottom - footerReserve
        ) {
          doc.addPage();
          this.drawPageBorder(doc);
          y = doc.page.margins.top;
          y = this.drawTableRow(doc, headerCells, colWidths, y, {
            isHeader: true,
            fontSize: 9,
            minHeight: 26,
            alignments: rowAlignments,
          });
        }

        y = this.drawTableRow(doc, cells, colWidths, y, {
          fontSize: 9,
          minHeight: 24,
          alignments: rowAlignments,
        });
      });

      const emptyCells = showCharacteristics
        ? ['', '', '', '']
        : ['', '', ''];

      for (let index = 0; index < NAKLADNOY_EMPTY_TABLE_ROWS; index += 1) {
        const rowHeightEstimate = this.measureRowHeight(
          doc,
          emptyCells,
          colWidths,
          9,
          false,
          28,
          6,
        );

        if (
          y + rowHeightEstimate >
          doc.page.height - doc.page.margins.bottom - footerReserve
        ) {
          doc.addPage();
          this.drawPageBorder(doc);
          y = doc.page.margins.top;
          y = this.drawTableRow(doc, headerCells, colWidths, y, {
            isHeader: true,
            fontSize: 9,
            minHeight: 26,
            alignments: rowAlignments,
          });
        }

        y = this.drawTableRow(doc, emptyCells, colWidths, y, {
          fontSize: 9,
          minHeight: 28,
          alignments: rowAlignments,
        });
      }

      y += 20;
      if (y > doc.page.height - doc.page.margins.bottom - footerReserve) {
        doc.addPage();
        this.drawPageBorder(doc);
        y = doc.page.margins.top;
      }

      this.drawSignatureSection(doc, y, pageWidth);

      doc.end();
    });
  }

  async generateDocx(dispatch: WarehouseDispatchDocument): Promise<Buffer> {
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
    const WidthType = docx.WidthType as Record<string, string>;
    const TableLayoutType = docx.TableLayoutType as Record<string, string>;
    const VerticalAlign = docx.VerticalAlign as Record<string, string>;
    const TabStopType = docx.TabStopType as Record<string, string>;

    const org = this.getOrganizationName();
    const showCharacteristics = dispatch.items.some((item) =>
      item.characteristics?.trim(),
    );
    const columnWidths = showCharacteristics
      ? DOCX_TABLE_COLUMN_WIDTHS_WITH_CHARS
      : DOCX_TABLE_COLUMN_WIDTHS_WITHOUT_CHARS;
    const senderName =
      dispatch.dispatchedBy.displayName || dispatch.dispatchedBy.login;

    const cellBorder = {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    };

    const makeCell = (
      text: string,
      columnIndex: number,
      options: { bold?: boolean; alignment?: string; minHeight?: number } = {},
    ) =>
      new TableCell({
        width: {
          size: columnWidths[columnIndex],
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

    const rowAlignments = showCharacteristics
      ? [
          AlignmentType.CENTER,
          AlignmentType.LEFT,
          AlignmentType.LEFT,
          AlignmentType.CENTER,
        ]
      : [AlignmentType.CENTER, AlignmentType.LEFT, AlignmentType.CENTER];

    const headerColumns = showCharacteristics
      ? [
          { text: 'T/R', alignment: AlignmentType.CENTER },
          { text: 'Tovar nomi', alignment: AlignmentType.LEFT },
          { text: 'Xususiyatlari', alignment: AlignmentType.LEFT },
          { text: 'Soni', alignment: AlignmentType.CENTER },
        ]
      : [
          { text: 'T/R', alignment: AlignmentType.CENTER },
          { text: 'Tovar nomi', alignment: AlignmentType.LEFT },
          { text: 'Soni', alignment: AlignmentType.CENTER },
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

    const itemRows = dispatch.items.map((item, index) => {
      const cells = showCharacteristics
        ? [
            String(index + 1),
            item.name,
            item.characteristics?.trim() || '—',
            String(item.quantityDispatched),
          ]
        : [String(index + 1), item.name, String(item.quantityDispatched)];

      return new TableRow({
        children: cells.map((text, cellIndex) =>
          makeCell(text, cellIndex, { alignment: rowAlignments[cellIndex] }),
        ),
      });
    });

    const emptyRows = Array.from({ length: NAKLADNOY_EMPTY_TABLE_ROWS }, () => {
      const cells = showCharacteristics ? ['', '', '', ''] : ['', '', ''];
      return new TableRow({
        children: cells.map((text, cellIndex) =>
          makeCell(text, cellIndex, { alignment: rowAlignments[cellIndex] }),
        ),
      });
    });

    const metaLine = (left: string, right: string) =>
      new Paragraph({
        spacing: { after: 80 },
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        children: [
          new TextRun({ text: left, size: 20 }),
          new TextRun({ text: '\t', size: 20 }),
          new TextRun({ text: right, size: 20 }),
        ],
      });

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
              pageBorderTop: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: '000000',
                space: 18,
              },
              pageBorderBottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: '000000',
                space: 18,
              },
              pageBorderLeft: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: '000000',
                space: 18,
              },
              pageBorderRight: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: '000000',
                space: 18,
              },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: org, bold: true, size: 26 })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 240 },
              children: [
                new TextRun({ text: 'NAKLADNOY', bold: true, size: 28 }),
              ],
            }),
            metaLine(
              `Nakladnoy raqami: ${dispatch.dispatchCode}`,
              `Jo‘natilgan sana: ${this.formatDate(dispatch.dispatchedAt)}`,
            ),
            metaLine(
              `Ariza ID: ${dispatch.requestCode}`,
              `Rejalashtirilgan kelish: ${this.formatDate(dispatch.plannedArrivalAt)}`,
            ),
            metaLine(
              `Qabul qiluvchi tuzilma: ${this.formatStructureShortName(dispatch.targetStructure)}`,
              `Holat: ${WAREHOUSE_DISPATCH_STATUS_LABELS[dispatch.status]}`,
            ),
            ...(dispatch.sourceStructure
              ? [
                  metaLine(
                    `Jo‘natuvchi tuzilma: ${this.formatStructureShortName(dispatch.sourceStructure)}`,
                    `Jo‘natuvchi: ${senderName}`,
                  ),
                ]
              : [metaLine(`Jo‘natuvchi: ${senderName}`, '')]),
            new Paragraph({ text: '' }),
            new Table({
              width: { size: DOCX_CONTENT_WIDTH_DXA, type: WidthType.DXA },
              columnWidths,
              layout: TableLayoutType.FIXED,
              borders: cellBorder,
              rows: [tableHeader, ...itemRows, ...emptyRows],
            }),
            new Paragraph({ text: '' }),
            new Paragraph({
              spacing: { before: 240 },
              tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
              children: [
                new TextRun({
                  text: 'Jo‘natuvchi: _________________________',
                  size: 20,
                }),
                new TextRun({ text: '\t', size: 20 }),
                new TextRun({
                  text: 'Qabul qiluvchi: ______________________',
                  size: 20,
                }),
              ],
            }),
            new Paragraph({
              spacing: { before: 120 },
              tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
              children: [
                new TextRun({
                  text: 'Imzo: _______________________________',
                  size: 20,
                }),
                new TextRun({ text: '\t', size: 20 }),
                new TextRun({
                  text: 'Imzo: _______________________________',
                  size: 20,
                }),
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }
}
