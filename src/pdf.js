// Lazy-loaded puppeteer so `npm start` works even if the browser download failed.
// We render the same EJS view used for the public invoice page, then print-to-PDF.

const path = require('path');
const ejs = require('ejs');
const { formatMoney, lineTotal, fromCents } = require('./money');

let _browserPromise = null;

async function getBrowser() {
  if (!_browserPromise) {
    const puppeteer = require('puppeteer');
    _browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return _browserPromise;
}

async function renderInvoiceHtml(invoice, settings) {
  const view = path.join(__dirname, '..', 'views', 'invoice-print.ejs');
  return ejs.renderFile(view, {
    invoice,
    settings,
    formatMoney,
    lineTotal,
    fromCents,
  });
}

async function generatePdf(invoice, settings) {
  const html = await renderInvoiceHtml(invoice, settings);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return pdf;
  } finally {
    await page.close();
  }
}

async function shutdown() {
  if (_browserPromise) {
    try {
      const b = await _browserPromise;
      await b.close();
    } catch {}
    _browserPromise = null;
  }
}

module.exports = { generatePdf, renderInvoiceHtml, shutdown };
