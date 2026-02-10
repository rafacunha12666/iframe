const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refresh');

const toNonEmptyString = (v) => {
  if (v === null || v === undefined) {
    return null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
};

const normalizeStage = (v) => toNonEmptyString(v) || 'Sem funil';

const stageColorClass = (stage) => {
  const s = String(stage || '').toLowerCase();
  if (s.includes('novo') || s.includes('backlog') || s.includes('inicial')) return 'c1';
  if (s.includes('analise') || s.includes('qual') || s.includes('doing')) return 'c2';
  if (s.includes('proposta') || s.includes('review') || s.includes('negoci')) return 'c3';
  if (s.includes('ganh') || s.includes('done') || s.includes('assin')) return 'c4';
  if (s.includes('perdid')) return 'c5';
  return 'c0';
};

const groupByStage = (contacts) => {
  const map = new Map();
  for (const c of contacts) {
    const stage = normalizeStage(
      c &&
        c.custom_attributes &&
        (c.custom_attributes.funil_de_vendas || c.custom_attributes['funil_de_vendas'])
    );
    if (!map.has(stage)) {
      map.set(stage, []);
    }
    map.get(stage).push(c);
  }
  return map;
};

const render = (contacts) => {
  if (!boardEl) return;

  const grouped = groupByStage(contacts);
  const stages = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

  boardEl.innerHTML = '';

  for (const stage of stages) {
    const col = document.createElement('section');
    col.className = 'col';

    const header = document.createElement('div');
    header.className = `colHeader ${stageColorClass(stage)}`;
    header.innerHTML = `<div class="colTitle"><span>${stage}</span><span class="count">${grouped.get(stage).length}</span></div>`;

    const list = document.createElement('div');
    list.className = 'colBody';

    const items = grouped.get(stage).slice().sort((a, b) => {
      const an = toNonEmptyString(a && a.name) || '';
      const bn = toNonEmptyString(b && b.name) || '';
      return an.localeCompare(bn);
    });

    for (const c of items) {
      const id = toNonEmptyString(c && c.id);
      if (!id) continue;
      const name = toNonEmptyString(c && c.name) || 'Sem nome';

      const card = document.createElement('article');
      card.className = 'card';

      const title = document.createElement('div');
      title.className = 'cardName';
      title.textContent = name;

      const meta = document.createElement('div');
      meta.className = 'cardMeta';
      meta.textContent = `#${id}`;

      card.appendChild(title);
      card.appendChild(meta);
      list.appendChild(card);
    }

    col.appendChild(header);
    col.appendChild(list);
    boardEl.appendChild(col);
  }
};

const setStatus = (msg) => {
  if (!statusEl) return;
  statusEl.textContent = msg || '';
};

const setError = (msg) => {
  if (!errorEl) return;
  errorEl.textContent = msg || '';
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
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    render(contacts);
    setStatus(`Atualizado: ${new Date().toLocaleString()} | Total: ${contacts.length}`);
  } catch (err) {
    setError(err && err.message ? err.message : 'Falha ao carregar');
    setStatus('');
    render([]);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
};

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => load());
}

load();

