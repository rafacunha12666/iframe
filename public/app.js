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

const allowedOrigins = new Set([
  'https://app.chatwoot.com',
]);

let currentContactName = 'Nao informado';
let currentAvatarUrl = null;
let avatarImage = null;
let avatarImageUrl = null;

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
    contactCanvasCtx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
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
  setText(
    contactAvatarEl,
    pickFirst(
      contact.avatar_url,
      pickFirst(contact.thumbnail, normalized.contact_avatar_url)
    )
  );
  currentAvatarUrl = pickFirst(
    contact.avatar_url,
    pickFirst(contact.thumbnail, normalized.contact_avatar_url)
  );
  loadAvatar(currentAvatarUrl);
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
