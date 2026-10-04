
const C = window.CAFE_CONFIG || {};
const API = "/api";
const params = new URLSearchParams(location.search);

const state = {
  table: params.get("table") || "",
  token: params.get("token") || "",
  customer: null,
  cart: {},
  payment: "counter",
  menu: [],
  lastOrder: localStorage.getItem("ss_last_order") || ""
}; const $ = s => document.querySelector(s), money = n => "₹" + Number(n).toLocaleString("en-IN");
async function api(path, opts) { const r = await fetch(API + path, { headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }, ...opts }); let data = null; try { data = await r.json() } catch { } if (!r.ok) throw new Error(data?.error || "Request failed"); return data }
async function load() { state.menu = await api("/menu"); render() }
function render() {
  const cats = [...new Set(state.menu.map(x => x.category))];
  document.getElementById("app").innerHTML = `
<header class="nav">
  <div class="brand">
    <div>
      <div>Seth Sanwaliya</div>
      <span>RESTAURANT</span>
    </div>
  </div></header><main class="container">">GOOD FOOD • GOOD MOOD</div><h1>Fresh food,<br><span class="gold">happy tables.</span></h1><p>Order directly from your table. Choose your favourites, place the order and enjoy.</p>${state.lastOrder ? `<button class="action" onclick="trackOrder()" style="margin-top:14px">Track last order #${state.lastOrder}</button>` : ""}</div><div class="table-pill">Order for Table <b>${state.table || "—"}</b></div></section>
 ${!state.table ? '<div class="notice">Demo: open this page as <b>?table=8</b> to simulate a table QR.</div>' : ''}
 <div class="tabs">${cats.map((c, i) => `<button class="${i === 0 ? 'active' : ''}" onclick="document.getElementById('cat-${CSS.escape(c)}').scrollIntoView({behavior:'smooth',block:'start'})">${c}</button>`).join("")}</div>
 ${cats.map(cat => `<section id="cat-${cat}" class="menu-section"><h2 class="section-title">${cat}</h2><div class="grid">${state.menu.filter(x => x.category === cat).map(i => `<article class="card"><div class="card-top"><div class="item-name">${i.name}</div><div class="price">${money(i.price)}</div></div><p>${i.available ? 'Freshly prepared at Seth Sanwaliya.' : 'Currently unavailable.'}</p><button class="add" ${i.available ? '' : 'disabled'} onclick="add('${i.id}')">${i.available ? 'Add to cart' : 'Unavailable'}</button></article>`).join("")}</div></section>`).join("")}</main>
 <button class="cart" onclick="openCart()">🛒 Cart <span id="cart-count">0</span> · <span id="cart-total">₹0</span></button><div id="drawer" class="drawer" onclick="if(event.target.id==='drawer')closeDrawer()"></div>`;
  updateButton();
}
function add(id) { state.cart[id] = (state.cart[id] || 0) + 1; updateButton() }
function items() { return Object.entries(state.cart).map(([id, qty]) => ({ item: state.menu.find(x => String(x.id) === String(id)), qty })).filter(x => x.item) }
function total() { return items().reduce((s, x) => s + x.item.price * x.qty, 0) }
function updateButton() { if (!$("#cart-count")) return; $("#cart-count").textContent = Object.values(state.cart).reduce((a, b) => a + b, 0); $("#cart-total").textContent = money(total()) }
function openCart() { if (!items().length) { alert("Your cart is empty."); return } const d = $("#drawer"); d.classList.add("open"); d.innerHTML = `<div class="sheet"><div class="row"><h2>🛒 Your Order</h2><button class="action" onclick="closeDrawer()">Close</button></div>${items().map(x => `<div class="row"><div><b>${x.item.name}</b><div class="muted">${money(x.item.price)} each</div></div><div class="qty"><button onclick="qty('${x.item.id}',-1)">−</button><b>${x.qty}</b><button onclick="qty('${x.item.id}',1)">+</button></div><b>${money(x.item.price * x.qty)}</b></div>`).join("")}<div class="total">Total: ${money(total())}</div><button class="primary" onclick="customerForm()">Continue</button></div>` }
function qty(id, n) { state.cart[id] = (state.cart[id] || 0) + n; if (state.cart[id] <= 0) delete state.cart[id]; updateButton(); if (items().length) openCart(); else closeDrawer() }
function customerForm() { const d = $("#drawer"); d.classList.add("open"); d.innerHTML = `<div class="sheet"><div class="row"><h2>Before we send it</h2><button class="action" onclick="closeDrawer()">Close</button></div><label class="label">Your name</label><input id="cust-name" class="input" placeholder="e.g. Rahul Sharma"><label class="label">Phone number</label><input id="cust-phone" class="input" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number"><div class="notice">Table <b>${state.table || "—"}</b> · Details are stored with your order.</div><button class="primary" onclick="paymentForm()">Continue to payment</button></div>` }
function paymentForm() {
  const name = $("#cust-name").value.trim();
  const phone = $("#cust-phone").value.trim();

  if (!name || !/^\d{10}$/.test(phone)) {
    alert("Please enter a valid name and 10-digit phone number.");
    return;
  }

  state.customer = { name, phone };
  state.payment = "counter";

  const d = $("#drawer");

  d.innerHTML = `
    <div class="sheet">
      <div class="row">
        <h2>Place your order</h2>
        <button class="action" onclick="closeDrawer()">Close</button>
      </div>

      <div class="notice">
        Table <b>${state.table || "—"}</b>
      </div>

      <div class="pay-option selected">
        <b>💵 Pay at Counter</b>
        <div class="muted">
          Place your order now and pay at the counter.
        </div>
      </div>

      <div class="total">
        Payable: ${money(total())}
      </div>

      <button class="primary" onclick="placeOrder()">
        Place order
      </button>

      <p class="muted" style="font-size:11px;margin-top:12px">
        Your order will be sent directly to the kitchen.
        Please pay at the counter.
      </p>
    </div>
  `;
}
async function selectPay(p) {
  state.payment = p;
  $("#pay-counter").classList.toggle("selected", p === "counter");
  $("#pay-upi").classList.toggle("selected", p === "upi");
  $("#upi-area").classList.toggle("hidden", p !== "upi");
  updatePaymentUI();
}
async function updatePaymentUI() {
  const button = $("#payment-submit"), note = $("#payment-note"); if (!button) return;
  if (state.payment === "counter") {
    button.textContent = "Place order"; note.textContent = "Counter orders go directly to the kitchen."; return;
  }
  try {
    const cfg = await api("/payments/config");
    button.textContent = cfg.enabled ? "Pay securely with UPI" : "Online payment not configured";
    button.disabled = !cfg.enabled;
    note.textContent = cfg.enabled ? "Razorpay Test Mode is ready. No real money is charged while using test keys." : "Owner needs to add Razorpay Test Mode keys before online payments can be used.";
  } catch (e) { button.disabled = true; button.textContent = "Payment unavailable"; note.textContent = e.message }
}
function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = resolve; s.onerror = () => reject(new Error("Could not load Razorpay Checkout.")); document.head.appendChild(s);
  });
}
async function placeOrder() {
  if (!state.table) { alert("Open this page with a table QR, for example ?table=8."); return }
  const button = $("#payment-submit"); if (button) button.disabled = true;
  try {
    const result = await api("/orders", {
      method: "POST",
      body: JSON.stringify({
        table: Number(state.table),
        token: state.token,
        customer: state.customer,
        payment: state.payment,
        items: items().map(x => ({
          id: Number(x.item.id),
          qty: x.qty
        }))
      })
    }); const o = result.order; state.lastOrder = o.id; localStorage.setItem("ss_last_order", o.id);
    if (state.payment === "counter") {
      state.cart = {}; updateButton();
      $("#drawer").innerHTML = `<div class="sheet success"><div class="big">🎉</div><h2>Order placed!</h2><p class="muted">Order <b>#${o.id}</b> for Table <b>${o.table}</b> has reached the cafe.</p><div class="notice"><b>Please pay at the counter.</b><br>Total ${money(o.total)}</div><button class="primary" onclick="trackOrder()">Track order</button><button class="secondary" onclick="closeDrawer()">Done</button></div>`;
      return;
    }
    await startRazorpayPayment(o);
  } catch (e) { alert(e.message); if (button) button.disabled = false }
}
async function startRazorpayPayment(o) {
  await loadRazorpay();
  const rz = await api("/payments/create-order", { method: "POST", body: JSON.stringify({ publicId: o.id }) });
  const options = {
    key: rz.keyId, amount: rz.amount, currency: rz.currency, name: C.name || "Seth Sanwaliya Restaurant",
    description: `Table ${o.table} · Order #${o.id}`, order_id: rz.orderId,
    prefill: { name: state.customer.name, contact: state.customer.phone },
    notes: { cafe_order_id: o.id, table: String(o.table) }, theme: { color: "#d9a441" },
    handler: async function (response) {
      try {
        const verified = await api("/payments/verify", { method: "POST", body: JSON.stringify({ publicId: o.id, razorpay_payment_id: response.razorpay_payment_id, razorpay_order_id: response.razorpay_order_id, razorpay_signature: response.razorpay_signature }) });
        if (!verified.verified) { throw new Error("Payment was authenticated but is not captured yet. Please wait a few seconds and check the order status.") }
        state.cart = {}; updateButton();
        $("#drawer").innerHTML = `<div class="sheet success"><div class="big">✅</div><h2>Payment successful!</h2><p class="muted">Order <b>#${o.id}</b> for Table <b>${o.table}</b> is paid and has been sent to the kitchen.</p><div class="notice"><b>Payment verified.</b><br>Total ${money(o.total)}</div><button class="primary" onclick="trackOrder()">Track order</button><button class="secondary" onclick="closeDrawer()">Done</button></div>`;
      } catch (e) { alert(e.message); $("#drawer").innerHTML = `<div class="sheet"><h2>Payment received, verification pending</h2><p class="muted">Order #${o.id}. We are checking the payment with the gateway. Please use Track order to see the latest status.</p><button class="primary" onclick="trackOrder()">Track order</button></div>` }
    },
    modal: { ondismiss: function () { alert("Payment window closed. Your order is saved as payment-pending; you can retry online payment from the order flow.") } }
  };
  const rzp = new Razorpay(options); rzp.on("payment.failed", function (resp) { alert(resp.error?.description || "Payment failed. Please try again.") }); rzp.open();
}
async function trackOrder() { if (!state.lastOrder) { alert("No recent order found."); return } try { const o = await api("/orders/" + encodeURIComponent(state.lastOrder)); const steps = ["new", "preparing", "ready", "completed"]; const idx = steps.indexOf(o.status); const labels = { new: "Order received", preparing: "Being prepared", ready: "Ready", completed: "Completed", cancelled: "Cancelled" }; const d = $("#drawer"); d.classList.add("open"); d.innerHTML = `<div class="sheet"><div class="row"><h2>Order #${o.id}</h2><button class="action" onclick="closeDrawer()">Close</button></div><div class="notice">Table <b>${o.table}</b> · ${labels[o.status] || o.status}</div><div>${steps.map((s, i) => `<div class="row"><span>${i <= idx ? '✓' : '○'} ${labels[s]}</span><span>${i === idx ? 'Current' : ''}</span></div>`).join("")}</div><div class="total">Total: ${money(o.total)}</div><button class="primary" onclick="closeDrawer()">Done</button></div>` } catch (e) { alert(e.message) } }
function closeDrawer() { $("#drawer").classList.remove("open") }
load().catch(e => { document.getElementById("app").innerHTML = `<div class="container"><div class="notice">Backend not running. Start the server with <b>npm install</b> and <b>npm start</b>.</div></div>` });

// Phase 5 helper: open customer order tracking.
function openOrderTracking(orderId) {
  if (orderId) window.location.href = "/track.html?id=" + encodeURIComponent(orderId);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-track-order]");
  if (b) openOrderTracking(b.dataset.trackOrder);
});
