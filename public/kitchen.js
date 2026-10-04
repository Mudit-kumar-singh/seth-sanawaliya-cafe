const $=s=>document.querySelector(s),money=n=>"₹"+Number(n).toLocaleString("en-IN");
async function api(path,opts){const r=await fetch("/api"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts?.headers||{})},...opts});let d=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.error||"Request failed");return d}
let orders=[];
let filter="all";
let previousNewIds=new Set();
async function load(){try{await api("/auth/me");orders=await api("/kitchen/orders");render()}catch(e){document.getElementById("kitchen").innerHTML=`<div class="login-wrap"><div class="login-card"><h2>Kitchen login required</h2><p class="muted">Open the Owner Dashboard, log in, then open the Kitchen Display again.</p><button class="primary" onclick="location.href='/owner.html'">Open Owner Login</button></div></div>`}}
function render(){
 const counts={all:orders.length,new:orders.filter(o=>o.status==='new').length,preparing:orders.filter(o=>o.status==='preparing').length,ready:orders.filter(o=>o.status==='ready').length};
 const visible=filter==='all'?orders:orders.filter(o=>o.status===filter);
 const currentNew=new Set(orders.filter(o=>o.status==='new').map(o=>o.id));
 const hasNew=[...currentNew].some(id=>!previousNewIds.has(id));
 if(hasNew && previousNewIds.size) document.title=`🔔 NEW ORDER • Kitchen Display`; else document.title='Kitchen Display • Seth Sanwaliya';
 previousNewIds=currentNew;
 const active=orders.length;
 document.getElementById("kitchen").innerHTML=`<main class="k-wrap"><header class="k-head"><div><div class="k-title">🍳 Kitchen Display</div><div class="k-meta"><span class="live"><i class="dot"></i> Live</span> · ${active} active order${active===1?'':'s'} · auto refresh every 5 sec</div></div><div><button class="action" onclick="load()">Refresh</button> <button class="action" onclick="location.href='/owner.html'">Staff Portal</button></div></header><div class="k-filters">${['all','new','preparing','ready'].map(x=>`<button class="${filter===x?'active':''}" onclick="setFilter('${x}')">${x==='all'?'All':x[0].toUpperCase()+x.slice(1)} <span>${counts[x]}</span></button>`).join('')}</div>${visible.length?`<div class="k-grid">${visible.map(card).join("")}</div>`:`<div class="panel k-empty"><div style="font-size:50px">☕</div><h2>No ${filter==='all'?'active ':filter+' '}orders</h2><p>Orders will appear here automatically.</p></div>`}</main>`;
}
function setFilter(next){filter=next;render()}
function ageLabel(createdAt){
 const mins=Math.max(0,Math.floor((Date.now()-new Date(createdAt).getTime())/60000));
 if(mins<1)return 'just now';
 if(mins===1)return '1 min ago';
 return `${mins} min ago`;
}

function card(o){return `<article class="k-card ${o.status}"><div class="k-top"><div><div class="k-table">Table ${o.table}</div><div class="k-order">Order #${o.id}</div></div><div style="text-align:right"><span class="badge">${o.status.toUpperCase()}</span><div class="k-time">${ageLabel(o.createdAt)}</div></div></div><div class="k-items">${o.items.map(i=>`<div class="k-item"><span><b>${i.qty}×</b> ${esc(i.name)}</span><span>${money(i.price*i.qty)}</span></div>`).join("")}</div><div class="row" style="border-top:1px solid #292929"><span><b>${esc(o.customer.name)}</b><br><small class="muted">${esc(o.customer.phone)}</small></span><b>${money(o.total)}</b></div><div class="k-actions">${o.status==='new'?`<button class="go" onclick="change('${o.id}','preparing')">Start Preparing</button><button onclick="change('${o.id}','cancelled')">Cancel</button>`:o.status==='preparing'?`<button class="go" onclick="change('${o.id}','ready')">Mark Ready</button><button onclick="change('${o.id}','cancelled')">Cancel</button>`:`<button class="go" onclick="change('${o.id}','completed')">Complete</button><button onclick="change('${o.id}','preparing')">Back to Preparing</button>`}</div></article>`}

function esc(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
async function change(id,status){try{await api(`/orders/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load()}catch(e){alert(e.message)}}
load();setInterval(load,5000);