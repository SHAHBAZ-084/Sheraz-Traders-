import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type ReportLetterheadConfig = {
  companyName: string;
  subtitle: string;
  email?: string;
  contacts?: ReadonlyArray<{ name: string; phone: string }>;
};

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

export function downloadExcel(filename: string, sheetName: string, headers: string[], rows: (string | number)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  triggerDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export function downloadPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: (string | number)[][],
  options?: {
    subtitle?: string;
    letterhead?: ReportLetterheadConfig;
  },
) {
  const doc = new jsPDF({ orientation: rows[0]?.length > 6 ? 'landscape' : 'portrait' });
  let y = 14;

  if (options?.letterhead) {
    y = writeCenteredLines(doc, [options.letterhead.companyName], y, 14, { fontStyle: 'bold' });
    doc.setFont('helvetica', 'normal');
    const detailLines = [
      options.letterhead.subtitle,
      ...(options.letterhead.email ? [`Email: ${options.letterhead.email}`] : []),
      ...(options.letterhead.contacts?.length
        ? [options.letterhead.contacts.map((c) => `${c.name}: ${c.phone}`).join(' · ')]
        : []),
    ];
    y = writeCenteredLines(doc, detailLines, y, 10);
    y += 4;
  }

  y = writeCenteredLines(doc, [title], y, 13, { fontStyle: 'bold' });
  doc.setFont('helvetica', 'normal');
  y += 2;

  if (options?.subtitle) {
    y = writeCenteredLines(doc, [options.subtitle], y, 9);
    y += 2;
  }

  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map(String)),
    startY: y,
    theme: 'plain',
    styles: {
      fontSize: 8,
      cellPadding: 2,
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
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
  });

  const pdfBlob = doc.output('blob');
  triggerDownload(pdfBlob, filename);
}
