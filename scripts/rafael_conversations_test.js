/* eslint-disable no-console */
const { spawn } = require('node:child_process');

if (process.env.NODE_ENV !== 'production') {
  // Local test helper
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalizeStageValue = (stage) => {
  const raw = String(stage || '').trim();
  return raw || 'Sem funil';
};

const toLabelSlug = (stageValue) => {
  const raw = String(stageValue || '').trim();
  if (!raw) return 'sem_funil';
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw.toLowerCase();
  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (ascii || 'sem_funil').toLowerCase();
};

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
  child.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s) console.error('[server stderr]', s);
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

  const targetName = 'Rafael Dos Anjos';

  // Load all contacts via our own API to avoid relying on Chatwoot search semantics.
  const port = 3123;
  const server = await startLocalServer(port);
  let allContacts = [];
  try {
    const res = await fetch(`http://localhost:${port}/api/contacts`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body && body.error) || `Failed to load contacts (${res.status})`);
    }
    allContacts = Array.isArray(body.contacts) ? body.contacts : [];
  } finally {
    server.kill();
  }

  const exact = allContacts.filter(
    (c) => normalizeName(c && c.name) === normalizeName(targetName)
  );
  if (!exact.length) {
    const contains = allContacts
      .filter((c) => normalizeName(c && c.name).includes('rafael'))
      .slice(0, 15)
      .map((c) => `- ${c && c.name} (id=${c && c.id})`);
    console.log(`No exact match for contact name "${targetName}".`);
    if (contains.length) {
      console.log('Candidates containing "rafael":');
      for (const line of contains) console.log(line);
    }
    return;
  }

  const chosen = exact
    .slice()
    .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0))[0];
  const contactId = chosen.id;
  const contactName = chosen.name;
  const previousStage =
    (chosen.custom_attributes && chosen.custom_attributes.funil_de_vendas) || '';

  console.log(`CONTACT name="${contactName}" id=${contactId}`);
  console.log(`CONTACT funil_de_vendas="${previousStage || ''}"`);

  const contactLabelsRes = await chatwootFetchJson(
    `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/contacts/${encodeURIComponent(
      contactId
    )}/labels`
  );
  const contactLabels = Array.isArray(contactLabelsRes && contactLabelsRes.payload)
    ? contactLabelsRes.payload
    : [];
  console.log(`CONTACT labels: ${contactLabels.length ? contactLabels.join(', ') : '(none)'}`);

  const convsRes = await chatwootFetchJson(
    `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/contacts/${encodeURIComponent(
      contactId
    )}/conversations`
  );
  const convs = Array.isArray(convsRes && convsRes.payload) ? convsRes.payload : [];
  const convIds = convs
    .map((c) => (c && c.id !== undefined && c.id !== null ? String(c.id) : null))
    .filter(Boolean);
  console.log(`CONVERSATIONS count=${convIds.length}`);

  const before = [];
  for (const convId of convIds) {
    const labelsRes = await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/conversations/${encodeURIComponent(
        convId
      )}/labels`
    );
    const labels = Array.isArray(labelsRes && labelsRes.payload) ? labelsRes.payload : [];
    before.push({ convId, labels });
  }

  console.log('CONVERSATIONS labels BEFORE');
  for (const item of before) {
    console.log(`- ${item.convId}: ${item.labels.length ? item.labels.join(', ') : '(none)'}`);
  }

  const targetStage = 'Análise';
  const expectedLabel = toLabelSlug(normalizeStageValue(targetStage));
  console.log(`\nMOVE -> "${targetStage}" (expect label "${expectedLabel}")`);

  const server2 = await startLocalServer(port);
  try {
    const moveRes = await fetch(
      `http://localhost:${port}/api/contacts/${encodeURIComponent(contactId)}/move`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: targetStage, previousStage }),
      }
    );
    const moveBody = await moveRes.json().catch(() => ({}));
    if (!moveRes.ok) {
      throw new Error(
        (moveBody && moveBody.error) || `Move failed with status ${moveRes.status}`
      );
    }

    // Re-fetch conversation labels to verify.
    const after = [];
    for (const convId of convIds) {
      const labelsRes = await chatwootFetchJson(
        `/api/v1/accounts/${encodeURIComponent(ACCOUNT_ID)}/conversations/${encodeURIComponent(
          convId
        )}/labels`
      );
      const labels = Array.isArray(labelsRes && labelsRes.payload) ? labelsRes.payload : [];
      after.push({ convId, labels });
    }

    console.log('CONVERSATIONS labels AFTER');
    let okCount = 0;
    for (const item of after) {
      const only = item.labels.map(String);
      const ok = only.length === 1 && only[0] === expectedLabel;
      if (ok) okCount += 1;
      console.log(
        `- ${item.convId}: ${item.labels.length ? item.labels.join(', ') : '(none)'}${
          ok ? ' [OK]' : ' [NOT-ONLY]'
        }`
      );
    }
    console.log(
      `VERIFY conversations have ONLY "${expectedLabel}": ${okCount}/${after.length}`
    );
  } finally {
    server2.kill();
  }

  // Optional: revert to previous stage so we don't disturb production.
  if (previousStage) {
    const revertStage = previousStage;
    const port2 = 3124;
    const server2 = await startLocalServer(port2);
    console.log(`\nREVERT -> "${revertStage}"`);
    try {
      const res = await fetch(
        `http://localhost:${port2}/api/contacts/${encodeURIComponent(contactId)}/move`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage: revertStage, previousStage: 'Análise' }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body && body.error) || `Revert failed (${res.status})`);
      }
      console.log('REVERT OK');
    } finally {
      server2.kill();
    }
  } else {
    console.log('\nSKIP REVERT: previous funil_de_vendas was empty');
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
