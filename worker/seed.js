// Seeds the Worker KV with the current data/products.json catalog.
// Run with:  node seed.js https://minarealm-admin.YOURACCT.workers.dev cynthia <ADMIN_PASSWORD>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , workerUrl, username, password] = process.argv;
if(!workerUrl || !username || !password){
  console.error('Usage: node seed.js <worker-url> <username> <password>');
  console.error('  On first run (bootstrap), use the ADMIN_PASSWORD secret as password.');
  console.error('  This will create the initial owner account using <username>.');
  process.exit(1);
}

const catalogPath = path.join(__dirname, '..', 'data', 'products.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const login = await fetch(`${workerUrl}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
});
if(!login.ok){
  console.error('Login failed:', login.status, await login.text());
  process.exit(2);
}
const { token } = await login.json();
console.log('Logged in.');

const put = await fetch(`${workerUrl}/api/products`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(catalog)
});
const result = await put.json();
console.log('Result:', put.status, result);
