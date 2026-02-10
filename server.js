if (process.env.NODE_ENV !== 'production') {
  // Local-only: Railway provides env vars via dashboard; don't rely on .env in prod.
  require('dotenv').config();
}

const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

app.use(express.json({ limit: '256kb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: 0,
    setHeaders(res) {
      // Avoid stale iframe assets when deploying frequently.
      res.setHeader('Cache-Control', 'no-store');
    },
  })
);

const getChatwootConfig = () => {
  const baseUrl =
    (process.env.CHATWOOT_BASE_URL || process.env.CHATWOOT_URL || '').trim() ||
    'https://app.chatwoot.com';
  const accountId =
    (process.env.CHATWOOT_ACCOUNT_ID || process.env.CHATWOOT_ACCOUNT || '').trim();
  const apiAccessToken =
    (process.env.CHATWOOT_API_ACCESS_TOKEN ||
      process.env.CHATWOOT_API_TOKEN ||
      process.env.CHATWOOT_TOKEN ||
      '').trim();
  return { baseUrl, accountId, apiAccessToken };
};

const chatwootFetchJson = async (pathname, init) => {
  const { baseUrl, apiAccessToken } = getChatwootConfig();
  const url = new URL(pathname, baseUrl);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init && init.headers ? init.headers : {}),
      api_access_token: apiAccessToken,
      'content-type': 'application/json',
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = { raw: text };
  }

  if (!res.ok) {
    const error = new Error(`Chatwoot API error: ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
};

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/version', (req, res) => {
  res.json({
    startedAt,
    node: process.version,
    app: {
      name: 'chatwoot-dashboard-app',
      version: '1.0.0',
    },
    git: {
      railway: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      github: process.env.GITHUB_SHA || null,
      vercel: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
  });
});

app.get('/api/config', (req, res) => {
  const cfg = getChatwootConfig();
  res.json({
    baseUrl: cfg.baseUrl,
    accountId: cfg.accountId || null,
    hasToken: Boolean(cfg.apiAccessToken),
  });
});

app.get('/api/contacts', async (req, res) => {
  const { accountId, apiAccessToken } = getChatwootConfig();
  if (!accountId || !apiAccessToken) {
    res.status(400).json({
      error: 'Missing CHATWOOT_ACCOUNT_ID and/or CHATWOOT_API_ACCESS_TOKEN',
    });
    return;
  }

  const perPage = Math.min(Number(req.query.per_page || 50) || 50, 100);
  const maxPages = Math.min(Number(req.query.max_pages || 50) || 50, 200);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  try {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('per_page', String(perPage));
      if (q) {
        qs.set('q', q);
      }

      const data = await chatwootFetchJson(
        `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts?${qs.toString()}`
      );
      const payload = data && Array.isArray(data.payload) ? data.payload : [];
      all.push(...payload);
      if (payload.length < perPage) {
        break;
      }
    }

    const simplified = all.map((c) => ({
      id: c && c.id,
      name: c && (c.name || c.identifier || null),
      email: c && c.email,
      phone_number: c && c.phone_number,
      custom_attributes: (c && c.custom_attributes) || {},
      updated_at: c && c.updated_at,
    }));

    res.json({ contacts: simplified });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, data: err.data || null });
  }
});

app.put('/api/contacts/:id/funil', async (req, res) => {
  const { accountId, apiAccessToken } = getChatwootConfig();
  if (!accountId || !apiAccessToken) {
    res.status(400).json({
      error: 'Missing CHATWOOT_ACCOUNT_ID and/or CHATWOOT_API_ACCESS_TOKEN',
    });
    return;
  }

  const contactId = String(req.params.id || '').trim();
  const stage = (req.body && req.body.stage !== undefined ? String(req.body.stage) : '')
    .trim();
  if (!contactId) {
    res.status(400).json({ error: 'Missing contact id' });
    return;
  }

  try {
    await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          custom_attributes: { funil_de_vendas: stage || null },
        }),
      }
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, data: err.data || null });
  }
});

app.listen(port, () => {
  console.log(`Chatwoot app listening on ${port}`);
});
