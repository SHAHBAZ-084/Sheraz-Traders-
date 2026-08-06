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
    letterhead?: {
      companyName: string;
      subtitle: string;
      email?: string;
      contacts?: ReadonlyArray<{ name: string; phone: string }>;
    };
  },
) {
  const doc = new jsPDF({ orientation: rows[0]?.length > 6 ? 'landscape' : 'portrait' });
  let y = 14;
  if (options?.letterhead) {
    doc.setFontSize(14);
    doc.text(options.letterhead.companyName, 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.text(options.letterhead.subtitle, 14, y);
    y += 5;
    if (options.letterhead.email) {
      doc.text(`Email: ${options.letterhead.email}`, 14, y);
      y += 5;
    }
    if (options.letterhead.contacts && options.letterhead.contacts.length > 0) {
      const contactText = options.letterhead.contacts
        .map((c) => `${c.name}: ${c.phone}`)
        .join(' · ');
      doc.text(contactText, 14, y);
      y += 6;
    } else {
      y += 2;
    }
  }
  doc.setFontSize(13);
  doc.text(title, 14, y);
  y += 6;
  if (options?.subtitle) {
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(options.subtitle, 270);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 2;
  }
  autoTable(doc, {
    head: [headers],
    body: rows.map((row) => row.map(String)),
    startY: y,
    styles: { fontSize: 8 },
  });
  const pdfBlob = doc.output('blob');
  triggerDownload(pdfBlob, filename);
}
