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
5. **Caisse Journalière & Maintenance** :
   - Ouvrez et clôturez la session de caisse chaque jour (rapprochement espèces).
   - Suivez les vidanges et entretiens par kilométrage et par date avec déduction automatique des pièces de rechange en stock.

---

### 4. Sauvegarde et Restauration / النسخ الاحتياطي والاسترجاع
- Les sauvegardes automatiques et manuelles utilisent l'API de sauvegarde en ligne SQLite afin de garantir l'intégrité des données sans corruption.
- **Restauration (Admin uniquement)** : Avant toute restauration, le système crée automatiquement une sauvegarde de sécurité de la base actuelle.
