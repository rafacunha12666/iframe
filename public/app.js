const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refresh');
const filterEl = document.getElementById('filter');

const STORAGE_COL_ORDER = 'kanban_col_order_v1';

const toNonEmptyString = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const normalizeStage = (v) => toNonEmptyString(v) || 'Sem funil';

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

const LABEL_COLORS = {
  analise: '#FBAF0C',
  assinatura: '#D82DFB',
  contato_inicial: '#3E7FD0',
  fundo_de_funil: '#EDF654',
  negociacao: '#C0BABA',
  venda_ganha: '#10B636',
  venda_perdida: '#0F0F0F',
  sem_funil: '#C0BABA',
};

const isDarkColor = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Relative luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.45;
};

const readColOrder = () => {
  try {
    const raw = localStorage.getItem(STORAGE_COL_ORDER);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch (err) {
    return [];
  }
};

const writeColOrder = (order) => {
  try {
    localStorage.setItem(STORAGE_COL_ORDER, JSON.stringify(order));
  } catch (err) {
    // ignore
  }
};

let contactsState = [];
let filterQuery = '';
let colOrder = readColOrder();
const expandedIds = new Set();
const pendingIds = new Set();

const setStatus = (msg) => {
  if (!statusEl) return;
  statusEl.textContent = msg || '';
};

const setError = (msg) => {
  if (!errorEl) return;
  errorEl.textContent = msg || '';
};

const getChatIds = (c) => {
  const ids = [];
  const identifier = toNonEmptyString(c && c.identifier);
  if (identifier) ids.push(identifier);

  const inboxes = Array.isArray(c && c.contact_inboxes) ? c.contact_inboxes : [];
  for (const ci of inboxes) {
    const sid = toNonEmptyString(ci && ci.source_id);
    if (sid) ids.push(sid);
  }
  return ids;
};

const matchesFilter = (c) => {
  if (!filterQuery) return true;
  const q = filterQuery.toLowerCase();
  const id = toNonEmptyString(c && c.id) || '';
  const name = toNonEmptyString(c && c.name) || '';
  const phone = toNonEmptyString(c && c.phone_number) || '';
  const email = toNonEmptyString(c && c.email) || '';
  const chatIds = getChatIds(c).join(' ');
  const hay = `${id} ${name} ${phone} ${email} ${chatIds}`.toLowerCase();
  return hay.includes(q);
};

const groupByStage = (contacts) => {
  const map = new Map();
  for (const c of contacts) {
    const stage = normalizeStage(
      c &&
        c.custom_attributes &&
        (c.custom_attributes.funil_de_vendas || c.custom_attributes['funil_de_vendas'])
    );
    if (!map.has(stage)) map.set(stage, []);
    map.get(stage).push(c);
  }
  return map;
};

const computeStageList = (grouped) => {
  const stages = Array.from(grouped.keys());
  const ordered = [];
  const remaining = new Set(stages);

  for (const s of colOrder) {
    if (remaining.has(s)) {
      ordered.push(s);
      remaining.delete(s);
    }
  }

  const rest = Array.from(remaining).sort((a, b) => a.localeCompare(b));
  return ordered.concat(rest);
};

const setContactStageLocal = (contactId, stage) => {
  const idStr = String(contactId);
  for (const c of contactsState) {
    if (String(c && c.id) === idStr) {
      if (!c.custom_attributes || typeof c.custom_attributes !== 'object') {
        c.custom_attributes = {};
      }
      c.custom_attributes.funil_de_vendas = stage;
      break;
    }
  }
};

const moveContactServer = async (contactId, stage) => {
  const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/move`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body && body.error ? body.error : `Erro (${res.status})`);
  }
  return body;
};

const render = () => {
  if (!boardEl) return;

  const visible = contactsState.filter(matchesFilter);
  const grouped = groupByStage(visible);
  const stages = computeStageList(grouped);

  // Ensure persisted order doesn't grow forever.
  if (stages.length) {
    const nextOrder = stages.slice();
    colOrder = nextOrder;
    writeColOrder(colOrder);
  }

  boardEl.innerHTML = '';

  for (const stage of stages) {
    const list = grouped.get(stage) || [];

    const col = document.createElement('section');
    col.className = 'col';
    col.setAttribute('data-stage', stage);

    const header = document.createElement('div');
    header.className = 'colHeader';
    header.setAttribute('data-stage', stage);
    header.setAttribute('draggable', 'true');
    const slug = toLabelSlug(stage);
    const color = LABEL_COLORS[slug] || 'rgba(255, 255, 255, 0.25)';
    header.style.setProperty('--col-bg', color);
    header.style.setProperty('--col-fg', isDarkColor(color) ? '#fff' : '#0b0d10');
    if (isDarkColor(color)) {
      header.classList.add('colDark');
    }
    header.innerHTML = `<div class="colTitle"><span>${stage}</span><span class="count">${list.length}</span></div>`;

    const body = document.createElement('div');
    body.className = 'colBody';
    body.setAttribute('data-stage', stage);

    // Column reordering (drag header).
    header.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData('text/x-kanban-col', stage);
      e.dataTransfer.effectAllowed = 'move';
    });
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      header.classList.add('colOver');
    });
    header.addEventListener('dragleave', () => header.classList.remove('colOver'));
    header.addEventListener('drop', (e) => {
      e.preventDefault();
      header.classList.remove('colOver');
      const from = e.dataTransfer ? e.dataTransfer.getData('text/x-kanban-col') : '';
      if (!from || from === stage) return;
      const next = colOrder.slice();
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(stage);
      if (fromIdx === -1 || toIdx === -1) return;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      colOrder = next;
      writeColOrder(colOrder);
      render();
    });

    // Card dropping (move stage).
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('dropOver');
    });
    body.addEventListener('dragleave', () => body.classList.remove('dropOver'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('dropOver');

      const contactId = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      const fromStage = e.dataTransfer ? e.dataTransfer.getData('text/x-kanban-from') : '';
      if (!contactId) return;
      if (normalizeStage(fromStage) === normalizeStage(stage)) return;
      if (pendingIds.has(contactId)) return;

      pendingIds.add(contactId);
      const previous = normalizeStage(fromStage);
      setContactStageLocal(contactId, stage);
      setStatus(`Atualizando #${contactId} para "${stage}"...`);
      setError('');
      render();

      try {
        await fetch(`/api/contacts/${encodeURIComponent(contactId)}/move`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage, previousStage: fromStage }),
        }).then(async (r) => {
          const b = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(b && b.error ? b.error : `Erro (${r.status})`);
          }
          return b;
        });
        setStatus(`Atualizado: ${new Date().toLocaleString()}`);
      } catch (err) {
        setContactStageLocal(contactId, previous === 'Sem funil' ? null : previous);
        setError(err && err.message ? err.message : 'Falha ao atualizar');
        setStatus('');
      } finally {
        pendingIds.delete(contactId);
        render();
      }
    });

    // Cards
    const items = list.slice().sort((a, b) => {
      const an = toNonEmptyString(a && a.name) || '';
      const bn = toNonEmptyString(b && b.name) || '';
      return an.localeCompare(bn);
    });

    for (const c of items) {
      const id = toNonEmptyString(c && c.id);
      if (!id) continue;
      const name = toNonEmptyString(c && c.name) || 'Sem nome';
      const resumo =
        (c &&
          c.custom_attributes &&
          (c.custom_attributes.resumo_paty || c.custom_attributes['resumo_paty'])) ||
        '';

      const card = document.createElement('article');
      card.className = `card${expandedIds.has(id) ? ' expanded' : ''}${
        pendingIds.has(id) ? ' pending' : ''
      }`;
      card.setAttribute('draggable', 'true');
      card.setAttribute('data-id', id);
      card.setAttribute('data-stage', stage);

      card.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.setData('text/x-kanban-from', stage);
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('click', () => {
        if (expandedIds.has(id)) expandedIds.delete(id);
        else expandedIds.add(id);
        render();
      });

      const title = document.createElement('div');
      title.className = 'cardName';
      title.textContent = name;

      const meta = document.createElement('div');
      meta.className = 'cardMeta';
      meta.textContent = `#${id}`;

      const details = document.createElement('div');
      details.className = 'cardDetails';

      const label = document.createElement('div');
      label.className = 'cardDetailsLabel';
      label.textContent = 'resumo_paty';

      const text = document.createElement('p');
      text.className = 'cardDetailsText';
      text.textContent = toNonEmptyString(resumo) || '(vazio)';

      details.appendChild(label);
      details.appendChild(text);

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(details);
      body.appendChild(card);
    }

    col.appendChild(header);
    col.appendChild(body);
    boardEl.appendChild(col);
  }
};

const load = async () => {
  setError('');
  setStatus('Carregando contatos...');
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const res = await fetch('/api/contacts');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body && body.error ? body.error : `Erro (${res.status})`);
    }
    contactsState = Array.isArray(body.contacts) ? body.contacts : [];
    render();
    setStatus(
      `Atualizado: ${new Date().toLocaleString()} | Total: ${contactsState.length}`
    );
  } catch (err) {
    contactsState = [];
    render();
    setError(err && err.message ? err.message : 'Falha ao carregar');
    setStatus('');
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
};

if (refreshBtn) refreshBtn.addEventListener('click', () => load());
if (filterEl) {
  filterEl.addEventListener('input', (e) => {
    filterQuery = e && e.target ? String(e.target.value || '').trim() : '';
    render();
  });
}

load();
