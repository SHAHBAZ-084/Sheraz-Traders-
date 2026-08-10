import type { jsPDF } from 'jspdf';

export type ReportLetterheadConfig = {
  companyName: string;
  subtitle: string;
  email?: string;
  contacts?: ReadonlyArray<{ name: string; phone: string }>;
};

const BRAND_GREEN_RGB: [number, number, number] = [27, 67, 50];
const BRAND_GOLD_RGB: [number, number, number] = [192, 138, 46];
const BORDER_RGB: [number, number, number] = [216, 212, 200];

function drawFilledDiamond(
  doc: jsPDF,
  cx: number,
  cy: number,
  width: number,
  height: number,
  color: [number, number, number],
) {
  const hw = width / 2;
  const hh = height / 2;
  doc.setFillColor(...color);
  doc.setDrawColor(...color);
  doc.triangle(cx, cy - hh, cx + hw, cy, cx, cy + hh, 'F');
  doc.triangle(cx, cy - hh, cx - hw, cy, cx, cy + hh, 'F');
}

function drawCircleIcon(doc: jsPDF, cx: number, cy: number, radius: number) {
  doc.setDrawColor(...BRAND_GREEN_RGB);
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, radius, 'S');
}

function drawEnvelopeIcon(doc: jsPDF, cx: number, cy: number, radius: number) {
  drawCircleIcon(doc, cx, cy, radius);
  const w = radius * 1.15;
  const h = radius * 0.75;
  const left = cx - w / 2;
  const top = cy - h / 2 + 0.2;
  doc.setDrawColor(...BRAND_GREEN_RGB);
  doc.setLineWidth(0.22);
  doc.rect(left, top, w, h, 'S');
  doc.line(left, top, cx, cy + 0.15);
  doc.line(left + w, top, cx, cy + 0.15);
}

function drawPersonIcon(doc: jsPDF, cx: number, cy: number, radius: number) {
  drawCircleIcon(doc, cx, cy, radius);
  doc.setDrawColor(...BRAND_GREEN_RGB);
  doc.setLineWidth(0.22);
  doc.circle(cx, cy - radius * 0.28, radius * 0.28, 'S');
  doc.line(cx - radius * 0.55, cy + radius * 0.55, cx + radius * 0.55, cy + radius * 0.55);
}

function drawTaglineOrnamentRow(doc: jsPDF, y: number, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_GOLD_RGB);
  const text = subtitle.toUpperCase();
  const textWidth = doc.getTextWidth(text);
  doc.text(text, centerX, y, { align: 'center' });

  const lineLength = 14;
  const gap = 2.5;
  const diamondW = 1.6;
  const diamondH = 1.6;
  const lineY = y - 1.2;

  doc.setDrawColor(...BRAND_GOLD_RGB);
  doc.setLineWidth(0.25);

  const leftLineEnd = centerX - textWidth / 2 - gap;
  const leftLineStart = leftLineEnd - lineLength;
  const leftDiamondX = leftLineStart - gap - diamondW / 2;
  doc.line(leftLineStart, lineY, leftLineEnd, lineY);
  drawFilledDiamond(doc, leftDiamondX, lineY, diamondW, diamondH, BRAND_GOLD_RGB);

  const rightLineStart = centerX + textWidth / 2 + gap;
  const rightLineEnd = rightLineStart + lineLength;
  const rightDiamondX = rightLineEnd + gap + diamondW / 2;
  doc.line(rightLineStart, lineY, rightLineEnd, lineY);
  drawFilledDiamond(doc, rightDiamondX, lineY, diamondW, diamondH, BRAND_GOLD_RGB);
}

function drawBottomRule(doc: jsPDF, y: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  const lineLength = 36;
  const lineY = y;

  doc.setDrawColor(...BRAND_GOLD_RGB);
  doc.setLineWidth(0.25);
  doc.line(centerX - lineLength - 2, lineY, centerX - 2, lineY);
  doc.line(centerX + 2, lineY, centerX + lineLength + 2, lineY);
  drawFilledDiamond(doc, centerX, lineY, 1.8, 1.8, BRAND_GOLD_RGB);
}

type PdfContactItem = {
  kind: 'email' | 'person';
  label: string;
  phone?: string;
};

function measureContactBlock(
  doc: jsPDF,
  item: PdfContactItem,
  iconRadius: number,
  iconGap: number,
) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const labelWidth = doc.getTextWidth(item.label);
  let phoneWidth = 0;
  if (item.phone) {
    doc.setFont('helvetica', 'bold');
    phoneWidth = doc.getTextWidth(item.phone);
    doc.setFont('helvetica', 'normal');
  }
  const textWidth = Math.max(labelWidth, phoneWidth);
  const width = iconRadius * 2 + iconGap + textWidth;
  const height = item.phone ? 8 : 4;
  return { width, height, textWidth };
}

function drawContactRow(doc: jsPDF, letterhead: ReportLetterheadConfig, startY: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const items: PdfContactItem[] = [];

  if (letterhead.email) {
    items.push({ kind: 'email', label: `Email: ${letterhead.email}` });
  }
  for (const contact of letterhead.contacts ?? []) {
    items.push({ kind: 'person', label: contact.name, phone: contact.phone });
  }
  if (items.length === 0) return startY;

  const iconRadius = 3.2;
  const iconGap = 2;
  const rowHeight = 9;
  const rowTop = startY;
  const rowCenterY = rowTop + rowHeight / 2;
  const usableWidth = pageWidth - margin * 2;
  const colWidth = usableWidth / items.length;

  items.forEach((item, index) => {
    const colCenterX = margin + colWidth * index + colWidth / 2;
    const { width, textWidth } = measureContactBlock(doc, item, iconRadius, iconGap);
    const blockLeft = colCenterX - width / 2;
    const iconCx = blockLeft + iconRadius;
    const textCenterX = blockLeft + iconRadius * 2 + iconGap + textWidth / 2;

    if (item.kind === 'email') {
      drawEnvelopeIcon(doc, iconCx, rowCenterY, iconRadius);
    } else {
      drawPersonIcon(doc, iconCx, rowCenterY, iconRadius);
    }

    doc.setTextColor(...BRAND_GREEN_RGB);
    doc.setFontSize(7.5);

    if (item.phone) {
      doc.setFont('helvetica', 'normal');
      doc.text(item.label, textCenterX, rowCenterY - 2.2, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(item.phone, textCenterX, rowCenterY + 2.3, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.text(item.label, textCenterX, rowCenterY + 0.8, { align: 'center' });
    }

    if (index < items.length - 1) {
      const dividerX = margin + colWidth * (index + 1);
      doc.setDrawColor(...BORDER_RGB);
      doc.setLineWidth(0.25);
      doc.line(dividerX, rowTop - 1, dividerX, rowTop + rowHeight + 1);
    }
  });

  return rowTop + rowHeight + 4;
}

export function writeBusinessLetterheadToPdf(
  doc: jsPDF,
  letterhead: ReportLetterheadConfig,
  startY: number,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;

  doc.setTextColor(...BRAND_GREEN_RGB);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(letterhead.companyName, pageWidth / 2, y, { align: 'center' });
  y += 7;

  drawTaglineOrnamentRow(doc, y, letterhead.subtitle);
  y += 8;

  y = drawContactRow(doc, letterhead, y);
  drawBottomRule(doc, y);
  y += 5;

  doc.setTextColor(30, 30, 30);
  return y;
}
