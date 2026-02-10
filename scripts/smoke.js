/* eslint-disable no-console */
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const safeJson = async (res) => {
  const text = await res.text();
  try {
    return { ok: true, json: text ? JSON.parse(text) : null, text };
  } catch (err) {
    return { ok: false, json: null, text };
  }
};

const groupStages = (contacts) => {
  const counts = new Map();
  for (const c of contacts) {
    const stage =
      (c &&
        c.custom_attributes &&
        (c.custom_attributes.funil_de_vendas || c.custom_attributes['funil_de_vendas'])) ||
      'Sem funil';
    const key = String(stage || 'Sem funil');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
};

async function main() {
  const port = process.env.SMOKE_PORT || '3100';
  const base = `http://localhost:${port}`;

  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: port, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverReady = false;
  child.stdout.on('data', (d) => {
    const s = String(d);
    if (s.includes('listening')) {
      serverReady = true;
    }
  });

  child.stderr.on('data', (d) => {
    // Keep stderr quiet unless debugging; still helps if the process crashes.
    const s = String(d);
    if (s.trim()) {
      console.error('[server stderr]', s.trim());
    }
  });

  // Wait a bit for the server to start.
  for (let i = 0; i < 25; i++) {
    if (serverReady) break;
    await sleep(200);
  }

  try {
    const versionRes = await fetch(`${base}/api/version`);
    const version = await safeJson(versionRes);
    console.log(`VERSION status=${versionRes.status}`);
    if (version.ok && version.json) {
      console.log(
        `VERSION startedAt=${version.json.startedAt} railwaySha=${version.json.git && version.json.git.railway}`
      );
    }

    const cfgRes = await fetch(`${base}/api/config`);
    const cfg = await safeJson(cfgRes);
    console.log(`CONFIG status=${cfgRes.status}`);
    if (cfg.ok && cfg.json) {
      console.log(
        `CONFIG baseUrl=${cfg.json.baseUrl} accountId=${cfg.json.accountId} hasToken=${cfg.json.hasToken}`
      );
    }

    const contactsRes = await fetch(`${base}/api/contacts?per_page=50&max_pages=50`);
    const contactsBody = await safeJson(contactsRes);
    console.log(`CONTACTS status=${contactsRes.status}`);

    if (!contactsRes.ok) {
      console.log(
        `CONTACTS_ERROR ${(contactsBody.ok && contactsBody.json && contactsBody.json.error) || contactsBody.text}`
      );
      process.exitCode = 2;
      return;
    }

    const contacts = (contactsBody.ok && contactsBody.json && contactsBody.json.contacts) || [];
    console.log(`CONTACTS count=${contacts.length}`);

    const stages = groupStages(contacts).slice(0, 15);
    console.log('TOP_STAGES');
    for (const [name, count] of stages) {
      console.log(`- ${name}: ${count}`);
    }
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

