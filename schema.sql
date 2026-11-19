CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'christmas' CHECK (event_type IN ('christmas','birthday','wedding','birth','baptism','custom')),
  event_name TEXT,
  event_second_name TEXT,
  event_date TEXT,
  share_token TEXT NOT NULL UNIQUE,
  admin_token_hash TEXT NOT NULL UNIQUE,
  admin_token_enc TEXT,
  welcome_message TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  surprise_mode INTEGER NOT NULL DEFAULT 1,
  show_reserver_names INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  recipient TEXT,
  image_url TEXT,
  shop_url TEXT,
  price REAL,
  quantity_wanted INTEGER NOT NULL DEFAULT 1 CHECK (quantity_wanted >= 1),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gifts_list ON gifts(list_id, position);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  gift_id TEXT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  cancel_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_res_gift ON reservations(gift_id, cancelled_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Photos ajoutees par les utilisateurs (JPEG redimensionne cote navigateur, stocke en base64 dans D1 : gratuit, sans R2).
CREATE TABLE IF NOT EXISTS gift_images (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_img_list ON gift_images(list_id);
