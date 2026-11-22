export type InspectionChecklistCategory = 'EXTERIOR' | 'INTERIOR' | 'SAFETY_DOCS';

export interface InspectionChecklistTemplateItem {
  itemKey: string;
  category: InspectionChecklistCategory;
  labelFr: string;
  labelAr: string;
  sortOrder: number;
}

export const DEFAULT_INSPECTION_CHECKLIST: readonly InspectionChecklistTemplateItem[] = [
  // Exterior & Body
  {
    itemKey: 'exterior_body',
    category: 'EXTERIOR',
    labelFr: 'Carrosserie générale et peinture',
    labelAr: 'الهيكل الخارجي والطلاء',
    sortOrder: 1,
  },
  {
    itemKey: 'windshield_windows',
    category: 'EXTERIOR',
    labelFr: 'Pare-brise et vitres',
    labelAr: 'الزجاج الأمامي والنوافذ',
    sortOrder: 2,
  },
  {
    itemKey: 'lights_indicators',
    category: 'EXTERIOR',
    labelFr: 'Phares, feux arrière et clignotants',
    labelAr: 'الأضواء الأمامية والخلفية وإشارات الانعطاف',
    sortOrder: 3,
  },
  {
    itemKey: 'mirrors',
    category: 'EXTERIOR',
    labelFr: 'Rétroviseurs gauche et droit',
    labelAr: 'المرايا الجانبية اليسرى واليمنى',
    sortOrder: 4,
  },
  {
    itemKey: 'tires_wheels',
    category: 'EXTERIOR',
    labelFr: 'Pneumatiques et jantes (4 roues)',
    labelAr: 'الإطارات والعجلات (الأربع)',
    sortOrder: 5,
  },
  {
    itemKey: 'wipers',
    category: 'EXTERIOR',
    labelFr: 'Essuie-glaces avant / arrière',
    labelAr: 'ماسحات الزجاج',
    sortOrder: 6,
  },
  // Interior & Comfort
  {
    itemKey: 'interior_cleanliness',
    category: 'INTERIOR',
    labelFr: 'Propreté et état général intérieur',
    labelAr: 'النظافة والحالة العامة للمقصورة',
    sortOrder: 7,
  },
  {
    itemKey: 'seats_upholstery',
    category: 'INTERIOR',
    labelFr: 'Sièges et sellerie',
    labelAr: 'المقاعد والتنجيد',
    sortOrder: 8,
  },
  {
    itemKey: 'dashboard_controls',
    category: 'INTERIOR',
    labelFr: 'Tableau de bord et voyants',
    labelAr: 'لوحة القيادة والمؤشرات',
    sortOrder: 9,
  },
  {
    itemKey: 'air_conditioning',
    category: 'INTERIOR',
    labelFr: 'Climatisation et chauffage',
    labelAr: 'التكييف والتدفئة',
    sortOrder: 10,
  },
  {
    itemKey: 'radio_multimedia',
    category: 'INTERIOR',
    labelFr: 'Autoradio et écran multimédia',
    labelAr: 'المذياع وشاشة الوسائط',
    sortOrder: 11,
  },
  // Safety, Documents & Accessories
  {
    itemKey: 'spare_tire',
    category: 'SAFETY_DOCS',
    labelFr: 'Roue de secours',
    labelAr: 'العجلة الاحتياطية',
    sortOrder: 12,
  },
  {
    itemKey: 'jack_tools',
    category: 'SAFETY_DOCS',
    labelFr: 'Cric et clé de démontage roue',
    labelAr: 'الرافعة ومفتاح العجلات',
    sortOrder: 13,
  },
  {
    itemKey: 'warning_triangle_vest',
    category: 'SAFETY_DOCS',
    labelFr: 'Triangle de signalisation et gilet',
    labelAr: 'مثلث التحذير وسترة السلامة',
    sortOrder: 14,
  },
  {
    itemKey: 'fire_extinguisher',
    category: 'SAFETY_DOCS',
    labelFr: 'Extincteur',
    labelAr: 'مطفأة الحريق',
    sortOrder: 15,
  },
  {
    itemKey: 'registration_docs',
    category: 'SAFETY_DOCS',
    labelFr: 'Carte grise (documents véhicule)',
    labelAr: 'البطاقة الرمادية',
    sortOrder: 16,
  },
  {
    itemKey: 'insurance_docs',
    category: 'SAFETY_DOCS',
    labelFr: 'Assurance, vignette et contrôle technique',
    labelAr: 'شهادة التأمين وقسيمة السيارات والمراقبة التقنية',
    sortOrder: 17,
  },
  {
    itemKey: 'keys_fobs',
    category: 'SAFETY_DOCS',
    labelFr: 'Clés et télécommande',
    labelAr: 'المفاتيح وجهاز التحكم',
    sortOrder: 18,
  },
] as const;

export type VehicleDiagramZoneCode =
  | 'FRONT_BUMPER'
  | 'HOOD'
  | 'WINDSHIELD'
  | 'ROOF'
  | 'REAR_WINDOW'
  | 'TRUNK'
  | 'REAR_BUMPER'
  | 'FRONT_LEFT_FENDER'
  | 'LEFT_MIRROR'
  | 'FRONT_LEFT_DOOR'
  | 'REAR_LEFT_DOOR'
  | 'REAR_LEFT_FENDER'
  | 'FRONT_RIGHT_FENDER'
  | 'RIGHT_MIRROR'
  | 'FRONT_RIGHT_DOOR'
  | 'REAR_RIGHT_DOOR'
  | 'REAR_RIGHT_FENDER'
  | 'FRONT_LEFT_WHEEL'
  | 'REAR_LEFT_WHEEL'
  | 'FRONT_RIGHT_WHEEL'
  | 'REAR_RIGHT_WHEEL'
  | 'INTERIOR_DASH'
  | 'INTERIOR_SEATS'
  | 'OTHER';

export interface VehicleDiagramZoneDef {
  code: VehicleDiagramZoneCode;
  labelFr: string;
  labelAr: string;
  defaultX: number; // 0-100 on 400x260 top-down vehicle SVG
  defaultY: number;
}

export const VEHICLE_DIAGRAM_ZONES: readonly VehicleDiagramZoneDef[] = [
  { code: 'FRONT_BUMPER', labelFr: 'Pare-chocs avant', labelAr: 'المصد الأمامي', defaultX: 50, defaultY: 8 },
  { code: 'HOOD', labelFr: 'Capot moteur', labelAr: 'غطاء المحرك', defaultX: 50, defaultY: 21 },
  { code: 'WINDSHIELD', labelFr: 'Pare-brise', labelAr: 'الزجاج الأمامي', defaultX: 50, defaultY: 34 },
  { code: 'ROOF', labelFr: 'Pavillon / Toit', labelAr: 'السقف', defaultX: 50, defaultY: 52 },
  { code: 'REAR_WINDOW', labelFr: 'Lunette arrière', labelAr: 'الزجاج الخلفي', defaultX: 50, defaultY: 70 },
  { code: 'TRUNK', labelFr: 'Coffre / Hayon', labelAr: 'الصندوق الخلفي', defaultX: 50, defaultY: 82 },
  { code: 'REAR_BUMPER', labelFr: 'Pare-chocs arrière', labelAr: 'المصد الخلفي', defaultX: 50, defaultY: 93 },
  { code: 'FRONT_LEFT_FENDER', labelFr: 'Aile avant gauche', labelAr: 'الجناح الأمامي الأيسر', defaultX: 20, defaultY: 22 },
  { code: 'LEFT_MIRROR', labelFr: 'Rétroviseur gauche', labelAr: 'المرآة اليسرى', defaultX: 12, defaultY: 36 },
  { code: 'FRONT_LEFT_DOOR', labelFr: 'Porte avant gauche', labelAr: 'الباب الأمامي الأيسر', defaultX: 21, defaultY: 45 },
  { code: 'REAR_LEFT_DOOR', labelFr: 'Porte arrière gauche', labelAr: 'الباب الخلفي الأيسر', defaultX: 21, defaultY: 62 },
  { code: 'REAR_LEFT_FENDER', labelFr: 'Aile arrière gauche', labelAr: 'الجناح الخلفي الأيسر', defaultX: 20, defaultY: 78 },
  { code: 'FRONT_RIGHT_FENDER', labelFr: 'Aile avant droite', labelAr: 'الجناح الأمامي الأيمن', defaultX: 80, defaultY: 22 },
  { code: 'RIGHT_MIRROR', labelFr: 'Rétroviseur droit', labelAr: 'المرآة اليمنى', defaultX: 88, defaultY: 36 },
  { code: 'FRONT_RIGHT_DOOR', labelFr: 'Porte avant droite', labelAr: 'الباب الأمامي الأيمن', defaultX: 79, defaultY: 45 },
  { code: 'REAR_RIGHT_DOOR', labelFr: 'Porte arrière droite', labelAr: 'الباب الخلفي الأيمن', defaultX: 79, defaultY: 62 },
  { code: 'REAR_RIGHT_FENDER', labelFr: 'Aile arrière droite', labelAr: 'الجناح الخلفي الأيمن', defaultX: 80, defaultY: 78 },
  { code: 'FRONT_LEFT_WHEEL', labelFr: 'Roue avant gauche', labelAr: 'العجلة الأمامية اليسرى', defaultX: 13, defaultY: 24 },
  { code: 'REAR_LEFT_WHEEL', labelFr: 'Roue arrière gauche', labelAr: 'العجلة الخلفية اليسرى', defaultX: 13, defaultY: 76 },
  { code: 'FRONT_RIGHT_WHEEL', labelFr: 'Roue avant droite', labelAr: 'العجلة الأمامية اليمنى', defaultX: 87, defaultY: 24 },
  { code: 'REAR_RIGHT_WHEEL', labelFr: 'Roue arrière droite', labelAr: 'العجلة الخلفية اليمنى', defaultX: 87, defaultY: 76 },
  { code: 'INTERIOR_DASH', labelFr: 'Intérieur — Tableau de bord', labelAr: 'الداخل — لوحة القيادة', defaultX: 50, defaultY: 42 },
  { code: 'INTERIOR_SEATS', labelFr: 'Intérieur — Sièges / sellerie', labelAr: 'الداخل — المقاعد', defaultX: 50, defaultY: 59 },
  { code: 'OTHER', labelFr: 'Autre zone / Accessoire', labelAr: 'منطقة أخرى / ملحقات', defaultX: 50, defaultY: 50 },
] as const;

export function getDiagramZoneLabel(zoneCode: string, lang: 'fr' | 'ar'): string {
  const found = VEHICLE_DIAGRAM_ZONES.find((z) => z.code === zoneCode);
  if (!found) return zoneCode;
  return lang === 'ar' ? found.labelAr : found.labelFr;
}
