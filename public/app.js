const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');
const contactNameEl = document.getElementById('contactName');
const postMessageEl = document.getElementById('postMessagePayload');

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

const initialName = readNameFromQuery();
if (initialName) {
  setContactName(initialName);
}

window.addEventListener('message', (event) => {
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
