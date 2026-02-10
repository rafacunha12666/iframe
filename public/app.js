const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');
const contactNameEl = document.getElementById('contactName');
const postMessageEl = document.getElementById('postMessagePayload');
const postMessageHintEl = document.getElementById('postMessageHint');
const contactIdEl = document.getElementById('contactId');
const contactEmailEl = document.getElementById('contactEmail');
const contactPhoneEl = document.getElementById('contactPhone');
const contactAvatarEl = document.getElementById('contactAvatar');
const conversationIdEl = document.getElementById('conversationId');
const conversationStatusEl = document.getElementById('conversationStatus');
const conversationInboxIdEl = document.getElementById('conversationInboxId');
const accountIdEl = document.getElementById('accountId');
const inboxIdEl = document.getElementById('inboxId');
const contactCustomAttributesEl = document.getElementById('contactCustomAttributes');
const contactLabelsEl = document.getElementById('contactLabels');

const contactCanvas = document.getElementById('contactCanvas');
const contactCanvasCtx = contactCanvas ? contactCanvas.getContext('2d') : null;

const kanbanBoardEl = document.getElementById('kanbanBoard');
const clearBoardBtn = document.getElementById('clearBoardBtn');
const kanbanSearchEl = document.getElementById('kanbanSearch');
const kanbanSyncStatusEl = document.getElementById('kanbanSyncStatus');
const kanbanErrorEl = document.getElementById('kanbanError');

const allowedOrigins = new Set(['https://app.chatwoot.com']);
try {
  if (document.referrer) {
    allowedOrigins.add(new URL(document.referrer).origin);
  }
} catch (err) {
  // ignore
}

const STORAGE_KEY = 'kanban_funil_de_vendas_v1';

let currentContactName = 'Nao informado';
let avatarImage = null;
let avatarImageUrl = null;

// Optional: define preferred ordering for common stages.
const PREFERRED_STAGES = [
  'novo',
  'lead',
  'qualificacao',
  'contato',
  'proposta',
  'negociacao',
  'ganho',
  'perdido',
];

const loadBoardState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { contacts: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.contacts) {
      return { contacts: {} };
    }
    return { contacts: parsed.contacts || {} };
  } catch (err) {
    return { contacts: {} };
  }
};

const saveBoardState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // ignore
  }
};

let boardState = loadBoardState();
let kanbanFilter = '';
let lastSyncAt = null;
let isSyncing = false;

const getInitials = (name) => {
  if (!name || typeof name !== 'string') {
    return '?';
  }
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const drawCanvas = () => {
  if (!contactCanvasCtx || !contactCanvas) {
    return;
  }
  const { width, height } = contactCanvas;
  contactCanvasCtx.clearRect(0, 0, width, height);

  contactCanvasCtx.fillStyle = '#f3efe8';
  contactCanvasCtx.fillRect(0, 0, width, height);

  const centerX = 64;
  const centerY = height / 2;
  const radius = 42;

  contactCanvasCtx.save();
  contactCanvasCtx.beginPath();
  contactCanvasCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  contactCanvasCtx.closePath();
  contactCanvasCtx.clip();

  if (avatarImage && avatarImage.complete) {
    contactCanvasCtx.drawImage(
      avatarImage,
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );
  } else {
    contactCanvasCtx.fillStyle = '#e85d3f';
    contactCanvasCtx.fillRect(
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );
  }
  contactCanvasCtx.restore();

  contactCanvasCtx.strokeStyle = '#e5e0d8';
  contactCanvasCtx.lineWidth = 2;
  contactCanvasCtx.beginPath();
  contactCanvasCtx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  contactCanvasCtx.stroke();

  if (!avatarImage || !avatarImage.complete) {
    contactCanvasCtx.fillStyle = '#ffffff';
    contactCanvasCtx.font = '600 22px "Space Grotesk", "Segoe UI", sans-serif';
    contactCanvasCtx.textAlign = 'center';
    contactCanvasCtx.textBaseline = 'middle';
    contactCanvasCtx.fillText(getInitials(currentContactName), centerX, centerY);
  }

  contactCanvasCtx.fillStyle = '#1c1b1a';
  contactCanvasCtx.font = '600 18px "Space Grotesk", "Segoe UI", sans-serif';
  contactCanvasCtx.textAlign = 'left';
  contactCanvasCtx.textBaseline = 'alphabetic';
  contactCanvasCtx.fillText('Contato', 130, 70);

  contactCanvasCtx.fillStyle = '#6d6a65';
  contactCanvasCtx.font = '14px "Space Grotesk", "Segoe UI", sans-serif';
  contactCanvasCtx.fillText(currentContactName || 'Nao informado', 130, 96);
};

const loadAvatar = (url) => {
  if (!url) {
    avatarImage = null;
    avatarImageUrl = null;
    drawCanvas();
    return;
  }
  if (url === avatarImageUrl && avatarImage) {
    drawCanvas();
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    avatarImage = img;
    avatarImageUrl = url;
    drawCanvas();
  };
  img.onerror = () => {
    avatarImage = null;
    avatarImageUrl = null;
    drawCanvas();
  };
  img.src = url;
};

const setContactName = (name) => {
  if (!contactNameEl) {
    return;
  }
  if (typeof name !== 'string') {
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return;
  }
  currentContactName = trimmed;
  contactNameEl.textContent = trimmed;
  drawCanvas();
};

const setPostMessagePayload = (payload) => {
  if (!postMessageEl) {
    return;
  }
  try {
    postMessageEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    postMessageEl.textContent = String(payload);
  }
};

const setHint = (message) => {
  if (!postMessageHintEl) {
    return;
  }
  postMessageHintEl.textContent = message || '';
};

const setText = (el, value) => {
  if (!el) {
    return;
  }
  if (value === null || value === undefined || value === '') {
    el.textContent = 'Nao informado';
    return;
  }
  if (typeof value === 'object') {
    try {
      el.textContent = JSON.stringify(value);
    } catch (err) {
      el.textContent = String(value);
    }
    return;
  }
  el.textContent = String(value);
};

const extractContactName = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = [
    payload.contact && payload.contact.name,
    payload.contact && payload.contact.full_name,
    payload.contact && payload.contact.fullName,
    payload.contact_name,
    payload.contactName,
    payload.name,
    payload.full_name,
    payload.fullName,
    payload.data && payload.data.contact && payload.data.contact.name,
    payload.data && payload.data.contact && payload.data.contact.full_name,
    payload.data && payload.data.contact && payload.data.contact.fullName,
    payload.payload && payload.payload.contact && payload.payload.contact.name,
    payload.payload && payload.payload.contact && payload.payload.contact.full_name,
    payload.payload && payload.payload.contact && payload.payload.contact.fullName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
};

const readNameFromQuery = () => {
  const params = new URLSearchParams(window.location.search);
  const keys = ['contact_name', 'contactName', 'name', 'full_name', 'fullName'];
  for (const key of keys) {
    const value = params.get(key);
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return null;
};

const pickFirst = (value, fallback) => {
  if (value !== null && value !== undefined && value !== '') {
    return value;
  }
  return fallback;
};

const toNonEmptyString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const s = String(value).trim();
  return s.length ? s : null;
};

const getNested = (root, path) => {
  if (!root) {
    return undefined;
  }
  return path.split('.').reduce((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return acc[key];
  }, root);
};

const normalizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const wrappers = [payload, payload.data, payload.payload, payload.message, payload.detail];
  for (const wrapper of wrappers) {
    if (!wrapper || typeof wrapper !== 'object') {
      continue;
    }
    if (wrapper.contact || wrapper.conversation || wrapper.account || wrapper.inbox) {
      return wrapper;
    }
  }
  return payload;
};

const setKanbanStatus = () => {
  if (!kanbanSyncStatusEl) {
    return;
  }
  const parts = [];
  if (isSyncing) {
    parts.push('Sincronizando...');
  }
  if (lastSyncAt) {
    parts.push(`Ultima sincronizacao: ${new Date(lastSyncAt).toLocaleString()}`);
  }
  kanbanSyncStatusEl.textContent = parts.join(' | ');
};

const setKanbanError = (msg) => {
  if (!kanbanErrorEl) {
    return;
  }
  kanbanErrorEl.textContent = msg || '';
};

const extractContactId = (normalized) => {
  const contact =
    normalized.contact ||
    getNested(normalized, 'data.contact') ||
    getNested(normalized, 'conversation.meta.sender') ||
    {};

  const candidates = [
    contact.id,
    normalized.contact_id,
    getNested(normalized, 'conversation.meta.sender.id'),
    getNested(normalized, 'data.contact_id'),
  ];

  for (const c of candidates) {
    const s = toNonEmptyString(c);
    if (s) {
      return s;
    }
  }
  return null;
};

const extractFunilStage = (normalized) => {
  const contact =
    normalized.contact ||
    getNested(normalized, 'data.contact') ||
    getNested(normalized, 'conversation.meta.sender') ||
    {};

  const candidates = [
    getNested(contact, 'custom_attributes.funil_de_vendas'),
    getNested(normalized, 'custom_attributes.funil_de_vendas'),
    getNested(normalized, 'conversation.meta.sender.custom_attributes.funil_de_vendas'),
    getNested(normalized, 'contact.custom_attributes.funil_de_vendas'),
  ];

  for (const c of candidates) {
    const s = toNonEmptyString(c);
    if (s) {
      return s;
    }
  }
  return null;
};

const upsertKanbanContact = (normalized) => {
  const id = extractContactId(normalized);
  if (!id) {
    return;
  }

  const name = extractContactName(normalized);
  const stageFromPayload = extractFunilStage(normalized);
  const existing = boardState.contacts[id] || {};

  // Prefer server-synced stage; fallback to current payload.
  const stage = stageFromPayload || toNonEmptyString(existing.stage) || 'Sem funil';

  boardState.contacts[id] = {
    id,
    name: toNonEmptyString(name) || existing.name || null,
    stage,
    updatedAt: Date.now(),
  };

  saveBoardState(boardState);
};

const getStageOrderKey = (stage) => {
  const idx = PREFERRED_STAGES.indexOf(String(stage).toLowerCase());
  if (idx !== -1) {
    return `0_${String(idx).padStart(3, '0')}`;
  }
  if (stage === 'Sem funil') {
    return '0_000';
  }
  return `1_${String(stage).toLowerCase()}`;
};

const getStagesFromState = () => {
  const stages = new Set(['Sem funil']);
  for (const id of Object.keys(boardState.contacts || {})) {
    const s = toNonEmptyString(boardState.contacts[id].stage) || 'Sem funil';
    stages.add(s);
  }
  return Array.from(stages).sort((a, b) => {
    const ka = getStageOrderKey(a);
    const kb = getStageOrderKey(b);
    return ka.localeCompare(kb);
  });
};

const matchesFilter = (contact) => {
  if (!kanbanFilter) {
    return true;
  }
  const needle = kanbanFilter.toLowerCase();
  const hay = `${contact.id} ${contact.name || ''} ${contact.stage || ''}`.toLowerCase();
  return hay.includes(needle);
};

const renderKanban = () => {
  if (!kanbanBoardEl) {
    return;
  }

  const stages = getStagesFromState();
  const contacts = Object.values(boardState.contacts || {})
    .filter((c) => c && c.id)
    .filter(matchesFilter)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  kanbanBoardEl.innerHTML = '';

  for (const stage of stages) {
    const col = document.createElement('section');
    col.className = 'col';
    col.setAttribute('data-stage', stage);

    const header = document.createElement('div');
    header.className = 'colHeader';

    const count = contacts.filter((c) => (c.stage || 'Sem funil') === stage).length;
    header.innerHTML = `<p class="colTitle"><strong>${stage}</strong><code>${count}</code></p>`;

    const zone = document.createElement('div');
    zone.className = 'dropzone';
    zone.setAttribute('data-stage', stage);

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const contactId = e.dataTransfer ? e.dataTransfer.getData('text/plain') : null;
      if (!contactId) {
        return;
      }
      if (!boardState.contacts[contactId]) {
        return;
      }
      boardState.contacts[contactId].stage = stage;
      boardState.contacts[contactId].updatedAt = Date.now();
      saveBoardState(boardState);
      renderKanban();
    });

    const stageContacts = contacts.filter((c) => (c.stage || 'Sem funil') === stage);
    if (stageContacts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Vazio';
      zone.appendChild(empty);
    } else {
      for (const c of stageContacts) {
        const card = document.createElement('article');
        card.className = 'cardItem';
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-id', c.id);
        card.addEventListener('dragstart', (e) => {
          if (!e.dataTransfer) {
            return;
          }
          e.dataTransfer.setData('text/plain', c.id);
          e.dataTransfer.effectAllowed = 'move';
        });

        const top = document.createElement('div');
        top.className = 'cardTop';
        const left = document.createElement('strong');
        left.textContent = c.id;
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = 'contact.id';
        top.appendChild(left);
        top.appendChild(pill);

        const name = document.createElement('p');
        name.className = 'cardName';
        name.textContent = c.name || 'Nome nao informado';

        card.appendChild(top);
        card.appendChild(name);
        zone.appendChild(card);
      }
    }

    col.appendChild(header);
    col.appendChild(zone);
    kanbanBoardEl.appendChild(col);
  }
};

const syncContactsFromServer = async () => {
  isSyncing = true;
  setKanbanStatus();
  setKanbanError('');
  try {
    const res = await fetch('/api/contacts');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data && data.error) || `Falha ao buscar contatos (${res.status})`);
    }
    const list = data && Array.isArray(data.contacts) ? data.contacts : [];
    const next = { contacts: {} };
    for (const c of list) {
      if (!c || c.id === null || c.id === undefined) {
        continue;
      }
      const id = String(c.id);
      const stage =
        toNonEmptyString(
          c.custom_attributes &&
            (c.custom_attributes.funil_de_vendas ||
              c.custom_attributes['funil_de_vendas'])
        ) || 'Sem funil';
      next.contacts[id] = {
        id,
        name: toNonEmptyString(c.name) || null,
        stage,
        updatedAt: Date.now(),
      };
    }
    boardState = next;
    saveBoardState(boardState);
    lastSyncAt = Date.now();
  } catch (err) {
    setKanbanError(err && err.message ? err.message : 'Erro ao sincronizar');
  } finally {
    isSyncing = false;
    setKanbanStatus();
    renderKanban();
  }
};

const updateFields = (payload) => {
  const normalized = normalizePayload(payload);
  const contact =
    normalized.contact ||
    getNested(normalized, 'data.contact') ||
    getNested(normalized, 'conversation.meta.sender') ||
    {};
  const conversation =
    normalized.conversation || getNested(normalized, 'data.conversation') || {};
  const account = normalized.account || getNested(normalized, 'data.account') || {};
  const inbox = normalized.inbox || getNested(normalized, 'data.inbox') || {};

  setText(contactIdEl, pickFirst(contact.id, normalized.contact_id));
  setText(contactEmailEl, pickFirst(contact.email, normalized.contact_email));
  setText(
    contactPhoneEl,
    pickFirst(contact.phone_number, normalized.contact_phone_number)
  );
  const avatarUrl = pickFirst(
    contact.avatar_url,
    pickFirst(contact.thumbnail, normalized.contact_avatar_url)
  );
  setText(contactAvatarEl, avatarUrl);
  const avatarString = toNonEmptyString(avatarUrl);
  if (avatarString !== avatarImageUrl) {
    loadAvatar(avatarString);
  }
  setText(conversationIdEl, pickFirst(conversation.id, normalized.conversation_id));
  setText(
    conversationStatusEl,
    pickFirst(conversation.status, normalized.conversation_status)
  );
  setText(
    conversationInboxIdEl,
    pickFirst(conversation.inbox_id, normalized.conversation_inbox_id)
  );
  setText(
    accountIdEl,
    pickFirst(account.id, pickFirst(conversation.account_id, normalized.account_id))
  );
  setText(
    inboxIdEl,
    pickFirst(inbox.id, pickFirst(conversation.inbox_id, normalized.inbox_id))
  );
  setText(
    contactCustomAttributesEl,
    contact.custom_attributes ||
      getNested(normalized, 'conversation.meta.sender.custom_attributes') ||
      normalized.custom_attributes
  );
  setText(
    contactLabelsEl,
    conversation.labels ||
      contact.labels ||
      contact.tags ||
      normalized.labels ||
      normalized.tags
  );
};

  const initialName = readNameFromQuery();
if (initialName) {
  setContactName(initialName);
}

drawCanvas();
renderKanban();
setKanbanStatus();
syncContactsFromServer();

window.addEventListener('message', (event) => {
  if (event.origin && !allowedOrigins.has(event.origin)) {
    setHint(`Ignorando postMessage de ${event.origin}`);
    return;
  }
  if (event.origin) {
    setHint(`Origem: ${event.origin}`);
  }

  let data = event.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      setPostMessagePayload(event.data);
      return;
    }
  }
  setPostMessagePayload(data);
  updateFields(data);
  const normalized = normalizePayload(data);
  upsertKanbanContact(normalized);
  renderKanban();

  const name = extractContactName(data);
  if (name) {
    setContactName(name);
  }
});

pingBtn.addEventListener('click', async () => {
  pingResult.textContent = '...';
  try {
    const res = await fetch('/health');
    pingResult.textContent = res.ok ? 'OK' : 'Falhou';
  } catch (err) {
    pingResult.textContent = 'Erro';
  }
});

if (kanbanSearchEl) {
  kanbanSearchEl.addEventListener('input', (e) => {
    kanbanFilter = (e.target && e.target.value ? String(e.target.value) : '').trim();
    renderKanban();
  });
}

if (clearBoardBtn) {
  clearBoardBtn.addEventListener('click', () => {
    boardState = { contacts: {} };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // ignore
    }
    renderKanban();
  });
}
