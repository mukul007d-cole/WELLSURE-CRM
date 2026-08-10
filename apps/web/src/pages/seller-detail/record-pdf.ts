import { jsPDF } from 'jspdf';
import { groupFieldsBySection } from './DetailsTab';
import { formatFieldValue } from '../../lib/format';
import type { FieldDefinition, Seller360Record } from '../../types/domain';

const MARGIN = 48;
const LINE = 16;
const PAGE_BOTTOM = 780;

/**
 * A downloadable copy of the record.
 *
 * Built from exactly what the page was given — the already-filtered
 * `fieldValues` and the visible process instances — so a viewer cannot export
 * their way around field visibility. Anything the server withheld is simply
 * not here to print.
 */
export function buildRecordPdf(seller: Seller360Record, fields: readonly FieldDefinition[]): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = MARGIN;

  /** Advances the cursor, starting a page when the current one is full. */
  const write = (text: string, options: { size?: number; bold?: boolean; gap?: number } = {}) => {
    if (y > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFontSize(options.size ?? 10);
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    // Wrap rather than overflow the page width — a long note otherwise runs
    // off the right edge and is silently lost.
    for (const line of doc.splitTextToSize(text, 500) as string[]) {
      doc.text(line, MARGIN, y);
      y += LINE;
    }
    y += options.gap ?? 0;
  };

  const rule = () => {
    doc.setDrawColor(210);
    doc.line(MARGIN, y - 10, 547, y - 10);
  };

  write(seller.name, { size: 18, bold: true });
  write([seller.phone, seller.email].filter(Boolean).join('  ·  ') || 'No contact details', {
    size: 10,
    gap: 6,
  });
  write(`Exported ${new Date().toLocaleString()}`, { size: 8, gap: 14 });

  rule();
  write('Journeys', { size: 12, bold: true, gap: 4 });
  if (seller.processInstances.length === 0) {
    write('No visible journeys.', { gap: 10 });
  } else {
    for (const process of seller.processInstances) {
      write(`${process.journey.name} — ${process.currentStatus.name}`, { bold: true });
      const owners = process.assignments
        .map((assignment) => `${assignment.userName} (${assignment.assignmentType})`)
        .join(', ');
      write(owners || 'No one assigned', { size: 9, gap: 6 });
    }
    y += 4;
  }

  for (const section of groupFieldsBySection(fields, seller.fieldValues)) {
    rule();
    write(section.name, { size: 12, bold: true, gap: 4 });
    for (const field of section.fields) {
      write(field.label, { size: 8 });
      // Back up over the label's own line so the value sits under it tightly.
      y -= 4;
      write(String(formatFieldValue(field, seller.fieldValues[field.key]) || '—'), { gap: 4 });
    }
  }

  return doc;
}

export function downloadRecordPdf(
  seller: Seller360Record,
  fields: readonly FieldDefinition[],
): void {
  const safeName = seller.name.replace(/[^\w\s-]/g, '').trim() || 'seller';
  buildRecordPdf(seller, fields).save(`${safeName}.pdf`);
}
