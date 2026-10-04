
const C=window.CAFE_CONFIG||{},API="/api"; console.log("Seth Sanwaliya Owner UI v5.1.1 loaded");
const $=s=>document.querySelector(s),money=n=>"₹"+Number(n).toLocaleString("en-IN");
async function api(path,opts){const r=await fetch(API+path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts?.headers||{})},...opts});let d=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.error||"Request failed");return d}
let state={orders:[],menu:[],tables:[],dash:null,me:null,users:[],paymentConfig:null};
let staffRefreshTimer=null;

async function boot(){
  try{const me=await api("/auth/me"); state.me=me.user||me; await loadAll(); render(); if(state.me.role==="staff") startStaffRefresh();}
  catch(e){renderLogin()}
}
function startStaffRefresh(){
  if(staffRefreshTimer) clearInterval(staffRefreshTimer);
  staffRefreshTimer=setInterval(async()=>{
    if(state.me?.role!=="staff") return;
    try{await loadAll(); renderStaff()}catch{}
  },5000);
}
async function login(){
  const username=$("#login-user").value.trim(),password=$("#login-pass").value;
  $("#login-error").textContent="";
  try{await api("/auth/login",{method:"POST",body:JSON.stringify({username,password})});const me=await api("/auth/me");state.me=me.user||me;await loadAll();render()}
  catch(e){$("#login-error").textContent=e.message}
}
function renderLogin(){
 document.getElementById("owner-app").innerHTML=`<div class="login-wrap"><div class="login-card"><div class="brand center">Seth Sanwaliya<span>OWNER PORTAL</span></div><h1>Owner Login</h1><p class="muted">Sign in to manage orders, menu, tables and staff.</p><label class="label">Username</label><input id="login-user" class="input" value="owner" autocomplete="username"><label class="label">Password</label><input id="login-pass" class="input" type="password" autocomplete="current-password" placeholder="Enter password" onkeydown="if(event.key==='Enter')login()"><div id="login-error" class="error"></div><button class="primary" onclick="login()">Sign in</button><p class="muted small">First login default: <b>owner / seth1234</b>. Change the password immediately.</p></div></div>`;
}
async function loadAll(){
 if(state.me.role !== "owner"){
  state.orders=await api("/orders"); state.menu=[]; state.tables=[]; state.dash=null; state.users=[]; state.paymentConfig=null; return;
 }
 [state.orders,state.menu,state.tables,state.dash,state.paymentConfig]=await Promise.all([api("/orders"),api("/menu/admin"),api("/tables"),api("/dashboard"),api("/payments/config")]);
 try{state.users=await api("/users")}catch{state.users=[]}
}
function render(){
 if(state.me.role!=="owner") return renderStaff();
 const d=state.dash.today,o=state.orders.slice(0,12);
 document.getElementById("owner-app").innerHTML=`<div class="admin-wrap"><header class="nav" style="margin:-20px -20px 0"><div class="brand">Seth Sanwaliya<span>OWNER DASHBOARD</span></div><div class="row"><span class="muted">${esc(state.me.username)} · owner</span><button class="action" onclick="changePassword()">Change password</button><button class="action" onclick="openKitchen()">Kitchen</button><button class="action" onclick="logout()">Logout</button></div></header><div style="padding-top:20px"><h1 style="font-family:'Playfair Display';margin-bottom:4px">Owner Dashboard</h1><div class="muted">Full management and operations panel.</div></div><nav class="admin-nav"><button class="active" onclick="tab('overview',this)">Overview</button><button onclick="tab('orders',this)">Orders</button><button onclick="tab('menu',this)">Menu</button><button onclick="tab('tables',this)">21 Tables + QR</button><button onclick="tab('reports',this)">Reports</button><button onclick="tab('users',this)">Staff</button></nav><section id="overview">${overview(d,o)}</section><section id="orders" class="hidden">${ordersHTML(state.orders)}</section><section id="menu" class="hidden">${menuHTML()}</section><section id="tables" class="hidden">${tablesHTML()}</section><section id="reports" class="hidden">${reportsHTML()}</section><section id="users" class="hidden">${usersHTML()}</section></div>`;
 setTimeout(makeQRs,50);
}
function renderStaff(){
 document.getElementById("owner-app").innerHTML=`<div class="admin-wrap"><header class="nav" style="margin:-20px -20px 0"><div class="brand">Seth Sanwaliya<span>STAFF PORTAL</span></div><div class="row"><span class="muted">${esc(state.me.username)} · staff</span><button class="action" onclick="changePassword()">Change password</button><button class="action" onclick="openKitchen()">Kitchen</button><button class="action" onclick="logout()">Logout</button></div></header><div style="padding-top:20px"><div class="row" style="align-items:flex-end"><div><h1 style="font-family:'Playfair Display';margin-bottom:4px">Staff Portal</h1><div class="muted">Orders and kitchen operations only. Auto-refreshes every 5 seconds.</div></div><button class="action" onclick="refreshStaffNow()">Refresh orders</button></div></div><nav class="admin-nav"><button class="active" onclick="tab('orders',this)">Orders <span class="nav-count">${state.orders.filter(x=>['new','preparing','ready'].includes(x.status)).length}</span></button><button onclick="openKitchen()">Kitchen Display</button></nav><section id="orders">${ordersHTML(state.orders)}</section></div>`;
}
async function refreshStaffNow(){try{await loadAll();renderStaff()}catch(e){alert(e.message)}}

function esc(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function overview(d,o){return `<div class="stats"><div class="stat"><small>Today's sales</small><strong>${money(d.revenue)}</strong></div><div class="stat"><small>Today's orders</small><strong>${d.orders}</strong></div><div class="stat"><small>UPI sales</small><strong>${money(d.upi)}</strong></div><div class="stat"><small>Counter sales</small><strong>${money(d.counter)}</strong></div></div><div class="admin-grid"><div class="panel"><h2>Recent orders</h2>${ordersHTML(o)}</div><div class="panel"><h2>Top items today</h2>${state.dash.topItems.map((x,i)=>`<div class="row"><span>${i+1}. ${esc(x.name)}</span><b>${x.quantity} sold</b></div>`).join("")||'<div class="empty">No sales yet today.</div>'}</div></div>`}
function historyHTML(o){
 if(!o.statusHistory?.length)return '<span class="muted">No history yet.</span>';
 return `<details><summary class="action" style="display:inline-block;cursor:pointer">Timeline</summary><div class="status-timeline">${o.statusHistory.map((h,i)=>`<div class="timeline-row"><span class="timeline-dot"></span><div><b>${esc(h.status)}</b><small>${new Date(h.changedAt).toLocaleString()}${h.changedBy?` · ${esc(h.changedBy)}`:''}</small></div></div>`).join('')}</div></details>`;
}
function nextActions(o){
 if(o.status==='new') return `<button class="action go-action" onclick="statusChange('${o.id}','preparing')">Start Preparing</button><button class="action danger-action" onclick="statusChange('${o.id}','cancelled')">Cancel</button>`;
 if(o.status==='preparing') return `<button class="action go-action" onclick="statusChange('${o.id}','ready')">Mark Ready</button><button class="action danger-action" onclick="statusChange('${o.id}','cancelled')">Cancel</button>`;
 if(o.status==='ready') return `<button class="action go-action" onclick="statusChange('${o.id}','completed')">Complete</button><button class="action" onclick="statusChange('${o.id}','preparing')">Back to Preparing</button>`;
 return '';
}
function ordersHTML(arr){
 if(!arr.length)return '<div class="empty">No orders yet.</div>';
 return `<div class="table-scroll"><table class="data"><thead><tr><th>Order</th><th>Table</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead><tbody>${arr.map(o=>{
   const manual=state.me.role==='owner' && o.payment==='upi'&&o.paymentStatus!=='paid'&&!state.paymentConfig?.enabled ? `<br><button class="action" onclick="markPaid('${o.id}')">Manual verify & mark paid</button>` : (o.payment==='upi'&&o.paymentStatus!=='paid' ? '<br><small>Gateway verification pending</small>' : '');
   return `<tr><td><b>#${o.id}</b><br><small>${new Date(o.createdAt).toLocaleString()}</small><br><small>Updated ${new Date(o.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></td><td><b>Table ${o.table}</b></td><td>${esc(o.customer.name)}<br><small>${esc(o.customer.phone)}</small></td><td>${o.items.map(i=>`${i.qty}× ${esc(i.name)}`).join(', ')}</td><td><b>${money(o.total)}</b></td><td><span class="badge ${o.payment==='upi'?'b-green':'b-gold'}">${o.payment.toUpperCase()}</span><br><small>${o.paymentStatus}</small>${manual}</td><td><span class="badge">${o.status}</span><br>${historyHTML(o)}</td><td><div class="order-actions">${nextActions(o)}<button class="action" onclick="printReceipt('${o.id}')">Receipt</button></div></td></tr>`;
 }).join('')}</tbody></table></div>`;
}

function menuHTML(){return `<div class="panel"><div class="row"><div><h2 style="margin:0">Menu management</h2><div class="muted">Changes are saved in the database and immediately appear to customers.</div></div><button class="action gold" onclick="addItem()">+ Add item</button></div><div class="menu-admin">${state.menu.map(i=>`<div class="menu-line"><div><b>${esc(i.name)}</b><br><small>${esc(i.category)} · ${money(i.price)} · ${i.available?'Available':'Unavailable'}</small></div><div><button class="action" onclick="editItem(${i.id})">Edit</button> <button class="action" onclick="toggleItem(${i.id},${!i.available})">${i.available?'Off':'On'}</button> ${state.me.role==="owner"?`<button class="action" onclick="removeItem(${i.id})">×</button>`:""}</div></div>`).join("")}</div></div>`}
function tablesHTML(){return `<div class="panel"><h2>21 table QR codes</h2><p class="muted">Each QR opens the customer menu with its table number.</p><div class="qr-grid">${Array.from({length:21},(_,i)=>`<div class="qr-card"><b>TABLE ${i+1}</b><div id="qr-${i+1}" style="margin:10px auto"></div><button class="action" onclick="printQR(${i+1})">Print QR</button><div style="font-size:10px;margin-top:5px">Active orders: ${state.tables[i]?.active_orders||0}</div></div>`).join("")}</div></div>`}
function reportsHTML(){const completed=state.orders.filter(x=>x.status==="completed"),rev=completed.reduce((s,x)=>s+x.total,0);const counts={};completed.flatMap(x=>x.items).forEach(i=>counts[i.name]=(counts[i.name]||0)+i.qty);const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);const pg=state.paymentConfig?.enabled?`Enabled (${esc(state.paymentConfig.mode||"test")} mode)`:"Not configured";return `<div class="admin-grid"><div class="panel"><h2>Completed sales in database</h2><div class="stat"><small>Revenue</small><strong>${money(rev)}</strong></div><h3>Top selling items</h3>${top.map((x,i)=>`<div class="row"><span>${i+1}. ${esc(x[0])}</span><b>${x[1]} sold</b></div>`).join("")||'<div class="empty">Complete some orders first.</div>'}</div><div class="panel"><h2>System status</h2><p>Database: <b>SQLite ✓</b></p><p>Tables: <b>21 ✓</b></p><p>Menu: <b>${state.menu.length} items</b></p><p>UPI ID: <b>${C.upiId||"7983875180@fam"}</b></p><p>Online payments: <b>${pg}</b></p></div></div>`}
function usersHTML(){return `<div class="panel"><div class="row"><div><h2 style="margin:0">Staff & owner accounts</h2><div class="muted">Only owner accounts can manage users.</div></div><button class="action gold" onclick="addUser()">+ Add account</button></div><div class="menu-admin">${state.users.map(u=>`<div class="menu-line"><div><b>${esc(u.username)}</b><br><small>${u.role} · ${u.active?'Active':'Disabled'}</small></div><div>${u.id!==state.me.id?`<button class="action" onclick="toggleUser(${u.id},${!u.active})">${u.active?'Disable':'Enable'}</button> <button class="action" onclick="resetUserPassword(${u.id},'${esc(u.username)}')">Reset password</button>`:"Current account"}</div></div>`).join("")}</div>`}
function tab(id,b){document.querySelectorAll("#owner-app>div>section").forEach(x=>x.classList.add("hidden"));$("#"+id)?.classList.remove("hidden");document.querySelectorAll(".admin-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");if(id==="tables")setTimeout(makeQRs,50)}
async function statusChange(id,status){try{await api("/orders/"+id+"/status",{method:"PATCH",body:JSON.stringify({status})});await loadAll();render()}catch(e){alert(e.message)}}
async function markPaid(id){if(!confirm("Only do this after you have actually verified the UPI payment."))return;try{await api("/orders/"+id+"/payment",{method:"PATCH",body:JSON.stringify({paymentStatus:"paid"})});await loadAll();render()}catch(e){alert(e.message)}}
async function addItem(){const name=prompt("Item name?");if(!name)return;const category=prompt("Category?","New");const price=Number(prompt("Price?","100"));if(!category||!price)return;try{await api("/menu",{method:"POST",body:JSON.stringify({name,category,price})});await loadAll();render()}catch(e){alert(e.message)}}
async function editItem(id){const i=state.menu.find(x=>x.id===id);const name=prompt("Item name",i.name),category=prompt("Category",i.category),price=Number(prompt("Price",i.price));if(!name||!category||!price)return;try{await api("/menu/"+id,{method:"PATCH",body:JSON.stringify({name,category,price})});await loadAll();render()}catch(e){alert(e.message)}}
async function toggleItem(id,available){try{await api("/menu/"+id,{method:"PATCH",body:JSON.stringify({available})});await loadAll();render()}catch(e){alert(e.message)}}
async function removeItem(id){if(!confirm("Remove this item from the live menu?"))return;try{await api("/menu/"+id,{method:"DELETE"});await loadAll();render()}catch(e){alert(e.message)}}
async function addUser(){const username=prompt("Username (3-30 chars)");if(!username)return;const password=prompt("Temporary password (8+ chars)");if(!password)return;const role=(prompt("Role: owner or staff","staff")||"staff").toLowerCase();try{await api("/users",{method:"POST",body:JSON.stringify({username,password,role})});await loadAll();render()}catch(e){alert(e.message)}}
async function toggleUser(id,active){try{await api("/users/"+id,{method:"PATCH",body:JSON.stringify({active})});await loadAll();render()}catch(e){alert(e.message)}}
async function resetUserPassword(id,username){const next=prompt(`New password for ${username} (8+ chars)`);if(!next)return;try{await api("/users/"+id+"/reset-password",{method:"POST",body:JSON.stringify({password:next})});alert("Password reset successfully.");}catch(e){alert(e.message)}}
async function changePassword(){const current=prompt("Current password");if(!current)return;const next=prompt("New password (8+ chars)");if(!next)return;try{await api("/auth/change-password",{method:"POST",body:JSON.stringify({currentPassword:current,newPassword:next})});alert("Password changed successfully.");}catch(e){alert(e.message)}}
async function logout(){try{await api("/auth/logout",{method:"POST"})}finally{if(staffRefreshTimer)clearInterval(staffRefreshTimer);staffRefreshTimer=null;renderLogin()}}
function openKitchen(){window.open("/kitchen.html","_blank");}
function printReceipt(id){const o=state.orders.find(x=>x.id===id);if(!o)return;const w=window.open("","_blank","width=420,height=700");const rows=o.items.map(i=>`<tr><td>${i.qty}× ${esc(i.name)}</td><td style="text-align:right">${money(i.price*i.qty)}</td></tr>`).join("");w.document.write(`<!doctype html><html><head><title>Receipt #${o.id}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}.c{text-align:center}.line{border-top:1px dashed #777;margin:14px 0}table{width:100%;border-collapse:collapse}td{padding:6px 0}.small{font-size:12px;color:#555}</style></head><body><div class="c"><h2>Seth Sanwaliya Restaurant</h2><div class="small">Good Food • Good Mood</div></div><div class="line"></div><p><b>Order #${o.id}</b><br>Table ${o.table}<br>${new Date(o.createdAt).toLocaleString()}</p><p>${esc(o.customer.name)} · ${esc(o.customer.phone)}</p><table>${rows}</table><div class="line"></div><h3 style="text-align:right">Total: ${money(o.total)}</h3><p class="small">Payment: ${o.payment.toUpperCase()} · ${o.paymentStatus}</p><div class="c small">Thank you! Please visit again.</div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
function makeQRs(){
  for(let i=1;i<=21;i++){
    const el=$("#qr-"+i);
    const table=state.tables.find(x=>Number(x.id)===i);

    if(el && table?.qr_token){
      el.innerHTML="";

      const url=new URL("/",location.origin);
      url.searchParams.set("table",i);
      url.searchParams.set("token",table.qr_token);

      new QRCode(el,{
        text:url.href,
        width:120,
        height:120
      });
    }
  }
}function printQR(n){const el=$("#qr-"+n),w=window.open("","_blank");w.document.write(`<html><body style="font-family:Arial;text-align:center;padding:40px"><h1>Seth Sanwaliya Restaurant</h1><h2>TABLE ${n}</h2>${el.innerHTML}<p>Scan to view menu & order</p><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
boot();
