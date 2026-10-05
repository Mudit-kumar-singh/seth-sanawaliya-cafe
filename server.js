require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const db = require("./db");

const app = express();
// Table QR security migration
try {
  const cols = db.prepare("PRAGMA table_info(tables)").all().map(x => x.name);

  if (!cols.includes("qr_token")) {
    db.exec("ALTER TABLE tables ADD COLUMN qr_token TEXT");
  }

  const tables = db.prepare("SELECT id, qr_token FROM tables").all();
  const crypto = require("crypto");

  const updateToken = db.prepare(
    "UPDATE tables SET qr_token=? WHERE id=?"
  );

  for (const table of tables) {
    if (!table.qr_token) {
      updateToken.run(
        crypto.randomBytes(24).toString("hex"),
        table.id
      );
    }
  }

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_qr_token ON tables(qr_token)"
  );

  console.log("Table QR security migration ready.");
} catch (e) {
  console.error("Table QR migration failed:", e);
}
// Payment-gateway columns are added safely for existing databases.
try {
  const cols = db.prepare("PRAGMA table_info(orders)").all().map(x => x.name);
  if (!cols.includes("razorpay_order_id")) db.exec("ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT");
  if (!cols.includes("razorpay_payment_id")) db.exec("ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order ON orders(razorpay_order_id)");
  db.exec("CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
} catch (e) { console.error("Payment schema migration failed:", e); }


const PORT = process.env.PORT || 3000;
const CAFE_UPI = process.env.CAFE_UPI || "7983875180@fam";
const SESSION_DAYS = 7;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

app.use(cors({ origin: true, credentials: true }));
// Webhooks must be verified against the exact raw request body.
app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "500kb" }));
app.use(express.json({ limit: "200kb" }));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many order requests. Please wait a moment." }
});


app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader("Cache-Control", "no-store");
  }
}));


function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, keyHex] = String(stored).split(":");
    if (!salt || !keyHex) return resolve(false);
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      const a = Buffer.from(keyHex, "hex");
      const b = Buffer.from(derivedKey.toString("hex"), "hex");
      resolve(a.length === b.length && crypto.timingSafeEqual(a, b));
    });
  });
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

async function ensureDefaultOwner() {
  const user = db.prepare("SELECT * FROM users WHERE username=?").get("owner");
  if (user && user.password_hash === "__DEFAULT_OWNER_PASSWORD__") {
    const password = process.env.OWNER_DEFAULT_PASSWORD || "seth1234";
    const hash = await hashPassword(password);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, user.id);
    console.log(`Default owner created. Username: owner | Password: ${password}`);
  }
}

async function authUser(req, res, next) {
  try {
    const raw = req.headers.cookie || "";
    const match = raw.match(/(?:^|;\s*)ss_session=([^;]+)/);
    if (!match) return res.status(401).json({ error: "Owner login required." });
    const token = decodeURIComponent(match[1]);
    const session = db.prepare(`
      SELECT s.token_hash, s.expires_at, u.id, u.username, u.role, u.active
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.active=1
    `).get(tokenHash(token));
    if (!session) return res.status(401).json({ error: "Session expired. Please log in again." });
    req.user = { id: session.id, username: session.username, role: session.role };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Authentication error." });
  }
}

function ownerOnly(req, res, next) {
  authUser(req, res, () => {
    if (req.user?.role !== "owner") return res.status(403).json({ error: "Owner access required." });
    next();
  });
}

function orderHistory(orderId, includeActor = false) {
  const rows = db.prepare(`
    SELECT status, changed_by_username AS changedBy, changed_at AS changedAt
    FROM order_status_history WHERE order_id=? ORDER BY id ASC
  `).all(orderId);
  return includeActor ? rows : rows.map(x => ({ status: x.status, changedAt: x.changedAt }));
}

function publicOrder(row, options = {}) {
  const items = db.prepare(`
    SELECT menu_item_id AS menuItemId, item_name AS name, unit_price AS price, quantity AS qty
    FROM order_items WHERE order_id = ?
  `).all(row.id);
  const customer = db.prepare(`SELECT name, phone FROM customers WHERE id = ?`).get(row.customer_id);
  return {
    id: row.public_id, table: row.table_id, customer, items, total: row.total,
    payment: row.payment_method, paymentStatus: row.payment_status, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
    statusHistory: orderHistory(row.id, !!options.includeActor)
  };
}

// ---------- Authentication ----------
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

    const user = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().replace("T", " ").replace("Z", "");
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(tokenHash(token), user.id, expires);

    res.setHeader("Set-Cookie", cookie("ss_session", token, { maxAge: SESSION_DAYS * 86400 }));
    res.json({ user: { username: user.username, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not log in." });
  }
});

app.post("/api/auth/logout", authUser, (req, res) => {
  const raw = req.headers.cookie || "";
  const match = raw.match(/(?:^|;\s*)ss_session=([^;]+)/);
  if (match) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(decodeURIComponent(match[1])));
  res.setHeader("Set-Cookie", cookie("ss_session", "", { maxAge: 0 }));
  res.json({ ok: true });
});

app.get("/api/auth/me", authUser, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/change-password", authUser, async (req, res) => {
  const current = String(req.body.currentPassword || "");
  const next = String(req.body.newPassword || "");
  if (next.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  const hash = await hashPassword(next);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, user.id);
  res.json({ ok: true });
});


// ---------- Razorpay helpers ----------
function razorpayConfigured() {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}
function razorpayAuth() {
  return "Basic " + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
}
async function razorpayRequest(path, options = {}) {
  if (!razorpayConfigured()) throw new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.");
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: razorpayAuth(), ...(options.headers || {}) }
  });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text) } catch { }
  if (!r.ok) throw new Error(data?.error?.description || `Razorpay request failed (${r.status}).`);
  return data;
}
function hmacHex(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}
function safeEqualHex(a, b) {
  try {
    const x = Buffer.from(String(a || ""), "hex"), y = Buffer.from(String(b || ""), "hex");
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
  } catch { return false; }
}

// ---------- Public customer API ----------
app.get("/api/health", (req, res) => res.json({ ok: true, cafe: "Seth Sanwaliya Restaurant" }));
app.get("/api/config", (req, res) => res.json({
  name: "Seth Sanwaliya Restaurant", upiId: CAFE_UPI,
  upiName: "Seth Sanwaliya Restaurant", tables: 21
}));
app.get("/api/menu", (req, res) => {
  const rows = db.prepare("SELECT id,category,name,price,available FROM menu_items ORDER BY id")
    .all().map(x => ({ ...x, available: !!x.available }));
  res.json(rows);
});

app.post("/api/orders", orderLimiter, (req, res) => {
  try {
    const { table, token, customer, items, payment } = req.body;
    const tableId = Number(table);
    if (!Number.isInteger(tableId) || tableId < 1 || tableId > 21) return res.status(400).json({ error: "Invalid table." });
    const tableRow = db.prepare(
      "SELECT id FROM tables WHERE id=? AND qr_token=?"
    ).get(tableId, String(token || ""));

    if (!tableRow) {
      return res.status(403).json({
        error: "Invalid table QR. Please scan the QR code placed on your table."
      });
    }
    if (!customer || !String(customer.name || "").trim() || /^[6-9]\d{9}$/.test(String(customer.phone || ""))) {
      return res.status(400).json({ error: "Valid customer name and 10-digit phone are required." });
    }
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Cart is empty." });
    if (!["upi", "counter"].includes(payment)) return res.status(400).json({ error: "Invalid payment method." });

    const cleanItems = items.map(x => ({ id: Number(x.id), qty: Math.max(1, Math.min(50, Number(x.qty))) }));
    const ids = [...new Set(cleanItems.map(x => x.id))];
    const placeholders = ids.map(() => "?").join(",");
    const menuRows = db.prepare(`SELECT id,name,price,available FROM menu_items WHERE id IN (${placeholders})`).all(...ids);
    const menuMap = new Map(menuRows.map(x => [x.id, x]));
    let total = 0; const orderItems = [];
    for (const x of cleanItems) {
      const item = menuMap.get(x.id);
      if (!item || !item.available) return res.status(400).json({ error: `Item unavailable: ${item?.name || x.id}` });
      total += item.price * x.qty;
      orderItems.push({ id: item.id, name: item.name, price: item.price, qty: x.qty });
    }
    total = Math.round(total * 100) / 100;

    const customerName = String(customer.name).trim().slice(0, 100), phone = String(customer.phone);
    const existing = db.prepare("SELECT id FROM customers WHERE phone=? ORDER BY id DESC LIMIT 1").get(phone);
    const customerId = existing
      ? (db.prepare("UPDATE customers SET name=? WHERE id=?").run(customerName, existing.id), existing.id)
      : db.prepare("INSERT INTO customers(name,phone) VALUES(?,?)").run(customerName, phone).lastInsertRowid;

    const publicId = "SS" + Date.now().toString().slice(-8);
    const paymentStatus = payment === "upi" ? "initiated" : "pending";
    const create = db.transaction(() => {
      const orderId = db.prepare(`
        INSERT INTO orders(public_id,table_id,customer_id,total,payment_method,payment_status,status)
        VALUES(?,?,?,?,?,?,?)
      `).run(publicId, tableId, customerId, total, payment, paymentStatus, "new").lastInsertRowid;
      const ins = db.prepare("INSERT INTO order_items(order_id,menu_item_id,item_name,unit_price,quantity) VALUES(?,?,?,?,?)");
      orderItems.forEach(x => ins.run(orderId, x.id, x.name, x.price, x.qty));
      db.prepare(`INSERT INTO order_status_history(order_id,status,changed_by_username) VALUES(?,?,?)`).run(orderId, "new", "customer");
      return orderId;
    });
    const row = db.prepare("SELECT * FROM orders WHERE id=?").get(create());
    res.status(201).json({
      order: publicOrder(row), upi: payment === "upi" ? {
        upiId: CAFE_UPI, note: "Payment must be verified by a production payment gateway webhook before being marked paid."
      } : null
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create order." }); }
});


// ---------- Razorpay payment API ----------
app.get("/api/payments/config", (req, res) => {
  res.json({ enabled: razorpayConfigured(), keyId: RAZORPAY_KEY_ID || null, mode: process.env.RAZORPAY_MODE || "test" });
});

app.post("/api/payments/create-order", orderLimiter, async (req, res) => {
  try {
    if (!razorpayConfigured()) return res.status(503).json({ error: "Online payment is not configured yet. Use Pay at Counter or configure Razorpay Test Mode keys." });
    const publicId = String(req.body.publicId || "").trim();
    if (!/^SS\d{8}$/.test(publicId)) return res.status(400).json({ error: "Invalid cafe order ID." });
    const row = db.prepare("SELECT * FROM orders WHERE public_id=?").get(publicId);
    if (!row) return res.status(404).json({ error: "Cafe order not found." });
    if (row.payment_method !== "upi") return res.status(400).json({ error: "This order is not an online-payment order." });
    if (row.payment_status === "paid") return res.status(409).json({ error: "This order is already paid." });

    let razorpayOrderId = row.razorpay_order_id;
    let rzOrder = null;
    if (razorpayOrderId) {
      try { rzOrder = await razorpayRequest(`/orders/${encodeURIComponent(razorpayOrderId)}`, { method: "GET" }); }
      catch { razorpayOrderId = null; }
    }
    if (!rzOrder) {
      rzOrder = await razorpayRequest("/orders", {
        method: "POST", body: JSON.stringify({
          amount: Math.round(Number(row.total) * 100), currency: "INR", receipt: publicId,
          notes: { cafe_order_id: publicId, table: String(row.table_id) }
        })
      });
      razorpayOrderId = rzOrder.id;
      db.prepare("UPDATE orders SET razorpay_order_id=?,updated_at=CURRENT_TIMESTAMP WHERE public_id=?").run(razorpayOrderId, publicId);
    }
    res.json({ keyId: RAZORPAY_KEY_ID, orderId: razorpayOrderId, amount: rzOrder.amount, currency: rzOrder.currency, receipt: publicId });
  } catch (e) { console.error("Razorpay create-order:", e); res.status(502).json({ error: e.message || "Could not start online payment." }); }
});

app.post("/api/payments/verify", orderLimiter, async (req, res) => {
  try {
    if (!razorpayConfigured()) return res.status(503).json({ error: "Online payment is not configured." });
    const publicId = String(req.body.publicId || "").trim();
    const paymentId = String(req.body.razorpay_payment_id || "").trim();
    const signature = String(req.body.razorpay_signature || "").trim();
    if (!/^SS\d{8}$/.test(publicId) || !paymentId || !signature) return res.status(400).json({ error: "Incomplete payment verification details." });
    const row = db.prepare("SELECT * FROM orders WHERE public_id=?").get(publicId);
    if (!row || !row.razorpay_order_id) return res.status(404).json({ error: "Payment order not found." });
    const expected = hmacHex(RAZORPAY_KEY_SECRET, `${row.razorpay_order_id}|${paymentId}`);
    if (!safeEqualHex(expected, signature)) return res.status(400).json({ error: "Payment signature verification failed." });

    // Confirm the payment state from Razorpay's server before marking the cafe order paid.
    const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    if (payment.order_id !== row.razorpay_order_id) return res.status(400).json({ error: "Payment does not belong to this order." });
    if (Number(payment.amount) !== Math.round(Number(row.total) * 100)) return res.status(400).json({ error: "Payment amount does not match the cafe order." });
    db.prepare("UPDATE orders SET razorpay_payment_id=?,payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE public_id=?")
      .run(paymentId, payment.status === "captured" ? "paid" : row.payment_status, publicId);
    const updated = db.prepare("SELECT * FROM orders WHERE public_id=?").get(publicId);
    res.json({ ok: true, verified: payment.status === "captured", status: payment.status, cafeOrder: publicOrder(updated) });
  } catch (e) { console.error("Razorpay verify:", e); res.status(502).json({ error: e.message || "Could not verify payment." }); }
});

app.post("/api/payments/webhook", (req, res) => {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) return res.status(503).send("Webhook secret not configured.");
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const signature = String(req.headers["x-razorpay-signature"] || "");
    const expected = hmacHex(RAZORPAY_WEBHOOK_SECRET, raw);
    if (!safeEqualHex(expected, signature)) return res.status(400).send("Invalid webhook signature.");
    const eventId = String(req.headers["x-razorpay-event-id"] || "");
    const payload = JSON.parse(raw.toString("utf8"));
    if (eventId) {
      const exists = db.prepare("SELECT 1 FROM webhook_events WHERE event_id=?").get(eventId);
      if (exists) return res.json({ ok: true, duplicate: true });
      db.prepare("INSERT INTO webhook_events(event_id,event_type) VALUES(?,?)").run(eventId, String(payload.event || "unknown"));
    }
    const event = String(payload.event || "");
    let rzOrderId = null, paymentId = null, status = null;
    if (event === "payment.captured" || event === "payment.failed") {
      const entity = payload?.payload?.payment?.entity;
      rzOrderId = entity?.order_id || null; paymentId = entity?.id || null; status = event === "payment.captured" ? "paid" : "failed";
    } else if (event === "order.paid") {
      const entity = payload?.payload?.order?.entity;
      rzOrderId = entity?.id || null; status = "paid";
    }
    if (rzOrderId) {
      const update = db.prepare(`UPDATE orders SET payment_status=?, razorpay_payment_id=COALESCE(?,razorpay_payment_id), updated_at=CURRENT_TIMESTAMP WHERE razorpay_order_id=?`).run(status, paymentId, rzOrderId);
      if (update.changes) console.log(`Razorpay webhook ${event}: updated ${rzOrderId} -> ${status}`);
    }
    res.json({ ok: true });
  } catch (e) { console.error("Razorpay webhook:", e); res.status(400).send("Webhook processing failed."); }
});

// ---------- Phase 4 operations API ----------
app.get("/api/kitchen/orders", authUser, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE status IN ('new','preparing','ready') AND (payment_method='counter' OR payment_status='paid') ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'preparing' THEN 1 ELSE 2 END, id ASC").all();
  res.json(rows.map(publicOrder));
});

// app.get("/api/orders/:id", (req, res) => {
//   const row = db.prepare("SELECT * FROM orders WHERE public_id=?").get(req.params.id);
//   if (!row) return res.status(404).json({ error: "Order not found." });
//   res.json(publicOrder(row));
// });

app.get("/api/analytics", ownerOnly, (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days || 7)));
  const summary = db.prepare(`
    SELECT date(created_at,'localtime') AS day,
      COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status<>'cancelled' AND (payment_method='counter' OR payment_status='paid') THEN total ELSE 0 END),0) AS sales,
      COALESCE(SUM(CASE WHEN payment_method='upi' AND payment_status='paid' AND status<>'cancelled' THEN total ELSE 0 END),0) AS upi,
      COALESCE(SUM(CASE WHEN payment_method='counter' AND status<>'cancelled' THEN total ELSE 0 END),0) AS counter
    FROM orders
    WHERE date(created_at,'localtime') >= date('now','localtime', ?)
    GROUP BY day ORDER BY day ASC
  `).all(`-${days - 1} days`);
  const byCategory = db.prepare(`
    SELECT mi.category AS category, SUM(oi.quantity) AS quantity, ROUND(SUM(oi.quantity*oi.unit_price),2) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    LEFT JOIN menu_items mi ON mi.id=oi.menu_item_id
    WHERE o.status<>'cancelled' AND (o.payment_method='counter' OR o.payment_status='paid') AND date(o.created_at,'localtime') >= date('now','localtime', ?)
    GROUP BY mi.category ORDER BY revenue DESC
  `).all(`-${days - 1} days`);
  const byItem = db.prepare(`
    SELECT oi.item_name AS name, SUM(oi.quantity) AS quantity, ROUND(SUM(oi.quantity*oi.unit_price),2) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status<>'cancelled' AND (o.payment_method='counter' OR o.payment_status='paid') AND date(o.created_at,'localtime') >= date('now','localtime', ?)
    GROUP BY oi.menu_item_id ORDER BY quantity DESC LIMIT 15
  `).all(`-${days - 1} days`);
  const peak = db.prepare(`
    SELECT strftime('%H',created_at,'localtime') AS hour, COUNT(*) AS orders, ROUND(SUM(total),2) AS sales
    FROM orders WHERE status<>'cancelled' AND (payment_method='counter' OR payment_status='paid') AND date(created_at,'localtime') >= date('now','localtime', ?)
    GROUP BY hour ORDER BY hour
  `).all(`-${days - 1} days`);
  res.json({ days, summary, byCategory, byItem, peak });
});


// Public customer order tracking by order ID.
app.get("/api/orders/:publicId", (req, res) => {
  const id = String(req.params.publicId || "").trim();
  if (!/^SS\d{8}$/.test(id)) return res.status(400).json({ error: "Invalid order ID." });
  const row = db.prepare("SELECT * FROM orders WHERE public_id=?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  const order = publicOrder(row);
  // Do not expose customer phone on the public tracking endpoint.
  delete order.customer.phone;
  res.json(order);
});

// ---------- Protected owner/staff API ----------
app.get("/api/orders", authUser, (req, res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC").all().map(row => publicOrder(row, { includeActor: true })));
});

app.patch("/api/orders/:id/status", authUser, (req, res) => {
  const status = String(req.body.status || "");
  if (!["new", "preparing", "ready", "completed", "cancelled"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  const row = db.prepare("SELECT * FROM orders WHERE public_id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  if (row.status === status) return res.json(publicOrder(row, { includeActor: true }));

  if (req.user.role === "staff") {
    const allowed = {
      new: ["preparing", "cancelled"],
      preparing: ["ready", "cancelled"],
      ready: ["completed", "preparing"],
      completed: [],
      cancelled: []
    };
    if (!allowed[row.status]?.includes(status)) {
      return res.status(403).json({ error: `Staff cannot change ${row.status} to ${status}.` });
    }
  }

  const update = db.transaction(() => {
    db.prepare("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, row.id);
    db.prepare(`INSERT INTO order_status_history(order_id,status,changed_by_user_id,changed_by_username) VALUES(?,?,?,?)`)
      .run(row.id, status, req.user.id, req.user.username);
  });
  update();
  const updated = db.prepare("SELECT * FROM orders WHERE id=?").get(row.id);
  res.json(publicOrder(updated, { includeActor: true }));
});

app.get("/api/orders/:id/history", authUser, (req, res) => {
  const row = db.prepare("SELECT id FROM orders WHERE public_id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  res.json(orderHistory(row.id, true));
});

app.patch("/api/orders/:id/payment", ownerOnly, (req, res) => {
  const status = String(req.body.paymentStatus || "");
  if (!["pending", "initiated", "paid", "failed"].includes(status)) return res.status(400).json({ error: "Invalid payment status." });
  const result = db.prepare("UPDATE orders SET payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE public_id=?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Order not found." });
  res.json(publicOrder(db.prepare("SELECT * FROM orders WHERE public_id=?").get(req.params.id)));
});

app.get("/api/tables", ownerOnly, (req, res) => {
  res.json(db.prepare(`
    SELECT
      t.id,
      t.name,
      t.qr_token,
      COUNT(CASE WHEN o.status IN ('new','preparing','ready') THEN 1 END) AS active_orders
    FROM tables t
    LEFT JOIN orders o ON o.table_id=t.id
    GROUP BY t.id
    ORDER BY t.id
  `).all());
});

app.get("/api/dashboard", ownerOnly, (req, res) => {
  const today = db.prepare(`
    SELECT COUNT(*) AS orders,COALESCE(SUM(CASE WHEN payment_method='counter' OR payment_status='paid' THEN total ELSE 0 END),0) AS revenue,
      COALESCE(SUM(CASE WHEN payment_method='upi' AND payment_status='paid' THEN total ELSE 0 END),0) AS upi,
      COALESCE(SUM(CASE WHEN payment_method='counter' THEN total ELSE 0 END),0) AS counter
    FROM orders WHERE date(created_at,'localtime')=date('now','localtime') AND status<>'cancelled'
  `).get();
  const status = db.prepare("SELECT status,COUNT(*) AS count FROM orders WHERE date(created_at,'localtime')=date('now','localtime') GROUP BY status").all();
  const topItems = db.prepare(`
    SELECT item_name AS name,SUM(quantity) AS quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE date(o.created_at,'localtime')=date('now','localtime') AND o.status<>'cancelled' AND (o.payment_method='counter' OR o.payment_status='paid')
    GROUP BY menu_item_id ORDER BY quantity DESC LIMIT 10
  `).all();
  res.json({ today, status, topItems });
});

app.get("/api/menu/admin", ownerOnly, (req, res) => {
  res.json(db.prepare("SELECT id,category,name,price,available FROM menu_items ORDER BY id").all()
    .map(x => ({ ...x, available: !!x.available })));
});

app.post("/api/menu", ownerOnly, (req, res) => {
  const { category, name, price } = req.body;
  if (!String(category || "").trim() || !String(name || "").trim() || !(Number(price) > 0)) return res.status(400).json({ error: "Category, name and positive price are required." });
  const id = db.prepare("INSERT INTO menu_items(category,name,price) VALUES(?,?,?)").run(String(category).trim(), String(name).trim(), Number(price)).lastInsertRowid;
  res.status(201).json(db.prepare("SELECT id,category,name,price,available FROM menu_items WHERE id=?").get(id));
});

app.patch("/api/menu/:id", ownerOnly, (req, res) => {
  const current = db.prepare("SELECT * FROM menu_items WHERE id=?").get(Number(req.params.id));
  if (!current) return res.status(404).json({ error: "Menu item not found." });
  const category = req.body.category ?? current.category, name = req.body.name ?? current.name, price = req.body.price ?? current.price;
  const available = req.body.available === undefined ? current.available : (req.body.available ? 1 : 0);
  if (!String(category).trim() || !String(name).trim() || !(Number(price) > 0)) return res.status(400).json({ error: "Invalid menu data." });
  db.prepare("UPDATE menu_items SET category=?,name=?,price=?,available=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(String(category).trim(), String(name).trim(), Number(price), available, current.id);
  res.json(db.prepare("SELECT id,category,name,price,available FROM menu_items WHERE id=?").get(current.id));
});

app.delete("/api/menu/:id", ownerOnly, (req, res) => {
  const result = db.prepare("DELETE FROM menu_items WHERE id=?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "Menu item not found." });
  res.status(204).end();
});

// User management: owner only.
app.get("/api/users", ownerOnly, (req, res) => {
  res.json(db.prepare("SELECT id,username,role,active,created_at AS createdAt FROM users ORDER BY id").all()
    .map(x => ({ ...x, active: !!x.active })));
});
app.post("/api/users", ownerOnly, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim(), password = String(req.body.password || ""), role = req.body.role === "staff" ? "staff" : "owner";
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ error: "Username must be 3-30 characters." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await hashPassword(password);
    const id = db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)").run(username, hash, role).lastInsertRowid;
    res.status(201).json({ id, username, role });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Username already exists." });
    res.status(500).json({ error: "Could not create user." });
  }
});
app.post("/api/users/:id/reset-password", ownerOnly, async (req, res) => {
  try {
    const id = Number(req.params.id), password = String(req.body.password || "");
    const u = db.prepare("SELECT id,username FROM users WHERE id=?").get(id);
    if (!u) return res.status(404).json({ error: "User not found." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const hash = await hashPassword(password);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Could not reset password." }); }
});

app.patch("/api/users/:id", ownerOnly, (req, res) => {
  const id = Number(req.params.id), u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) return res.status(404).json({ error: "User not found." });
  if (id === req.user.id && req.body.active === false) return res.status(400).json({ error: "You cannot deactivate your own account." });
  if (req.body.active !== undefined) db.prepare("UPDATE users SET active=? WHERE id=?").run(req.body.active ? 1 : 0, id);
  if (req.body.role && ["owner", "staff"].includes(req.body.role)) db.prepare("UPDATE users SET role=? WHERE id=?").run(req.body.role, id);
  res.json({ ok: true });
});

app.use((req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

ensureDefaultOwner().then(() => app.listen(PORT, () => {
  console.log(`Seth Sanwaliya server running at http://localhost:${PORT}`);
  console.log(`Owner login: http://localhost:${PORT}/owner.html`);
})).catch(e => { console.error(e); process.exit(1) });
