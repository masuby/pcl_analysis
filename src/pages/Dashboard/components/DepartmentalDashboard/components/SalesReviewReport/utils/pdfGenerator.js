import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/**
 * Export the report container to PDF. Expects container to have children
 * with class .report-page (each becomes one PDF page).
 */
export async function exportReportToPDF(containerElement, selectedMonth) {
  const pages = containerElement.querySelectorAll('.report-page');
  if (!pages.length) {
    throw new Error('No report pages found');
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = await html2canvas(page, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false,
      windowWidth: page.scrollWidth,
      windowHeight: page.scrollHeight
    });

    const imgData = canvas.toDataURL('image/png', 1.0);
    if (i > 0) {
      pdf.addPage();
    }
    pdf.addImage(imgData, 'PNG', 0, 0, A4_WIDTH, A4_HEIGHT);
  }

  const fileName = `Sales_Review_${selectedMonth}.pdf`;
  pdf.save(fileName);
  return { success: true, fileName };
}
