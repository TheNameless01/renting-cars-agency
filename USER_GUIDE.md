# USER_GUIDE.md
## Guide d'Utilisation — دليل الاستعمال
### Gestion Agence de Location | تسيير وكالة كراء السيارات

---

### 1. Présentation / تقديم التطبيق
**Gestion Agence de Location** est un progiciel de gestion (ERP) hors-ligne conçu pour les agences de location de voitures de tourisme en Algérie (statut personne physique). Il fonctionne intégralement sans connexion Internet sur Windows 10 et Windows 11.

**تسيير وكالة كراء السيارات** هو نظام تسيير متكامل يعمل دون الحاجة للاتصال بالإنترنت، مخصص لوكالات كراء السيارات السياحية في الجزائر، ويدعم اللغتين الفرنسية والعربية بالكامل.

---

### 2. Premier Démarrage / التشغيل الأول
1. **Création du compte Administrateur (Admin)** : Au tout premier lancement, aucun mot de passe n'est prédéfini. Créez votre compte Administrateur principal (nom d'utilisateur, nom complet, mot de passe sécurisé d'au moins 8 caractères).
   - **إنشاء حساب المدير**: عند التشغيل الأول، قم بإنشاء حساب المدير الرئيسي بكلمة مرور لا تقل عن 8 أحرف.
2. **Configuration de l'Agence** : Ouvrez **Paramètres → Agence** pour renseigner la raison sociale, l'adresse, la wilaya (01 à 69), le téléphone, le NIF, le RC, l'ART et le logo. Ces informations sont requises pour générer des factures conformes.
3. **Langue et Thème** : Basculez instantanément entre **Français (LTR)** et **العربية (RTL)** ainsi qu'entre le mode **Clair** et **Sombre** depuis la barre supérieure.

---

### 3. Flux de Travail Quotidien / سير العمل اليومي
1. **Flotte (Parc Automobile)** : Enregistrez vos véhicules avec leur matricule algérien (`00123-124-16`), kilométrage actuel et dates d'expiration (Assurance, Vignette, Contrôle technique, Carte grise).
2. **Clients** : Enregistrez les particuliers (CNI, Passeport, Permis de conduire) ou les entreprises (RC, NIF, NIS, ART, Bon de commande). Vérifiez les alertes de fiabilité avant toute location.
3. **Nouveau Contrat de Location** :
   - Sélectionnez le client et un véhicule disponible (le système bloque automatiquement tout chevauchement ou véhicule en maintenance).
   - Définissez les dates, le kilométrage inclus, la tarification et le montant de la **caution** (séparée du loyer).
   - Enregistrez le paiement initial (Espèces DZD par défaut, CCP, BaridiMob ou virement).
   - Réalisez l'**État des lieux de départ** (kilométrage, carburant, état des éléments, photos, signatures) puis imprimez le contrat bilingue.
4. **Prolongation & Retour** :
   - Utilisez **Prolonger le contrat** pour conserver l'historique initial tout en recalculant les jours et le kilométrage.
   - Au retour, effectuez l'**État des lieux de retour**, calculez automatiquement les kilomètres supplémentaires et pénalités de retard éventuelles, puis régularisez la caution (restitution ou déduction justifiée).
5. **Caisse Journalière & Finances** :
   - Ouvrez et clôturez la session de caisse chaque jour (rapprochement espèces).
   - Encaissez les loyers (Espèces, CCP, BaridiMob, Virement), gérez les cautions séparément et enregistrez les dépenses avec pièces justificatives chiffrées.
6. **États des lieux & Dommages (`/inspections`)** :
   - Créez un état des lieux **Départ** avant la remise des clés puis un état des lieux **Retour** à la restitution (schéma interactif du véhicule, photos chiffrées AES-256, signatures numériques, export PDF comparatif).
   - Une fois validé (`FINALIZED`), le procès-verbal est verrouillé. Les nouveaux dommages n'entraînent jamais de débit automatique : toute déduction passe explicitement par Finance (Cautions / Paiements).
7. **Maintenance Préventive & Alertes (`/maintenance`)** :
   - Suivez les vidanges, filtres, freins, pneus et échéanciers personnalisés par véhicule. Cochez l'option de blocage véhicule pour empêcher toute location durant l'intervention, téléversez la facture chiffrée et générez au maximum une dépense Finance.
   - Consultez les **Alertes opérationnelles** sur le tableau de bord (documents expirant, retards de maintenance, anomalies compteur, ruptures de stock).
8. **Stock Pièces Détachées & Fournisseurs (`/inventory`)** :
   - Gérez le catalogue des pièces, seuils minimums, achats (avec création optionnelle d'une dépense Finance *Pièces détachées*), sorties/retours atelier et fournisseurs.
   - Lorsqu'une maintenance passe à **Clôturée (`COMPLETED`)**, les pièces sélectionnées sont déduites automatiquement du stock (une seule fois, sans double comptage). L'ajustement manuel d'inventaire est réservé à l'Administrateur.
9. **Documents, Impression & Rapports (`/documents`)** :
   - **Générateur & Archive chiffrée** : Générez 16 types de documents (contrats, avenants, états des lieux départ/retour, constats de dommages, reçus de paiement/caution, factures, justificatifs de dépenses, fiches maintenance, historique véhicule, relevé client, clôture de caisse, synthèses) aux formats **A4 Portrait**, **A4 Paysage**, **Thermique 80 mm** ou **Thermique 58 mm**, en **Français** ou **Arabe (RTL)** avec chiffres latins (`0-9`) ou orientaux (`٠-٩`).
   - **Immutabilité & Copie Certifiée** : Chaque document original est chiffré (AES-256-GCM) et horodaté par SHA-256. La réédition produit une **COPIE CONFORME / نسخة مطابقة** issue de l'instantané figé d'origine, sans jamais altérer le document original ni appliquer de modifications ultérieures du dossier.
   - **Impression directe** : Sur Electron Desktop, sélectionnez vos imprimantes système (A4 ou thermique 58/80 mm) ou utilisez l'aperçu PDF intégré.
   - **Documents Clients & Échéances** : Suivez les dates de validité des pièces d'identité/permis/RC client, remplacez une pièce expirée sans supprimer l'historique et recevez des alertes automatiques.
   - **Rapports Centralisés & Exports (Admin)** : Construisez des rapports **Financiers**, **Flotte**, **Opérationnels** ou **Personnalisés** (avec exclusion explicite des cautions du chiffre d'affaires) et exportez-les en **PDF**, **CSV (UTF-8)** ou **Excel (.xlsx)** sécurisés.

---

### 4. Sauvegarde et Restauration / النسخ الاحتياطي والاسترجاع
- Les sauvegardes automatiques et manuelles utilisent l'API de sauvegarde en ligne SQLite afin de garantir l'intégrité des données sans corruption.
- **Restauration (Admin uniquement)** : Avant toute restauration, le système crée automatiquement une sauvegarde de sécurité de la base actuelle.
