import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'data');
const dbPath = path.join(dataDir, 'orders.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

const SQL = await initSqlJs({
  locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file)
});

export const db = fs.existsSync(dbPath)
  ? new SQL.Database(fs.readFileSync(dbPath))
  : new SQL.Database();

function persistDb() {
  const binary = db.export();
  fs.writeFileSync(dbPath, Buffer.from(binary));
}

function run(sql, params = []) {
  db.run(sql, params);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function initDb() {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderNumber TEXT UNIQUE,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      ticketType TEXT NOT NULL CHECK(ticketType IN ('general', 'vip')),
      ticketNumber TEXT,
      comment TEXT,
      subtotal INTEGER NOT NULL,
      voucherAmount INTEGER NOT NULL,
      finalTotal INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'nuevo',
      internalNote TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      accessType TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unitPrice INTEGER NOT NULL,
      total INTEGER NOT NULL,
      FOREIGN KEY(orderId) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);
  persistDb();
}

function rowToOrder(row, items) {
  return {
    id: Number(row.id),
    orderNumber: row.orderNumber,
    customer: {
      name: row.customerName,
      phone: row.customerPhone,
      ticketType: row.ticketType,
      ticketNumber: row.ticketNumber || '',
      comment: row.comment || ''
    },
    items,
    subtotal: Number(row.subtotal),
    voucherAmount: Number(row.voucherAmount),
    finalTotal: Number(row.finalTotal),
    status: row.status,
    internalNote: row.internalNote || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function itemRows(orderId) {
  return all(
    'SELECT productId, productName as name, accessType, quantity, unitPrice, total FROM order_items WHERE orderId = ? ORDER BY id ASC',
    [orderId]
  ).map(item => ({
    ...item,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    total: Number(item.total)
  }));
}

export function getOrdersWithItems() {
  const rows = all('SELECT * FROM orders ORDER BY id DESC');
  return rows.map(row => rowToOrder(row, itemRows(row.id)));
}

export function getOrderById(id) {
  const row = get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!row) return null;
  return rowToOrder(row, itemRows(id));
}


export function countActiveVipVoucherOrders() {
  const row = get("SELECT COUNT(*) AS total FROM orders WHERE ticketType = 'vip' AND status != 'cancelado'");
  return Number(row?.total || 0);
}

export function isActiveVipCodeUsed(ticketCode) {
  const code = String(ticketCode || '').trim().toUpperCase();
  if (!code) return false;
  const row = get("SELECT COUNT(*) AS total FROM orders WHERE ticketType = 'vip' AND UPPER(ticketNumber) = ? AND status != 'cancelado'", [code]);
  return Number(row?.total || 0) > 0;
}

export function createOrder(payload) {
  const now = new Date().toISOString();
  try {
    run('BEGIN TRANSACTION');
    run(
      `INSERT INTO orders (customerName, customerPhone, ticketType, ticketNumber, comment, subtotal, voucherAmount, finalTotal, status, internalNote, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nuevo', '', ?, ?)`,
      [
        payload.customerName,
        payload.customerPhone,
        payload.ticketType,
        payload.ticketNumber,
        payload.comment,
        payload.subtotal,
        payload.voucherAmount,
        payload.finalTotal,
        now,
        now
      ]
    );

    const inserted = get('SELECT last_insert_rowid() AS id');
    const id = Number(inserted.id);
    const orderNumber = `CC-${String(id).padStart(4, '0')}`;
    run('UPDATE orders SET orderNumber = ? WHERE id = ?', [orderNumber, id]);

    for (const item of payload.items) {
      run(
        `INSERT INTO order_items (orderId, productId, productName, accessType, quantity, unitPrice, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, item.productId, item.name, item.accessType, item.quantity, item.unitPrice, item.total]
      );
    }

    run('COMMIT');
    persistDb();
    return getOrderById(id);
  } catch (error) {
    try { run('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

export function updateOrderStatus(id, status) {
  run('UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?', [status, new Date().toISOString(), id]);
  persistDb();
  return getOrderById(id);
}

export function updateOrderNote(id, internalNote) {
  run('UPDATE orders SET internalNote = ?, updatedAt = ? WHERE id = ?', [internalNote, new Date().toISOString(), id]);
  persistDb();
  return getOrderById(id);
}
