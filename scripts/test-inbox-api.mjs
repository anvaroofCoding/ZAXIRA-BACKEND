const base = process.argv[2] || 'http://localhost:8000/api';
const login = process.argv[3] || 'boshliq';
const password = process.argv[4] || '123123';

const loginRes = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login, password }),
});
const loginJson = await loginRes.json();
if (!loginRes.ok) {
  console.error('Login failed', loginJson);
  process.exit(1);
}

const token = loginJson.data?.accessToken ?? loginJson.accessToken;
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
console.log('JWT sub:', payload.sub, 'login:', payload.login);

const inboxRes = await fetch(
  `${base}/purchase-requests/approvals/inbox?page=1&limit=50`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const inbox = await inboxRes.json();
if (!inboxRes.ok) {
  console.error('Inbox failed', inbox);
  process.exit(1);
}

const data = inbox.data ?? inbox;
console.log(`${base} [${login}] total=${data.total} items=${data.items?.length ?? 0}`);
for (const item of data.items ?? []) {
  console.log(`  ${item.requestCode} | ${item.statusLabel ?? item.status}`);
}
