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

const normalizeStageValue = (stage) => {
  const raw = String(stage || '').trim();
  return raw || 'Sem funil';
};

// Chatwoot label names: letters/numbers/_/-. Prefer lower_snake.
const toLabelSlug = (stageValue) => {
  const raw = String(stageValue || '').trim();
  if (!raw) {
    return 'sem_funil';
  }
  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    return raw.toLowerCase();
  }
  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (ascii || 'sem_funil').toLowerCase();
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

const setOnlyLabel = async ({ accountId, type, id, label }) => {
  const endpoint =
    type === 'contact'
      ? `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
          id
        )}/labels`
      : `/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(
          id
        )}/labels`;

  // Overwrite labels: the conversation/contact must have exactly one label.
  return chatwootFetchJson(endpoint, {
    method: 'POST',
    body: JSON.stringify({ labels: [label] }),
  });
};

const listConversationIdsForContact = (payload, maxCount) => {
  const list = Array.isArray(payload) ? payload : [];
  const ids = uniqStrings(
    list
      .map((c) => (c && c.id !== null && c.id !== undefined ? String(c.id) : null))
      .filter(Boolean)
  );
  return ids.slice(0, Math.max(1, Number(maxCount) || 50));
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
    const stageValue = normalizeStageValue(stage);
    const prevStageValue = previousStage ? normalizeStageValue(previousStage) : '';
    const nextLabel = toLabelSlug(stageValue);
    const prevLabel = toLabelSlug(prevStageValue);

    // 1) Update funnel custom attribute.
    await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          custom_attributes: { funil_de_vendas: stageValue },
        }),
      }
    );

    // 2) Contact must have exactly one label equal to funil_de_vendas.
    const updated = await setOnlyLabel({
      accountId,
      type: 'contact',
      id: contactId,
      label: nextLabel,
    });

    // 3) Apply the same label to the most relevant conversation(s) of this contact.
    const convs = await chatwootFetchJson(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
        contactId
      )}/conversations`
    );
    const conversationIds = listConversationIdsForContact(
      convs && Array.isArray(convs.payload) ? convs.payload : [],
      req.query.max_conversations || 50
    );

    const updatedConversations = [];
    for (const conversationId of conversationIds) {
      const updatedConv = await setOnlyLabel({
        accountId,
        type: 'conversation',
        id: conversationId,
        label: nextLabel,
      });
      updatedConversations.push({
        conversationId,
        labels:
          updatedConv && Array.isArray(updatedConv.payload)
            ? updatedConv.payload
            : [nextLabel],
      });
    }

    res.status(200).json({
      ok: true,
      stage: stageValue,
      label: nextLabel,
      labels: updated && Array.isArray(updated.payload) ? updated.payload : [nextLabel],
      conversations: updatedConversations,
    });
  } catch (err) {
    // Best-effort revert (if provided) to avoid leaving funil and labels inconsistent.
    if (previousStage) {
      try {
        const prevStageValue = normalizeStageValue(previousStage);
        const prevLabel = toLabelSlug(prevStageValue);
        await chatwootFetchJson(
          `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
            contactId
          )}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              custom_attributes: { funil_de_vendas: prevStageValue },
            }),
          }
        );
        await setOnlyLabel({
          accountId,
          type: 'contact',
          id: contactId,
          label: prevLabel,
        });
        const convs = await chatwootFetchJson(
          `/api/v1/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(
            contactId
          )}/conversations`
        );
        const conversationIds = listConversationIdsForContact(
          convs && Array.isArray(convs.payload) ? convs.payload : [],
          req.query.max_conversations || 50
        );
        for (const conversationId of conversationIds) {
          await setOnlyLabel({
            accountId,
            type: 'conversation',
            id: conversationId,
            label: prevLabel,
          });
        }
      } catch {
        // ignore revert errors
      }
    }
    res.status(err.status || 500).json({ error: err.message, data: err.data || null });
  }
});

app.listen(port, () => {
  console.log(`Chatwoot app listening on ${port}`);
});
