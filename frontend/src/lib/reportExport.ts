import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Styles } from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { writeBusinessLetterheadToPdf, type ReportLetterheadConfig } from './letterheadPdf';

export type { ReportLetterheadConfig };

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function writeCenteredLines(
  doc: jsPDF,
  lines: string[],
  startY: number,
  fontSize: number,
  options?: { fontStyle?: 'normal' | 'bold' },
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  doc.setFontSize(fontSize);
  if (options?.fontStyle) {
    doc.setFont('helvetica', options.fontStyle);
  } else {
    doc.setFont('helvetica', 'normal');
  }
  let y = startY;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(line, pageWidth - margin * 2) as string[];
    for (const part of wrapped) {
      doc.text(part, pageWidth / 2, y, { align: 'center' });
      y += fontSize >= 13 ? 6 : 5;
    }
  }
  return y;
}

async function embedLetterheadFromElement(doc: jsPDF, element: HTMLElement, startY: number): Promise<number> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: (clonedDoc) => {
      const clonedLetterhead = clonedDoc.querySelector('.report-letterhead');
      if (clonedLetterhead instanceof HTMLElement) {
        clonedLetterhead.style.overflow = 'visible';
        clonedLetterhead.style.paddingBottom = '6px';
      }
      clonedDoc.querySelectorAll('.report-letterhead__report, .report-letterhead__subtitle').forEach((node) => {
        if (node instanceof HTMLElement) {
          node.style.overflow = 'visible';
          node.style.paddingBottom = '4px';
          node.style.lineHeight = '1.5';
        }
      });
    },
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const dataUrl = canvas.toDataURL('image/png');

  doc.addImage(dataUrl, 'PNG', margin, startY, imgWidth, imgHeight, undefined, 'FAST');
  return startY + imgHeight + 4;
}

const PDF_AMOUNT_FONT_SIZE = 12;
const PDF_BODY_FONT_SIZE = 8;
/** Helvetica digit width as a fraction of font size (points). */
const HELVETICA_DIGIT_WIDTH = 0.56;
const PT_TO_MM = 0.352778;
const PDF_CELL_PAD_X_MM = 4;

function pdfWidthForSample(sample: string, fontSizePt: number): number {
  return Math.ceil(sample.length * fontSizePt * HELVETICA_DIGIT_WIDTH * PT_TO_MM + PDF_CELL_PAD_X_MM);
}

/** Debit/Credit: 8-digit millions e.g. 11,300,000.00 */
const PDF_AMOUNT_COL_WIDTH_MM = pdfWidthForSample('99,999,999.99', PDF_AMOUNT_FONT_SIZE);
/** Balance/Value with trailing Dr/Cr — extra glyphs Debit/Credit do not have */
const PDF_BALANCE_COL_WIDTH_MM = pdfWidthForSample('99,999,999.99 Dr', PDF_AMOUNT_FONT_SIZE);

function isPdfAmountColumn(header: string): boolean {
  const label = header.toLowerCase();
  return (
    label.includes('debit') ||
    label.includes('credit') ||
    label.includes('amount') ||
    label.includes('balance') ||
    label.includes('profit') ||
    label.includes('price') ||
    label.includes('mazduri') ||
    label === 'value'
  );
}

function isPdfBalanceColumn(header: string): boolean {
  const label = header.toLowerCase();
  return label.includes('balance') || label === 'value';
}

function buildPdfColumnStyles(headers: string[]): Record<number, Partial<Styles>> {
  const styles: Record<number, Partial<Styles>> = {};

  headers.forEach((header, index) => {
    const label = header.toLowerCase();
    const amountStyle: Partial<Styles> = {
      cellWidth: isPdfBalanceColumn(header) ? PDF_BALANCE_COL_WIDTH_MM : PDF_AMOUNT_COL_WIDTH_MM,
      halign: 'right',
      fontSize: PDF_AMOUNT_FONT_SIZE,
      fontStyle: 'normal',
      overflow: 'linebreak',
    };

    if (label.includes('date')) {
      styles[index] = { cellWidth: 19 };
      return;
    }
    if (label.includes('voucher')) {
      styles[index] = { cellWidth: 13, halign: 'right' };
      return;
    }
    if (label.includes('ref')) {
      styles[index] = { cellWidth: 12 };
      return;
    }
    if (label === 'type') {
      styles[index] = { cellWidth: 16, overflow: 'linebreak' };
      return;
    }
    if (label.includes('description') || label.includes('product name') || label === 'account' || label.includes('account name')) {
      styles[index] = { cellWidth: 'auto', overflow: 'linebreak' };
      return;
    }
    if (isPdfAmountColumn(header)) {
      styles[index] = amountStyle;
      return;
    }
    if (label.includes('account code')) {
      styles[index] = { cellWidth: 18 };
      return;
    }
    if (label.includes('from/debit') || label.includes('to/credit')) {
      styles[index] = { cellWidth: 24, overflow: 'linebreak' };
      return;
    }
    if (label.includes('status')) {
      styles[index] = { cellWidth: 14 };
    }
  });

  return styles;
}

export function downloadExcel(filename: string, sheetName: string, headers: string[], rows: (string | number)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = headers.map((header, index) => {
    let maxLen = header.length;
    for (const row of rows) {
      maxLen = Math.max(maxLen, String(row[index] ?? '').length);
    }
    if (isPdfBalanceColumn(header)) {
      return { wch: Math.max(maxLen + 2, 20) };
    }
    if (isPdfAmountColumn(header)) {
      return { wch: Math.max(maxLen + 2, 14) };
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export async function downloadPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
  options?: {
    subtitle?: string;
    letterhead?: ReportLetterheadConfig;
    letterheadElement?: HTMLElement | null;
    orientation?: 'portrait' | 'landscape';
    /** Summary row(s) repeated at the bottom of every PDF page (e.g. ledger totals). */
    footerRows?: (string | number)[][];
  },
) {
  const doc = new jsPDF({
    orientation: options?.orientation ?? ((rows[0]?.length ?? headers.length) >= 6 ? 'landscape' : 'portrait'),
  });
  let y = 14;

  if (options?.letterheadElement) {
    y = await embedLetterheadFromElement(doc, options.letterheadElement, y);
  } else if (options?.letterhead) {
    y = writeBusinessLetterheadToPdf(doc, options.letterhead, y);
    y = writeCenteredLines(doc, [title], y, 14, { fontStyle: 'bold' });
    doc.setFont('helvetica', 'normal');
    y += 2;
    if (options?.subtitle) {
      y = writeCenteredLines(doc, [options.subtitle], y, 9);
      y += 2;
    }
  } else {
    y = writeCenteredLines(doc, [title], y, 14, { fontStyle: 'bold' });
    doc.setFont('helvetica', 'normal');
    y += 2;
    if (options?.subtitle) {
      y = writeCenteredLines(doc, [options.subtitle], y, 9);
      y += 2;
    }
  }

  const footerRows = options?.footerRows?.map((row) => row.map(String));
  const columnStyles = buildPdfColumnStyles(headers);

  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map(String)),
    ...(footerRows?.length ? { foot: footerRows, showFoot: 'lastPage' as const } : {}),
    startY: y + 2,
    margin: { top: 14, right: 14, bottom: 14, left: 14 },
    theme: 'plain',
    styles: {
      fontSize: PDF_BODY_FONT_SIZE,
      cellPadding: { top: 1.8, right: 2, bottom: 2.2, left: 2 },
      minCellHeight: 6,
      valign: 'middle',
      overflow: 'linebreak',
      fillColor: [255, 255, 255],
      lineColor: [210, 210, 210],
      lineWidth: 0.1,
      textColor: [30, 30, 30],
    },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [40, 40, 40],
      fontStyle: 'bold',
      lineWidth: 0.1,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      minCellHeight: 7,
      valign: 'middle',
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      lineWidth: 0.1,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      minCellHeight: 7,
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    columnStyles,
    didParseCell(data) {
      if (data.section === 'body' && isPdfAmountColumn(headers[data.column.index] ?? '')) {
        data.cell.styles.fontSize = PDF_AMOUNT_FONT_SIZE;
      }
      if (data.section === 'foot' && isPdfAmountColumn(headers[data.column.index] ?? '')) {
        data.cell.styles.fontSize = PDF_AMOUNT_FONT_SIZE;
      }
    },
  });

  const pdfBlob = doc.output('blob');
  triggerDownload(pdfBlob, filename);
}
