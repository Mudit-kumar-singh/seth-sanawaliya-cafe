
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "cafe.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  table_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('upi','counter')),
  payment_status TEXT NOT NULL CHECK(payment_status IN ('pending','initiated','paid','failed')),
  status TEXT NOT NULL CHECK(status IN ('new','preparing','ready','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  FOREIGN KEY(table_id) REFERENCES tables(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  menu_item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(menu_item_id) REFERENCES menu_items(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('new','preparing','ready','completed','cancelled')),
  changed_by_user_id INTEGER,
  changed_by_username TEXT NOT NULL DEFAULT 'customer',
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id, id);

INSERT INTO order_status_history(order_id,status,changed_by_username)
SELECT o.id,o.status,'system' FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id=o.id);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order ON orders(razorpay_order_id);
CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

const tableCount = db.prepare("SELECT COUNT(*) AS c FROM tables").get().c;
if (tableCount === 0) {
  const insertTable = db.prepare("INSERT INTO tables(id,name) VALUES(?,?)");
  const tx = db.transaction(() => {
    for (let i = 1; i <= 21; i++) insertTable.run(i, `Table ${i}`);
  });
  tx();
}

const menuCount = db.prepare("SELECT COUNT(*) AS c FROM menu_items").get().c;
if (menuCount === 0) {
  const seed = [
    ["Pizza","O Com Pizza",79],["Pizza","Magetta Pizza",89],["Pizza","Tandoori Paneer Pizza",129],["Pizza","Sweet Corn Pizza",99],
    ["Sandwich","Veg Cheese Grill",79],["Sandwich","Tandoori Paneer",99],["Sandwich","Veg Grill",79],["Sandwich","Bombe Sandwich",99],
    ["Pasta","Red Pasta",99],["Pasta","White Pasta",129],
    ["Burger","Veg Aloo Tikki",69],["Burger","Veg Cheese",89],["Burger","Veg Peri Peri",79],
    ["Meggie","Plain Meggie",69],["Meggie","Veg Masala Meggie",79],["Meggie","Cheese Meggie",79],
    ["French Fries","Peri Peri",99],["French Fries","Plain",69],["French Fries","Masala",79],
    ["Chinese","Veg Chawmin",79],["Chinese","Chilly Paneer (Dry)",119],["Chinese","Chilly Paneer (Gravy)",139],["Chinese","Dragon Patato",99],["Chinese","Corn Fritters",89],["Chinese","Fried Rice",89],["Chinese","Manchurian (Dry)",99],["Chinese","Manchurian (Gravy)",119],["Chinese","Chinese Bhel",99],
    ["Shakes","Oreo Shake",79],["Shakes","Kirket Shake",69],["Shakes","Chocolate Shake",79],["Shakes","Pineapple Shake",69],["Shakes","Banana Shake",79],["Shakes","Mango Shake",69],
    ["Beverage","Hot Coffee",30],["Beverage","Cold Coffee",80],["Beverage","Tandoori Tea",30],["Beverage","Kulhad Tea",20],["Beverage","Red Bull",130],["Beverage","Hell",60],["Beverage","Diet Coke",50],["Beverage","Water",20],
    ["Paneer Sabji","Paneer Butter Masala",170],["Paneer Sabji","Shahi Paneer",180],["Paneer Sabji","Handi Paneer",180],["Paneer Sabji","Kadai Paneer",200],["Paneer Sabji","Mutter Paneer",170],["Paneer Sabji","Palak Paneer",200],
    ["Dal","Dal Fry",120],["Dal","Dal Tadka",140],
    ["Veg Sabji","Mix Veg",150],["Veg Sabji","Dam Allo",120],["Veg Sabji","Jeera Aloo",90],["Veg Sabji","Aloo Pyaz",100],["Veg Sabji","Aloo Mutter",110],["Veg Sabji","Bhindi Fry",130],["Veg Sabji","Bhindi Masala",120],["Veg Sabji","Sew Tamater",120],["Veg Sabji","Sev Bhaji",130],
    ["Raita","Bhindi Raita",60],["Raita","Veg Raita",70],["Raita","Plan Chach",20],["Raita","Masala",30],["Raita","Plan Dahi",50],
    ["Snacks","Masala Papad",30],["Snacks","Plan Papad",10],["Snacks","Masala Khichiya",40],["Snacks","Plan Khichiya",20],["Snacks","Pinet Masala",80],
    ["Roti","Tawa Plan Roti",15],["Roti","Tawa Butter Roti",20],["Roti","Aloo Paratha",80],["Roti","Paneer Paratha",100],["Roti","Veg Paratha",70],
    ["Rice","Plan Rice",60],["Rice","Jeera Rice",70],["Rice","Veg Biryani",150],["Rice","Veg Pulao",160]
  ];
  const insert = db.prepare("INSERT INTO menu_items(category,name,price) VALUES(?,?,?)");
  const tx = db.transaction(() => seed.forEach(x => insert.run(...x)));
  tx();
}

module.exports = db;


const defaultUser = db.prepare("SELECT id FROM users WHERE username=?").get("owner");
if (!defaultUser) {
  // Marker is intentionally replaced by server.js on first startup.
  db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)")
    .run("owner", "__DEFAULT_OWNER_PASSWORD__", "owner");
}
