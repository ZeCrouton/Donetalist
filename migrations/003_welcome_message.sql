-- Message d'accueil en tete de liste (deploy.ps1 l'applique ; echoue sans danger si la colonne existe deja)
ALTER TABLE lists ADD COLUMN welcome_message TEXT;
