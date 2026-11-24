# Notes de version — Gestion Agence de Location v1.0.0

## Nouveautés & Durcissement de Production (Phase 6)

- **Durabilité SQLite maximale** : journal WAL activé avec `PRAGMA synchronous = FULL`, vérification d’intégrité à l’ouverture sans écrasement silencieux, et fermeture propre avec `wal_checkpoint(TRUNCATE)`.
- **Sauvegardes chiffrées complètes (`.agbkp`)** : capture transactionnelle à chaud via l’API SQLite Online Backup (`db.backup`) incluant l’ensemble des pièces chiffrées du coffre documentaire (contrats PDF, pièces clients, photos d’état des lieux, factures, logo).
- **Double protection cryptographique** : chiffrement AES-256-GCM par clé de récupération du coffre (`AGL-RK1-...`) ou par phrase secrète dédiée, avec vérification structurelle et référentielle automatique après création.
- **Restauration atomique avec retour arrière** : vérification complète préalable, création automatique d’une sauvegarde `PRE_RESTORE` de l’état actuel, migration ascendante automatique si l’archive provient d’une version antérieure, et restauration/rollback automatique en cas d’erreur.
- **Planificateur quotidien & export USB** : sauvegardes automatiques journalières avec rétention configurable, export/import vers clé USB ou disque externe.
- **Protection matérielle & sessions** : protection de la clé du coffre via Windows DPAPI (`safeStorage`), verrouillage automatique d’inactivité synchronisé serveur/client, limitation et audit des tentatives de déverrouillage, validation binaire par signature magique de tous les fichiers importés.
- **Sécurité du shell Electron** : CSP stricte hors-ligne, DevTools désactivés en production, blocage des fenêtres externes et webviews.

## Mise à niveau & Conservation des données

- L’installeur Windows NSIS (`perMachine: false`, `deleteAppDataOnUninstall: false`) met uniquement à jour les binaires de l’application.
- Vos données (`%APPDATA%\Gestion Agence de Location\data\agency_erp.db`, `secure_vault\`, `backups\`) restent intactes lors d’une mise à jour ou d’une désinstallation.
- Avant toute nouvelle migration SQL sur une base existante, une copie de sécurité `PRE_MIGRATION` est créée automatiquement.

## Note sur les dépendances (Audit sécurité)

- La dépendance `exceljs@4.4.0` utilisée uniquement hors-ligne pour la génération locale de classeurs `.xlsx` embarque transitivement `uuid@8.3.2`. Ce composant n’est pas exposé à des données réseau ou des identifiants de session (les jetons et clés AES utilisent exclusivement `node:crypto.randomBytes`).
