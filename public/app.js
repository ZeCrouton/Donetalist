'use strict';
// Donetalist : interface sans étape de build. Tout le texte saisi passe par textContent (pas d'injection HTML).

const app = document.getElementById('app');
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const base = location.origin + location.pathname;
const shareUrl = (t) => `${base}#/l/${t}`;
const adminUrl = (t) => `${base}#/a/${t}`;

// ---------- Outils ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const store = {
  get(k, d) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ }
  },
};

async function api(path, { method = 'GET', body, admin } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (admin) headers['x-admin-token'] = admin;
  let r;
  try {
    r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Connexion impossible. Vérifiez votre réseau et réessayez.'), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue.'), { status: r.status });
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3800);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Lien copié.'); }
  catch { window.prompt('Copiez ce lien :', text); }
}

// Boutons pour s'envoyer le lien d'administration (messagerie, WhatsApp, SMS, partage du téléphone).
function sendAdminLink(title, url) {
  const msg = `Mon lien d’administration Donetalist pour « ${title} ». Gardez-le : il permet de modifier la liste depuis n’importe quel appareil.`;
  return h('div', { class: 'row' },
    h('a', { class: 'btn small', href: 'mailto:?subject=' + encodeURIComponent('Mon lien Donetalist : ' + title) + '&body=' + encodeURIComponent(msg + '\n' + url) }, 'M’envoyer par e-mail'),
    h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(msg + ' ' + url) }, 'WhatsApp'),
    h('a', { class: 'btn ghost small', href: 'sms:?&body=' + encodeURIComponent(msg + ' ' + url) }, 'SMS'),
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => copy(url) }, 'Copier'),
    navigator.share ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => navigator.share({ title, text: msg, url }).catch(() => {}) }, 'Autres applications') : null);
}

// Ouvre une liste à partir d'un lien collé (lien d'administration ou de partage).
function openByLink(value) {
  const v = String(value || '').trim();
  const m = v.match(/#\/(l|a)\/([\w-]{20,})/) || v.match(/^()([\w-]{20,})$/);
  if (!m) return false;
  location.hash = `#/${m[1] || 'a'}/${m[2]}`;
  return true;
}

function formDialog({ title, fields, submit, onSubmit }) {
  const dlg = h('dialog');
  const err = h('p', { class: 'err', role: 'alert' });
  const form = h('form', { method: 'dialog' },
    h('h2', null, title),
    fields.map((f) => h('label', { class: 'fld' },
      h('span', null, f.label),
      f.type === 'textarea'
        ? h('textarea', { name: f.name, rows: 3, maxlength: f.len || 500 }, f.value || '')
        : h('input', {
            name: f.name, type: f.type || 'text', value: f.value ?? '', required: !!f.required, maxlength: f.len,
            min: f.min, max: f.maxnum, step: f.step, autocomplete: f.autocomplete || 'off', placeholder: f.placeholder,
          }),
      f.hint ? h('small', null, f.hint) : null)),
    err,
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Annuler'),
      h('button', { type: 'submit', class: 'btn' }, submit)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    err.textContent = '';
    try { await onSubmit(Object.fromEntries(new FormData(form))); dlg.close(); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  });
  const af = fields.find((f) => f.autofill);
  if (af) {
    const input = form.elements[af.name];
    const note = h('small', { class: 'autonote' });
    input.after(note);
    let last = '';
    const run = async () => {
      const url = input.value.trim();
      if (!url || url === last) return;
      last = url;
      note.textContent = 'Lecture du lien…';
      try { note.textContent = (await af.autofill(url, form)) || ''; }
      catch (x) { note.textContent = x.message; }
    };
    input.addEventListener('change', run);
    input.addEventListener('paste', () => setTimeout(run, 0));
  }
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  form.querySelector('input,textarea')?.focus();
}

const EVENTS = {
  christmas: { label: 'Noël', icon: '🎄', theme: 'christmas' },
  birthday: { label: 'Anniversaire', icon: '🎂', theme: 'birthday' },
  wedding: { label: 'Mariage', icon: '💍', theme: 'wedding' },
  birth: { label: 'Naissance', icon: '🍼', theme: 'birth' },
  baptism: { label: 'Baptême', icon: '🕊️', theme: 'baptism' },
  custom: { label: 'Autre événement', icon: '✨', theme: 'custom' },
};
const eventTitle = (type, name, second, date) => {
  if (type === 'christmas') return `Noël ${new Date().getFullYear()}`;
  if (type === 'birthday') return `Anniversaire de ${name}`;
  if (type === 'wedding') return `Mariage de ${name} et ${second}`;
  if (type === 'birth') return `Naissance de ${name}`;
  if (type === 'baptism') return `Baptême de ${name}`;
  return name;
};
function setTheme(type) { document.documentElement.dataset.theme = EVENTS[type]?.theme || 'custom'; }
const topbar = () => h('div', { class: 'topbar' },
  h('a', { class: 'brand', href: '#/' }, '✨ Donetalist'),
  h('a', { class: 'btn ghost small navbtn', href: '#/' }, 'Accueil'));
const pic = (url) =>
  h('div', { class: 'pic' }, url
    ? h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith('🎁') })
    : '🎁');
const plural = (n, s, p) => (n > 1 ? p : s);

function progress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = h('i');
  requestAnimationFrame(() => (fill.style.width = pct + '%'));
  return h('div', { class: 'progress' }, h('div', { class: 'bar' }, fill),
    h('small', null, total ? `${done} sur ${total} ${plural(total, 'cadeau réservé', 'cadeaux réservés')}` : 'Aucun cadeau pour le moment'));
}

// ---------- Routage ----------
const state = { adminToken: null, reveal: false, just: null, filter: null };

async function route() {
  const m = location.hash.match(/^#\/(l|a)\/([\w-]{20,})$/);
  window.scrollTo(0, 0);
  try {
    if (!m) return home();
    if (m[1] === 'l') { if (state.shareToken !== m[2]) { state.shareToken = m[2]; state.filter = null; } return await visitor(m[2]); }
    if (state.adminToken !== m[2]) { state.adminToken = m[2]; state.reveal = false; }
    return await admin(m[2]);
  } catch (e) {
    const gone = e.status === 404 || e.status === 401;
    let msg = e.message;
    if (gone && m) {
      // Liste supprimée (peut-être depuis un autre appareil) : on la retire de « Mes listes ».
      const all = store.get('noel.lists', []);
      const rest = all.filter((l) => (m[1] === 'a' ? l.admin : l.share) !== m[2]);
      if (rest.length !== all.length) {
        store.set('noel.lists', rest);
        msg = 'Cette liste n’existe plus : elle a sans doute été supprimée depuis un autre appareil. Elle a été retirée de « Mes listes ».';
      }
    }
    app.replaceChildren(h('div', { class: 'wrap center' },
      h('h1', null, gone ? 'Liste introuvable' : 'Oups'),
      h('p', null, msg),
      h('a', { class: 'btn', href: '#/' }, 'Retour à l’accueil')));
  }
}
window.addEventListener('hashchange', route);
route();

// ---------- Accueil ----------
function home() {
  document.title = 'Donetalist';
  setTheme('custom');
  const mine = store.get('noel.lists', []);
  let selected = 'christmas';
  const details = h('div', { class: 'event-fields' });
  const err = h('p', { class: 'err', role: 'alert' });
  const cards = h('div', { class: 'event-picker', role: 'group', 'aria-label': 'Type d’événement' });
  const renderDetails = () => {
    details.replaceChildren();
    const type = selected;
    if (type === 'birthday') details.append(h('label', { class: 'fld' }, h('span', null, 'Anniversaire de'), h('input', { name: 'event_name', required: true, maxlength: 100, placeholder: 'Prénom ou nom' })));
    if (type === 'wedding') details.append(
      h('label', { class: 'fld' }, h('span', null, 'Nom de la première personne'), h('input', { name: 'event_name', required: true, maxlength: 80, placeholder: 'Prénom' })),
      h('label', { class: 'fld' }, h('span', null, 'Nom de la deuxième personne'), h('input', { name: 'event_second_name', required: true, maxlength: 80, placeholder: 'Prénom' })));
    if (type === 'birth' || type === 'baptism') details.append(h('label', { class: 'fld' }, h('span', null, type === 'birth' ? 'Naissance de' : 'Baptême de'), h('input', { name: 'event_name', required: true, maxlength: 100, placeholder: 'Prénom ou nom' })));
    if (type === 'custom') details.append(h('label', { class: 'fld' }, h('span', null, 'Nom de votre événement'), h('input', { name: 'event_name', required: true, maxlength: 120, placeholder: 'Ex. : Pendaison de crémaillère' })));
    if (type !== 'christmas') details.append(h('label', { class: 'fld' }, h('span', null, 'Date de l’événement (facultative)'), h('input', { name: 'event_date', type: 'date' }), h('small', null, 'Vous pourrez la renseigner ou la modifier plus tard.')));
    else details.append(h('p', { class: 'event-hint' }, 'La période de Noël est automatiquement définie. Aucune date à saisir.'));
  };
  Object.entries(EVENTS).forEach(([key, ev]) => {
    const b = h('button', { type: 'button', class: 'event-choice' + (key === selected ? ' selected' : ''), 'aria-pressed': String(key === selected), onclick: () => {
      selected = key;
      [...cards.children].forEach((c) => { c.classList.toggle('selected', c.dataset.type === key); c.setAttribute('aria-pressed', String(c.dataset.type === key)); });
      renderDetails();
    } }, h('span', { class: 'event-icon' }, ev.icon), h('b', null, ev.label));
    b.dataset.type = key;
    cards.append(b);
  });
  renderDetails();
  const form = h('form', null,
    h('h2', null, 'Quel événement souhaitez-vous célébrer ?'),
    h('p', { class: 'muted' }, 'Choisissez une occasion : son univers graphique s’adaptera automatiquement.'),
    cards, details, err,
    h('button', { class: 'btn', type: 'submit' }, 'Créer ma liste'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; err.textContent = '';
    const fd = new FormData(form);
    const name = String(fd.get('event_name') || '').trim();
    const second = String(fd.get('event_second_name') || '').trim();
    if (selected === 'wedding' && (!name || !second)) { err.textContent = 'Indiquez les deux noms pour le mariage.'; btn.disabled = false; return; }
    if (selected !== 'christmas' && !name) { err.textContent = 'Indiquez le nom de la personne ou de l’événement.'; btn.disabled = false; return; }
    const title = eventTitle(selected, name, second);
    try {
      const event_date = String(fd.get('event_date') || '');
      const payload = { title, event_type: selected, event_name: name, event_second_name: second, event_date };
      const r = await api('/lists', { method: 'POST', body: payload });
      store.set('noel.lists', [{ title, admin: r.admin_token, share: r.share_token }, ...mine]);
      location.hash = `#/a/${r.admin_token}`;
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  });
  const openErr = h('p', { class: 'err', role: 'alert' });
  const openInput = h('input', { type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'Collez votre lien d’administration', 'aria-label': 'Lien d’administration à ouvrir' });
  const openForm = h('form', { onsubmit: (e) => {
    e.preventDefault();
    openErr.textContent = openByLink(openInput.value) ? '' : 'Ce lien n’est pas valide. Collez le lien complet reçu à la création de la liste.';
  } },
    h('div', { class: 'linkbox' }, openInput, h('button', { class: 'btn', type: 'submit' }, 'Ouvrir')),
    openErr);
  app.replaceChildren(
    h('header', { class: 'band' }, h('div', { class: 'wrap' }, topbar(),
      h('h1', null, 'Toutes vos envies, tous vos événements.'),
      h('p', null, 'Créez une liste de cadeaux et partagez-la avec vos proches en un simple lien. Ils réservent sans créer de compte.'))),
    h('main', { class: 'wrap home' }, h('section', { class: 'panel' }, form),
      h('section', { class: 'mine' }, h('h2', null, 'Retrouver une liste'),
        h('p', { class: 'muted' }, 'Vous avez déjà créé une liste, sur un autre appareil par exemple ? Collez ici son lien d’administration pour la retrouver et la gérer.'),
        openForm),
      mine.length ? h('section', { class: 'mine' }, h('h2', null, 'Mes listes'), h('ul', null, mine.map((l) => h('li', null, h('span', null, l.title), h('a', { class: 'btn ghost small', href: `#/a/${l.admin}` }, 'Gérer'))))) : null));
  pruneDeadLists(mine);
}

// Retire de « Mes listes » celles qui n'existent plus sur le serveur (supprimées depuis un autre appareil).
async function pruneDeadLists(mine) {
  if (!mine.length) return;
  const gone = new Set();
  await Promise.all(mine.map(async (l) => {
    try { await api('/lists/' + l.share); } catch (e) { if (e.status === 404) gone.add(l.admin); }
  }));
  if (!gone.size) return;
  store.set('noel.lists', store.get('noel.lists', []).filter((l) => !gone.has(l.admin)));
  if (!location.hash || location.hash === '#/' || location.hash === '#') home();
}

// ---------- Vue visiteur ----------
async function visitor(share) {
  const data = await api('/lists/' + share);
  const mine = store.get('noel.cancel.' + share, {});
  const { list, gifts } = data;
  setTheme(list.event_type);
  document.title = `${list.title} – Donetalist`;
  const wanted = gifts.reduce((n, g) => n + g.quantity_wanted, 0);
  const done = gifts.reduce((n, g) => n + Math.min(g.reserved, g.quantity_wanted), 0);
  const people = [...new Set(gifts.map((g) => g.recipient).filter(Boolean))];
  if (state.filter && !people.includes(state.filter)) state.filter = null;
  const shown = state.filter ? gifts.filter((g) => g.recipient === state.filter) : gifts;

  const card = (g) => {
    const remaining = g.quantity_wanted - g.reserved;
    const full = remaining <= 0;
    return h('article', { class: 'tag' + (full ? ' done' : '') + (g.reservations.some((r) => r.id === state.just) ? ' just' : '') },
      pic(g.image_url),
      h('div', { class: 'body' },
        g.recipient ? h('p', { class: 'for' }, 'Pour ', h('b', null, g.recipient)) : null,
        h('h3', null, g.name),
        g.price != null ? h('p', { class: 'price' }, eur.format(g.price)) : null,
        g.description ? h('p', { class: 'desc' }, g.description) : null,
        g.shop_url ? h('a', { class: 'shop', href: g.shop_url, target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur le site marchand') : null,
        g.quantity_wanted > 1 ? h('p', { class: 'qty' }, `${g.reserved} sur ${g.quantity_wanted} réservé${plural(g.reserved, '', 's')}`) : null,
        g.reservations.map((r) => {
          const own = !!mine[r.id];
          if (!own && !r.name) return null;
          return h('p', { class: 'who' },
            h('span', null, 'Réservé par ', h('b', null, own ? 'vous' : r.name), r.quantity > 1 ? ` (×${r.quantity})` : ''),
            own ? h('button', { class: 'btn ghost small danger', onclick: () => cancelMine(share, r.id, mine[r.id]) }, 'Annuler') : null);
        }),
        !full && list.open
          ? h('div', { class: 'act' }, h('button', { class: 'btn', onclick: () => reserve(share, g, remaining) }, 'Réserver'))
          : null),
      full ? h('div', { class: 'stamp', 'aria-hidden': 'true' }, 'Réservé') : null);
  };

  app.replaceChildren(
    h('header', { class: 'band' }, h('div', { class: 'wrap' }, topbar(),
      h('span', { class: 'ev-icon', 'aria-hidden': 'true' }, EVENTS[list.event_type]?.icon || '✨'),
      h('h1', null, list.title),
      list.event_date ? h('p', { class: 'event-date' }, '📅 ' + new Date(list.event_date + 'T12:00:00').toLocaleDateString('fr-FR', { dateStyle: 'long' })) : null,
      h('p', null, 'Choisissez un cadeau et cliquez sur « Réserver » : seuls votre prénom et votre nom sont demandés.'),
      progress(done, wanted))),
    h('main', { class: 'wrap' },
      !list.open ? h('p', { class: 'notice' },
        list.closed ? 'Cette liste est clôturée : les réservations sont fermées.' : 'La date limite est passée : les réservations sont fermées.') : null,
      people.length > 1 ? h('div', { class: 'filters', role: 'group', 'aria-label': 'Filtrer par personne' },
        [null, ...people].map((p) => h('button', {
          class: 'fchip', 'aria-pressed': String((state.filter || null) === p),
          onclick: () => { state.filter = p; route(); },
        }, p || 'Tous'))) : null,
      shown.length ? h('div', { class: 'grid' }, shown.map(card))
        : h('div', { class: 'center' }, h('p', null, 'Cette liste ne contient pas encore de cadeau. Revenez bientôt.'))));
  state.just = null;
}

function reserve(share, g, remaining) {
  const me = store.get('noel.me', {});
  formDialog({
    title: `Réserver « ${g.name} »`,
    submit: 'Confirmer la réservation',
    fields: [
      { name: 'first_name', label: 'Prénom', required: true, len: 60, value: me.first_name, autocomplete: 'given-name' },
      { name: 'last_name', label: 'Nom', required: true, len: 60, value: me.last_name, autocomplete: 'family-name' },
      ...(remaining > 1 ? [{ name: 'quantity', label: 'Nombre d’exemplaires', type: 'number', value: 1, min: 1, maxnum: remaining, required: true }] : []),
    ],
    onSubmit: async (v) => {
      try {
        const r = await api(`/lists/${share}/gifts/${g.id}/reserve`, {
          method: 'POST',
          body: { first_name: v.first_name, last_name: v.last_name, quantity: Number(v.quantity) || 1 },
        });
        store.set('noel.me', { first_name: v.first_name, last_name: v.last_name });
        const c = store.get('noel.cancel.' + share, {});
        c[r.reservation_id] = r.cancel_token;
        store.set('noel.cancel.' + share, c);
        state.just = r.reservation_id;
        toast('C’est réservé. Merci !');
        route();
      } catch (e) {
        if (e.status === 409) { document.querySelector('dialog')?.close(); toast(e.message); route(); return; }
        throw e;
      }
    },
  });
}

async function cancelMine(share, reservationId, cancelToken) {
  if (!confirm('Annuler votre réservation ? Le cadeau redeviendra disponible pour les autres.')) return;
  try {
    await api('/reservations/cancel', { method: 'POST', body: { reservation_id: reservationId, cancel_token: cancelToken } });
    const c = store.get('noel.cancel.' + share, {});
    delete c[reservationId];
    store.set('noel.cancel.' + share, c);
    toast('Réservation annulée.');
  } catch (e) { toast(e.message); }
  route();
}

// ---------- Vue propriétaire ----------
async function admin(token) {
  const data = await api('/admin' + (state.reveal ? '?reveal=1' : ''), { admin: token });
  const { list, gifts, summary } = data;
  state.eventType = list.event_type;
  setTheme(list.event_type);
  document.title = `Gérer – ${list.title}`;
  // Liste ouverte depuis un lien sur un autre appareil : on la mémorise ici dans « Mes listes ».
  const known = store.get('noel.lists', []);
  if (!known.some((l) => l.admin === token)) store.set('noel.lists', [{ title: list.title, admin: token, share: list.share_token }, ...known]);
  const link = shareUrl(list.share_token);
  const msg = `Voici ma liste de cadeaux pour ${list.title}. Vous pouvez y réserver un cadeau sans créer de compte :`;
  const patch = async (body) => {
    try { await api('/admin', { method: 'PATCH', body, admin: token }); } catch (e) { toast(e.message); }
    route();
  };

  const opt = (label, hint, checked, onchange, disabled = false) => h('label', { class: 'opt' },
    h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onchange(e.target.checked) }),
    h('span', null, label, h('small', null, hint)));

  const giftRow = (g) => h('div', { class: 'agift' },
    pic(g.image_url),
    h('div', null,
      h('h3', null, g.name),
      h('p', { class: 'meta' }, [g.recipient ? `Pour ${g.recipient}` : null, g.price != null ? eur.format(g.price) : null, g.quantity_wanted > 1 ? `${g.quantity_wanted} exemplaires` : null].filter(Boolean).join(' · ') || 'Prix non indiqué'),
      data.revealed ? h('div', null,
        h('span', { class: 'chip' + (g.reserved ? ' warn' : '') }, g.reserved ? `${g.reserved} réservé${plural(g.reserved, '', 's')}` : 'Disponible'),
        (g.reservations || []).map((r) => h('p', { class: 'who' }, h('span', null, r.name + (r.quantity > 1 ? ` (×${r.quantity})` : '')),
          h('button', { class: 'btn ghost small danger', onclick: async () => {
            if (!confirm(`Annuler la réservation de ${r.name} ?`)) return;
            try { await api(`/admin/reservations/${r.id}/cancel?reveal=1`, { method: 'POST', admin: token }); toast('Réservation annulée.'); } catch (e) { toast(e.message); }
            route();
          } }, 'Annuler')))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: () => giftForm(token, g) }, 'Modifier'),
        h('button', { class: 'btn ghost small danger', onclick: async () => {
          if (!confirm(`Supprimer « ${g.name} » ? Les réservations éventuelles seront aussi supprimées.`)) return;
          try { await api('/admin/gifts/' + g.id, { method: 'DELETE', admin: token }); } catch (e) { toast(e.message); }
          route();
        } }, 'Supprimer'))));

  app.replaceChildren(
    h('header', { class: 'band' }, h('div', { class: 'wrap' }, topbar(),
      h('span', { class: 'ev-icon', 'aria-hidden': 'true' }, EVENTS[list.event_type]?.icon || '✨'),
      h('h1', null, list.title),
      list.event_date ? h('p', { class: 'event-date' }, '📅 ' + new Date(list.event_date + 'T12:00:00').toLocaleDateString('fr-FR', { dateStyle: 'long' })) : null,
      h('p', null, list.status === 'closed' ? 'Liste clôturée : plus aucune réservation possible.' : 'Gérez vos cadeaux et partagez le lien avec vos proches.'),
      progress(summary.units_reserved, summary.units_wanted))),
    h('main', { class: 'wrap admin' },
      h('div', { class: 'notice' },
        h('b', null, 'Gardez votre lien d’administration. '),
        'C’est le seul moyen de retrouver et modifier cette liste, notamment depuis un autre téléphone ou ordinateur. Envoyez-le-vous maintenant :',
        sendAdminLink(list.title, adminUrl(token))),
      h('section', { class: 'card' }, h('h2', null, 'Partager la liste'),
        h('div', { class: 'linkbox' },
          h('input', { readonly: true, value: link, 'aria-label': 'Lien de partage', onfocus: (e) => e.target.select() }),
          h('button', { class: 'btn', onclick: () => copy(link) }, 'Copier le lien')),
        h('div', { class: 'row', style: null },
          h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(msg + ' ' + link) }, 'WhatsApp'),
          h('a', { class: 'btn ghost small', href: 'sms:?&body=' + encodeURIComponent(msg + ' ' + link) }, 'SMS'),
          h('a', { class: 'btn ghost small', href: 'mailto:?subject=' + encodeURIComponent('Donetalist') + '&body=' + encodeURIComponent(msg + '\n' + link) }, 'E-mail'),
          navigator.share ? h('button', { class: 'btn ghost small', onclick: () => navigator.share({ title: list.title, text: msg, url: link }).catch(() => {}) }, 'Autres applications') : null)),
      h('section', { class: 'card' }, h('h2', null, 'Vos cadeaux'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => giftForm(token, null) }, 'Ajouter un cadeau')),
        gifts.length ? gifts.map(giftRow) : h('p', null, 'Votre liste est vide. Ajoutez un premier cadeau pour commencer.'),
        !data.revealed
          ? h('p', { class: 'notice' }, 'Mode surprise : ', summary.units_reserved, ' réservation', plural(summary.units_reserved, '', 's'),
              ' sur ', summary.units_wanted, '. Les détails restent cachés. ',
              h('button', { class: 'btn ghost small', onclick: () => {
                if (!confirm('Voir qui a réservé quoi peut gâcher la surprise. Continuer ?')) return;
                state.reveal = true; route();
              } }, 'Voir qui a réservé'))
          : h('p', { class: 'notice' }, 'Les réservations sont affichées. ',
              h('button', { class: 'btn ghost small', onclick: () => { state.reveal = false; route(); } }, 'Masquer de nouveau'))),
      h('section', { class: 'card' }, h('h2', null, 'Réglages'),
        opt('Mode surprise', 'Vous ne voyez pas le détail des réservations, et les visiteurs ne voient pas qui a réservé.', list.surprise_mode, (v) => patch({ surprise_mode: v })),
        opt('Afficher les noms aux visiteurs', 'Les visiteurs voient qui a réservé quoi. Indisponible tant que le mode surprise est activé.', list.show_reserver_names, (v) => patch({ show_reserver_names: v }), list.surprise_mode),
        opt('Clôturer la liste', 'Plus aucune réservation n’est possible. Décochez pour rouvrir.', list.status === 'closed', (v) => patch({ status: v ? 'closed' : 'open' })),
        h('label', { class: 'fld' }, h('span', null, 'Date limite de réservation (facultative)'),
          h('input', { type: 'date', value: list.deadline || '', onchange: (e) => patch({ deadline: e.target.value }) })),
        h('div', { class: 'row' },
          list.event_type !== 'christmas' ? h('button', { class: 'btn ghost small', onclick: () => eventForm(token, list) }, 'Modifier l’événement') : null,
          h('button', { class: 'btn ghost small', onclick: () => renameForm(token, list.title) }, 'Renommer la liste'))),
      h('section', { class: 'card validate' }, h('h2', null, 'Valider la liste'),
        h('p', null, 'Votre liste est prête ? Validez-la pour revenir à l’accueil, où elle apparaît dans « Mes listes ».'),
        h('button', { class: 'btn', onclick: () => { location.hash = '#/'; toast('Liste créée. Retrouvez-la dans « Mes listes ».'); } }, 'Valider la liste')),
      h('section', { class: 'card' }, h('h2', null, 'Supprimer la liste'),
        h('p', null, 'Efface définitivement la liste, ses cadeaux et toutes les réservations, y compris les noms des personnes qui ont réservé. Cette action est irréversible.'),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!confirm('Supprimer définitivement cette liste et toutes ses réservations ?')) return;
          try {
            await api('/admin', { method: 'DELETE', admin: token });
            store.set('noel.lists', store.get('noel.lists', []).filter((l) => l.admin !== token));
            toast('Liste supprimée.');
            location.hash = '#/';
          } catch (e) { toast(e.message); }
        } }, 'Supprimer définitivement la liste')),
      h('section', { class: 'card' }, h('h2', null, 'Votre lien d’administration'),
        h('p', null, 'Ce lien est le seul moyen de modifier la liste : gardez-le précieusement et ne le partagez pas. Il est mémorisé sur cet appareil, dans « Mes listes ». Pour la retrouver ailleurs, collez-le dans « Retrouver une liste » sur la page d’accueil.'),
        h('div', { class: 'linkbox' },
          h('input', { readonly: true, value: adminUrl(token), 'aria-label': 'Lien d’administration', onfocus: (e) => e.target.select() }),
          h('button', { class: 'btn ghost', onclick: () => copy(adminUrl(token)) }, 'Copier')))));
}

function giftForm(token, g) {
  formDialog({
    title: g ? 'Modifier le cadeau' : 'Ajouter un cadeau',
    submit: g ? 'Enregistrer' : 'Ajouter à la liste',
    fields: [
      { name: 'shop_url', label: 'Lien vers le site marchand (facultatif)', type: 'url', len: 2000, value: g?.shop_url,
        hint: 'Collez le lien du produit : le nom, l’image et le prix sont remplis automatiquement quand le site le permet.',
        autofill: async (url, form) => {
          const r = await api('/admin/preview?url=' + encodeURIComponent(url), { admin: token });
          if (!r.found) return r.reason || 'Rien trouvé : remplissez les champs à la main.';
          const set = (n, v) => { const el = form.elements[n]; if (el && v && !el.value.trim()) el.value = v; };
          set('name', r.title); set('image_url', r.image); set('price', r.price);
          return 'Champs remplis. Vérifiez-les avant d’enregistrer.';
        } },
      { name: 'name', label: 'Nom du cadeau', required: true, len: 120, value: g?.name },
      ...(state.eventType === 'christmas' ? [{ name: 'recipient', label: 'Pour qui ? Prénom (facultatif)', len: 40, value: g?.recipient, hint: 'Laissez vide si le cadeau est pour tout le monde.' }] : []),
      { name: 'description', label: 'Description (facultatif)', type: 'textarea', len: 500, value: g?.description },
      { name: 'image_url', label: 'Adresse d’une image (facultatif)', type: 'url', len: 2000, value: g?.image_url, hint: 'Rempli automatiquement si possible. Sinon : clic droit sur l’image du produit, puis « Copier l’adresse de l’image ».' },
      { name: 'price', label: 'Prix indicatif en euros (facultatif)', type: 'number', min: 0, step: '0.01', value: g?.price },
      { name: 'quantity_wanted', label: 'Nombre d’exemplaires souhaités', type: 'number', min: 1, maxnum: 99, required: true, value: g?.quantity_wanted ?? 1 },
    ],
    onSubmit: async (v) => {
      await api(g ? '/admin/gifts/' + g.id : '/admin/gifts', {
        method: g ? 'PUT' : 'POST', admin: token,
        body: { ...v, price: v.price === '' ? null : Number(v.price), quantity_wanted: Number(v.quantity_wanted) || 1 },
      });
      toast(g ? 'Cadeau modifié.' : 'Cadeau ajouté.');
      route();
    },
  });
}

function eventForm(token, list) {
  const type = list.event_type || 'christmas';
  const fields = [];
  if (type === 'custom') fields.push({ name: 'event_name', label: 'Nom de l’événement', required: true, len: 120, value: list.event_name });
  else if (type === 'wedding') {
    fields.push({ name: 'event_name', label: 'Nom de la première personne', required: true, len: 80, value: list.event_name });
    fields.push({ name: 'event_second_name', label: 'Nom de la deuxième personne', required: true, len: 80, value: list.event_second_name });
  } else if (type !== 'christmas') fields.push({ name: 'event_name', label: 'Nom / prénom', required: true, len: 100, value: list.event_name });
  if (type !== 'christmas') fields.push({ name: 'event_date', label: 'Date de l’événement (facultative)', type: 'date', value: list.event_date || '' });
  formDialog({ title: 'Modifier les informations de l’événement', submit: 'Enregistrer', fields,
    onSubmit: async (v) => {
      const second = v.event_second_name || '';
      const title = eventTitle(type, v.event_name || '', second);
      await api('/admin', { method: 'PATCH', admin: token, body: { event_name: v.event_name || '', event_second_name: second, event_date: v.event_date || '', title } });
      store.set('noel.lists', store.get('noel.lists', []).map((l) => (l.admin === token ? { ...l, title } : l)));
      toast('Événement mis à jour.');
      route();
    },
  });
}

function renameForm(token, title) {
  formDialog({
    title: 'Renommer la liste', submit: 'Enregistrer',
    fields: [{ name: 'title', label: 'Nom de la liste', required: true, len: 120, value: title }],
    onSubmit: async (v) => {
      await api('/admin', { method: 'PATCH', body: { title: v.title }, admin: token });
      const all = store.get('noel.lists', []).map((l) => (l.admin === token ? { ...l, title: v.title.trim() } : l));
      store.set('noel.lists', all);
      route();
    },
  });
}
