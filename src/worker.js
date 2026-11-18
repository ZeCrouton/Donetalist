// Donetalist : API multi-événements (Cloudflare Workers + D1), sans dépendance.

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = () => b64url(crypto.getRandomValues(new Uint8Array(24))); // 192 bits
const sha = async (s) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const validDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });
const fail = (status, error) => json({ error }, status);

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const httpUrl = (v) => {
  const s = clean(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};
const readJson = async (request) => {
  const t = await request.text();
  if (t.length > 20000) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, u);
    } catch (e) {
      console.error(e);
      return fail(500, 'Erreur du serveur. Réessayez dans un instant.');
    }
  },
  // Tâche quotidienne (cron) : purge des données périmées.
  async scheduled(event, env) {
    await purge(env);
  },
};

// ---------- Limitation de débit (compteurs dans D1, IP stockée uniquement sous forme de hash) ----------
async function limited(request, env, name, max, windowSec) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const r = await env.DB.prepare(
    `INSERT INTO rate_limits (key, n, expires_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n`
  )
    .bind(`${name}:${await sha(ip)}:${bucket}`, Date.now() + windowSec * 2000)
    .first();
  return r.n > max;
}
const tooMany = () => fail(429, 'Trop de tentatives en peu de temps. Patientez quelques minutes puis réessayez.');

// ---------- Rétention : listes sans activité depuis 18 mois, réservations annulées > 30 jours ----------
async function purge(env) {
  const stale = new Date(Date.now() - 548 * 86400000).toISOString();
  const month = new Date(Date.now() - 30 * 86400000).toISOString();
  const oldLists = 'SELECT id FROM lists WHERE updated_at < ?1';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservations WHERE gift_id IN (SELECT id FROM gifts WHERE list_id IN (${oldLists}))`).bind(stale),
    env.DB.prepare(`DELETE FROM gifts WHERE list_id IN (${oldLists})`).bind(stale),
    env.DB.prepare('DELETE FROM lists WHERE updated_at < ?1').bind(stale),
    env.DB.prepare('DELETE FROM reservations WHERE cancelled_at IS NOT NULL AND cancelled_at < ?1').bind(month),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1').bind(Date.now()),
  ]);
}

const touchList = (env, listId) =>
  env.DB.prepare('UPDATE lists SET updated_at = ?1 WHERE id = ?2').bind(now(), listId).run();

async function route(request, env, u) {
  const p = u.pathname;
  const m = request.method;
  let x;

  // ---- Public (visiteurs, sans compte) ----
  if (p === '/api/lists' && m === 'POST') return createList(request, env);
  if ((x = p.match(/^\/api\/lists\/([\w-]+)$/)) && m === 'GET') return publicList(env, x[1]);
  if ((x = p.match(/^\/api\/lists\/([\w-]+)\/gifts\/([\w-]+)\/reserve$/)) && m === 'POST')
    return reserve(request, env, x[1], x[2]);
  if (p === '/api/reservations/cancel' && m === 'POST') return cancelOwn(request, env);

  // ---- Administration (jeton dans l'en-tête X-Admin-Token) ----
  if (p.startsWith('/api/admin')) {
    const list = await adminList(request, env);
    if (!list) return fail(401, 'Lien d’administration invalide.');
    const reveal = u.searchParams.get('reveal') === '1';
    if (p === '/api/admin' && m === 'GET') return adminView(env, list, reveal);
    if (p === '/api/admin' && m === 'PATCH') return patchList(request, env, list);
    if (p === '/api/admin' && m === 'DELETE') return deleteList(env, list);
    if (p === '/api/admin/gifts' && m === 'POST') return saveGift(request, env, list, null);
    if ((x = p.match(/^\/api\/admin\/gifts\/([\w-]+)$/))) {
      if (m === 'PUT') return saveGift(request, env, list, x[1]);
      if (m === 'DELETE') return deleteGift(env, list, x[1]);
    }
    if ((x = p.match(/^\/api\/admin\/reservations\/([\w-]+)\/cancel$/)) && m === 'POST')
      return adminCancel(env, list, x[1], reveal);
  }
  return fail(404, 'Introuvable.');
}

// ---------- Listes ----------

async function createList(request, env) {
  if (await limited(request, env, 'create', 5, 3600)) return tooMany();
  const b = await readJson(request);
  const event_type = clean(b?.event_type, 20) || 'christmas';
  const allowed = ['christmas', 'birthday', 'wedding', 'birth', 'baptism', 'custom'];
  if (!allowed.includes(event_type)) return fail(400, 'Type d’événement invalide.');
  const event_name = clean(b?.event_name, event_type === 'custom' ? 120 : 100);
  const event_second_name = clean(b?.event_second_name, 80);
  const event_date = event_type === 'christmas' ? null : (clean(b?.event_date, 10) || null);
  if (event_type !== 'christmas' && !event_name) return fail(400, 'Indiquez le nom de la personne ou de l’événement.');
  if (event_type === 'wedding' && !event_second_name) return fail(400, 'Indiquez les deux noms pour le mariage.');
  if (event_date && !validDate(event_date)) return fail(400, 'Date de l’événement invalide.');
  const year = new Date().getFullYear();
  const title = event_type === 'christmas' ? `Noël ${year}` : event_type === 'birthday' ? `Anniversaire de ${event_name}` : event_type === 'wedding' ? `Mariage de ${event_name} et ${event_second_name}` : event_type === 'birth' ? `Naissance de ${event_name}` : event_type === 'baptism' ? `Baptême de ${event_name}` : event_name;
  if (!title) return fail(400, 'Donnez un nom à votre liste.');
  const share = token();
  const admin = token();
  const t = now();
  await env.DB.prepare(
    'INSERT INTO lists (id, title, event_type, event_name, event_second_name, event_date, share_token, admin_token_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)'
  )
    .bind(crypto.randomUUID(), title, event_type, event_name || null, event_second_name || null, event_date, share, await sha(admin), t)
    .run();
  return json({ share_token: share, admin_token: admin }, 201);
}

async function loadGifts(env, listId) {
  const gifts = (
    await env.DB.prepare('SELECT * FROM gifts WHERE list_id = ?1 ORDER BY position, created_at').bind(listId).all()
  ).results;
  const res = (
    await env.DB.prepare(
      `SELECT r.id, r.gift_id, r.first_name, r.last_name, r.quantity
       FROM reservations r JOIN gifts g ON g.id = r.gift_id
       WHERE g.list_id = ?1 AND r.cancelled_at IS NULL ORDER BY r.created_at`
    )
      .bind(listId)
      .all()
  ).results;
  const byGift = new Map();
  for (const r of res) {
    if (!byGift.has(r.gift_id)) byGift.set(r.gift_id, []);
    byGift.get(r.gift_id).push(r);
  }
  return gifts.map((g) => {
    const rs = byGift.get(g.id) || [];
    return { ...g, _res: rs, reserved: rs.reduce((n, r) => n + r.quantity, 0) };
  });
}

const giftBase = (g) => ({
  id: g.id,
  name: g.name,
  description: g.description,
  recipient: g.recipient,
  image_url: g.image_url,
  shop_url: g.shop_url,
  price: g.price,
  quantity_wanted: g.quantity_wanted,
});

async function publicList(env, share) {
  const l = await env.DB.prepare('SELECT * FROM lists WHERE share_token = ?1').bind(share).first();
  if (!l) return fail(404, 'Cette liste est introuvable. Vérifiez le lien que vous avez reçu.');
  // Les noms ne sortent que si le mode surprise est désactivé ET que l'affichage est choisi.
  const showNames = !!l.show_reserver_names && !l.surprise_mode;
  const gifts = (await loadGifts(env, l.id)).map((g) => ({
    ...giftBase(g),
    reserved: g.reserved,
    reservations: g._res.map((r) => ({
      id: r.id,
      quantity: r.quantity,
      ...(showNames ? { name: `${r.first_name} ${r.last_name}` } : {}),
    })),
  }));
  return json({
    list: {
      title: l.title,
      event_type: l.event_type || 'christmas',
      event_name: l.event_name || '',
      event_second_name: l.event_second_name || '',
      event_date: l.event_date || null,
      open: l.status === 'open' && !(l.deadline && l.deadline < today()),
      closed: l.status !== 'open',
      deadline: l.deadline,
    },
    gifts,
  });
}

// ---------- Réservation (atomique) ----------
// Une seule requête SQL conditionnelle : la réservation n'est insérée que s'il reste
// assez d'exemplaires. D1 exécute les écritures une par une : deux visiteurs qui cliquent
// en même temps ne peuvent pas réserver le même exemplaire.
async function reserve(request, env, share, giftId) {
  if (await limited(request, env, 'reserve', 20, 600)) return tooMany();
  const b = await readJson(request);
  const first = clean(b?.first_name, 60);
  const last = clean(b?.last_name, 60);
  const qty = Number.isInteger(b?.quantity) ? b.quantity : 1;
  if (!first || !last) return fail(400, 'Indiquez votre prénom et votre nom.');
  if (qty < 1 || qty > 99) return fail(400, 'Nombre d’exemplaires invalide.');

  const cancelToken = token();
  const id = crypto.randomUUID();
  const r = await env.DB.prepare(
    `INSERT INTO reservations (id, gift_id, first_name, last_name, quantity, cancel_token_hash, created_at)
     SELECT ?1, g.id, ?2, ?3, ?4, ?5, ?6
     FROM gifts g JOIN lists l ON l.id = g.list_id
     WHERE g.id = ?7 AND l.share_token = ?8 AND l.status = 'open'
       AND (l.deadline IS NULL OR l.deadline >= ?9)
       AND ?4 + (SELECT COALESCE(SUM(x.quantity), 0) FROM reservations x
                 WHERE x.gift_id = g.id AND x.cancelled_at IS NULL) <= g.quantity_wanted`
  )
    .bind(id, first, last, qty, await sha(cancelToken), now(), giftId, share, today())
    .run();

  if (r.meta.changes === 1) {
    await env.DB.prepare('UPDATE lists SET updated_at = ?1 WHERE share_token = ?2').bind(now(), share).run();
    return json({ reservation_id: id, cancel_token: cancelToken }, 201);
  }

  const info = await env.DB.prepare(
    'SELECT l.status, l.deadline FROM gifts g JOIN lists l ON l.id = g.list_id WHERE g.id = ?1 AND l.share_token = ?2'
  )
    .bind(giftId, share)
    .first();
  if (!info) return fail(404, 'Cadeau introuvable.');
  if (info.status !== 'open' || (info.deadline && info.deadline < today()))
    return fail(409, 'Les réservations sont fermées pour cette liste.');
  return fail(409, 'Ce cadeau vient d’être réservé par quelqu’un d’autre. La liste a été actualisée.');
}

async function cancelOwn(request, env) {
  if (await limited(request, env, 'cancel', 20, 600)) return tooMany();
  const b = await readJson(request);
  const id = clean(b?.reservation_id, 80);
  const tok = clean(b?.cancel_token, 80);
  if (!id || !tok) return fail(400, 'Requête invalide.');
  const r = await env.DB.prepare(
    "UPDATE reservations SET cancelled_at = ?1, first_name = '', last_name = '' WHERE id = ?2 AND cancel_token_hash = ?3 AND cancelled_at IS NULL"
  )
    .bind(now(), id, await sha(tok))
    .run();
  return r.meta.changes === 1 ? json({ ok: true }) : fail(404, 'Cette réservation est déjà annulée ou introuvable.');
}

// ---------- Administration ----------

async function adminList(request, env) {
  const t = request.headers.get('x-admin-token');
  if (!t || t.length > 80) return null;
  return env.DB.prepare('SELECT * FROM lists WHERE admin_token_hash = ?1').bind(await sha(t)).first();
}

async function adminView(env, l, reveal) {
  const all = await loadGifts(env, l.id);
  const gifts = all.map((g) => ({
    ...giftBase(g),
    // Sans « reveal », aucun détail de réservation ne quitte le serveur : la surprise est préservée.
    ...(reveal
      ? {
          reserved: g.reserved,
          reservations: g._res.map((r) => ({ id: r.id, quantity: r.quantity, name: `${r.first_name} ${r.last_name}` })),
        }
      : {}),
  }));
  return json({
    list: {
      title: l.title,
      event_type: l.event_type || 'christmas',
      event_name: l.event_name || '',
      event_second_name: l.event_second_name || '',
      event_date: l.event_date || null,
      status: l.status,
      surprise_mode: !!l.surprise_mode,
      show_reserver_names: !!l.show_reserver_names,
      deadline: l.deadline,
      share_token: l.share_token,
    },
    summary: {
      units_wanted: all.reduce((n, g) => n + g.quantity_wanted, 0),
      units_reserved: all.reduce((n, g) => n + Math.min(g.reserved, g.quantity_wanted), 0),
    },
    revealed: reveal,
    gifts,
  });
}

async function patchList(request, env, l) {
  const b = await readJson(request);
  if (!b) return fail(400, 'Requête invalide.');
  const sets = [];
  const vals = [];
  const add = (col, v) => {
    vals.push(v);
    sets.push(`${col} = ?${vals.length}`);
  };
  if ('title' in b) {
    const t = clean(b.title, 120);
    if (!t) return fail(400, 'Le nom de la liste ne peut pas être vide.');
    add('title', t);
  }
  if ('event_name' in b) add('event_name', clean(b.event_name, 120) || null);
  if ('event_second_name' in b) add('event_second_name', clean(b.event_second_name, 80) || null);
  if ('event_date' in b) {
    if (b.event_date && !validDate(b.event_date)) return fail(400, 'Date de l’événement invalide.');
    add('event_date', b.event_date || null);
  }
  if ('surprise_mode' in b) add('surprise_mode', b.surprise_mode ? 1 : 0);
  if ('show_reserver_names' in b) add('show_reserver_names', b.show_reserver_names ? 1 : 0);
  if ('status' in b) {
    if (b.status !== 'open' && b.status !== 'closed') return fail(400, 'Statut invalide.');
    add('status', b.status);
  }
  if ('deadline' in b) {
    if (b.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(b.deadline)) return fail(400, 'Date invalide.');
    add('deadline', b.deadline || null);
  }
  if (!sets.length) return fail(400, 'Rien à modifier.');
  add('updated_at', now());
  vals.push(l.id);
  await env.DB.prepare(`UPDATE lists SET ${sets.join(', ')} WHERE id = ?${vals.length}`).bind(...vals).run();
  return json({ ok: true });
}

function giftFields(b) {
  const name = clean(b?.name, 120);
  if (!name) return { error: 'Donnez un nom au cadeau.' };
  let price = null;
  if (b.price !== null && b.price !== undefined && b.price !== '') {
    price = Number(b.price);
    if (!Number.isFinite(price) || price < 0 || price > 1e6) return { error: 'Prix invalide.' };
  }
  const q = b.quantity_wanted === undefined ? 1 : Number(b.quantity_wanted);
  if (!Number.isInteger(q) || q < 1 || q > 99) return { error: 'Quantité invalide (1 à 99).' };
  return {
    name,
    description: clean(b.description, 500) || null,
    recipient: clean(b.recipient, 40) || null,
    image_url: httpUrl(b.image_url),
    shop_url: httpUrl(b.shop_url),
    price,
    quantity_wanted: q,
  };
}

async function saveGift(request, env, l, giftId) {
  const f = giftFields(await readJson(request));
  if (f.error) return fail(400, f.error);
  // Le champ « Pour qui » n'a de sens que pour Noël.
  const recipient = l.event_type === 'christmas' ? f.recipient : null;
  if (!giftId) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO gifts (id, list_id, name, description, image_url, shop_url, price, quantity_wanted, position, created_at, recipient)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
         (SELECT COALESCE(MAX(position), 0) + 1 FROM gifts WHERE list_id = ?2), ?9, ?10)`
    )
      .bind(id, l.id, f.name, f.description, f.image_url, f.shop_url, f.price, f.quantity_wanted, now(), recipient)
      .run();
    await touchList(env, l.id);
    return json({ id }, 201);
  }
  const booked = await env.DB.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS n FROM reservations WHERE gift_id = ?1 AND cancelled_at IS NULL'
  )
    .bind(giftId)
    .first();
  if (booked && booked.n > f.quantity_wanted)
    return fail(409, 'Des exemplaires sont déjà réservés : la quantité ne peut pas passer en dessous.');
  const r = await env.DB.prepare(
    `UPDATE gifts SET name = ?1, description = ?2, image_url = ?3, shop_url = ?4, price = ?5, quantity_wanted = ?6, recipient = ?9
     WHERE id = ?7 AND list_id = ?8`
  )
    .bind(f.name, f.description, f.image_url, f.shop_url, f.price, f.quantity_wanted, giftId, l.id, recipient)
    .run();
  if (r.meta.changes !== 1) return fail(404, 'Cadeau introuvable.');
  await touchList(env, l.id);
  return json({ ok: true });
}

async function deleteGift(env, l, giftId) {
  const own = await env.DB.prepare('SELECT id FROM gifts WHERE id = ?1 AND list_id = ?2').bind(giftId, l.id).first();
  if (!own) return fail(404, 'Cadeau introuvable.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE gift_id = ?1').bind(giftId),
    env.DB.prepare('DELETE FROM gifts WHERE id = ?1').bind(giftId),
  ]);
  return json({ ok: true });
}

async function adminCancel(env, l, reservationId, reveal) {
  // Annuler la réservation d'un autre suppose d'avoir levé le mode surprise.
  if (!reveal) return fail(403, 'Affichez d’abord les réservations pour pouvoir en annuler une.');
  const r = await env.DB.prepare(
    `UPDATE reservations SET cancelled_at = ?1, first_name = '', last_name = ''
     WHERE id = ?2 AND cancelled_at IS NULL
       AND gift_id IN (SELECT id FROM gifts WHERE list_id = ?3)`
  )
    .bind(now(), reservationId, l.id)
    .run();
  return r.meta.changes === 1 ? json({ ok: true }) : fail(404, 'Réservation introuvable.');
}

// Droit à l'effacement : le propriétaire supprime sa liste, ses cadeaux et toutes les réservations.
async function deleteList(env, l) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE gift_id IN (SELECT id FROM gifts WHERE list_id = ?1)').bind(l.id),
    env.DB.prepare('DELETE FROM gifts WHERE list_id = ?1').bind(l.id),
    env.DB.prepare('DELETE FROM lists WHERE id = ?1').bind(l.id),
  ]);
  return json({ ok: true });
}
