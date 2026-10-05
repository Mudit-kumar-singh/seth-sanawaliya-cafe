
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
    ["Soup", "Tomato Soup", 99],
    ["Soup", "Sweet Corn Soup", 99],
    ["Soup", "Manchow Soup", 99],
    ["Soup", "Hot N Sour Soup", 99],

    ["Starter", "Paneer Pakora", 129],
    ["Starter", "Mix Veg Pakora", 119],
    ["Starter", "Plain Papad", 25],
    ["Starter", "Masala Papad", 35],
    ["Starter", "Plain Khichiya", 25],
    ["Starter", "Masala Khichiya", 35],
    ["Starter", "Peanut Masala", 99],
    ["Starter", "Chana Masala", 99],
    ["Starter", "Corn Fritters", 99],

    ["Breakfast", "Poha", 69],
    ["Breakfast", "Aloo Paratha", 99],
    ["Breakfast", "Paneer Paratha", 119],

    ["Breads", "Veg Paratha", 89],

    ["Maggie", "Plain Maggi", 49],
    ["Maggie", "Plain Cheese Maggi", 89],
    ["Maggie", "Veg Cheese Masala Maggi", 99],
    ["Maggie", "Veg Masala Maggie", 79],

    ["Fries", "Peri Peri Fries", 119],
    ["Fries", "Plain Fries", 89],
    ["Fries", "Masala Fries", 129],

    ["Pizza", "Cheese Pizza", 119],
    ["Pizza", "Onion Capscicum Com Pizza", 119],
    ["Pizza", "Cheese Tomato onion Capscicum Pizza", 129],
    ["Pizza", "Cheese Garlic Onion Capscicum Pizza", 129],
    ["Pizza", "Cheese American Corn Pizza", 129],
    ["Pizza", "Cheese Masala Pizza", 129],
    ["Pizza", "Punjabi Paneer Pizza", 169],
    ["Pizza", "Chilly Cheese Garlic Bread", 119],

    ["Italian", "White Pasta", 149],
    ["Italian", "Red Pasta", 149],
    ["Italian", "Desi Pasta", 169],

    ["Burger", "Veg Aloo Tikki Burger", 79],
    ["Burger", "Veg Cheese Burger", 99],
    ["Burger", "Spicy Cheese Burger", 129],
    ["Burger", "Spicy Cheese Paneer Burger", 149],

    ["Chinese ", "Veg Chouwmein", 99],
    ["Chinese ", "Hakka Noodles", 119],
    ["Chinese ", "Chili Garlic Noodles", 129],
    ["Chinese ", "Spring Roll", 109],
    ["Chinese ", "Chinese Bhel", 119],
    ["Chinese ", "Fried Rice", 119],
    ["Chinese ", "Veg Manchurian Dry", 119],
    ["Chinese ", "Veg Manchurian Gravy", 129],
    ["Chinese ", "Dragon Potato", 109],
    ["Chinese ", "Chilly Paneer Dry", 129],
    ["Chinese ", "Chilly Paneer Gravy", 149],

    ["Sandwich ", "Plain Veg Cheese Grill", 89],
    ["Sandwich ", "Veg Tandoori Paneer Grilled", 129],

    ["Main Course", "Paneer Butter Masala", 229],
    ["Main Course", "Shahi Paneer", 229],
    ["Main Course", "Handi Paneer", 229],
    ["Main Course", "Kadai Paneer", 229],
    ["Main Course", "Mutter Paneer", 229],
    ["Main Course", "Palak Paneer", 229],
    ["Main Course", "Dal Fry", 129],
    ["Main Course", "Dal Tadka", 149],
    ["Main Course", "Mix Veg", 169],
    ["Main Course", "Dum Aloo", 129],
    ["Main Course", "Jeera Aloo", 99],
    ["Main Course", "Aloo Pyaz", 109],
    ["Main Course", "Aloo Mutter", 119],
    ["Main Course", "Bhindi Fry", 149],
    ["Main Course", "Bhindi Masala", 129],
    ["Main Course", "Sev Tamatar", 129],
    ["Main Course", "Sev Bhaji", 149],
    ["Main Course", "Rajasthani Gatte ki Sabzi", 229],

    ["Rice Preparation ", "Plain Rice", 80],
    ["Rice Preparation ", "Jeera Rice", 90],
    ["Rice Preparation ", "Veg Biryani", 169],
    ["Rice Preparation ", "Hyederabad Biryani", 199],
    ["Rice Preparation ", "Veg Pulao", 189],

    ["Curd", "Boondi Raita", 89],
    ["Curd", "Bhindi Raita", 69],
    ["Curd", "Veg Raita", 79],
    ["Curd", "Plain Chaas", 25],
    ["Curd", "Masala Chaas", 30],
    ["Curd", "Plain Dahi", 59],

    ["Thali", "Thali (Paneer Butter Masala, Dal Fry, Jeera Rice, Boondi Raita,Butter Roti(4Pcs), Salad", 249],
    ["Thali", "Student Thali (Seasonal Sabzi, Dal fry, Butter Roti (4 Pcs) Plain Rice", 189],

    ["Beverages", "Oreo Shake", 129],
    ["Beverages", "KitKat Shake", 129],
    ["Beverages", "Chocolate Shake", 99],
    ["Beverages", "Pineapple Shake", 79],
    ["Beverages", "Banana Shake", 89],
    ["Beverages", "Mango Shake", 79],
    ["Beverages", "Hot Coffee", 40],
    ["Beverages", "Cold Coffee", 99],
    ["Beverages", "Tandoori Tea", 40],
    ["Beverages", "Kulhad Tea", 30],
    ["Beverages", "Red Bull", 130],
    ["Beverages", "monster", 130],
    ["Beverages", "Hell", 60],
    ["Beverages", "Diet Coke", 60],
    ["Beverages", "coke can", 40],
    ["Beverages", "sprite can ", 40],
    ["Beverages", "thums up can ", 40],
    ["Beverages", "dew can ", 70],
    ["Beverages", "pepsi can ", 40],
    ["Beverages", "diet pepsi can", 50],
    ["Beverages", "coke (2 liter)", 100],
    ["Beverages", "sprite (2 liter)", 100],
    ["Beverages", "thums up (2liter)", 100],
    ["Beverages", "dew (2 liter)", 100],
    ["Beverages", "pepsi (2 liter)", 100],
    ["Beverages", "real juice(jumbo)", 150],
    ["Beverages", "Water", 20],

    ["Salad", "Onion Salad", 25],
    ["Salad", "Green Salad", 69],

    ["Breads", "Plain Tawa Roti", 15],
    ["Breads", "Butter Tawa Roti", 20]
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
