-- ============================================================================
-- Migration 002: Editable 69-Wilaya Reference (2026 Division) + RBAC & Settings Seeds
-- ============================================================================

CREATE TABLE IF NOT EXISTS wilayas (
  code TEXT PRIMARY KEY,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  is_newly_created_2026 INTEGER NOT NULL DEFAULT 0 CHECK (is_newly_created_2026 IN (0, 1)),
  parent_wilaya_code TEXT REFERENCES wilayas(code) ON DELETE SET NULL,
  decree_reference TEXT,
  effective_year INTEGER NOT NULL DEFAULT 2026,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Seed 58 historical wilayas first (so parent_wilaya_code FK references exist)
INSERT OR IGNORE INTO wilayas (code, name_fr, name_ar, is_newly_created_2026, parent_wilaya_code, decree_reference, effective_year) VALUES
  ('01', 'Adrar', 'أدرار', 0, NULL, NULL, 1984),
  ('02', 'Chlef', 'الشلف', 0, NULL, NULL, 1984),
  ('03', 'Laghouat', 'الأغواط', 0, NULL, NULL, 1984),
  ('04', 'Oum El Bouaghi', 'أم البواقي', 0, NULL, NULL, 1984),
  ('05', 'Batna', 'باتنة', 0, NULL, NULL, 1984),
  ('06', 'Béjaïa', 'بجاية', 0, NULL, NULL, 1984),
  ('07', 'Biskra', 'بسكرة', 0, NULL, NULL, 1984),
  ('08', 'Béchar', 'بشار', 0, NULL, NULL, 1984),
  ('09', 'Blida', 'البليدة', 0, NULL, NULL, 1984),
  ('10', 'Bouira', 'البويرة', 0, NULL, NULL, 1984),
  ('11', 'Tamanrasset', 'تمنراست', 0, NULL, NULL, 1984),
  ('12', 'Tébessa', 'تبسة', 0, NULL, NULL, 1984),
  ('13', 'Tlemcen', 'تلمسان', 0, NULL, NULL, 1984),
  ('14', 'Tiaret', 'تيارت', 0, NULL, NULL, 1984),
  ('15', 'Tizi Ouzou', 'تيزي وزو', 0, NULL, NULL, 1984),
  ('16', 'Alger', 'الجزائر العاصمة', 0, NULL, NULL, 1984),
  ('17', 'Djelfa', 'الجلفة', 0, NULL, NULL, 1984),
  ('18', 'Jijel', 'جيجل', 0, NULL, NULL, 1984),
  ('19', 'Sétif', 'سطيف', 0, NULL, NULL, 1984),
  ('20', 'Saïda', 'سعيدة', 0, NULL, NULL, 1984),
  ('21', 'Skikda', 'سكيكدة', 0, NULL, NULL, 1984),
  ('22', 'Sidi Bel Abbès', 'سيدي بلعباس', 0, NULL, NULL, 1984),
  ('23', 'Annaba', 'عنابة', 0, NULL, NULL, 1984),
  ('24', 'Guelma', 'قالمة', 0, NULL, NULL, 1984),
  ('25', 'Constantine', 'قسنطينة', 0, NULL, NULL, 1984),
  ('26', 'Médéa', 'المدية', 0, NULL, NULL, 1984),
  ('27', 'Mostaganem', 'مستغانم', 0, NULL, NULL, 1984),
  ('28', 'M''Sila', 'المسيلة', 0, NULL, NULL, 1984),
  ('29', 'Mascara', 'معسكر', 0, NULL, NULL, 1984),
  ('30', 'Ouargla', 'ورقلة', 0, NULL, NULL, 1984),
  ('31', 'Oran', 'وهران', 0, NULL, NULL, 1984),
  ('32', 'El Bayadh', 'البيض', 0, NULL, NULL, 1984),
  ('33', 'Illizi', 'إليزي', 0, NULL, NULL, 1984),
  ('34', 'Bordj Bou Arréridj', 'برج بوعريريج', 0, NULL, NULL, 1984),
  ('35', 'Boumerdès', 'بومرداس', 0, NULL, NULL, 1984),
  ('36', 'El Tarf', 'الطارف', 0, NULL, NULL, 1984),
  ('37', 'Tindouf', 'تندوف', 0, NULL, NULL, 1984),
  ('38', 'Tissemsilt', 'تيسمسيلت', 0, NULL, NULL, 1984),
  ('39', 'El Oued', 'الوادي', 0, NULL, NULL, 1984),
  ('40', 'Khenchela', 'خنشلة', 0, NULL, NULL, 1984),
  ('41', 'Souk Ahras', 'سوق أهراس', 0, NULL, NULL, 1984),
  ('42', 'Tipaza', 'تيبازة', 0, NULL, NULL, 1984),
  ('43', 'Mila', 'ميلة', 0, NULL, NULL, 1984),
  ('44', 'Aïn Defla', 'عين الدفلى', 0, NULL, NULL, 1984),
  ('45', 'Naâma', 'النعامة', 0, NULL, NULL, 1984),
  ('46', 'Aïn Témouchent', 'عين تموشنت', 0, NULL, NULL, 1984),
  ('47', 'Ghardaïa', 'غرداية', 0, NULL, NULL, 1984),
  ('48', 'Relizane', 'غليزان', 0, NULL, NULL, 1984),
  ('49', 'Timimoun', 'تيميمون', 0, '01', 'Loi 19-12', 2019),
  ('50', 'Bordj Badji Mokhtar', 'برج باجي مختار', 0, '01', 'Loi 19-12', 2019),
  ('51', 'Ouled Djellal', 'أولاد جلال', 0, '07', 'Loi 19-12', 2019),
  ('52', 'Béni Abbès', 'بني عباس', 0, '08', 'Loi 19-12', 2019),
  ('53', 'In Salah', 'عين صالح', 0, '11', 'Loi 19-12', 2019),
  ('54', 'In Guezzam', 'عين قزام', 0, '11', 'Loi 19-12', 2019),
  ('55', 'Touggourt', 'تقرت', 0, '30', 'Loi 19-12', 2019),
  ('56', 'Djanet', 'جانت', 0, '33', 'Loi 19-12', 2019),
  ('57', 'El M''Ghair', 'المغير', 0, '39', 'Loi 19-12', 2019),
  ('58', 'El Meniaa', 'المنيعة', 0, '47', 'Loi 19-12', 2019);

-- Seed 11 newly promoted wilayas under 2026 administrative reorganization (59-69)
INSERT OR IGNORE INTO wilayas (code, name_fr, name_ar, is_newly_created_2026, parent_wilaya_code, decree_reference, effective_year, notes) VALUES
  ('59', 'Aflou', 'أفلو', 1, '03', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Laghouat (03)'),
  ('60', 'Barika', 'بريكة', 1, '05', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Batna (05)'),
  ('61', 'El Kantara', 'القنطرة', 1, '07', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Biskra (07)'),
  ('62', 'Bir El Ater', 'بئر العاتر', 1, '12', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Tébessa (12)'),
  ('63', 'El Aricha', 'العريشة', 1, '13', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Tlemcen (13)'),
  ('64', 'Ksar Chellala', 'قصر الشلالة', 1, '14', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Tiaret (14)'),
  ('65', 'Aïn Ouessara', 'عين وسارة', 1, '17', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Djelfa (17)'),
  ('66', 'Messaad', 'مسعد', 1, '17', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Djelfa (17)'),
  ('67', 'Ksar El Boukhari', 'قصر البخاري', 1, '26', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis Médéa (26)'),
  ('68', 'Bou Saâda', 'بوسعادة', 1, '28', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis M''Sila (28)'),
  ('69', 'El Abiodh Sidi Cheikh', 'الأبيض سيدي الشيخ', 1, '32', 'Loi n° 26-06 / Décret 26-206', 2026, 'Promue en 2026 depuis El Bayadh (32)');

-- Seed Roles
INSERT OR IGNORE INTO roles (code, name_fr, name_ar, description) VALUES
  ('ADMIN', 'Administrateur', 'المدير العام', 'Accès complet: paramètres, utilisateurs, finance, restauration et audit.'),
  ('AGENT', 'Agent de location', 'عون كراء السيارات', 'Opérations courantes: clients, disponibilités, contrats, inspections, encaissements autorisés.');

-- Seed Permissions
INSERT OR IGNORE INTO permissions (code, module, description_fr, description_ar) VALUES
  ('users:manage', 'users', 'Gérer les utilisateurs et permissions', 'إدارة المستخدمين والصلاحيات'),
  ('settings:manage', 'settings', 'Configurer les paramètres et wilayas', 'إعدادات الوكالة والولايات'),
  ('vehicles:read', 'vehicles', 'Consulter le parc automobile', 'عرض أسطول السيارات'),
  ('vehicles:write', 'vehicles', 'Ajouter et modifier des véhicules', 'إضافة وتعديل السيارات'),
  ('customers:read', 'customers', 'Consulter les fiches clients', 'عرض ملفات الزبائن'),
  ('customers:write', 'customers', 'Créer et modifier des clients', 'إضافة وتعديل الزبائن'),
  ('customers:override_blacklist', 'customers', 'Autoriser une exception liste noire', 'تجاوز القائمة السوداء'),
  ('contracts:read', 'contracts', 'Consulter les contrats et réservations', 'عرض العقود والحجوزات'),
  ('contracts:write', 'contracts', 'Créer et confirmer des contrats', 'إنشاء وتأكيد العقود'),
  ('contracts:extend', 'contracts', 'Prolonger un contrat actif', 'تمديد عقد ساري'),
  ('contracts:cancel', 'contracts', 'Annuler un contrat', 'إلغاء عقد'),
  ('inspections:write', 'inspections', 'Réaliser les états des lieux', 'إجراء معاينة المركبة'),
  ('finance:read', 'finance', 'Consulter les rapports financiers', 'الاطلاع على المالية'),
  ('finance:record_payment', 'finance', 'Enregistrer les paiements autorisés', 'تسجيل المدفوعات'),
  ('finance:manage_deposit', 'finance', 'Gérer et déduire les cautions', 'تسيير الكفالات والخصومات'),
  ('finance:manage_expenses', 'finance', 'Enregistrer et gérer les dépenses', 'تسيير المصاريف'),
  ('finance:cash_register', 'finance', 'Ouvrir et clôturer la caisse', 'فتح وإغلاق الصندوق اليومي'),
  ('finance:approve_adjustment', 'finance', 'Approuver les ajustements financiers', 'اعتماد التعديلات المالية'),
  ('maintenance:write', 'maintenance', 'Enregistrer la maintenance', 'تسجيل الصيانة'),
  ('inventory:read', 'inventory', 'Consulter le stock de pièces', 'عرض مخزون قطع الغيار'),
  ('inventory:write', 'inventory', 'Gérer les mouvements de stock', 'إدارة حركات المخزون'),
  ('inventory:override_negative', 'inventory', 'Autoriser un stock négatif', 'تجاوز المخزون السلبي'),
  ('documents:generate', 'documents', 'Générer et imprimer les documents', 'توليد وطباعة الوثائق'),
  ('reports:view', 'reports', 'Consulter les statistiques et exports', 'عرض التقارير والتصدير'),
  ('audit:view', 'audit', 'Consulter le journal d''audit', 'الاطلاع على سجل التدقيق'),
  ('backups:manage', 'backups', 'Créer des sauvegardes locales', 'إنشاء نسخ احتياطية'),
  ('backups:restore', 'backups', 'Restaurer la base de données', 'استرجاع قاعدة البيانات');

-- Grant all permissions to ADMIN
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN';

-- Grant operational permissions to AGENT
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'vehicles:read',
  'customers:read',
  'customers:write',
  'contracts:read',
  'contracts:write',
  'contracts:extend',
  'inspections:write',
  'finance:record_payment',
  'finance:cash_register',
  'inventory:read',
  'documents:generate'
) WHERE r.code = 'AGENT';

-- Seed Default Maintenance Types
INSERT OR IGNORE INTO maintenance_types (code, name_fr, name_ar, default_km_interval, default_day_interval, km_warning_threshold, day_warning_threshold) VALUES
  ('VIDANGE', 'Vidange moteur', 'تغيير زيت المحرك', 10000, 365, 1000, 14),
  ('OIL_FILTER', 'Filtre à huile', 'مصفاة الزيت', 10000, 365, 1000, 14),
  ('AIR_FILTER', 'Filtre à air', 'مصفاة الهواء', 20000, 365, 1500, 14),
  ('FUEL_FILTER', 'Filtre à carburant', 'مصفاة الوقود', 30000, 730, 2000, 30),
  ('TIMING_BELT', 'Courroie de distribution', 'حزام التوزيع', 60000, 1460, 3000, 30),
  ('TIRES', 'Pneumatiques', 'الإطارات', 40000, NULL, 3000, 30),
  ('BRAKE_PADS', 'Plaquettes de frein', 'صفائح الفرامل', 30000, NULL, 2000, 14),
  ('BRAKE_DISCS', 'Disques de frein', 'أقراص الفرامل', 60000, NULL, 3000, 30),
  ('BATTERY', 'Batterie', 'البطارية', NULL, 730, 0, 30),
  ('GENERAL_REPAIR', 'Réparation générale', 'إصلاح عام', NULL, NULL, 0, 0);

-- Seed Default Application Settings
INSERT OR IGNORE INTO application_settings (setting_key, setting_group, setting_value) VALUES
  ('agency.name', 'agency', 'Agence Location Auto'),
  ('agency.commercial_name', 'agency', ''),
  ('agency.legal_status', 'agency', 'Personne physique'),
  ('agency.address', 'agency', ''),
  ('agency.wilaya_code', 'agency', '16'),
  ('agency.commune', 'agency', ''),
  ('agency.phone', 'agency', ''),
  ('agency.email', 'agency', ''),
  ('agency.nif', 'agency', ''),
  ('agency.rc', 'agency', ''),
  ('agency.nis', 'agency', ''),
  ('agency.art', 'agency', ''),
  ('business.default_currency', 'business', 'DZD'),
  ('business.allow_eur_deposits', 'business', 'false'),
  ('business.min_licence_years', 'business', '2'),
  ('business.enforce_matricule_regex', 'business', 'true'),
  ('business.custom_matricule_regex', 'business', ''),
  ('business.default_daily_mileage_km', 'business', '300'),
  ('business.default_extra_km_rate_minor', 'business', '1500'),
  ('business.default_deposit_minor', 'business', '5000000'),
  ('business.late_grace_period_minutes', 'business', '60'),
  ('business.late_hourly_fee_minor', 'business', '50000'),
  ('business.late_daily_fee_minor', 'business', '400000'),
  ('business.max_agent_discount_percent', 'business', '10'),
  ('business.admin_doc_reminder_days', 'business', '30'),
  ('app.default_language', 'app', 'fr'),
  ('app.default_theme', 'app', 'light'),
  ('app.numeral_system', 'app', 'latin'),
  ('app.date_format', 'app', 'dd/MM/yyyy'),
  ('app.timezone', 'app', 'Africa/Algiers'),
  ('app.auto_lock_minutes', 'app', '15'),
  ('app.auto_backup_enabled', 'app', 'true'),
  ('app.auto_backup_time', 'app', '22:00'),
  ('app.backup_retention_count', 'app', '14');
