/* eslint-disable no-console */
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const BASE_URL = (process.env.CHATWOOT_BASE_URL || process.env.CHATWOOT_URL || '').trim()
  ? (process.env.CHATWOOT_BASE_URL || process.env.CHATWOOT_URL).trim()
  : 'https://app.chatwoot.com';
const ACCOUNT_ID = (process.env.CHATWOOT_ACCOUNT_ID || process.env.CHATWOOT_ACCOUNT || '').trim();
const TOKEN = (
  process.env.CHATWOOT_API_ACCESS_TOKEN ||
  process.env.CHATWOOT_API_TOKEN ||
  process.env.CHATWOOT_TOKEN ||
  ''
).trim();

const targetName = 'Rafael Dos Anjos';
const targetStage = 'Análise';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chatwootFetchJson = async (pathname, init) => {
  const url = new URL(pathname, BASE_URL);
  const res = await fetch(url, {
    ...init,
    headers: {
      api_access_token: TOKEN,
      'content-type': 'application/json',
      ...(init && init.headers ? init.headers : {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Chatwoot API error: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const { spawn } = require('node:child_process');

const startLocalServer = async (port) => {
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  child.stdout.on('data', (d) => {
    const s = String(d);
    if (s.includes('listening')) ready = true;
  });

  for (let i = 0; i < 30; i++) {
    if (ready) return child;
    await sleep(200);
  }
  child.kill();
  throw new Error('Local server did not start');
};

const normalizeName = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

async function main() {
  if (!ACCOUNT_ID) throw new Error('Missing CHATWOOT_ACCOUNT_ID');
  if (!TOKEN) throw new Error('Missing CHATWOOT_API_ACCESS_TOKEN');

  // Use our own API (same as the app) to find the contact reliably.
  const port = 3126;
  const server = await startLocalServer(port);
  let contacts = [];
  try {
    const res = await fetch(`http://localhost:${port}/api/contacts`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body && body.error) || `Failed to load contacts (${res.status})`);
    }
    contacts = Array.isArray(body.contacts) ? body.contacts : [];
  } finally {
    server.kill();
  }

  const exact = contacts.filter(
    (c) => normalizeName(c && c.name) === normalizeName(targetName)
  );
  if (!exact.length) {
    throw new Error(`Contact not found by exact name via /api/contacts: "${targetName}"`);
  }
  const chosen = exact
    .slice()
    .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0))[0];
  const contactId = chosen.id;

  console.log(
    `Updating contact id=${contactId} name="${chosen.name}" -> funil="${targetStage}"`
  );

  // 1) Update custom_attributes.funil_de_vendas
  await chatwootFetchJson(
    `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/contacts/${encodeURIComponent(
      contactId
    )}`,
    {
      method: 'PUT',
      body: JSON.stringify({ custom_attributes: { funil_de_vendas: targetStage } }),
    }
  );

  // 2) Overwrite contact labels to ONLY the funnel stage
  await chatwootFetchJson(
    `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/contacts/${encodeURIComponent(
      contactId
    )}/labels`,
    {
      method: 'POST',
      body: JSON.stringify({ labels: [targetStage] }),
    }
  );

  // 3) Overwrite labels for ALL conversations of this contact
  const convs = await chatwootFetchJson(
    `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/contacts/${encodeURIComponent(
      contactId
    )}/conversations`
  );
  const convList = Array.isArray(convs && convs.payload) ? convs.payload : [];
  const convIds = convList
    .map((c) => (c && c.id !== undefined && c.id !== null ? String(c.id) : null))
    .filter(Boolean);

  console.log(`Found conversations: ${convIds.length ? convIds.join(', ') : '(none)'}`);

  for (const conversationId of convIds) {
    await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/conversations/${encodeURIComponent(
        conversationId
      )}/labels`,
      {
        method: 'POST',
        body: JSON.stringify({ labels: [targetStage] }),
      }
    );
  }

  console.log('OK. Refresh the Chatwoot UI and check conversation labels.');
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  if (err && err.data) {
    console.error('API response:', JSON.stringify(err.data));
  }
  process.exitCode = 1;
});
