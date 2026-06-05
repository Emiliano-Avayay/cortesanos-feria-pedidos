import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');
const siteConfigPath = path.join(root, 'config/site.config.json');
const winesConfigPath = path.join(root, 'config/wines.config.json');

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readSiteConfig() {
  return readJson(siteConfigPath);
}

export function readWines() {
  const wines = readJson(winesConfigPath);
  return wines
    .filter(wine => wine.visible !== false)
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
}

export function publicConfig(config) {
  return {
    showPrices: Boolean(config.showPrices),
    enableOrders: Boolean(config.enableOrders),
    eventName: config.eventName,
    eventSubtitle: config.eventSubtitle,
    eventDate: config.eventDate,
    eventTime: config.eventTime,
    eventLocation: config.eventLocation,
    currency: config.currency,
    vouchers: config.vouchers || { general: 0, vip: 0 },
    catalogBackgroundImage: config.catalogBackgroundImage || '',
    ticketAccessRequired: Boolean(config.ticketAccess?.enabled),
    defaultGeneralAccess: config.ticketAccess?.defaultGeneralAccess !== false,
    vipVoucherLimit: Number(config.vipVoucherLimit || config.ticketAccess?.vipVoucherLimit || 50)
  };
}

export function publicWines(wines, showPrices) {
  return wines.map(wine => {
    const base = {
      id: wine.id,
      name: wine.name,
      winery: wine.winery,
      category: wine.category,
      varietal: wine.varietal,
      description: wine.description || '',
      image: wine.image,
      accessType: wine.accessType,
      featured: Boolean(wine.featured),
      order: wine.order
    };
    if (showPrices) {
      return {
        ...base,
        suggestedPrice: wine.suggestedPrice,
        discountPrice: wine.discountPrice
      };
    }
    return base;
  });
}

export function normalizeTicketCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function resolveTicketAccess(site, rawCode) {
  const access = site.ticketAccess || {};
  if (!access.enabled) return { verified: true, ticketType: 'general', ticketCode: '' };

  const code = normalizeTicketCode(rawCode);
  if (code.length < 3) return null;

  const matches = (candidate) => normalizeTicketCode(candidate) === code;

  if (Array.isArray(access.generalCodes) && access.generalCodes.some(matches)) {
    return { verified: true, ticketType: 'general', ticketCode: code };
  }
  if (Array.isArray(access.vipCodes) && access.vipCodes.some(matches)) {
    return { verified: true, ticketType: 'vip', ticketCode: code };
  }
  if (Array.isArray(access.codes)) {
    const found = access.codes.find(entry => entry && matches(entry.code) && ['general', 'vip'].includes(entry.type));
    if (found) {
      return {
        verified: true,
        ticketType: found.type,
        ticketCode: code,
        holderName: found.name || found.customerName || '',
        holderPhone: found.phone || found.customerPhone || ''
      };
    }
  }

  return null;
}

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

export function validateVoucherIdentity(access, customerName, customerPhone) {
  if (!access) return { ok: false, error: 'Código inválido.' };
  const expectedName = normalizeName(access.holderName);
  const expectedPhone = normalizePhone(access.holderPhone);
  const givenName = normalizeName(customerName);
  const givenPhone = normalizePhone(customerPhone);

  if (expectedName && expectedName !== givenName) {
    return { ok: false, error: 'El nombre ingresado no coincide con el titular del voucher VIP.' };
  }
  if (expectedPhone && expectedPhone !== givenPhone) {
    return { ok: false, error: 'El WhatsApp ingresado no coincide con el titular del voucher VIP.' };
  }
  return { ok: true };
}

export function sanitizeText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(number);
}

export function formatStatus(status) {
  const labels = {
    nuevo: 'Nuevo',
    visto: 'Visto',
    registrado: 'Registrado',
    preparando: 'Preparando',
    listo_para_retirar: 'Listo para retirar',
    entregado: 'Entregado',
    cancelado: 'Cancelado'
  };
  return labels[status] || status;
}

export function buildWhatsAppMessage(order, site) {
  const customer = order.customer || {};
  const itemsLines = (order.items || [])
    .map(item => `${item.quantity} x ${item.name} — ${formatCurrency(item.total)}`)
    .join('\n');
  const ticketLabel = customer.ticketType === 'vip' ? 'VIP' : 'General';
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleString('es-AR') : new Date().toLocaleString('es-AR');

  return [
    `Nuevo pedido ${site.eventName || 'Cultura Cortesana'}`,
    '',
    `Pedido: ${order.orderNumber}`,
    `Cliente: ${customer.name}`,
    `WhatsApp: ${customer.phone}`,
    `Tipo de entrada: ${ticketLabel}`,
    `N° entrada: ${customer.ticketNumber || '-'}`,
    '',
    'Productos:',
    itemsLines,
    '',
    `Subtotal: ${formatCurrency(order.subtotal)}`,
    `Voucher ${ticketLabel} aplicado: -${formatCurrency(order.voucherAmount)}`,
    `Total final: ${formatCurrency(order.finalTotal)}`,
    '',
    'Comentario:',
    customer.comment || '-',
    '',
    'Fecha/hora:',
    createdAt
  ].join('\n');
}
