# Donetalist

Application de listes de cadeaux partageables par lien, utilisable toute l'année : Noël, anniversaire, mariage, naissance, baptême ou événement libre. Les proches peuvent réserver sans créer de compte.

## Fonctionnalités

- Création sans compte et liens séparés de partage et d'administration.
- Bouton « Accueil » sur chaque page et confirmation « Liste créée » après validation.
- Six types d'événements avec identité graphique dédiée : Noël, anniversaire, mariage, naissance, baptême et événement libre.
- Formulaires adaptés au type choisi : nom de la personne, deux noms pour un mariage ou intitulé libre.
- Date de l'événement facultative pour tous les événements sauf Noël (qui utilise automatiquement l'année en cours).
- Modification des informations et de la date depuis l'administration.
- Date limite de réservation indépendante de la date de l'événement.
- Ajout de cadeaux, quantités, prix, images, liens marchands et bénéficiaires.
- Réservations atomiques, mode surprise, annulation sécurisée et clôture.
- Interface sans dépendance ni étape de build.

## Déploiement Cloudflare

Prérequis : Node.js 18+ et un compte Cloudflare.

```bash
cd donetalist
npx wrangler login
npx wrangler d1 create donetalist
```

Copiez le `database_id` retourné dans `wrangler.toml`, à la place de `REMPLACER_PAR_VOTRE_ID`, puis initialisez la base :

```bash
npx wrangler d1 execute donetalist --remote --file=schema.sql
npx wrangler deploy
```

L'URL du Worker et du site sera affichée par Wrangler. Les fichiers statiques du dossier `public/` sont servis par le binding Assets.

## Essayer en local

Après avoir configuré le `database_id` :

```bash
npx wrangler d1 execute donetalist --local --file=schema.sql
npx wrangler dev
```

## Sécurité et données

- Jetons aléatoires de 192 bits pour le partage et l'administration ; seul le hash du jeton d'administration est stocké.
- Mode surprise activé par défaut : les visiteurs ne voient pas qui a réservé, et le propriétaire ne voit le détail des réservations qu'après l'avoir demandé explicitement.
- L'affichage des noms aux visiteurs est désactivé par défaut et n'a d'effet que si le mode surprise est désactivé.
- Le champ « Pour qui » n'est proposé que pour Noël.
- Les réservations sont effectuées par une requête SQL conditionnelle pour éviter les doubles réservations concurrentes.
- Limitation de débit pour les créations, réservations et annulations.
- Les noms saisis sont affichés via `textContent`/création de nœuds, pas injectés comme HTML.
- Les URL d'images et de boutiques sont limitées à HTTP(S).
- Annuler une réservation efface le prénom et le nom ; le propriétaire peut supprimer la liste.
- Purge quotidienne des listes inactives depuis 18 mois, réservations annulées anciennes et compteurs périmés.

Avant une mise en ligne publique, remplacez les coordonnées entre crochets dans `public/confidentialite.html` par votre nom/pseudonyme et une adresse de contact.

## Structure

- `public/index.html` : page d'entrée
- `public/app.js` : interface, formulaires, navigation et thèmes
- `public/style.css` : design responsive et palettes événementielles
- `src/worker.js` : API Cloudflare Worker
- `schema.sql` : schéma D1 complet pour une nouvelle installation
- `wrangler.toml` : configuration Cloudflare à compléter avec votre identifiant D1

## Mise à jour d'une installation existante

Les listes déjà créées gardent leurs réglages. Pour que les noms restent masqués aux visiteurs sur les anciennes listes, exécutez une fois :

```bash
npx wrangler d1 execute donetalist --remote --command="UPDATE lists SET show_reserver_names = 0"
```
