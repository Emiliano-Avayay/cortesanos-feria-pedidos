const ADMIN_COOKIE = 'cc_admin_token';
const ADMIN_MAX_AGE = 60 * 60 * 12;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders }
  });
}

function sanitizeText(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeTicketCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function resolveTicketAccess(site, rawCode) {
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

function validateVoucherIdentity(access, customerName, customerPhone) {
  if (!access) return { ok: false, error: 'Codigo invalido.' };
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

function publicConfig(config) {
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

function publicWines(wines, showPrices) {
  return wines
    .filter(wine => wine.visible !== false)
    .sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999))
    .map(wine => {
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
      if (!showPrices) return base;
      return {
        ...base,
        suggestedPrice: wine.suggestedPrice,
        discountPrice: wine.discountPrice
      };
    });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function buildWhatsAppMessage(order, site) {
  const customer = order.customer || {};
  const itemsLines = (order.items || [])
    .map(item => `${item.quantity} x ${item.name} - ${formatCurrency(item.total)}`)
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
    `Nro entrada: ${customer.ticketNumber || '-'}`,
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

async function readStaticJson(request, file) {
  const url = new URL(request.url);
  url.pathname = `/data/${file}`;
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`No se pudo leer ${file}`);
  return response.json();
}

function requireSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Cloudflare Pages.');
  }
}

async function supabase(env, table, options = {}) {
  requireSupabase(env);
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.hint || `Supabase error ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function rowToOrder(row, items = []) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      ticketType: row.ticket_type,
      ticketNumber: row.ticket_number || '',
      comment: row.comment || ''
    },
    items,
    subtotal: Number(row.subtotal),
    voucherAmount: Number(row.voucher_amount),
    finalTotal: Number(row.final_total),
    status: row.status,
    internalNote: row.internal_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToItem(row) {
  return {
    productId: row.product_id,
    name: row.product_name,
    accessType: row.access_type,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    total: Number(row.total)
  };
}

async function getOrdersWithItems(env) {
  const rows = await supabase(env, 'orders', {
    query: { select: '*', order: 'id.desc' }
  });
  const orderIds = rows.map(row => row.id);
  if (!orderIds.length) return [];
  const itemRows = await supabase(env, 'order_items', {
    query: {
      select: '*',
      order: 'id.asc',
      order_id: `in.(${orderIds.join(',')})`
    }
  });
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.order_id) || [];
    list.push(rowToItem(item));
    itemsByOrder.set(item.order_id, list);
  }
  return rows.map(row => rowToOrder(row, itemsByOrder.get(row.id) || []));
}

async function isActiveVipCodeUsed(env, ticketCode) {
  const code = normalizeTicketCode(ticketCode);
  if (!code) return false;
  const rows = await supabase(env, 'orders', {
    query: {
      select: 'id',
      ticket_type: 'eq.vip',
      ticket_number: `eq.${code}`,
      status: 'neq.cancelado',
      limit: '1'
    }
  });
  return rows.length > 0;
}

async function countActiveVipVoucherOrders(env) {
  const rows = await supabase(env, 'orders', {
    query: {
      select: 'id',
      ticket_type: 'eq.vip',
      status: 'neq.cancelado'
    },
    headers: { Prefer: 'count=exact' }
  });
  return rows.length;
}

async function createOrder(env, payload) {
  const now = new Date().toISOString();
  const insertedRows = await supabase(env, 'orders', {
    method: 'POST',
    body: {
      customer_name: payload.customerName,
      customer_phone: payload.customerPhone,
      ticket_type: payload.ticketType,
      ticket_number: payload.ticketNumber,
      comment: payload.comment,
      subtotal: payload.subtotal,
      voucher_amount: payload.voucherAmount,
      final_total: payload.finalTotal,
      status: 'nuevo',
      internal_note: '',
      created_at: now,
      updated_at: now
    }
  });
  const row = insertedRows[0];
  const orderNumber = `CC-${String(row.id).padStart(4, '0')}`;
  const updatedRows = await supabase(env, 'orders', {
    method: 'PATCH',
    query: { id: `eq.${row.id}` },
    body: { order_number: orderNumber, updated_at: now }
  });
  await supabase(env, 'order_items', {
    method: 'POST',
    body: payload.items.map(item => ({
      order_id: row.id,
      product_id: item.productId,
      product_name: item.name,
      access_type: item.accessType,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.total
    }))
  });
  return rowToOrder(updatedRows[0], payload.items);
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

async function hmac(env, value) {
  const secret = env.SESSION_SECRET || env.ADMIN_PASSWORD || 'change-me';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createAdminToken(env) {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_MAX_AGE;
  const payload = `admin.${expires}`;
  return `${payload}.${await hmac(env, payload)}`;
}

async function isAdmin(request, env) {
  const token = getCookie(request, ADMIN_COOKIE);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  if (Number(parts[1]) < Math.floor(Date.now() / 1000)) return false;
  return parts[2] === await hmac(env, `${parts[0]}.${parts[1]}`);
}

async function handleCreateOrder(request, env) {
  const site = await readStaticJson(request, 'site.config.json');
  const wines = await readStaticJson(request, 'wines.config.json');

  if (!site.enableOrders) return json({ error: 'La venta esta desactivada.' }, 403);
  if (!site.showPrices) return json({ error: 'Los precios todavia no estan publicados.' }, 403);

  const body = await request.json().catch(() => ({}));
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
      return json({ error: 'Codigo VIP invalido. Sin codigo VIP valido se aplica voucher General.' }, 403);
    }

    const identity = validateVoucherIdentity(resolvedAccess, customerName, customerPhone);
    if (!identity.ok) return json({ error: identity.error }, 403);

    const normalizedVipCode = normalizeTicketCode(resolvedAccess.ticketCode);
    const vipLimit = Number(site.vipVoucherLimit || site.ticketAccess?.vipVoucherLimit || 50);
    const vipUsed = await countActiveVipVoucherOrders(env);
    if (vipUsed >= vipLimit) {
      return json({ error: `Ya se alcanzo el limite de ${vipLimit} vouchers VIP.` }, 403);
    }
    if (site.ticketAccess?.requireUniqueVipCode !== false && await isActiveVipCodeUsed(env, normalizedVipCode)) {
      return json({ error: 'Este codigo VIP ya fue utilizado en otro pedido.' }, 403);
    }

    ticketType = 'vip';
    ticketNumber = normalizedVipCode;
  } else {
    ticketType = 'general';
  }

  if (customerName.length < 2) return json({ error: 'Ingresa nombre y apellido.' }, 400);
  if (customerPhone.length < 6) return json({ error: 'Ingresa un WhatsApp valido.' }, 400);
  if (!itemsInput.length) return json({ error: 'El pedido esta vacio.' }, 400);

  const winesById = new Map(wines.filter(w => w.visible !== false).map(w => [w.id, w]));
  const normalized = [];
  for (const input of itemsInput) {
    const productId = String(input.productId || input.id || '').trim();
    const quantity = Number(input.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      return json({ error: 'Cantidad invalida en el pedido.' }, 400);
    }
    const wine = winesById.get(productId);
    if (!wine) return json({ error: `Producto invalido: ${productId}` }, 400);
    if (typeof wine.discountPrice !== 'number' || wine.discountPrice <= 0) {
      return json({ error: `Falta cargar precio de feria para: ${wine.name}` }, 400);
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

  const order = await createOrder(env, {
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

  const whatsappTarget = env.WHATSAPP_TARGET || site.whatsappTarget || '543492717777';
  const message = buildWhatsAppMessage(order, site);
  const whatsappUrl = `https://wa.me/${whatsappTarget}?text=${encodeURIComponent(message)}`;
  return json({ orderNumber: order.orderNumber, order, whatsappUrl }, 201);
}

async function handleAdminLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD no esta configurada.' }, 500);
  if (password !== env.ADMIN_PASSWORD) return json({ error: 'Contrasena incorrecta.' }, 401);
  const token = await createAdminToken(env);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_MAX_AGE}`
  });
}

async function handleRequest(context) {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();
  const rawPath = params.path || '';
  const path = `/${Array.isArray(rawPath) ? rawPath.join('/') : rawPath}`;

  if (method === 'GET' && path === '/health') return json({ ok: true, service: 'cultura-cortesana-pages' });

  if (method === 'GET' && path === '/config') {
    return json(publicConfig(await readStaticJson(request, 'site.config.json')));
  }

  if (method === 'GET' && path === '/wines') {
    const site = await readStaticJson(request, 'site.config.json');
    const wines = await readStaticJson(request, 'wines.config.json');
    return json({ wines: publicWines(wines, site.showPrices) });
  }

  if (method === 'POST' && path === '/orders') return handleCreateOrder(request, env);

  if (method === 'POST' && path === '/admin/login') return handleAdminLogin(request, env);

  if (method === 'POST' && path === '/admin/logout') {
    return json({ ok: true }, 200, {
      'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    });
  }

  if (method === 'GET' && path === '/admin/me') {
    if (!await isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
    return json({ isAdmin: true });
  }

  if (method === 'GET' && path === '/admin/orders') {
    if (!await isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
    return json({ orders: await getOrdersWithItems(env) });
  }

  if (method === 'GET' && path === '/admin/orders/stream') {
    if (!await isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
    return new Response(`event: orders\ndata: ${JSON.stringify({ orders: await getOrdersWithItems(env) })}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }

  const statusMatch = path.match(/^\/admin\/orders\/(\d+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    if (!await isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
    const body = await request.json().catch(() => ({}));
    const status = sanitizeText(body.status || '', 40);
    const allowed = ['nuevo', 'visto', 'registrado', 'preparando', 'listo_para_retirar', 'entregado', 'cancelado'];
    if (!allowed.includes(status)) return json({ error: 'Estado invalido.' }, 400);
    const rows = await supabase(env, 'orders', {
      method: 'PATCH',
      query: { id: `eq.${statusMatch[1]}` },
      body: { status, updated_at: new Date().toISOString() }
    });
    const itemRows = await supabase(env, 'order_items', { query: { select: '*', order: 'id.asc', order_id: `eq.${statusMatch[1]}` } });
    return json({ order: rowToOrder(rows[0], itemRows.map(rowToItem)) });
  }

  const noteMatch = path.match(/^\/admin\/orders\/(\d+)\/note$/);
  if (method === 'PATCH' && noteMatch) {
    if (!await isAdmin(request, env)) return json({ error: 'No autorizado' }, 401);
    const body = await request.json().catch(() => ({}));
    const internalNote = sanitizeText(body.internalNote || '', 600);
    const rows = await supabase(env, 'orders', {
      method: 'PATCH',
      query: { id: `eq.${noteMatch[1]}` },
      body: { internal_note: internalNote, updated_at: new Date().toISOString() }
    });
    const itemRows = await supabase(env, 'order_items', { query: { select: '*', order: 'id.asc', order_id: `eq.${noteMatch[1]}` } });
    return json({ order: rowToOrder(rows[0], itemRows.map(rowToItem)) });
  }

  return json({ error: 'No encontrado' }, 404);
}

export async function onRequest(context) {
  try {
    return await handleRequest(context);
  } catch (error) {
    return json({ error: error.message || 'Error de servidor' }, 500);
  }
}
