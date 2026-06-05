import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getOrdersWithItems, createOrder, updateOrderStatus, updateOrderNote, countActiveVipVoucherOrders, isActiveVipCodeUsed } from './lib/db.js';
import { readSiteConfig, readWines, publicConfig, publicWines, sanitizeText, buildWhatsAppMessage, resolveTicketAccess, normalizeTicketCode, validateVoucherIdentity } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

initDb();

app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (!isProduction) {
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }));
}

app.use(session({
  name: 'cc_admin_sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction && process.env.FORCE_INSECURE_COOKIE !== 'true',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

const sseClients = new Set();
function broadcastOrders() {
  const payload = JSON.stringify({ orders: getOrdersWithItems() });
  for (const res of sseClients) {
    try { res.write(`event: orders\ndata: ${payload}\n\n`); } catch (_) { sseClients.delete(res); }
  }
}

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'cultura-cortesana-web' });
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig(readSiteConfig()));
});

app.get('/api/wines', (_req, res) => {
  const config = readSiteConfig();
  const wines = readWines();
  res.json({ wines: publicWines(wines, config.showPrices) });
});

app.get('/api/access/me', (req, res) => {
  const site = readSiteConfig();
  if (!site.ticketAccess?.enabled) {
    return res.json({ verified: true, ticketType: 'general', ticketCode: '' });
  }
  const current = req.session?.ticketAccess;
  if (!current?.verified || !['general', 'vip'].includes(current.ticketType)) {
    return res.json({ verified: false, ticketType: null, ticketCode: '' });
  }
  res.json({ verified: true, ticketType: current.ticketType, ticketCode: current.ticketCode || '' });
});

app.post('/api/access/validate', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const site = readSiteConfig();
  const result = resolveTicketAccess(site, req.body?.code);
  if (!result) return res.status(401).json({ error: 'Código inválido. Revisá el código de tu entrada.' });
  req.session.ticketAccess = result;
  res.json(result);
});

app.post('/api/access/general', (req, res) => {
  const site = readSiteConfig();
  if (site.ticketAccess?.enabled && site.ticketAccess?.defaultGeneralAccess === false) {
    return res.status(403).json({ error: 'El acceso General requiere código.' });
  }
  const result = { verified: true, ticketType: 'general', ticketCode: '' };
  req.session.ticketAccess = result;
  res.json(result);
});

app.post('/api/access/logout', (req, res) => {
  if (req.session) req.session.ticketAccess = null;
  res.json({ ok: true });
});

app.post('/api/orders', orderLimiter, (req, res) => {
  try {
    const site = readSiteConfig();
    if (!site.enableOrders) return res.status(403).json({ error: 'La venta está desactivada.' });
    if (!site.showPrices) return res.status(403).json({ error: 'Los precios todavía no están publicados.' });

    const body = req.body || {};
    const customer = body.customer || {};
    const itemsInput = Array.isArray(body.items) ? body.items : [];

    const customerName = sanitizeText(customer.name, 80);
    const customerPhone = sanitizeText(customer.phone, 40);
    let ticketType = customer.ticketType === 'vip' ? 'vip' : 'general';
    let ticketNumber = sanitizeText(customer.ticketNumber || '', 80);
    const comment = sanitizeText(customer.comment || '', 400);

    const wantsVipVoucher = Boolean(customer.wantsVipVoucher || customer.ticketType === 'vip' || customer.ticketCode);

    if (site.ticketAccess?.enabled && wantsVipVoucher) {
      const codeInput = customer.ticketCode || body.ticketCode || customer.ticketNumber || ticketNumber;
      const resolvedAccess = resolveTicketAccess(site, codeInput);

      if (!resolvedAccess?.verified || resolvedAccess.ticketType !== 'vip') {
        return res.status(403).json({ error: 'Código VIP inválido. Sin código VIP válido se aplica voucher General.' });
      }

      const identity = validateVoucherIdentity(resolvedAccess, customerName, customerPhone);
      if (!identity.ok) return res.status(403).json({ error: identity.error });

      const normalizedVipCode = normalizeTicketCode(resolvedAccess.ticketCode);
      const vipLimit = Number(site.vipVoucherLimit || site.ticketAccess?.vipVoucherLimit || 50);
      const vipUsed = countActiveVipVoucherOrders();
      if (vipUsed >= vipLimit) {
        return res.status(403).json({ error: `Ya se alcanzó el límite de ${vipLimit} vouchers VIP.` });
      }
      if (site.ticketAccess?.requireUniqueVipCode !== false && isActiveVipCodeUsed(normalizedVipCode)) {
        return res.status(403).json({ error: 'Este código VIP ya fue utilizado en otro pedido.' });
      }

      ticketType = 'vip';
      ticketNumber = normalizedVipCode;
    } else {
      // Por defecto todos los pedidos entran como General.
      // El código VIP se pide recién al finalizar compra y solo cambia el voucher.
      ticketType = 'general';
    }

    if (customerName.length < 2) return res.status(400).json({ error: 'Ingresá nombre y apellido.' });
    if (customerPhone.length < 6) return res.status(400).json({ error: 'Ingresá un WhatsApp válido.' });
    if (!itemsInput.length) return res.status(400).json({ error: 'El pedido está vacío.' });

    const winesById = new Map(readWines().filter(w => w.visible !== false).map(w => [w.id, w]));
    const normalized = [];
    for (const input of itemsInput) {
      const productId = String(input.productId || input.id || '').trim();
      const quantity = Number(input.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
        return res.status(400).json({ error: 'Cantidad inválida en el pedido.' });
      }
      const wine = winesById.get(productId);
      if (!wine) return res.status(400).json({ error: `Producto inválido: ${productId}` });
      // Los vinos destacados/VIP son comprables por cualquier entrada.
      // El código solo define qué voucher se aplica: General o VIP.
      if (typeof wine.discountPrice !== 'number' || wine.discountPrice <= 0) {
        return res.status(400).json({ error: `Falta cargar precio de feria para: ${wine.name}` });
      }
      normalized.push({ wine, quantity });
    }

    const items = normalized.map(({ wine, quantity }) => ({
      productId: wine.id,
      name: wine.name,
      accessType: wine.accessType,
      quantity,
      unitPrice: wine.discountPrice,
      total: wine.discountPrice * quantity
    }));
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const voucherAmount = Math.min(Number(site.vouchers?.[ticketType] || 0), subtotal);
    const finalTotal = Math.max(0, subtotal - voucherAmount);

    const order = createOrder({
      customerName,
      customerPhone,
      ticketType,
      ticketNumber,
      comment,
      items,
      subtotal,
      voucherAmount,
      finalTotal
    });

    const whatsappTarget = process.env.WHATSAPP_TARGET || site.whatsappTarget || '543492717777';
    const message = buildWhatsAppMessage(order, site);
    const whatsappUrl = `https://wa.me/${whatsappTarget}?text=${encodeURIComponent(message)}`;

    broadcastOrders();
    res.status(201).json({ orderNumber: order.orderNumber, order, whatsappUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'No se pudo crear el pedido.' });
  }
});

app.post('/api/admin/login', rateLimit({ windowMs: 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const password = String(req.body?.password || '');
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) return res.status(500).json({ error: 'ADMIN_PASSWORD no está configurada en el servidor.' });
  if (password !== adminPassword) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', requireAdmin, (_req, res) => {
  res.json({ isAdmin: true });
});

app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  res.json({ orders: getOrdersWithItems() });
});

app.get('/api/admin/orders/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(`event: orders\ndata: ${JSON.stringify({ orders: getOrdersWithItems() })}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = sanitizeText(req.body?.status || '', 40);
  const allowed = ['nuevo', 'visto', 'registrado', 'preparando', 'listo_para_retirar', 'entregado', 'cancelado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
  const order = updateOrderStatus(id, status);
  broadcastOrders();
  res.json({ order });
});

app.patch('/api/admin/orders/:id/note', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const note = sanitizeText(req.body?.internalNote || '', 600);
  const order = updateOrderNote(id, note);
  broadcastOrders();
  res.json({ order });
});

// Static production frontend
const distPath = path.resolve(__dirname, '../client/dist');
app.use(express.static(distPath, { maxAge: isProduction ? '1h' : 0 }));
app.get(['/', '/admin-cortesanos'], (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Cultura Cortesana web running on port ${PORT}`);
});
