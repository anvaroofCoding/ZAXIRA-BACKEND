import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import {
  PDF_FONT_BOLD_PATH,
  PDF_FONT_REGULAR_PATH,
} from '../../common/utils/pdf-fonts.util';
import { buildPurchaseRequestKelishuvPdfPublicUrl } from '../../common/utils/public-url.util';
import { buildQrPngBuffer } from '../../common/utils/qr-code.util';
import { UsersService } from '../users/users.service';
import { ApprovalDecision } from './enums/approval-decision.enum';
import { PurchaseRequestDocument } from './schemas/purchase-request.schema';
import {
  GenerateKelishuvDocxOptions,
  PurchaseRequestDocumentSource,
} from './types/purchase-request-document-source.type';
import {
  AGREEMENT_TITLE_LINES,
  buildBuyerTitleLines,
  DOCUMENT_BUYER_TEXT_MAX_WIDTH_PT,
  estimateTextWidth,
  parseAgreementParagraphs,
} from './utils/document-text-layout.util';
import { resolveBossDocumentName } from './utils/resolve-boss-document-name.util';

/** A4 (11906 DXA) − chap/o‘ng margin 850×2 */
const DOCX_CONTENT_WIDTH_DXA = 10206;
const DOCX_TABLE_COLUMN_WIDTHS = [620, 2100, 5486, 2000];
const DOCX_TABLE_WIDTH_DXA = DOCX_TABLE_COLUMN_WIDTHS.reduce(
  (sum, value) => sum + value,
  0,
);

@Injectable()
export class PurchaseRequestCommissionDocumentService {
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

  private buildPublicPdfUrl(request: PurchaseRequestDocumentSource) {
    return buildPurchaseRequestKelishuvPdfPublicUrl(
      this.configService,
      String(request.id),
    );
  }

  private async buildQrBuffer(
    request: PurchaseRequestDocumentSource,
    options: GenerateKelishuvDocxOptions = {},
  ) {
    if (this.shouldAttachQr(request)) {
      return buildQrPngBuffer(this.buildPublicPdfUrl(request), 240);
    }

    if (options.applicantQrUrl) {
      return buildQrPngBuffer(options.applicantQrUrl, 240);
    }

    return null;
  }

  private getOrganizationNameLatin() {
    return this.configService.get<string>(
      'organization.fullNameLatin',
      '"Toshkent metropoliteni" DUK',
    );
  }

  private formatBossDateLine(confirmedAt?: Date) {
    const year = confirmedAt?.getFullYear() ?? new Date().getFullYear();

    if (!confirmedAt) {
      return `${year}-yil "____" __________`;
    }

    const day = String(confirmedAt.getDate()).padStart(2, '0');
    const month = new Intl.DateTimeFormat('uz-UZ', { month: 'long' }).format(
      confirmedAt,
    );

    return `${year}-yil "${day}" ${month}`;
  }

  private formatMemberSignDate(value: Date) {
    return new Intl.DateTimeFormat('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(value);
  }

  private resolveMemberSignMeta(decision?: {
    decision?: ApprovalDecision;
    decidedAt?: Date;
  }) {
    if (!decision?.decidedAt) {
      return {
        signLabel: '',
        signedAt: '',
        hasSignTicket: false,
        ticketCount: 0,
      };
    }

    const signedAt = this.formatMemberSignDate(decision.decidedAt);

    if (decision.decision === ApprovalDecision.APPROVED) {
      return {
        signLabel: 'Kelishgan',
        signedAt,
        hasSignTicket: true,
        ticketCount: 2,
      };
    }

    if (decision.decision === ApprovalDecision.PARTIAL) {
      return {
        signLabel: 'Qisman kelishgan',
        signedAt,
        hasSignTicket: true,
        ticketCount: 1,
      };
    }

    return {
      signLabel: '',
      signedAt: '',
      hasSignTicket: false,
      ticketCount: 0,
    };
  }

  private placeTextFlushRight(
    doc: PDFKit.PDFDocument,
    text: string,
    y: number,
    fontName: 'regular' | 'bold' = 'regular',
    fontSize = 10,
  ) {
    doc.font(fontName).fontSize(fontSize);
    const textWidth = doc.widthOfString(text);
    const x = doc.page.width - doc.page.margins.right - textWidth;
    doc.text(text, x, y, { lineBreak: false });
  }

  private placeTextCentered(
    doc: PDFKit.PDFDocument,
    text: string,
    y: number,
    pageWidth: number,
    fontName: 'regular' | 'bold' = 'regular',
    fontSize = 10,
  ) {
    doc.font(fontName).fontSize(fontSize);
    const textWidth = doc.widthOfString(text);
    const x = doc.page.margins.left + (pageWidth - textWidth) / 2;
    doc.text(text, x, y, { lineBreak: false });
  }

  private measurePdfText(
    doc: PDFKit.PDFDocument,
    fontName: 'regular' | 'bold',
    fontSize: number,
  ) {
    return (value: string) => {
      doc.font(fontName).fontSize(fontSize);
      return doc.widthOfString(value);
    };
  }

  private buildRows(request: PurchaseRequestDocumentSource, bossName: string) {
    const organizationName = this.getOrganizationNameLatin();
    const structureName = request.applicantStructure?.fullName ?? '—';
    const structureLeaderName =
      request.applicantStructure?.leaderName?.trim() || '—';

    const decisionByUserId = new Map(
      (request.memberDecisions ?? []).map((decision) => [
        String(decision.userId),
        decision,
      ]),
    );

    const members = (request.commissionMembers ?? []).map((member, index) => {
      const decision = decisionByUserId.get(String(member.userId));
      const signMeta = this.resolveMemberSignMeta(decision);

      return {
        index: index + 1,
        name: member.displayName || member.login,
        position:
          member.position?.trim() ||
          decision?.position?.trim() ||
          member.structureShortName?.trim() ||
          '—',
        signLabel: signMeta.signLabel,
        signedAt: signMeta.signedAt,
        hasSignTicket: signMeta.hasSignTicket,
        ticketCount: signMeta.ticketCount,
      };
    });

    const agreementParagraphs = parseAgreementParagraphs(
      request.commissionAgreementText,
    );

    return {
      organizationName,
      bossName,
      bossDateLine: this.formatBossDateLine(request.bossConfirmedAt),
      agreementParagraphs,
      members,
      structureName,
      structureLeaderName,
    };
  }

  private buildTableColumnWidths(pageWidth: number) {
    const weights = [34, 108, 210, 88];
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);

    return weights.map((weight) =>
      Math.floor((weight / totalWeight) * pageWidth),
    );
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
        (index === 0 || index === 3 ? 'center' : 'left');

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

  private drawApprovalTicket(
    doc: PDFKit.PDFDocument,
    cellX: number,
    cellY: number,
    cellWidth: number,
    cellHeight: number,
    ticketCount: number,
    signedAt: string,
  ) {
    const ticketIcon = ticketCount >= 2 ? '✓ ✓' : ticketCount === 1 ? '✓' : '';
    const ticketHeight = 36;
    const ticketY = cellY + (cellHeight - ticketHeight) / 2;

    doc
      .font('bold')
      .fontSize(12)
      .fillColor('#000000')
      .text(ticketIcon, cellX, ticketY + 4, {
        width: cellWidth,
        align: 'center',
        lineBreak: false,
      });

    doc
      .font('regular')
      .fontSize(7.5)
      .fillColor('#000000')
      .text(signedAt, cellX, ticketY + 20, {
        width: cellWidth,
        align: 'center',
        lineBreak: false,
      });
  }

  private drawMemberTableRow(
    doc: PDFKit.PDFDocument,
    member: {
      index: number;
      name: string;
      position: string;
      signLabel: string;
      signedAt: string;
      hasSignTicket: boolean;
      ticketCount: number;
    },
    colWidths: number[],
    y: number,
    fontSize: number,
  ) {
    const padding = 6;
    const minHeight = member.hasSignTicket ? 42 : 22;
    const cells = [
      String(member.index),
      member.name,
      member.position,
      member.signedAt || '',
    ];

    const height = this.measureRowHeight(
      doc,
      cells,
      colWidths,
      fontSize,
      false,
      minHeight,
      padding,
    );

    let x = doc.page.margins.left;
    const alignments: ('left' | 'center' | 'right')[] = [
      'center',
      'left',
      'left',
      'center',
    ];

    cells.forEach((cell, index) => {
      const width = colWidths[index] ?? 40;
      doc.lineWidth(0.75).rect(x, y, width, height).stroke();

      if (index === 3 && member.hasSignTicket && member.ticketCount > 0) {
        this.drawApprovalTicket(
          doc,
          x,
          y,
          width,
          height,
          member.ticketCount,
          member.signedAt,
        );
      } else {
        doc
          .font('regular')
          .fontSize(fontSize)
          .fillColor('#000000')
          .text(cell, x + padding, y + padding, {
            width: width - padding * 2,
            height: height - padding * 2,
            align: alignments[index],
            lineGap: 1,
          });
      }

      x += width;
    });

    return y + height;
  }

  async generatePdf(
    request: PurchaseRequestDocumentSource,
    options: GenerateKelishuvDocxOptions = {},
  ): Promise<Buffer> {
    const bossName = await resolveBossDocumentName(request.boss, this.usersService);
    const data = this.buildRows(request, bossName);
    const qrBuffer = await this.buildQrBuffer(request, options);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 55, right: 55 },
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('regular', PDF_FONT_REGULAR_PATH);
      doc.registerFont('bold', PDF_FONT_BOLD_PATH);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      let y = doc.page.margins.top;

      doc.font('bold').fontSize(11);
      this.placeTextFlushRight(doc, 'TASDIQLAYMAN', y, 'bold', 11);
      y += 20;

      doc.font('regular').fontSize(10);
      this.placeTextFlushRight(
        doc,
        `${data.organizationName} boshlig'i`,
        y,
        'regular',
        10,
      );
      y += 16;

      this.placeTextFlushRight(doc, data.bossName, y, 'regular', 10);
      y += 16;

      this.placeTextFlushRight(doc, data.bossDateLine, y, 'regular', 10);
      y += 26;

      doc.font('regular').fontSize(10);
      AGREEMENT_TITLE_LINES.forEach((line) => {
        this.placeTextCentered(doc, line, y, pageWidth, 'regular', 10);
        y += 14;
      });
      y += 8;

      doc
        .font('bold')
        .fontSize(12)
        .text('KELIShUV VARAQASI', doc.page.margins.left, y, {
          width: pageWidth,
          align: 'center',
        });
      y = doc.y + 18;

      if (data.agreementParagraphs.length) {
        doc.font('regular').fontSize(10);
        data.agreementParagraphs.forEach((paragraph) => {
          const paragraphHeight = doc.heightOfString(paragraph, {
            width: pageWidth,
            align: 'justify',
            lineGap: 2,
          });

          if (y + paragraphHeight > doc.page.height - doc.page.margins.bottom - 80) {
            doc.addPage();
            y = doc.page.margins.top;
          }

          doc.text(paragraph, doc.page.margins.left, y, {
            width: pageWidth,
            align: 'justify',
            lineGap: 2,
          });
          y = doc.y + 10;
        });
        y += 10;
      }

      const colWidths = this.buildTableColumnWidths(pageWidth);
      const rowAlignments: ('left' | 'center' | 'right')[] = [
        'center',
        'left',
        'left',
        'center',
      ];

      y = this.drawTableRow(
        doc,
        ["T/r", "Komissiya a'zosi F.I.Sh.", 'Egallab turgan lavozimi', 'Imzo/sana'],
        colWidths,
        y,
        {
          isHeader: true,
          fontSize: 8.5,
          minHeight: 24,
          alignments: rowAlignments,
        },
      );

      data.members.forEach((member) => {
        const rowHeightEstimate = 30;
        if (y + rowHeightEstimate > doc.page.height - 110) {
          doc.addPage();
          y = doc.page.margins.top;
        }

        y = this.drawMemberTableRow(doc, member, colWidths, y, 8.5);
      });

      y += 22;

      const buyerBlockY = y + 4;
      const buyerTextWidth = pageWidth * 0.7;
      const buyerLineHeight = 14;

      doc
        .font('bold')
        .fontSize(10)
        .text('Buyurtmachi:', doc.page.margins.left, buyerBlockY, {
          width: buyerTextWidth,
          align: 'left',
          lineBreak: false,
        });

      const buyerTitleY = buyerBlockY + 18;
      const buyerTitleLines = buildBuyerTitleLines(
        data.structureName,
        buyerTextWidth,
        this.measurePdfText(doc, 'regular', 10),
      );

      buyerTitleLines.forEach((line, index) => {
        const lineY = buyerTitleY + index * buyerLineHeight;
        const isLastLine = index === buyerTitleLines.length - 1;

        doc
          .font('bold')
          .fontSize(10)
          .text(line, doc.page.margins.left, lineY, {
            width: isLastLine ? buyerTextWidth * 0.72 : buyerTextWidth,
            align: 'left',
            lineBreak: false,
          });

        if (isLastLine) {
          doc.font('bold').fontSize(11);
          this.placeTextFlushRight(
            doc,
            data.structureLeaderName,
            lineY,
            'bold',
            11,
          );
        }
      });

      let contentEndY =
        buyerTitleY + buyerTitleLines.length * buyerLineHeight + 12;

      if (qrBuffer) {
        const qrSize = 96;
        const qrY = contentEndY + 24;
        doc.image(qrBuffer, doc.page.margins.left, qrY, { fit: [qrSize, qrSize] });
        contentEndY = qrY + qrSize + 16;
      }

      doc.y = contentEndY;
      doc.x = doc.page.margins.left;

      doc.end();
    });
  }

  async generateDocx(
    request: PurchaseRequestDocumentSource,
    options: GenerateKelishuvDocxOptions = {},
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

    const bossName = await resolveBossDocumentName(request.boss, this.usersService);
    const data = this.buildRows(request, bossName);
    const qrBuffer = await this.buildQrBuffer(request, options);
    const buyerTitleLines = buildBuyerTitleLines(
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
      options: {
        bold?: boolean;
        alignment?: string;
        children?: unknown[];
      } = {},
    ) =>
      new TableCell({
        width: {
          size: DOCX_TABLE_COLUMN_WIDTHS[columnIndex],
          type: WidthType.DXA,
        },
        borders: cellBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: options.children ?? [
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

    const makeSignDecisionCell = (ticketCount: number, signedAt: string) => {
      const ticketIcon = ticketCount >= 2 ? '✓ ✓' : ticketCount === 1 ? '✓' : '';

      return makeCell('', 3, {
        alignment: AlignmentType.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60, line: 276 },
            children: [
              new TextRun({
                text: ticketIcon,
                bold: true,
                size: 24,
                color: '000000',
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 276 },
            children: [new TextRun({ text: signedAt, size: 20 })],
          }),
        ],
      });
    };

    const tableHeader = new TableRow({
      tableHeader: true,
      children: [
        makeCell('T/r', 0, {
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
        makeCell("Komissiya a'zosi F.I.Sh.", 1, {
          bold: true,
        }),
        makeCell('Egallab turgan lavozimi', 2, {
          bold: true,
        }),
        makeCell('Imzo/sana', 3, {
          bold: true,
          alignment: AlignmentType.CENTER,
        }),
      ],
    });

    const tableRows = data.members.map(
      (member) =>
        new TableRow({
          children: [
            makeCell(String(member.index), 0, {
              alignment: AlignmentType.CENTER,
            }),
            makeCell(member.name, 1),
            makeCell(member.position, 2),
            member.hasSignTicket && member.ticketCount > 0 && member.signedAt
              ? makeSignDecisionCell(member.ticketCount, member.signedAt)
              : makeCell('', 3, {
                  alignment: AlignmentType.CENTER,
                }),
          ],
        }),
    );

    const noBorder = {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };

    const buyerFooterChildren: unknown[] = [
      new Paragraph({
        spacing: { before: 120 },
        children: [new TextRun({ text: 'Buyurtmachi:', bold: true, size: 22 })],
      }),
      ...buyerTitleLines.slice(0, -1).map(
        (line) =>
          new Paragraph({
            spacing: { before: 60, line: 276 },
            children: [
              new TextRun({
                text: line,
                bold: true,
                size: 24,
              }),
            ],
          }),
      ),
      new Paragraph({
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: 9360,
          },
        ],
        spacing: {
          before: buyerTitleLines.length > 1 ? 60 : 120,
          after: qrBuffer ? 120 : 0,
          line: 276,
        },
        children: [
          new TextRun({
            text: buyerTitleLines[buyerTitleLines.length - 1] ?? '',
            bold: true,
            size: 24,
          }),
          new TextRun({ text: '\t', size: 22 }),
          new TextRun({
            text: data.structureLeaderName,
            bold: true,
            size: 24,
          }),
        ],
      }),
    ];

    if (qrBuffer) {
      buyerFooterChildren.push(
        new Paragraph({
          spacing: { before: 280, after: 160 },
          alignment: AlignmentType.LEFT,
          children: [
            new ImageRun({
              type: 'png',
              data: qrBuffer,
              transformation: {
                width: 110,
                height: 110,
              },
            }),
          ],
        }),
      );
    }

    const document = new Document({
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
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'TASDIQLAYMAN', bold: true, size: 22 })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: `${data.organizationName} boshlig'i`,
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: data.bossName, size: 22 })],
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 200 },
              children: [new TextRun({ text: data.bossDateLine, size: 22 })],
            }),
            ...AGREEMENT_TITLE_LINES.map(
              (line) =>
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 40, line: 276 },
                  children: [
                    new TextRun({
                      text: line,
                      size: 22,
                    }),
                  ],
                }),
            ),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 240, line: 276 },
              children: [
                new TextRun({
                  text: 'KELIShUV VARAQASI',
                  bold: true,
                  size: 28,
                }),
              ],
            }),
            ...data.agreementParagraphs.map(
              (paragraph) =>
                new Paragraph({
                  alignment: AlignmentType.JUSTIFIED,
                  spacing: { after: 200, line: 276 },
                  children: [new TextRun({ text: paragraph, size: 22 })],
                }),
            ),
            new Table({
              width: { size: DOCX_TABLE_WIDTH_DXA, type: WidthType.DXA },
              columnWidths: DOCX_TABLE_COLUMN_WIDTHS,
              layout: TableLayoutType.FIXED,
              borders: cellBorder,
              rows: [tableHeader, ...tableRows],
            }),
            new Table({
              width: { size: DOCX_TABLE_WIDTH_DXA, type: WidthType.DXA },
              columnWidths: [DOCX_TABLE_WIDTH_DXA],
              layout: TableLayoutType.FIXED,
              borders: noBorder,
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      borders: noBorder,
                      width: {
                        size: DOCX_TABLE_WIDTH_DXA,
                        type: WidthType.DXA,
                      },
                      children: buyerFooterChildren,
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(document);
  }

  buildFileName(request: PurchaseRequestDocumentSource, extension: 'pdf' | 'docx') {
    return `kelishuv-${request.requestCode}.${extension}`;
  }
}
