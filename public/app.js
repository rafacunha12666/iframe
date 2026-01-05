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

const allowedOrigins = new Set([
  'https://app.chatwoot.com',
]);

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
  contactNameEl.textContent = trimmed;
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

const updateFields = (payload) => {
  const normalized = normalizePayload(payload);
  const contact = normalized.contact || getNested(normalized, 'data.contact') || {};
  const conversation = normalized.conversation || getNested(normalized, 'data.conversation') || {};
  const account = normalized.account || getNested(normalized, 'data.account') || {};
  const inbox = normalized.inbox || getNested(normalized, 'data.inbox') || {};

  setText(contactIdEl, pickFirst(contact.id, normalized.contact_id));
  setText(contactEmailEl, pickFirst(contact.email, normalized.contact_email));
  setText(contactPhoneEl, pickFirst(contact.phone_number, normalized.contact_phone_number));
  setText(contactAvatarEl, pickFirst(contact.avatar_url, normalized.contact_avatar_url));
  setText(conversationIdEl, pickFirst(conversation.id, normalized.conversation_id));
  setText(conversationStatusEl, pickFirst(conversation.status, normalized.conversation_status));
  setText(conversationInboxIdEl, pickFirst(conversation.inbox_id, normalized.conversation_inbox_id));
  setText(accountIdEl, pickFirst(account.id, normalized.account_id));
  setText(inboxIdEl, pickFirst(inbox.id, normalized.inbox_id));
  setText(contactCustomAttributesEl, contact.custom_attributes || normalized.custom_attributes);
  setText(contactLabelsEl, contact.labels || contact.tags || normalized.labels || normalized.tags);
};

const initialName = readNameFromQuery();
if (initialName) {
  setContactName(initialName);
}

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
