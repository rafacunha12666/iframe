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

const toLabelName = (stage) => {
  const raw = String(stage || '').trim();
  if (!raw) {
    return 'sem_funil';
  }

  // Prefer using the original stage if it already matches Chatwoot label rules.
  // (UI docs mention: alphabets, numbers, hyphens, underscores)
  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    return raw;
  }

  // Fallback: normalize to ascii + underscores.
  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || 'sem_funil';
};

const uniqStrings = (arr) => {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const mergeLabels = ({ current, add, remove }) => {
  const set = new Set((current || []).map((s) => String(s)));
  const addLabel = String(add || '').trim();
  const removeLabel = String(remove || '').trim();
  if (removeLabel && removeLabel !== addLabel) {
    set.delete(removeLabel);
  }
  if (addLabel) {
    set.add(addLabel);
  }
  return Array.from(set);
};

const pickConversationIdsForContact = (payload) => {
  const list = Array.isArray(payload) ? payload : [];
  const convs = list
    .map((c) => {
      const id = c && c.id;
      if (id === null || id === undefined) return null;
      const status = c && c.status;
      const updatedAt = Number(c && (c.updated_at || c.last_activity_at || c.created_at)) || 0;
      return { id: Number(id), status: String(status || ''), updatedAt };
    })
    .filter(Boolean);

  const open = convs
    .filter((c) => c.status && c.status !== 'resolved')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const allSorted = convs.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const chosen = open.length ? open.slice(0, 5) : allSorted.slice(0, 1);
  return uniqStrings(chosen.map((c) => String(c.id)));
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
    let page = 1;
    while (page <= maxPages) {
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
      const meta = data && typeof data.meta === 'object' ? data.meta : null;
      all.push(...payload);

      // Prefer explicit pagination metadata if present. Chatwoot may return fewer
      // than per_page while still having more pages.
      if (meta && Number.isFinite(meta.current_page) && Number.isFinite(meta.total_pages)) {
        if (meta.current_page >= meta.total_pages) {
          break;
        }
        page = meta.current_page + 1;
        continue;
      }
      if (meta && Number.isFinite(meta.next_page) && meta.next_page) {
        page = meta.next_page;
        continue;
      }

      // Fallback when no pagination metadata exists.
      if (payload.length === 0) {
        break;
      }
      page += 1;
    }

    const simplified = all.map((c) => ({
      id: c && c.id,
      name: c && (c.name || c.identifier || null),
      identifier: c && c.identifier,
      email: c && c.email,
      phone_number: c && c.phone_number,
      contact_inboxes: Array.isArray(c && c.contact_inboxes)
        ? c.contact_inboxes.map((ci) => ({
            source_id: ci && ci.source_id,
            inbox_id: ci && ci.inbox && ci.inbox.id,
          }))
        : [],
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

app.put('/api/contacts/:id/move', async (req, res) => {
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
  const previousStage = (
    req.body && req.body.previousStage !== undefined ? String(req.body.previousStage) : ''
  ).trim();
  if (!contactId) {
    res.status(400).json({ error: 'Missing contact id' });
    return;
  }

  try {
    const nextLabel = toLabelName(stage || 'Sem funil');
    const prevLabel = previousStage ? toLabelName(previousStage) : '';

    // 1) Update funnel custom attribute.
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

    // 2) Ensure a contact label exists matching the funnel stage (normalized).
    const existing = await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}/labels`
    );
    const current = existing && Array.isArray(existing.payload) ? existing.payload : [];
    const merged = mergeLabels({ current, add: nextLabel, remove: prevLabel });

    const updated = await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}/labels`,
      {
        method: 'POST',
        body: JSON.stringify({ labels: merged }),
      }
    );

    // 3) Apply the same label to the most relevant conversation(s) of this contact.
    const convs = await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}/conversations`
    );
    const conversationIds = pickConversationIdsForContact(
      convs && Array.isArray(convs.payload) ? convs.payload : []
    );

    const updatedConversations = [];
    for (const conversationId of conversationIds) {
      const existingConv = await chatwootFetchJson(
        `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(
          conversationId
        )}/labels`
      );
      const currentConv =
        existingConv && Array.isArray(existingConv.payload) ? existingConv.payload : [];
      const mergedConv = mergeLabels({
        current: currentConv,
        add: nextLabel,
        remove: prevLabel,
      });

      const updatedConv = await chatwootFetchJson(
        `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(
          conversationId
        )}/labels`,
        {
          method: 'POST',
          body: JSON.stringify({ labels: mergedConv }),
        }
      );
      updatedConversations.push({
        conversationId,
        labels: updatedConv && Array.isArray(updatedConv.payload) ? updatedConv.payload : mergedConv,
      });
    }

    res.status(200).json({
      ok: true,
      stage: stage || null,
      label: nextLabel,
      labels: updated && Array.isArray(updated.payload) ? updated.payload : merged,
      conversations: updatedConversations,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, data: err.data || null });
  }
});

app.listen(port, () => {
  console.log(`Chatwoot app listening on ${port}`);
});
