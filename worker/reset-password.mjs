// Reset cynthia's password directly in KV
// Usage: node reset-password.mjs <newPassword>
import crypto from 'node:crypto';

const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NS = process.env.MINAREALM_KV_ID;

if (!ACCT || !TOKEN || !KV_NS) {
  console.error('Missing required env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, MINAREALM_KV_ID');
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}`;

const [,,newPassword] = process.argv;
if (!newPassword) {
  console.error('Usage: node reset-password.mjs <newPassword>');
  process.exit(1);
}

// Worker algorithm: SHA-256(salt + ":" + password) iterated 50k times
function newSalt() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map(x => x.toString(16).padStart(2,'0')).join('');
}
async function hashPw(password, salt) {
  const enc = new TextEncoder();
  let buf = enc.encode(salt + ':' + password);
  for (let i = 0; i < 50000; i++) {
    buf = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  }
  return [...buf].map(x => x.toString(16).padStart(2,'0')).join('');
}

// Fetch user record
console.log('Fetching user:cynthia from KV...');
const getRes = await fetch(`${BASE}/values/user%3Acynthia`, {
  headers: { Authorization: `Bearer ${TOKEN}` }
});
if (!getRes.ok) {
  console.error('Fetch failed:', getRes.status, await getRes.text());
  process.exit(1);
}
const user = await getRes.json();
console.log('Found user:', user.username, 'role:', user.role);

// Generate new salt + hash
console.log('Hashing password (50k SHA-256 iterations)...');
const salt = newSalt();
const hash = await hashPw(newPassword, salt);
user.salt = salt;
user.hash = hash;

// Write back
const putRes = await fetch(`${BASE}/values/user%3Acynthia`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(user)
});
const result = await putRes.json();
if (result.success) {
  console.log('Password reset successfully.');
  console.log(`Username: cynthia`);
  console.log(`New password: ${newPassword}`);
} else {
  console.error('Failed:', JSON.stringify(result));
  process.exit(2);
}
