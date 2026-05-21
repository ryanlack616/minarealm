// Minarealm admin Worker — multi-user with audit log
//
// User model (KV):
//   user:<username>    -> { username, name, role, salt, hash, created, createdBy, lastLogin, active }
//   session:<token>    -> { username, role }   (TTL 30d)
//   audit:<ts>-<rand>  -> { ts, user, role, action, target, summary }
//   catalog            -> products json
//   order:<id>         -> order json
//
// Roles:
//   "owner" = Cynthia. Can do everything: manage users, view audit log, change all settings.
//   "admin" = staff. Can edit inventory, manage orders, upload images. Cannot see users/audit.
//
// Bootstrap:
//   If no users exist, POST /api/login with username "owner" + ADMIN_PASSWORD secret
//   automatically creates a user "cynthia" with role=owner and password=ADMIN_PASSWORD,
//   then logs in. After that, the owner can create more users from /admin/.

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const AUDIT_RETENTION_DAYS = 365;
const MI_TAX_RATE = 0.06; // Michigan 6% sales tax (applied to product subtotal; shipping taxability varies)
const RATE_LIMITS = {
  loginIp: { limit: 20, windowSec: 60 * 10 },
  loginUserIp: { limit: 8, windowSec: 60 * 10 },
  ordersIp: { limit: 40, windowSec: 60 * 60 },
  formsIp: { limit: 30, windowSec: 60 * 60 },
  checkoutIp: { limit: 10, windowSec: 60 * 60 }
};

// ── CORS / helpers ───────────────────────────────────────────────────
function corsHeaders(env, req){
  const origin = req.headers.get('Origin') || env.ALLOWED_ORIGIN;
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    'Access-Control-Allow-Origin': ok ? origin : env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function sessionCookie(token, req){
  const origin = req.headers.get('Origin') || '';
  const secure = origin.startsWith('https://');
  const parts = [
    `minarealm_session=${token}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=None'
  ];
  if(secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(req){
  const origin = req.headers.get('Origin') || '';
  const secure = origin.startsWith('https://');
  const parts = [
    'minarealm_session=',
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=None'
  ];
  if(secure) parts.push('Secure');
  return parts.join('; ');
}
function json(data, init = {}, env, req){
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...corsHeaders(env, req), ...(init.headers || {})
    }
  });
}
const err = (status, message, env, req) => json({ error: message }, { status }, env, req);

function slugify(s){
  return (s || 'img').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'img';
}
function newId(){
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => b.toString(36).padStart(2,'0')).join('').slice(0,12);
}
function newToken(){
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map(x => x.toString(16).padStart(2,'0')).join('');
}
function newSalt(){
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2,'0')).join('');
}
async function hashPw(password, salt){
  // SHA-256(salt + ":" + password), iterated 50k times. Not bcrypt-strong but
  // acceptable for low-value shop with rate-limited login.
  const enc = new TextEncoder();
  let buf = enc.encode(salt + ':' + password);
  for(let i = 0; i < 50000; i++){
    buf = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }
  return [...buf].map(x => x.toString(16).padStart(2,'0')).join('');
}
function constantTimeEq(a, b){
  if(a.length !== b.length) return false;
  let r = 0;
  for(let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function sanitizeUsername(s){
  return String(s || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 24);
}
function normalizeEmail(s){
  return String(s || '').trim().toLowerCase().slice(0, 160);
}
function clampText(s, max){
  return String(s || '').trim().slice(0, max);
}
async function listByPrefix(env, prefix, limit = 100){
  const out = [];
  let cursor;
  do {
    const r = await env.STORE.list({ prefix, cursor, limit: Math.min(1000, limit) });
    for(const k of r.keys){
      const raw = await env.STORE.get(k.name);
      if(!raw) continue;
      try { out.push(JSON.parse(raw)); } catch {}
      if(out.length >= limit) break;
    }
    cursor = r.cursor;
    if(r.list_complete || out.length >= limit) break;
  } while(cursor);
  return out;
}

function getClientIp(req){
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  ).slice(0, 64);
}

async function checkRateLimit(env, key, limit, windowSec){
  const raw = await env.STORE.get(key);
  let count = 0;
  if(raw){
    const n = parseInt(raw, 10);
    count = Number.isFinite(n) ? n : 0;
  }
  count += 1;
  await env.STORE.put(key, String(count), { expirationTtl: windowSec });
  return count <= limit;
}

async function bumpLoginRateLimit(env, ipKey, comboKey){
  const okIp = await checkRateLimit(env, ipKey, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowSec);
  const okCombo = await checkRateLimit(env, comboKey, RATE_LIMITS.loginUserIp.limit, RATE_LIMITS.loginUserIp.windowSec);
  return okIp && okCombo;
}

function isWeakBootstrapPassword(pw){
  const v = String(pw || '').toLowerCase().trim();
  return ['rocks', 'password', 'admin', '123456', 'changeme'].includes(v) || v.length < 10;
}

// ── Weight & shipping helpers ────────────────────────────────────────
const WEIGHT_ESTIMATES = {
  'crystal-bracelet': 25,
  'agate-slice': 80,
  'crystal-sphere': 150,
  'labradorite-heart': 100,
  'polished-sphere': 400,
  'mystery-bag': 350,
  'tumbled-set': 80,
  'sterling-ring': 15,
  'selenite-dragonfly-plate': 200,
  'selenite-mushroom-women-plate': 390,
  'selenite-tower-6in': 150,
  'yellow-calcite-pooh-bear': 122,
  'yooperlite-owl': 200,
  'purple-labradorite-palmstone': 32
};
function productWeightGrams(p){
  if(p.weight_grams) return Math.round(Number(p.weight_grams));
  if(p.weight_lbs) return Math.round(Number(p.weight_lbs) * 453.592);
  return WEIGHT_ESTIMATES[p.id] || 200;
}
function calcShipping(weightGrams, subtotal, freeThreshold){
  if(subtotal >= freeThreshold) return 0;
  if(weightGrams <= 250) return 6.99;
  if(weightGrams <= 450) return 9.99;
  if(weightGrams <= 1000) return 14.99;
  if(weightGrams <= 2000) return 19.99;
  return 29.99;
}

// ── Square helpers ────────────────────────────────────────────────────
async function verifySquareWebhook(env, req, bodyText){
  const sig = req.headers.get('x-square-hmacsha256-signature');
  if(!sig || !env.SQUARE_WEBHOOK_SIGNATURE_KEY) return false;
  const url = new URL(req.url);
  const message = url.toString() + bodyText;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return constantTimeEq(sig, expected);
}
async function createSquarePaymentLink(env, { orderId, lines, shippingCost, taxAmount, customerEmail }){
  const base = env.SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
  const lineItems = [
    ...lines.map(l => ({
      name: l.name,
      quantity: String(l.qty),
      base_price_money: { amount: Math.round(l.price * 100), currency: 'USD' }
    })),
    ...(shippingCost > 0 ? [{
      name: 'Shipping (USPS)',
      quantity: '1',
      base_price_money: { amount: Math.round(shippingCost * 100), currency: 'USD' },
      item_type: 'CUSTOM_AMOUNT'
    }] : []),
    ...(taxAmount > 0 ? [{
      name: 'Michigan Sales Tax (6%)',
      quantity: '1',
      base_price_money: { amount: Math.round(taxAmount * 100), currency: 'USD' },
      item_type: 'CUSTOM_AMOUNT'
    }] : [])
  ];
  const body = {
    idempotency_key: orderId,
    order: { location_id: env.SQUARE_LOCATION_ID, line_items: lineItems },
    checkout_options: {
      redirect_url: `https://minarealm.shop/shop/order-success.html?orderId=${orderId}`,
      merchant_support_email: env.NOTIFY_EMAIL || 'cynthia@minarealm.org',
      allow_tipping: false,
      enable_coupon: false
    }
  };
  if(customerEmail) body.pre_populated_data = { buyer_email: customerEmail };
  const resp = await fetch(`${base}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-02-28'
    },
    body: JSON.stringify(body)
  });
  if(!resp.ok){
    const detail = await resp.text();
    throw new Error(`Square API ${resp.status}: ${detail.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.payment_link;
}
async function sendOrderNotification(env, order){
  const notifyEmail = env.NOTIFY_EMAIL || 'cynthia@minarealm.org';
  const itemsList = (order.lines || [])
    .map(l => `  - ${l.name} x${l.qty} @ $${Number(l.price).toFixed(2)}`)
    .join('\n');
  const addr = order.shippingAddress || {};
  const addrLines = [addr.name, addr.line1, addr.line2, `${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`]
    .filter(Boolean).join('\n  ');
  const isShip = String(order.fulfillment || '').toLowerCase().includes('ship');
  const lines = [
    `New paid order: ${order.id}`,
    '',
    `Customer: ${order.customer.name} <${order.customer.email}>`,
    order.customer.phone ? `Phone: ${order.customer.phone}` : null,
    '',
    `Fulfillment: ${order.fulfillment}`,
    isShip && addrLines ? `\nShip to:\n  ${addrLines}` : null,
    '',
    'Items:',
    itemsList,
    '',
    `Subtotal: $${Number(order.financial.subtotal).toFixed(2)}`,
    order.financial.shipping > 0 ? `Shipping: $${Number(order.financial.shipping).toFixed(2)}` : null,
    `Total: $${Number(order.financial.total).toFixed(2)}`,
    '',
    'View orders: https://minarealm.shop/admin/'
  ].filter(s => s !== null).join('\n');
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: notifyEmail, name: 'Cynthia' }] }],
        from: { email: 'orders@minarealm.shop', name: 'Minarealm Shop' },
        subject: `New order from ${order.customer.name || 'customer'} — $${Number(order.financial.total).toFixed(2)}`,
        content: [{ type: 'text/plain', value: lines }]
      })
    });
  } catch(_){ /* non-fatal — Square also notifies Cynthia */ }
}
async function sendCustomerConfirmation(env, order){
  const { customer, lines, financial, fulfillment, shippingAddress, id } = order;
  if(!customer?.email) return;
  const isShip = String(fulfillment || '').toLowerCase().includes('ship');
  const addr = shippingAddress || {};
  const addrBlock = isShip && addr.line1
    ? `\n\nShipping to:\n  ${[addr.name, addr.line1, addr.line2, `${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`].filter(Boolean).join('\n  ')}`
    : '';
  const itemsList = (lines || [])
    .map(l => `  - ${l.name} x${l.qty}  $${Number(l.price * l.qty).toFixed(2)}`)
    .join('\n');
  const finLines = [
    `Subtotal: $${Number(financial.subtotal).toFixed(2)}`,
    financial.shipping > 0 ? `Shipping: $${Number(financial.shipping).toFixed(2)}` : 'Shipping: FREE',
    financial.tax > 0 ? `Tax: $${Number(financial.tax).toFixed(2)}` : null,
    `Total charged: $${Number(financial.total).toFixed(2)}`
  ].filter(Boolean).join('\n');
  const body = [
    `Hi ${customer.name || 'there'},`,
    '',
    `Thank you for your order from Minarealm! Here's your confirmation.`,
    '',
    `Order #${id}`,
    `Fulfillment: ${fulfillment}`,
    addrBlock,
    '',
    'What you ordered:',
    itemsList,
    '',
    finLines,
    '',
    isShip
      ? `We'll email you a USPS tracking number once your order ships — usually within 1-2 business days.`
      : `Cynthia will reach out to coordinate your pickup.`,
    '',
    'Questions? Reply to this email or visit https://minarealm.shop',
    '',
    '— Cynthia @ Minarealm'
  ].filter(s => s !== null).join('\n');
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: customer.email, name: customer.name || '' }] }],
        from: { email: 'orders@minarealm.shop', name: 'Minarealm Crystals' },
        reply_to: { email: env.NOTIFY_EMAIL || 'cynthia@minarealm.org', name: 'Cynthia @ Minarealm' },
        subject: `Your Minarealm order is confirmed (#${id})`,
        content: [{ type: 'text/plain', value: body }]
      })
    });
  } catch(_){ /* non-fatal */ }
}
async function sendLowStockAlert(env, items){
  const notifyEmail = env.NOTIFY_EMAIL || 'cynthia@minarealm.org';
  const body = [
    'Heads up — the following items are running low after a recent order:',
    '',
    ...items.map(s => `  \u2022 ${s}`),
    '',
    'Check inventory: https://minarealm.shop/admin/'
  ].join('\n');
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: notifyEmail, name: 'Cynthia' }] }],
        from: { email: 'orders@minarealm.shop', name: 'Minarealm Shop' },
        subject: `Low stock alert: ${items.join(', ').slice(0, 60)}`,
        content: [{ type: 'text/plain', value: body }]
      })
    });
  } catch(_){}
}
async function sendTrackingEmail(env, order, trackingNumber){
  const { customer, lines, financial, id } = order;
  if(!customer?.email) return;
  const itemsList = (lines || []).map(l => `  - ${l.name} x${l.qty}`).join('\n');
  const uspsUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
  const body = [
    `Hi ${customer.name || 'there'},`,
    '',
    `Great news — your Minarealm order (#${id}) has shipped!`,
    '',
    `Tracking number: ${trackingNumber}`,
    `Track your package: ${uspsUrl}`,
    '',
    'What you ordered:',
    itemsList,
    '',
    `Order total: $${Number(financial.total).toFixed(2)}`,
    '',
    'Please allow 1-2 business days for tracking to update.',
    'Questions? Reply to this email.',
    '',
    '— Cynthia @ Minarealm',
    'https://minarealm.shop'
  ].join('\n');
  await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: customer.email, name: customer.name || '' }] }],
      from: { email: 'orders@minarealm.shop', name: 'Minarealm Crystals' },
      reply_to: { email: env.NOTIFY_EMAIL || 'cynthia@minarealm.org', name: 'Cynthia @ Minarealm' },
      subject: `Your Minarealm order has shipped — tracking: ${trackingNumber}`,
      content: [{ type: 'text/plain', value: body }]
    })
  });
}

async function sendPendingCatalogAlert(env, submitter, productCount){
  const notifyEmail = env.NOTIFY_EMAIL || 'cynthia@minarealm.org';
  const body = [
    `${submitter} submitted a product update (${productCount} product${productCount === 1 ? '' : 's'}) waiting for your approval.`,
    '',
    'Log in to review, approve, or reject:',
    'https://minarealm.shop/admin/',
    '',
    '— Minarealm Shop'
  ].join('\n');
  try {
    await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: notifyEmail, name: 'Cynthia' }] }],
        from: { email: 'orders@minarealm.shop', name: 'Minarealm Shop' },
        subject: `Shop update pending approval — ${productCount} product${productCount === 1 ? '' : 's'} from ${submitter}`,
        content: [{ type: 'text/plain', value: body }]
      })
    });
  } catch(_){}
}

function sanitizeCatalogForPublic(catalog){
  const products = (catalog.products || []).map((p) => {
    const {
      wholesale_cost,
      supplier,
      wholesale_confidence,
      retail_confidence,
      ...rest
    } = p || {};
    return rest;
  });
  return { ...catalog, products };
}
async function storeFormEntry(env, type, entry, email){
  const created = new Date().toISOString();
  const id = `${Date.now()}-${newId()}`;
  const record = { id, type, created, ...entry };
  await env.STORE.put(`form:${type}:${id}`, JSON.stringify(record));

  const normalizedEmail = normalizeEmail(email);
  if(normalizedEmail){
    const leadKey = `lead:${normalizedEmail}`;
    const priorRaw = await env.STORE.get(leadKey);
    let prior = null;
    if(priorRaw){
      try { prior = JSON.parse(priorRaw); } catch {}
    }
    const sources = Array.from(new Set([...(prior?.sources || []), type, entry.source].filter(Boolean)));
    await env.STORE.put(leadKey, JSON.stringify({
      email: normalizedEmail,
      name: entry.name || prior?.name || '',
      phone: entry.phone || prior?.phone || '',
      latestType: type,
      latestId: id,
      latestAt: created,
      sources,
      latestSummary: entry.message || entry.notes || entry.tier || ''
    }));
  }
  return record;
}
async function listFormEntries(env, kind, limit = 100){
  const types = ['booking', 'contact', 'newsletter', 'subscription'];
  const selected = types.includes(kind) ? [kind] : types;
  const groups = await Promise.all(selected.map(type => listByPrefix(env, `form:${type}:`, limit)));
  return groups
    .flat()
    .sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    .slice(0, limit);
}

const DEFAULT_CATALOG = {
  updated: new Date().toISOString().slice(0,10),
  currency: 'USD',
  categories: [
    { id: 'crystals',  name: 'Crystals & Minerals' },
    { id: 'jewelry',   name: 'Sterling Silver Jewelry' },
    { id: 'fossils',   name: 'Fossils' },
    { id: 'carvings',  name: 'Carvings & Spheres' },
    { id: 'tools',     name: 'Spiritual Tools' },
    { id: 'mystery',   name: 'Mystery & Bundles' }
  ],
  products: []
};
async function getCatalog(env){
  const raw = await env.STORE.get('catalog');
  if(!raw) return DEFAULT_CATALOG;
  try { return JSON.parse(raw); } catch { return DEFAULT_CATALOG; }
}

// ── Users ────────────────────────────────────────────────────────────
async function getUser(env, username){
  const raw = await env.STORE.get(`user:${username}`);
  return raw ? JSON.parse(raw) : null;
}
async function putUser(env, u){
  await env.STORE.put(`user:${u.username}`, JSON.stringify(u));
}
async function listUsers(env){
  const out = [];
  let cursor;
  do {
    const r = await env.STORE.list({ prefix: 'user:', cursor });
    for(const k of r.keys){
      const raw = await env.STORE.get(k.name);
      if(!raw) continue;
      const u = JSON.parse(raw);
      // never leak salt/hash
      out.push({
        username: u.username, name: u.name, role: u.role,
        created: u.created, createdBy: u.createdBy,
        lastLogin: u.lastLogin || null, active: u.active !== false,
        trusted: !!u.trusted
      });
    }
    cursor = r.cursor;
    if(r.list_complete) break;
  } while(cursor);
  out.sort((a,b) => a.username.localeCompare(b.username));
  return out;
}
async function anyUserExists(env){
  const r = await env.STORE.list({ prefix: 'user:', limit: 1 });
  return r.keys.length > 0;
}
async function createUser(env, { username, name, password, role, createdBy }){
  username = sanitizeUsername(username);
  if(!username) throw new Error('Invalid username');
  if(!password || password.length < 4) throw new Error('Password must be 4+ chars');
  if(!['owner','admin'].includes(role)) throw new Error('Invalid role');
  if(await getUser(env, username)) throw new Error('Username already exists');
  const salt = newSalt();
  const hash = await hashPw(password, salt);
  const u = {
    username, name: String(name || username).slice(0, 60), role,
    salt, hash,
    created: new Date().toISOString(),
    createdBy: createdBy || 'system',
    lastLogin: null, active: true
  };
  await putUser(env, u);
  return u;
}

// ── Sessions ─────────────────────────────────────────────────────────
async function getSession(env, req){
  let token = null;
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if(m) token = m[1];
  if(!token){
    const cookie = req.headers.get('Cookie') || '';
    const cm = cookie.match(/(?:^|;\s*)minarealm_session=([^;]+)/);
    if(cm) token = cm[1];
  }
  if(!token) return null;
  const raw = await env.STORE.get(`session:${token}`);
  if(!raw) return null;
  try {
    const s = JSON.parse(raw);
    s._token = token;
    return s;
  } catch { return null; }
}

// ── Audit log ────────────────────────────────────────────────────────
async function audit(env, sess, action, target, summary){
  const ts = new Date().toISOString();
  const id = ts + '-' + newId().slice(0,6);
  const entry = {
    ts, id,
    user: sess ? sess.username : '(anon)',
    role: sess ? sess.role : null,
    action, target: target || '', summary: summary || ''
  };
  await env.STORE.put(`audit:${id}`, JSON.stringify(entry), {
    expirationTtl: AUDIT_RETENTION_DAYS * 86400
  });
}
async function listAudit(env, limit = 200){
  const out = [];
  let cursor;
  do {
    const r = await env.STORE.list({ prefix: 'audit:', cursor, limit: 1000 });
    for(const k of r.keys){
      const raw = await env.STORE.get(k.name);
      if(raw){ try { out.push(JSON.parse(raw)); } catch {} }
    }
    cursor = r.cursor;
    if(r.list_complete) break;
  } while(cursor && out.length < limit * 2);
  out.sort((a,b) => (b.ts || '').localeCompare(a.ts || ''));
  return out.slice(0, limit);
}

// ── Main router ──────────────────────────────────────────────────────
export default {
  async fetch(req, env){
    const url = new URL(req.url);
    const path = url.pathname;

    if(req.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    }

    try {
      // ── Public: products ─────────────────────────────────────────
      if(path === '/api/products' && req.method === 'GET'){
        const cat = await getCatalog(env);
        const sess = await getSession(env, req);
        if(sess) return json(cat, {}, env, req);
        return json(sanitizeCatalogForPublic(cat), {}, env, req);
      }

      // ── Public: order confirmation (by orderId, semi-public) ────
      const confM = path.match(/^\/api\/orders\/([^/]+)\/confirmation$/);
      if(confM && req.method === 'GET'){
        const id = confM[1];
        const raw = await env.STORE.get(`order:${id}`);
        if(!raw) return err(404, 'Order not found', env, req);
        const order = JSON.parse(raw);
        return json({
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillment: order.fulfillment,
          customer: { name: order.customer.name, email: order.customer.email },
          shippingAddress: order.shippingAddress || null,
          lines: order.lines || [],
          financial: order.financial,
          created: order.created
        }, {}, env, req);
      }

      // ── Public: Square Payment Link checkout ─────────────────────
      if(path === '/api/checkout/create-payment-link' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env, `rl:checkout:${ip}`,
          RATE_LIMITS.checkoutIp.limit,
          RATE_LIMITS.checkoutIp.windowSec
        );
        if(!ok) return err(429, 'Too many checkout attempts. Try again later.', env, req);

        if(!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID){
          return err(503, 'Online payment is not yet configured. Please call to order.', env, req);
        }

        const body = await req.json().catch(() => null);
        if(!body || !Array.isArray(body.lines) || body.lines.length === 0){
          return err(400, 'Empty cart', env, req);
        }

        const cat = await getCatalog(env);
        const freeThreshold = Number(env.FREE_SHIPPING_THRESHOLD || '100');

        // Server-side re-price and stock check
        const stockDelta = new Map();
        let subtotal = 0;
        let totalWeightGrams = 0;
        const lines = body.lines.map(l => {
          const p = cat.products.find(x => x.id === l.id);
          if(!p) return null;
          const qty = Math.max(1, Math.min(99, parseInt(l.qty, 10) || 1));
          const stock = Number(p.stock);
          if(!Number.isFinite(stock) || stock < qty) return null;
          subtotal += p.price * qty;
          totalWeightGrams += productWeightGrams(p) * qty;
          stockDelta.set(p.id, (stockDelta.get(p.id) || 0) + qty);
          return { id: p.id, name: p.name, price: p.price, qty, subtotal: p.price * qty };
        }).filter(Boolean);

        if(lines.length === 0 || lines.length !== body.lines.length){
          return err(409, 'One or more items are out of stock.', env, req);
        }

        // Double-check stock
        for(const [id, qty] of stockDelta.entries()){
          const p = cat.products.find(x => x.id === id);
          const stock = Number(p?.stock);
          if(!p || !Number.isFinite(stock) || stock < qty){
            return err(409, 'One or more items are no longer available.', env, req);
          }
        }

        const shippingCost = calcShipping(totalWeightGrams, subtotal, freeThreshold);
        const taxAmount = Math.round(subtotal * MI_TAX_RATE * 100) / 100;
        const total = subtotal + shippingCost + taxAmount;

        const name = String(body.name || '').slice(0, 120);
        const email = normalizeEmail(body.email);
        const phone = clampText(body.phone, 40);
        const fulfillment = clampText(body.fulfillment || 'Ship \u2014 USPS', 60);
        const notes = clampText(body.notes, 800);
        const sa = body.shippingAddress || {};
        const shippingAddress = {
          name:  clampText(sa.name || name, 120),
          line1: clampText(sa.line1, 120),
          line2: clampText(sa.line2, 120),
          city:  clampText(sa.city, 80),
          state: clampText(sa.state, 40),
          zip:   clampText(sa.zip, 20),
          country: 'US'
        };

        if(!name || !email || !email.includes('@')){
          return err(400, 'Name and email are required', env, req);
        }
        if(!shippingAddress.line1 || !shippingAddress.city || !shippingAddress.zip){
          return err(400, 'Full shipping address is required', env, req);
        }

        const orderId = `${Date.now()}-${newId()}`;

        // Create Square payment link
        let squareLink;
        try {
          squareLink = await createSquarePaymentLink(env, {
            orderId, lines, shippingCost, taxAmount, customerEmail: email
          });
        } catch(e){
          return err(502, 'Could not create payment link. Please try again or call to order.', env, req);
        }

        const order = {
          id: orderId,
          created: new Date().toISOString(),
          status: 'new',
          customer: { name, email, phone },
          source: 'shop-web-square',
          fulfillment,
          paymentStatus: 'pending',
          squarePaymentLinkId: squareLink.id,
          squareOrderId: squareLink.order_id || null,
          squarePaymentId: null,
          shippingAddress,
          financial: { subtotal, discount: 0, shipping: shippingCost, tax: taxAmount, total },
          timeline: { createdAt: new Date().toISOString() },
          notes,
          lines,
          total,
          adminNotes: '',
          adminTags: []
        };

        // Store order + 24h stock reservation + Square order index
        await env.STORE.put(`order:${orderId}`, JSON.stringify(order));
        await env.STORE.put(
          `reservation:${orderId}`,
          JSON.stringify({ orderId, stockDelta: Object.fromEntries(stockDelta) }),
          { expirationTtl: 86400 }
        );
        if(order.squareOrderId){
          await env.STORE.put(`sqorder:${order.squareOrderId}`, orderId, { expirationTtl: 86400 * 30 });
        }
        await audit(env, null, 'order.create', orderId,
          `${name} — $${total.toFixed(2)} — Square link — ${lines.length} item(s)`);

        return json({ ok: true, orderId, url: squareLink.url }, {}, env, req);
      }

      // ── Public: Square webhook ────────────────────────────────────
      if(path === '/api/webhooks/square' && req.method === 'POST'){
        const bodyText = await req.text();
        const valid = await verifySquareWebhook(env, req, bodyText);
        if(!valid) return new Response('Unauthorized', { status: 401 });

        let event;
        try { event = JSON.parse(bodyText); } catch { return new Response('Bad request', { status: 400 }); }

        if(event.type === 'payment.updated' && event.data?.object?.payment?.status === 'COMPLETED'){
          const squareOrderId = event.data?.object?.payment?.order_id;
          if(squareOrderId){
            // Fast path: lookup by index
            let orderId = await env.STORE.get(`sqorder:${squareOrderId}`);
            // Slow path: scan (fallback for orders created before index was added)
            if(!orderId){
              const list = await env.STORE.list({ prefix: 'order:' });
              for(const k of list.keys){
                const raw = await env.STORE.get(k.name);
                if(!raw) continue;
                try {
                  const o = JSON.parse(raw);
                  if(o.squareOrderId === squareOrderId){ orderId = o.id; break; }
                } catch {}
              }
            }
            if(orderId){
              const raw = await env.STORE.get(`order:${orderId}`);
              if(raw){
                const order = JSON.parse(raw);
                if(order.paymentStatus !== 'paid'){
                  order.paymentStatus = 'paid';
                  order.squarePaymentId = event.data?.object?.payment?.id || null;
                  order.timeline = order.timeline || {};
                  order.timeline.paidAt = new Date().toISOString();
                  order.updated = new Date().toISOString();
                  await env.STORE.put(`order:${orderId}`, JSON.stringify(order));

                  // Decrement stock
                  const cat = await getCatalog(env);
                  for(const line of (order.lines || [])){
                    const p = cat.products.find(x => x.id === line.id);
                    if(p) p.stock = Math.max(0, Number(p.stock || 0) - line.qty);
                  }
                  cat.updated = new Date().toISOString().slice(0,10);
                  await env.STORE.put('catalog', JSON.stringify(cat));

                  // Release reservation
                  await env.STORE.delete(`reservation:${orderId}`);

                  // Low-stock alert
                  const lowItems = (order.lines || []).map(line => {
                    const p = cat.products.find(x => x.id === line.id);
                    return p && p.stock <= 2 ? `${p.name} (${p.stock} left)` : null;
                  }).filter(Boolean);
                  if(lowItems.length) await sendLowStockAlert(env, lowItems);

                  // Notify Cynthia + customer
                  await sendOrderNotification(env, order);
                  await sendCustomerConfirmation(env, order);
                  await audit(env, null, 'order.paid', orderId,
                    `Square payment ${order.squarePaymentId}`);
                }
              }
            }
          }
        }

        return new Response('OK', { status: 200 });
      }

      // ── Public: order create (server re-prices) ──────────────────
      if(path === '/api/orders' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env,
          `rl:orders:${ip}`,
          RATE_LIMITS.ordersIp.limit,
          RATE_LIMITS.ordersIp.windowSec
        );
        if(!ok) return err(429, 'Too many order attempts. Try again later.', env, req);

        const body = await req.json().catch(() => null);
        if(!body || !Array.isArray(body.lines) || body.lines.length === 0){
          return err(400, 'Empty order', env, req);
        }
        const cat = await getCatalog(env);
        const stockDelta = new Map();
        let subtotal = 0;
        const lines = body.lines.map(l => {
          const p = cat.products.find(x => x.id === l.id);
          if(!p) return null;
          const qty = Math.max(1, Math.min(99, parseInt(l.qty,10) || 1));
          const stock = Number(p.stock);
          if(!Number.isFinite(stock) || stock < qty) return null;
          subtotal += p.price * qty;
          stockDelta.set(p.id, (stockDelta.get(p.id) || 0) + qty);
          return { id: p.id, name: p.name, price: p.price, qty, subtotal: p.price * qty };
        }).filter(Boolean);
        if(lines.length === 0 || lines.length !== body.lines.length){
          return err(409, 'One or more items are out of stock.', env, req);
        }

        for(const [id, qty] of stockDelta.entries()){
          const p = cat.products.find(x => x.id === id);
          const stock = Number(p?.stock);
          if(!p || !Number.isFinite(stock) || stock < qty){
            return err(409, 'One or more items are no longer available.', env, req);
          }
        }
        const discount = Math.max(0, Number(body.discount || 0));
        const shipping = Math.max(0, Number(body.shipping || 0));
        // Server-side MI tax — never trust client value
        const taxAmount = Math.round(subtotal * MI_TAX_RATE * 100) / 100;
        const total = Math.max(0, subtotal - discount + shipping + taxAmount);
        const source = String(body.source || 'shop-web').slice(0, 40);
        const id = `${Date.now()}-${newId()}`;
        const order = {
          id, created: new Date().toISOString(), status: 'new',
          customer: {
            name:  String(body.name  || '').slice(0, 120),
            email: String(body.email || '').slice(0, 120),
            phone: String(body.phone || '').slice(0, 40)
          },
          source,
          fulfillment: String(body.fulfillment || 'Pickup').slice(0, 60),
          paymentStatus: 'pending_invoice',
          financial: { subtotal, discount, shipping, tax: taxAmount, total },
          timeline: { createdAt: new Date().toISOString() },
          notes: String(body.notes || '').slice(0, 800),
          lines, total, adminNotes: '', adminTags: []
        };
        await env.STORE.put(`order:${id}`, JSON.stringify(order));
        cat.products = cat.products.map((p) => {
          const qty = stockDelta.get(p.id) || 0;
          if(!qty) return p;
          return { ...p, stock: Math.max(0, Number(p.stock || 0) - qty) };
        });
        cat.updated = new Date().toISOString().slice(0,10);
        await env.STORE.put('catalog', JSON.stringify(cat));
        await sendCustomerConfirmation(env, order);
        await sendOrderNotification(env, order);
        await audit(env, null, 'order.create', id,
          `${order.customer.name || 'unknown'} — $${total.toFixed(2)} — ${lines.length} item(s) — ${source}`);
        return json({ ok: true, id, total }, {}, env, req);
      }

      if(path === '/api/forms/newsletter' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env,
          `rl:forms:${ip}`,
          RATE_LIMITS.formsIp.limit,
          RATE_LIMITS.formsIp.windowSec
        );
        if(!ok) return err(429, 'Too many form submissions. Try again later.', env, req);

        const body = await req.json().catch(() => ({}));
        const email = normalizeEmail(body.email);
        if(!email || !email.includes('@')) return err(400, 'Valid email required', env, req);
        const record = await storeFormEntry(env, 'newsletter', {
          email,
          source: clampText(body.source || 'site-signup', 60),
          consent: true
        }, email);
        await audit(env, null, 'form.newsletter', email, record.source);
        return json({ ok: true, id: record.id }, {}, env, req);
      }

      if(path === '/api/forms/contact' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env,
          `rl:forms:${ip}`,
          RATE_LIMITS.formsIp.limit,
          RATE_LIMITS.formsIp.windowSec
        );
        if(!ok) return err(429, 'Too many form submissions. Try again later.', env, req);

        const body = await req.json().catch(() => ({}));
        const name = clampText(body.name, 120);
        const email = normalizeEmail(body.email);
        const message = clampText(body.message, 4000);
        if(!name || !email || !email.includes('@') || !message){
          return err(400, 'Name, email, and message are required', env, req);
        }
        const record = await storeFormEntry(env, 'contact', {
          name,
          email,
          message,
          source: clampText(body.source || 'contact-form', 60)
        }, email);
        await audit(env, null, 'form.contact', email, name);
        return json({ ok: true, id: record.id }, {}, env, req);
      }

      if(path === '/api/forms/booking' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env,
          `rl:forms:${ip}`,
          RATE_LIMITS.formsIp.limit,
          RATE_LIMITS.formsIp.windowSec
        );
        if(!ok) return err(429, 'Too many form submissions. Try again later.', env, req);

        const body = await req.json().catch(() => ({}));
        const name = clampText(body.name, 120);
        const email = normalizeEmail(body.email);
        const phone = clampText(body.phone, 40);
        const service = clampText(body.service, 120);
        if(!name || !email || !email.includes('@') || !service){
          return err(400, 'Name, email, and service are required', env, req);
        }
        const record = await storeFormEntry(env, 'booking', {
          name,
          email,
          phone,
          service,
          preferred_date: clampText(body.preferred_date, 40),
          preferred_time: clampText(body.preferred_time, 40),
          notes: clampText(body.notes, 4000),
          source: clampText(body.source || 'booking-form', 60)
        }, email);
        await audit(env, null, 'form.booking', email, `${name} — ${service}`);
        return json({ ok: true, id: record.id }, {}, env, req);
      }

      if(path === '/api/forms/subscription' && req.method === 'POST'){
        const ip = getClientIp(req);
        const ok = await checkRateLimit(
          env,
          `rl:forms:${ip}`,
          RATE_LIMITS.formsIp.limit,
          RATE_LIMITS.formsIp.windowSec
        );
        if(!ok) return err(429, 'Too many form submissions. Try again later.', env, req);

        const body = await req.json().catch(() => ({}));
        const name = clampText(body.name, 120);
        const email = normalizeEmail(body.email);
        const tier = clampText(body.tier, 120);
        if(!name || !email || !email.includes('@') || !tier){
          return err(400, 'Name, email, and tier are required', env, req);
        }
        const loves = Array.isArray(body.loves)
          ? body.loves.map(x => clampText(x, 40)).filter(Boolean).slice(0, 20)
          : [];
        const record = await storeFormEntry(env, 'subscription', {
          name,
          email,
          phone: clampText(body.phone, 40),
          tier,
          loves,
          avoid: clampText(body.avoid, 1000),
          intent: clampText(body.intent, 1000),
          fulfillment: clampText(body.fulfillment, 40),
          extras_opt_in: clampText(body.extras_opt_in, 40),
          spirit_message: clampText(body.spirit_message, 10),
          source: clampText(body.source || 'subscription-page', 60)
        }, email);
        await audit(env, null, 'form.subscription', email, `${name} — ${tier}`);
        return json({ ok: true, id: record.id }, {}, env, req);
      }

      // ── Public: login ────────────────────────────────────────────
      if(path === '/api/login' && req.method === 'POST'){
        const body = await req.json().catch(() => ({}));
        const username = sanitizeUsername(body.username);
        const pw = String(body.password || '');
        if(!username || !pw) return err(400, 'Username and password required', env, req);

        const ip = getClientIp(req);
        const ipKey = `rl:login:ip:${ip}`;
        const comboKey = `rl:login:user:${username}:${ip}`;

        // Bootstrap: if no users exist and caller used ADMIN_PASSWORD,
        // create the cynthia owner account on the fly.
        const usersExist = await anyUserExists(env);
        if(!usersExist){
          if(!env.ADMIN_PASSWORD) return err(500, 'Bootstrap requires ADMIN_PASSWORD secret', env, req);
          if(isWeakBootstrapPassword(env.ADMIN_PASSWORD)){
            return err(500, 'ADMIN_PASSWORD is too weak. Set a stronger secret before bootstrap.', env, req);
          }
          if(pw !== env.ADMIN_PASSWORD){
            await new Promise(r => setTimeout(r, 400));
            const ok = await bumpLoginRateLimit(env, ipKey, comboKey);
            if(!ok) return err(429, 'Too many login attempts. Try again later.', env, req);
            return err(401, 'Bootstrap password incorrect', env, req);
          }
          // Use whichever username they typed (or default "cynthia") as the owner
          const ownerName = username === 'owner' ? 'cynthia' : username;
          await createUser(env, {
            username: ownerName, name: 'Cynthia', password: pw,
            role: 'owner', createdBy: 'bootstrap'
          });
          const owner = await getUser(env, ownerName);
          if(owner){
            owner.mustChangePassword = true;
            await putUser(env, owner);
          }
          await audit(env, { username: ownerName, role: 'owner' },
            'user.create', ownerName, 'Initial owner account created via bootstrap');
        }

        const u = await getUser(env, username);
        if(!u || u.active === false){
          await new Promise(r => setTimeout(r, 400));
          const ok = await bumpLoginRateLimit(env, ipKey, comboKey);
          if(!ok) return err(429, 'Too many login attempts. Try again later.', env, req);
          return err(401, 'Invalid login', env, req);
        }
        const candidate = await hashPw(pw, u.salt);
        if(!constantTimeEq(candidate, u.hash)){
          await new Promise(r => setTimeout(r, 400));
          await audit(env, null, 'login.fail', username, 'Wrong password');
          const ok = await bumpLoginRateLimit(env, ipKey, comboKey);
          if(!ok) return err(429, 'Too many login attempts. Try again later.', env, req);
          return err(401, 'Invalid login', env, req);
        }
        const token = newToken();
        await env.STORE.put(`session:${token}`,
          JSON.stringify({ username: u.username, role: u.role }),
          { expirationTtl: SESSION_TTL_SECONDS });
        await env.STORE.delete(ipKey);
        await env.STORE.delete(comboKey);
        u.lastLogin = new Date().toISOString();
        await putUser(env, u);
        await audit(env, { username: u.username, role: u.role }, 'login.ok', u.username, '');
        return json({
          token, ttl: SESSION_TTL_SECONDS,
          user: { username: u.username, name: u.name, role: u.role, mustChangePassword: !!u.mustChangePassword, trusted: !!u.trusted }
        }, { headers: { 'Set-Cookie': sessionCookie(token, req) } }, env, req);
      }

      // ────────── Authenticated routes below ───────────────────────
      const sess = await getSession(env, req);
      if(!sess) return err(401, 'Unauthorized', env, req);

      if(path === '/api/whoami' && req.method === 'GET'){
        const u = await getUser(env, sess.username);
        if(!u) return err(401, 'Session user missing', env, req);
        return json({ username: u.username, name: u.name, role: u.role, mustChangePassword: !!u.mustChangePassword, trusted: !!u.trusted }, {}, env, req);
      }

      if(path === '/api/logout' && req.method === 'POST'){
        if(sess._token) await env.STORE.delete(`session:${sess._token}`);
        await audit(env, sess, 'logout', sess.username, '');
        return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(req) } }, env, req);
      }

      if(path === '/api/password' && req.method === 'POST'){
        // Self-service password change: any logged-in user can change their own.
        const body = await req.json().catch(() => ({}));
        const cur = String(body.current || '');
        const next = String(body.next || '');
        if(next.length < 4) return err(400, 'New password must be 4+ chars', env, req);
        const u = await getUser(env, sess.username);
        if(!u) return err(404, 'User missing', env, req);
        const cand = await hashPw(cur, u.salt);
        if(!constantTimeEq(cand, u.hash)) return err(401, 'Current password wrong', env, req);
        u.salt = newSalt();
        u.hash = await hashPw(next, u.salt);
        u.mustChangePassword = false;
        await putUser(env, u);
        await audit(env, sess, 'password.change', u.username, 'Self-service change');
        return json({ ok: true }, {}, env, req);
      }

      const sessUser = await getUser(env, sess.username);
      if(sessUser && sessUser.mustChangePassword){
        return err(428, 'Password update required before continuing.', env, req);
      }

      // ── Catalog ──────────────────────────────────────────────────
      if(path === '/api/products' && req.method === 'PUT'){
        const body = await req.json();
        if(!body || !Array.isArray(body.products)) return err(400, 'Bad catalog', env, req);
        const now = new Date().toISOString();
        body.updated = now.slice(0,10);
        body.categories = body.categories || DEFAULT_CATALOG.categories;

        // Owners always publish live. Trusted admins also publish live.
        // Untrusted staff changes go to a pending queue for owner approval.
        const canAutoPublish = sess.role === 'owner' || (sess.role === 'admin' && sessUser?.trusted === true);
        if(!canAutoPublish){
          const pending = {
            submittedAt: now,
            submittedBy: sess.username,
            summary: String(body._changeNote || '').slice(0, 180),
            catalog: body
          };
          await env.STORE.put('catalog:pending', JSON.stringify(pending));
          await audit(env, sess, 'catalog.submit', '',
            `${body.products.length} products pending owner approval`);
          await sendPendingCatalogAlert(env, sess.username, body.products.length);
          return json({ ok: true, pending: true, submittedAt: pending.submittedAt }, {}, env, req);
        }

        const before = await getCatalog(env);
        await env.STORE.put('catalog:previous', JSON.stringify(before));
        await env.STORE.put('catalog', JSON.stringify(body));
        const beforeCount = (before.products || []).length;
        const afterCount = body.products.length;
        await audit(env, sess, 'catalog.save', '',
          `${afterCount} products (was ${beforeCount})`);
        return json({ ok: true, updated: body.updated }, {}, env, req);
      }

      if(path === '/api/catalog/pending' && req.method === 'GET'){
        const pendingRaw = await env.STORE.get('catalog:pending');
        if(!pendingRaw) return json({ pending: null }, {}, env, req);
        const pending = JSON.parse(pendingRaw);
        return json({ pending }, {}, env, req);
      }

      if(path === '/api/catalog/approve' && req.method === 'POST'){
        if(sess.role !== 'owner') return err(403, 'Owner only', env, req);
        const pendingRaw = await env.STORE.get('catalog:pending');
        if(!pendingRaw) return err(404, 'No pending catalog', env, req);
        const pending = JSON.parse(pendingRaw);
        const before = await getCatalog(env);
        const next = pending.catalog || DEFAULT_CATALOG;
        next.updated = new Date().toISOString().slice(0,10);
        next.categories = next.categories || DEFAULT_CATALOG.categories;
        await env.STORE.put('catalog:previous', JSON.stringify(before));
        await env.STORE.put('catalog', JSON.stringify(next));
        await env.STORE.delete('catalog:pending');
        await audit(env, sess, 'catalog.approve', pending.submittedBy || '',
          `${(next.products || []).length} products published (was ${(before.products || []).length})`);
        return json({ ok: true, updated: next.updated }, {}, env, req);
      }

      if(path === '/api/catalog/reject' && req.method === 'POST'){
        if(sess.role !== 'owner') return err(403, 'Owner only', env, req);
        const pendingRaw = await env.STORE.get('catalog:pending');
        if(!pendingRaw) return err(404, 'No pending catalog', env, req);
        const pending = JSON.parse(pendingRaw);
        const body = await req.json().catch(() => ({}));
        const reason = String(body.reason || '').trim();
        if(!reason) return err(400, 'Rejection reason is required', env, req);
        await env.STORE.delete('catalog:pending');
        await audit(env, sess, 'catalog.reject', pending.submittedBy || '', reason.slice(0, 180));
        return json({ ok: true }, {}, env, req);
      }

      if(path === '/api/catalog/previous' && req.method === 'GET'){
        if(sess.role !== 'owner') return err(403, 'Owner only', env, req);
        const prevRaw = await env.STORE.get('catalog:previous');
        if(!prevRaw) return json({ previous: null }, {}, env, req);
        const prev = JSON.parse(prevRaw);
        return json({ previous: { updated: prev.updated, count: (prev.products || []).length } }, {}, env, req);
      }

      if(path === '/api/catalog/rollback' && req.method === 'POST'){
        if(sess.role !== 'owner') return err(403, 'Owner only', env, req);
        const prevRaw = await env.STORE.get('catalog:previous');
        if(!prevRaw) return err(404, 'No previous catalog snapshot available', env, req);
        const prev = JSON.parse(prevRaw);
        const current = await getCatalog(env);
        await env.STORE.put('catalog:previous', JSON.stringify(current));
        await env.STORE.put('catalog', JSON.stringify(prev));
        await audit(env, sess, 'catalog.rollback', '',
          `Restored ${(prev.products || []).length} products from ${prev.updated || 'prior version'}`);
        return json({ ok: true, updated: prev.updated, count: (prev.products || []).length }, {}, env, req);
      }

      // ── Image upload ─────────────────────────────────────────────
      if(path === '/api/upload' && req.method === 'POST'){
        const ct = req.headers.get('Content-Type') || '';
        if(!ct.startsWith('multipart/form-data')) return err(400, 'Use multipart/form-data', env, req);
        const form = await req.formData();
        const file = form.get('file');
        const slug = slugify(form.get('slug') || 'img');
        if(!file || typeof file === 'string') return err(400, 'No file', env, req);
        if(file.size > 8 * 1024 * 1024) return err(413, 'Max 8 MB per image', env, req);
        const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
        if(!allowed.includes(file.type)) return err(415, 'Use JPG/PNG/WebP/GIF', env, req);
        const ext = ({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' })[file.type];
        const key = `products/${slug}-${Date.now()}-${newId().slice(0,6)}.${ext}`;
        await env.IMAGES.put(key, file.stream(), {
          httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
        });
        const base = (env.PUBLIC_IMAGE_BASE || '').replace(/\/+$/, '');
        await audit(env, sess, 'image.upload', key, `${(file.size/1024).toFixed(0)} KB`);
        return json({ ok: true, key, url: `${base}/${key}` }, {}, env, req);
      }

      // ── Orders ───────────────────────────────────────────────────
      if(path === '/api/orders' && req.method === 'GET'){
        const status = url.searchParams.get('status') || 'all';
        const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10));
        const list = await env.STORE.list({ prefix: 'order:' });
        const orders = [];
        for(const k of list.keys){
          const raw = await env.STORE.get(k.name);
          if(!raw) continue;
          try {
            const o = JSON.parse(raw);
            if(status === 'all' || o.status === status) orders.push(o);
          } catch {}
        }
        orders.sort((a,b) => (b.created || '').localeCompare(a.created || ''));
        return json({ orders: orders.slice(0, limit), total: orders.length }, {}, env, req);
      }

      // ── Orders CSV export (bookkeeping / taxes) ──────────────────
      if(path === '/api/orders/export.csv' && req.method === 'GET'){
        const since = url.searchParams.get('since') || '';   // YYYY-MM-DD
        const until = url.searchParams.get('until') || '';   // YYYY-MM-DD
        const status = url.searchParams.get('status') || 'all';
        const list = await env.STORE.list({ prefix: 'order:' });
        const rows = [];
        for(const k of list.keys){
          const raw = await env.STORE.get(k.name);
          if(!raw) continue;
          try {
            const o = JSON.parse(raw);
            const d = (o.created || '').slice(0, 10);
            if(since && d < since) continue;
            if(until && d > until) continue;
            if(status !== 'all' && o.status !== status) continue;
            rows.push(o);
          } catch {}
        }
        rows.sort((a,b) => (a.created || '').localeCompare(b.created || ''));
        const csvEsc = v => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        };
        const header = [
          'order_id','created','status','payment_status','source','fulfillment',
          'customer_name','customer_email','customer_phone',
          'ship_name','ship_line1','ship_line2','ship_city','ship_state','ship_zip',
          'item_count','items','subtotal','discount','shipping','tax','total',
          'tracking','admin_notes','customer_notes'
        ];
        const lines = [header.join(',')];
        for(const o of rows){
          const fin = o.financial || {};
          const addr = o.shippingAddress || {};
          const items = (o.lines || []).map(l => `${l.qty}x ${l.name} @${Number(l.price).toFixed(2)}`).join(' | ');
          const itemCount = (o.lines || []).reduce((s, l) => s + (Number(l.qty)||0), 0);
          lines.push([
            o.id, o.created, o.status, o.paymentStatus, o.source, o.fulfillment,
            o.customer?.name, o.customer?.email, o.customer?.phone,
            addr.name, addr.line1, addr.line2, addr.city, addr.state, addr.zip,
            itemCount, items,
            Number(fin.subtotal||0).toFixed(2), Number(fin.discount||0).toFixed(2),
            Number(fin.shipping||0).toFixed(2), Number(fin.tax||0).toFixed(2),
            Number(fin.total||o.total||0).toFixed(2),
            o.trackingNumber, o.adminNotes, o.notes
          ].map(csvEsc).join(','));
        }
        const csv = lines.join('\n');
        const fname = `minarealm-orders-${since || 'all'}-to-${until || 'now'}.csv`;
        await audit(env, sess, 'orders.export', '', `${rows.length} orders, ${since||'-'}..${until||'-'}, status=${status}`);
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fname}"`,
            'Cache-Control': 'no-store',
            ...corsHeaders(env, req)
          }
        });
      }
      // ── In-store sale (one-tap POS for brick-and-mortar) ─────────
      if(path === '/api/orders/in-store' && req.method === 'POST'){
        if(!sess) return err(401, 'Unauthorized', env, req);
        const body = await req.json().catch(() => null);
        if(!body) return err(400, 'body required', env, req);

        // Normalize to multi-line shape. Legacy single-line: {productId, qty, price}
        let rawLines = Array.isArray(body.lines) && body.lines.length
          ? body.lines
          : (body.productId ? [{ productId: body.productId, qty: body.qty, price: body.price }] : []);
        if(rawLines.length === 0) return err(400, 'lines or productId required', env, req);
        if(rawLines.length > 50) return err(400, 'too many lines (max 50)', env, req);

        const cat = await getCatalog(env);
        const lines = [];
        const stockDelta = new Map();
        for(const rl of rawLines){
          if(!rl || !rl.productId) return err(400, 'each line needs productId', env, req);
          const p = cat.products.find(x => x.id === rl.productId);
          if(!p) return err(404, `Product not found: ${rl.productId}`, env, req);
          const qty = Math.max(1, Math.min(99, parseInt(rl.qty, 10) || 1));
          const stock = Number(p.stock);
          const already = stockDelta.get(p.id) || 0;
          if(!Number.isFinite(stock) || stock < (qty + already)){
            return err(409, `Out of stock: ${p.name}`, env, req);
          }
          const price = rl.price != null
            ? Math.max(0, Number(rl.price))
            : Number(p.price || p.retail_price || 0);
          const subtotal = Math.round(price * qty * 100) / 100;
          lines.push({ id: p.id, name: p.name, price, qty, subtotal, _ref: p });
          stockDelta.set(p.id, already + qty);
        }

        const subtotal = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
        // In-store sales: tax is collected at point-of-sale via Square Reader receipts.
        // We record the gross sale here for unified reporting; Square holds the tax record.
        // taxEstimate is informational only — what Square *should* have collected at MI 6%.
        const taxEstimate = Math.round(subtotal * 0.06 * 100) / 100;
        const total = subtotal;
        const orderId = `${Date.now()}-${newId()}`;
        const nowIso = new Date().toISOString();
        const isInvoice = String(body.paymentMethod || '') === 'invoice';
        const order = {
          id: orderId,
          created: nowIso,
          status: isInvoice ? 'new' : 'fulfilled',
          customer: {
            name:  String(body.customerName || 'In-store customer').slice(0, 120),
            email: String(body.customerEmail || '').slice(0, 200),
            phone: ''
          },
          source: 'in-store',
          fulfillment: 'In-store',
          paymentStatus: isInvoice ? 'pending_invoice' : 'paid_in_store',
          financial: { subtotal, discount: 0, shipping: 0, tax: 0, taxEstimate, total },
          timeline: isInvoice
            ? { createdAt: nowIso }
            : { createdAt: nowIso, fulfilledAt: nowIso },
          notes: '',
          lines: lines.map(({ id, name, price, qty, subtotal }) => ({ id, name, price, qty, subtotal })),
          total,
          adminNotes: String(body.note || '').slice(0, 400),
          adminTags: isInvoice ? ['in-store', 'invoice'] : ['in-store']
        };
        await env.STORE.put(`order:${orderId}`, JSON.stringify(order));

        cat.products = cat.products.map(x => {
          const dec = stockDelta.get(x.id);
          if(!dec) return x;
          return { ...x, stock: Math.max(0, Number(x.stock || 0) - dec) };
        });
        cat.updated = new Date().toISOString().slice(0,10);
        await env.STORE.put('catalog', JSON.stringify(cat));

        const summary = lines.map(l => `${l.name} ×${l.qty}`).join(', ');
        await audit(env, sess, isInvoice ? 'order.in-store.invoice' : 'order.in-store',
          orderId,
          `${summary} = $${total.toFixed(2)}${isInvoice ? ' (pending invoice)' : ''} (${sess.username})`);
        return json({ ok: true, order }, {}, env, req);
      }

      if(path === '/api/forms' && req.method === 'GET'){
        const kind = clampText(url.searchParams.get('type') || 'all', 20);
        const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
        return json({ entries: await listFormEntries(env, kind, limit) }, {}, env, req);
      }
      const om = path.match(/^\/api\/orders\/([^/]+)$/);
      if(om){
        const id = om[1];
        const key = `order:${id}`;
        if(req.method === 'PATCH'){
          const raw = await env.STORE.get(key);
          if(!raw) return err(404, 'Not found', env, req);
          const o = JSON.parse(raw);
          const body = await req.json();
          const oldStatus = o.status;
          if(typeof body.status === 'string'){
            o.status = body.status;
            o.timeline = o.timeline || { createdAt: o.created || new Date().toISOString() };
            if(o.status === 'fulfilled') o.timeline.fulfilledAt = new Date().toISOString();
            if(o.status === 'cancelled') o.timeline.cancelledAt = new Date().toISOString();
            if(o.status === 'new') o.timeline.reopenedAt = new Date().toISOString();
          }
          if(typeof body.paymentStatus === 'string'){
            o.paymentStatus = body.paymentStatus.slice(0, 40);
          }
          if(typeof body.adminNotes === 'string') o.adminNotes = body.adminNotes.slice(0, 800);
          if(typeof body.trackingNumber === 'string'){
            o.trackingNumber = body.trackingNumber.slice(0, 80);
            if(o.trackingNumber) o.timeline = { ...(o.timeline||{}), trackingAddedAt: new Date().toISOString() };
          }
          if(Array.isArray(body.adminTags)){
            o.adminTags = body.adminTags.map(x => String(x).slice(0, 24)).slice(0, 8);
          }
          o.updated = new Date().toISOString();
          o.updatedBy = sess.username;
          await env.STORE.put(key, JSON.stringify(o));
          const summary = (oldStatus !== o.status) ? `${oldStatus} → ${o.status}` : 'notes updated';
          await audit(env, sess, 'order.update', id, summary);
          return json({ ok: true, order: o }, {}, env, req);
        }
        if(req.method === 'DELETE'){
          await env.STORE.delete(key);
          await audit(env, sess, 'order.delete', id, '');
          return json({ ok: true }, {}, env, req);
        }
      }

      // ── Send tracking email ──────────────────────────────────────
      const trackM = path.match(/^\/api\/orders\/([^/]+)\/send-tracking$/);
      if(trackM && req.method === 'POST'){
        const id = trackM[1];
        const raw = await env.STORE.get(`order:${id}`);
        if(!raw) return err(404, 'Order not found', env, req);
        const order = JSON.parse(raw);
        const body = await req.json().catch(() => ({}));
        const tracking = String(body.trackingNumber || order.trackingNumber || '').trim();
        if(!tracking) return err(400, 'trackingNumber required', env, req);
        if(!order.customer?.email) return err(400, 'Order has no customer email', env, req);
        // Save tracking number + mark fulfilled
        order.trackingNumber = tracking;
        order.status = 'fulfilled';
        order.timeline = { ...(order.timeline||{}), fulfilledAt: new Date().toISOString(), trackingAddedAt: new Date().toISOString() };
        order.updated = new Date().toISOString();
        order.updatedBy = sess.username;
        await env.STORE.put(`order:${id}`, JSON.stringify(order));
        await sendTrackingEmail(env, order, tracking);
        await audit(env, sess, 'order.tracking', id, `tracking=${tracking}`);
        return json({ ok: true, tracking }, {}, env, req);
      }

      // ── Resend receipt / order confirmation ──────────────────────
      const receiptM = path.match(/^\/api\/orders\/([^/]+)\/send-receipt$/);
      if(receiptM && req.method === 'POST'){
        const id = receiptM[1];
        const raw = await env.STORE.get(`order:${id}`);
        if(!raw) return err(404, 'Order not found', env, req);
        const order = JSON.parse(raw);
        if(!order.customer?.email) return err(400, 'Order has no customer email', env, req);
        await sendCustomerConfirmation(env, order);
        order.timeline = { ...(order.timeline||{}), receiptSentAt: new Date().toISOString() };
        await env.STORE.put(`order:${id}`, JSON.stringify(order));
        await audit(env, sess, 'order.receipt', id, `to ${order.customer.email}`);
        return json({ ok: true, email: order.customer.email }, {}, env, req);
      }

      // ── Mark invoice paid (closes the pending_invoice loop) ──────
      const paidM = path.match(/^\/api\/orders\/([^/]+)\/mark-paid$/);
      if(paidM && req.method === 'POST'){
        const id = paidM[1];
        const raw = await env.STORE.get(`order:${id}`);
        if(!raw) return err(404, 'Order not found', env, req);
        const order = JSON.parse(raw);
        if(order.paymentStatus === 'paid' || order.paymentStatus === 'paid_in_store'){
          return err(409, 'Order is already paid', env, req);
        }
        const body = await req.json().catch(() => ({}));
        const note = String(body.note || '').slice(0, 200);
        const prevPayment = order.paymentStatus || 'unknown';
        order.paymentStatus = 'paid';
        order.timeline = { ...(order.timeline || {}), paidAt: new Date().toISOString() };
        // For in-store invoice sales the goods already left; auto-fulfill on payment.
        if(order.source === 'in-store' && order.status === 'new'){
          order.status = 'fulfilled';
          order.timeline.fulfilledAt = order.timeline.paidAt;
        }
        if(note){
          order.adminNotes = (order.adminNotes ? order.adminNotes + ' · ' : '') + `Paid: ${note}`;
        }
        order.updated = order.timeline.paidAt;
        order.updatedBy = sess.username;
        await env.STORE.put(`order:${id}`, JSON.stringify(order));
        await audit(env, sess, 'order.paid', id,
          `${prevPayment} → paid · $${Number(order.total || 0).toFixed(2)}${note ? ' · ' + note : ''} (${sess.username})`);
        return json({ ok: true, order }, {}, env, req);
      }

      // ── Inventory adjust (audited +1/-1, restock log) ────────────
      if(path === '/api/inventory/adjust' && req.method === 'POST'){
        const body = await req.json().catch(() => null);
        if(!body || !body.productId || body.delta == null){
          return err(400, 'productId and delta required', env, req);
        }
        const delta = Math.trunc(Number(body.delta));
        if(!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 9999){
          return err(400, 'invalid delta', env, req);
        }
        const reason = String(body.reason || '').slice(0, 80) ||
          (delta > 0 ? 'restock' : 'adjust');
        const cat = await getCatalog(env);
        const p = cat.products.find(x => x.id === body.productId);
        if(!p) return err(404, 'Product not found', env, req);
        const before = Number(p.stock || 0);
        const after  = Math.max(0, before + delta);
        cat.products = cat.products.map(x =>
          x.id === p.id ? { ...x, stock: after } : x
        );
        cat.updated = new Date().toISOString().slice(0,10);
        await env.STORE.put('catalog', JSON.stringify(cat));
        await audit(env, sess, delta > 0 ? 'inventory.restock' : 'inventory.adjust',
          p.id,
          `${p.name}: ${before} → ${after} (${delta > 0 ? '+' : ''}${delta}) · ${reason} · ${sess.username}`);
        return json({ ok: true, productId: p.id, before, after, delta }, {}, env, req);
      }

      // ────────── Owner-only routes ────────────────────────────────
      const ownerOnly = () => sess.role === 'owner';

      if(path === '/api/users' && req.method === 'GET'){
        if(!ownerOnly()) return err(403, 'Owner only', env, req);
        return json({ users: await listUsers(env) }, {}, env, req);
      }
      if(path === '/api/users' && req.method === 'POST'){
        if(!ownerOnly()) return err(403, 'Owner only', env, req);
        const body = await req.json().catch(() => ({}));
        try {
          const u = await createUser(env, {
            username: body.username, name: body.name,
            password: body.password, role: body.role || 'admin',
            createdBy: sess.username
          });
          await audit(env, sess, 'user.create', u.username, `role=${u.role}`);
          return json({ ok: true, username: u.username }, {}, env, req);
        } catch(e){ return err(400, e.message, env, req); }
      }
      const um = path.match(/^\/api\/users\/([^/]+)$/);
      if(um){
        if(!ownerOnly()) return err(403, 'Owner only', env, req);
        const username = sanitizeUsername(um[1]);
        const u = await getUser(env, username);
        if(!u) return err(404, 'User not found', env, req);
        if(req.method === 'PATCH'){
          const body = await req.json().catch(() => ({}));
          if(typeof body.name === 'string') u.name = body.name.slice(0, 60);
          if(['owner','admin'].includes(body.role)){
            if(u.username === sess.username && body.role !== 'owner'){
              return err(400, 'You cannot demote yourself', env, req);
            }
            u.role = body.role;
          }
          if(typeof body.active === 'boolean'){
            if(u.username === sess.username && body.active === false){
              return err(400, 'You cannot deactivate yourself', env, req);
            }
            u.active = body.active;
          }
          if(typeof body.trusted === 'boolean'){
            // Only applies to admin role; owners always have full publish rights
            u.trusted = body.trusted;
          }
          if(typeof body.password === 'string' && body.password.length >= 4){
            u.salt = newSalt();
            u.hash = await hashPw(body.password, u.salt);
            u.mustChangePassword = true;
            await audit(env, sess, 'user.password_reset', u.username, '');
          }
          await putUser(env, u);
          await audit(env, sess, 'user.update', u.username, '');
          return json({ ok: true }, {}, env, req);
        }
        if(req.method === 'DELETE'){
          if(u.username === sess.username) return err(400, 'You cannot delete yourself', env, req);
          await env.STORE.delete(`user:${u.username}`);
          await audit(env, sess, 'user.delete', u.username, '');
          return json({ ok: true }, {}, env, req);
        }
      }

      if(path === '/api/audit' && req.method === 'GET'){
        if(!ownerOnly()) return err(403, 'Owner only', env, req);
        const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10));
        return json({ entries: await listAudit(env, limit) }, {}, env, req);
      }

      return err(404, 'Not found', env, req);
    } catch(e){
      return err(500, e.message || 'Server error', env, req);
    }
  }
};
