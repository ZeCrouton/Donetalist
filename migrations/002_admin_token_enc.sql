-- Une seule fois, sur une base existante (deploy.ps1 ne le fait pas) :
-- npx wrangler d1 execute donetalist --remote --command "ALTER TABLE lists ADD COLUMN admin_token_enc TEXT"
ALTER TABLE lists ADD COLUMN admin_token_enc TEXT;
