import type Database from 'better-sqlite3';
import type {
  AppLanguage,
  CurrencyCode,
  DocumentFormat,
  DocumentKind,
  DocumentTemplateConfig,
  NumeralSystem,
  ReportFilter,
} from '../../shared/types/domain.ts';
import { AuthError } from '../security/rbac.ts';
import { getAllSettings } from '../database/services/settingsService.ts';
import { getContractDetail } from '../database/services/contractService.ts';
import { computeCustomerFinancialMetrics } from '../database/services/customerFinanceService.ts';
import { getCustomerProfile } from '../database/services/customerService.ts';
import { getDepositDetail } from '../database/services/depositService.ts';
import { getCashSessionDetail } from '../database/services/cashRegisterService.ts';
import { getVehicleProfile } from '../database/services/fleetService.ts';
import { getContractInspections, getInspectionDetail } from '../database/services/inspectionService.ts';
import { getMaintenanceRecordDetail, getVehicleMaintenanceOverview } from '../database/services/maintenanceService.ts';
import { generateReportDataset, reportDatasetToPdfSections } from '../database/services/reportService.ts';
import { applyNumeralPreference, formatDateForDoc, formatMoneyForDoc } from './arabicText.ts';
import type { DocumentRenderPayload, DocumentSectionBlock } from './pdfEngine.ts';

export const ALL_DOCUMENT_KINDS: DocumentKind[] = [
  'RENTAL_CONTRACT',
  'CONTRACT_AMENDMENT',
  'DEPARTURE_INSPECTION',
  'RETURN_INSPECTION',
  'DAMAGE_REPORT',
  'PAYMENT_RECEIPT',
  'DEPOSIT_RECEIPT',
  'DEPOSIT_SETTLEMENT',
  'INVOICE',
  'EXPENSE_RECEIPT',
  'MAINTENANCE_REPORT',
  'VEHICLE_HISTORY',
  'CUSTOMER_STATEMENT',
  'CASH_REGISTER_CLOSING',
  'FINANCIAL_SUMMARY',
  'CUSTOM_REPORT',
];

const DEFAULT_PREFIXES: Record<DocumentKind, string> = {
  RENTAL_CONTRACT: 'CTR',
  CONTRACT_AMENDMENT: 'AVN',
  DEPARTURE_INSPECTION: 'EDL-D',
  RETURN_INSPECTION: 'EDL-R',
  DAMAGE_REPORT: 'DMG',
  PAYMENT_RECEIPT: 'REC',
  DEPOSIT_RECEIPT: 'CAU',
  DEPOSIT_SETTLEMENT: 'DEC',
  INVOICE: 'FAC',
  EXPENSE_RECEIPT: 'DEP',
  MAINTENANCE_REPORT: 'MNT',
  VEHICLE_HISTORY: 'HIST',
  CUSTOMER_STATEMENT: 'REL',
  CASH_REGISTER_CLOSING: 'CAI',
  FINANCIAL_SUMMARY: 'FIN',
  CUSTOM_REPORT: 'RPT',
};

export function loadTemplateConfigFromDb(db: Database.Database): DocumentTemplateConfig {
  const s = getAllSettings(db);
  const prefixes = {} as Record<DocumentKind, string>;
  for (const kind of ALL_DOCUMENT_KINDS) {
    prefixes[kind] = s[`documents.prefix_${kind}`] || DEFAULT_PREFIXES[kind];
  }

  return {
    agencyName: s['agency.name'] || 'Agence de Location',
    agencyAddress: s['agency.address'] || '',
    agencyPhone: s['agency.phone'] || '',
    agencyEmail: s['agency.email'] || '',
    agencyWilayaCode: s['agency.wilaya_code'] || '16',
    rcNumber: s['agency.rc'] || s['agency.rc_number'] || '',
    nifNumber: s['agency.nif'] || s['agency.nif_number'] || '',
    nisNumber: s['agency.nis'] || s['agency.nis_number'] || '',
    artNumber: s['agency.art'] || s['agency.art_number'] || '',
    logoVaultPath: s['agency.logo_vault_path'] || '',
    logoMimeType: s['agency.logo_mime_type'] || '',
    defaultLanguage: s['documents.default_language'] === 'ar' ? 'ar' : 'fr',
    defaultFormat: (['A4_PDF', 'A4_LANDSCAPE_PDF', 'THERMAL_80MM', 'THERMAL_58MM'].includes(s['documents.default_format'])
      ? s['documents.default_format']
      : 'A4_PDF') as DocumentFormat,
    thermalWidth: s['documents.thermal_width'] === '58MM' ? '58MM' : '80MM',
    defaultPrinterA4: s['documents.default_printer_a4'] || '',
    defaultPrinterThermal: s['documents.default_printer_thermal'] || '',
    showLogo: s['documents.show_logo'] !== '0',
    showFiscalIds: s['documents.show_fiscal_ids'] !== '0',
    showSignatureBoxes: s['documents.show_signature_boxes'] !== '0',
    invoiceFiscallyCompliant: s['documents.invoice_fiscally_compliant'] === '1',
    invoiceTaxRatePercent: Number(s['documents.invoice_tax_rate_percent'] ?? 0) || 0,
    templateVersion: Number(s['documents.template_version'] ?? 1) || 1,
    footerFr:
      s['documents.footer_fr'] ||
      'Document généré localement par le système de gestion de l’agence.',
    footerAr:
      s['documents.footer_ar'] ||
      'وثيقة صادرة محلياً عن نظام تسيير الوكالة.',
    signatureAgencyFr: s['documents.signature_agency_fr'] || 'Cachet & signature de l’agence',
    signatureAgencyAr: s['documents.signature_agency_ar'] || 'ختم وتوقيع الوكالة',
    signatureCustomerFr: s['documents.signature_customer_fr'] || 'Lu et approuvé — Signature du client',
    signatureCustomerAr: s['documents.signature_customer_ar'] || 'قرئ وصودق عليه — توقيع الزبون',
    contractTermsFr: s['documents.contract_terms_fr'] || '',
    contractTermsAr: s['documents.contract_terms_ar'] || '',
    invoiceDisclaimerFr:
      s['documents.invoice_disclaimer_fr'] ||
      'Document de facturation généré localement selon la configuration de l’agence.',
    invoiceDisclaimerAr:
      s['documents.invoice_disclaimer_ar'] ||
      'فاتورة صادرة محلياً وفق الإعدادات المعتمدة من طرف الوكالة.',
    prefixes,
  };
}

export function getDocumentTitle(kind: DocumentKind, lang: AppLanguage): string {
  const labels: Record<DocumentKind, { fr: string; ar: string }> = {
    RENTAL_CONTRACT: { fr: 'CONTRAT DE LOCATION DE VÉHICULE', ar: 'عقد كراء مركبة' },
    CONTRACT_AMENDMENT: { fr: 'AVENANT / PROLONGATION DE CONTRAT', ar: 'ملحق وتمديد عقد كراء' },
    DEPARTURE_INSPECTION: { fr: 'ÉTAT DES LIEUX DE DÉPART', ar: 'محضر معاينة المركبة عند الانطلاق' },
    RETURN_INSPECTION: { fr: 'ÉTAT DES LIEUX DE RETOUR', ar: 'محضر معاينة المركبة عند العودة' },
    DAMAGE_REPORT: { fr: 'RAPPORT COMPARATIF DES DOMMAGES', ar: 'تقرير مقارنة الأضرار' },
    PAYMENT_RECEIPT: { fr: 'REÇU DE PAIEMENT', ar: 'وصل دفع' },
    DEPOSIT_RECEIPT: { fr: 'REÇU DE CAUTION (DÉPÔT DE GARANTIE)', ar: 'وصل استلام كفالة ضمان' },
    DEPOSIT_SETTLEMENT: { fr: 'DÉCOMPTE DE RESTITUTION DE CAUTION', ar: 'كشف تصفية وإرجاع الكفالة' },
    INVOICE: { fr: 'FACTURE CLIENT', ar: 'فاتورة زبون' },
    EXPENSE_RECEIPT: { fr: 'BON / JUSTIFICATIF DE DÉPENSE', ar: 'سند وإثبات مصروف' },
    MAINTENANCE_REPORT: { fr: 'FICHE D’INTERVENTION MAINTENANCE', ar: 'بطاقة تدخل الصيانة' },
    VEHICLE_HISTORY: { fr: 'DOSSIER HISTORIQUE DU VÉHICULE', ar: 'السجل الكامل للمركبة' },
    CUSTOMER_STATEMENT: { fr: 'RELEVÉ DE COMPTE CLIENT', ar: 'كشف حساب الزبون' },
    CASH_REGISTER_CLOSING: { fr: 'PROCÈS-VERBAL DE CLÔTURE DE CAISSE', ar: 'محضر إغلاق الصندوق اليومي' },
    FINANCIAL_SUMMARY: { fr: 'SYNTHÈSE FINANCIÈRE PÉRIODIQUE', ar: 'الملخص المالي الدوري' },
    CUSTOM_REPORT: { fr: 'RAPPORT D’EXPLOITATION PERSONNALISÉ', ar: 'تقرير تشغيلي مخصص' },
  };
  return lang === 'ar' ? labels[kind].ar : labels[kind].fr;
}

export interface BuiltDocumentContext {
  title: string;
  subtitle?: string;
  sections: DocumentSectionBlock[];
  links: {
    contractId?: number | null;
    paymentId?: number | null;
    depositId?: number | null;
    inspectionId?: number | null;
    invoiceId?: number | null;
    customerId?: number | null;
    vehicleId?: number | null;
    maintenanceRecordId?: number | null;
    expenseId?: number | null;
    cashSessionId?: number | null;
  };
  invoiceCreateData?: {
    contractId: number;
    customerId: number;
    issueDate: string;
    subtotalMinor: number;
    discountMinor: number;
    taxRatePercent: number;
    taxMinor: number;
    totalMinor: number;
    currency: CurrencyCode;
    isFiscallyCompliant: boolean;
    notes: string | null;
  };
}

export function buildDocumentContentFromDb(
  db: Database.Database,
  params: {
    documentKind: DocumentKind;
    language: AppLanguage;
    numeralSystem: NumeralSystem;
    template: DocumentTemplateConfig;
    contractId?: number | null;
    extensionId?: number | null;
    paymentId?: number | null;
    depositId?: number | null;
    inspectionId?: number | null;
    invoiceId?: number | null;
    customerId?: number | null;
    vehicleId?: number | null;
    maintenanceRecordId?: number | null;
    expenseId?: number | null;
    cashSessionId?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    reportFilter?: ReportFilter | null;
    notes?: string | null;
    taxRatePercent?: number;
  }
): BuiltDocumentContext {
  const lang = params.language;
  const numSys = params.numeralSystem;
  const isAr = lang === 'ar';
  const tpl = params.template;
  const title = getDocumentTitle(params.documentKind, lang);
  const money = (minor: number, cur: CurrencyCode = 'DZD') => formatMoneyForDoc(minor, cur, lang, numSys);
  const dt = (iso: string | null | undefined, time = false) => formatDateForDoc(iso, lang, numSys, time);
  const num = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === '' ? '—' : applyNumeralPreference(String(v), numSys);

  switch (params.documentKind) {
    case 'RENTAL_CONTRACT': {
      if (!params.contractId) throw new AuthError('VALIDATION_ERROR', 'Contrat requis pour générer le contrat de location');
      const detail = getContractDetail(db, params.contractId);
      const c = detail.contract;
      const custProf = getCustomerProfile(db, c.customerId);
      const customer = custProf.customer;
      const vehProf = getVehicleProfile(db, c.vehicleId);
      const vehicle = vehProf.vehicle;
      const currency = (c.currency || 'DZD') as CurrencyCode;
      const paidNet = detail.payments.reduce(
        (s, p) => s + (p.direction === 'INFLOW' ? p.amountMinor : -p.amountMinor),
        0
      );
      const mileageLabel =
        c.mileageMode === 'UNLIMITED'
          ? isAr ? 'غير محدود' : 'Illimité'
          : c.mileageMode === 'DAILY_ALLOWANCE'
            ? `${num(c.dailyMileageAllowanceKm ?? 0)} ${isAr ? 'كم / يوم' : 'km / jour'}`
            : `${num(c.includedTotalKm ?? 0)} ${isAr ? 'كم إجمالي' : 'km forfait'}`;

      const sections: DocumentSectionBlock[] = [
        {
          type: 'kv_grid',
          title: isAr ? 'بيانات العقد' : 'Identification du contrat',
          columns: 2,
          items: [
            { label: isAr ? 'رقم العقد' : 'N° Contrat', value: num(c.contractNumber), emphasize: true },
            { label: isAr ? 'الحالة' : 'Statut', value: c.status },
            { label: isAr ? 'تاريخ الانطلاق' : 'Date de départ', value: dt(c.startDate, true) },
            { label: isAr ? 'تاريخ الإرجاع المتوقع' : 'Retour prévu', value: dt(c.expectedReturnDate, true) },
            { label: isAr ? 'نهاية العقد الأصلية' : 'Fin initiale', value: dt(c.originalEndDate, true) },
            { label: isAr ? 'الإرجاع الفعلي' : 'Retour effectif', value: dt(c.actualReturnDate, true) },
          ],
        },
        {
          type: 'kv_grid',
          title: isAr ? 'بيانات المستأجر' : 'Locataire (Client)',
          columns: 2,
          items: [
            { label: isAr ? 'الاسم الكامل / الشركة' : 'Nom / Raison sociale', value: custProf.company?.companyName ? `${custProf.company.companyName} (${customer.fullName})` : customer.fullName, emphasize: true },
            { label: isAr ? 'الهاتف' : 'Téléphone', value: num(customer.phone) },
            { label: isAr ? 'بطاقة التعريف / جواز السفر' : 'CNI / Passeport', value: num(customer.cniNumber || customer.passportNumber) },
            { label: isAr ? 'رخصة السياقة' : 'Permis de conduire', value: num(customer.drivingLicenceNumber) },
            { label: isAr ? 'العنوان' : 'Adresse', value: customer.address || '—' },
            { label: isAr ? 'الولاية' : 'Wilaya', value: num(customer.wilayaCode) },
          ],
        },
        {
          type: 'kv_grid',
          title: isAr ? 'المركبة المؤجرة' : 'Véhicule loué',
          columns: 2,
          items: [
            { label: isAr ? 'المركبة' : 'Marque & Modèle', value: `${vehicle.brand} ${vehicle.model} (${num(vehicle.year)})`, emphasize: true },
            { label: isAr ? 'الترقيم' : 'Matricule', value: num(vehicle.matricule), emphasize: true },
            { label: isAr ? 'الوقود / ناقل الحركة' : 'Énergie / Boîte', value: `${vehicle.fuelType} · ${vehicle.transmission}` },
            { label: isAr ? 'نظام المسافة' : 'Forfait kilométrique', value: mileageLabel },
            { label: isAr ? 'العداد عند الانطلاق' : 'Compteur départ', value: `${num(c.departureOdometerKm)} km` },
            { label: isAr ? 'تعريفة الكيلومتر الإضافي' : 'Tarif km suppl.', value: `${money(c.extraKmRateMinor, currency)} / km` },
          ],
        },
        {
          type: 'summary_box',
          title: isAr ? 'التسعير والمبلغ المتعاقد عليه' : 'Décompte financier du contrat',
          rows: [
            { label: isAr ? 'مبلغ الكراء الأساسي' : 'Location de base', value: money(c.baseRentalTotalMinor, currency) },
            { label: isAr ? 'التخفيض الممنوح' : 'Remise accordée', value: `-${money(c.discountMinor, currency)}` },
            { label: isAr ? 'التمديدات الإضافية' : 'Prolongations', value: money(c.extensionTotalMinor, currency) },
            { label: isAr ? 'مصاريف الكيلومترات / التأخير / الأضرار' : 'Km suppl. / Retard / Dommages', value: money(c.extraKmChargeMinor + c.lateFeeMinor + c.damageChargeMinor + c.otherChargesMinor, currency) },
            { label: isAr ? 'المبلغ الإجمالي للعقد' : 'TOTAL CONTRACTUEL', value: money(c.totalContractAmountMinor, currency), highlight: true },
            { label: isAr ? 'المبالغ المدفوعة' : 'Total encaissé net', value: money(paidNet, currency) },
            { label: isAr ? 'الرصيد المتبقي للدفع' : 'Reste à régler', value: money(Math.max(0, c.totalContractAmountMinor - paidNet), currency), highlight: true },
            ...(detail.deposit
              ? [{ label: isAr ? 'كفالة الضمان (خارج مبلغ الكراء)' : 'Caution de garantie (hors loyer)', value: `${money(detail.deposit.amountMinor, detail.deposit.currency as CurrencyCode)} (${detail.deposit.status})` }]
              : []),
          ],
        },
      ];

      const terms = (isAr ? tpl.contractTermsAr : tpl.contractTermsFr) || params.notes || '';
      if (terms) {
        sections.push({
          type: 'text_block',
          title: isAr ? 'الشروط والالتزامات التعاقدية' : 'Conditions générales & engagements',
          text: terms,
          muted: true,
        });
      }

      sections.push({
        type: 'signatures',
        leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
        rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
        leftSubtitle: tpl.agencyName,
        rightSubtitle: customer.fullName,
      });

      return {
        title,
        subtitle: `${c.contractNumber} · ${customer.fullName} · ${vehicle.matricule}`,
        sections,
        links: { contractId: c.id, customerId: c.customerId, vehicleId: c.vehicleId },
      };
    }

    case 'CONTRACT_AMENDMENT': {
      if (!params.contractId) throw new AuthError('VALIDATION_ERROR', 'Contrat requis pour l’avenant');
      const detail = getContractDetail(db, params.contractId);
      const ext = params.extensionId
        ? detail.extensions.find((e) => e.id === params.extensionId)
        : detail.extensions[0];
      if (!ext) throw new AuthError('NOT_FOUND', 'Aucune prolongation enregistrée pour ce contrat');
      const currency = (detail.contract.currency || 'DZD') as CurrencyCode;

      return {
        title,
        subtitle: `${detail.contract.contractNumber} · ${detail.contract.customerName}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'تفاصيل التمديد' : 'Détails de la prolongation',
            columns: 2,
            items: [
              { label: isAr ? 'العقد الأصلي' : 'Contrat concerné', value: num(detail.contract.contractNumber), emphasize: true },
              { label: isAr ? 'الزبون' : 'Client', value: detail.contract.customerName },
              { label: isAr ? 'المركبة' : 'Véhicule', value: detail.contract.vehicleLabel },
              { label: isAr ? 'تاريخ الإرجاع السابق' : 'Ancienne date retour', value: dt(ext.previousReturnDate, true) },
              { label: isAr ? 'تاريخ الإرجاع الجديد' : 'Nouvelle date retour', value: dt(ext.newReturnDate, true), emphasize: true },
              { label: isAr ? 'الكيلومترات المضافة' : 'Km additionnels', value: `${num(ext.additionalKmAllowance)} km` },
            ],
          },
          {
            type: 'summary_box',
            title: isAr ? 'الأثر المالي للملحق' : 'Impact financier de l’avenant',
            rows: [
              { label: isAr ? 'مبلغ التمديد الإضافي' : 'Supplément de prolongation', value: money(ext.additionalAmountMinor, currency), highlight: true },
              { label: isAr ? 'إجمالي العقد المحدث' : 'Nouveau total contractuel', value: money(detail.contract.totalContractAmountMinor, currency), highlight: true },
            ],
          },
          ...(ext.notes
            ? [{ type: 'text_block' as const, title: isAr ? 'ملاحظات' : 'Notes', text: ext.notes }]
            : []),
          {
            type: 'signatures',
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: detail.contract.customerName,
          },
        ],
        links: { contractId: detail.contract.id, customerId: detail.contract.customerId, vehicleId: detail.contract.vehicleId },
      };
    }

    case 'DEPARTURE_INSPECTION':
    case 'RETURN_INSPECTION': {
      let inspId = params.inspectionId ?? null;
      if (!inspId && params.contractId) {
        const wantedStage = params.documentKind === 'DEPARTURE_INSPECTION' ? 'DEPARTURE' : 'RETURN';
        const found = db
          .prepare<[number, string], { id: number }>(
            'SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = ? ORDER BY id DESC LIMIT 1'
          )
          .get(params.contractId, wantedStage);
        inspId = found?.id ?? null;
      }
      if (!inspId) throw new AuthError('NOT_FOUND', 'État des lieux introuvable');

      const detail = getInspectionDetail(db, inspId);
      const insp = detail.inspection;
      const condLabel = (c: string) =>
        isAr ? (c === 'GOOD' ? 'سليم' : c === 'DAMAGED' ? 'متضرر' : 'مفقود') : c === 'GOOD' ? 'Bon' : c === 'DAMAGED' ? 'Endommagé' : 'Manquant';

      return {
        title,
        subtitle: `${insp.inspectionNumber} · ${detail.contract.contractNumber} · ${detail.vehicle.matricule}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'معلومات المعاينة' : 'Informations générales',
            columns: 2,
            items: [
              { label: isAr ? 'رقم المعاينة' : 'N° Inspection', value: num(insp.inspectionNumber), emphasize: true },
              { label: isAr ? 'العقد' : 'Contrat', value: num(detail.contract.contractNumber) },
              { label: isAr ? 'الزبون' : 'Client', value: detail.customer.fullName },
              { label: isAr ? 'المركبة' : 'Véhicule', value: `${detail.vehicle.brand} ${detail.vehicle.model} (${num(detail.vehicle.matricule)})` },
              { label: isAr ? 'العداد' : 'Kilométrage', value: `${num(insp.odometerKm)} km`, emphasize: true },
              { label: isAr ? 'مستوى الوقود' : 'Niveau carburant', value: `${num(insp.fuelLevelPercent)} %`, emphasize: true },
              { label: isAr ? 'تاريخ المعاينة' : 'Date d’inspection', value: dt(insp.inspectedAt, true) },
              { label: isAr ? 'الحالة' : 'Statut', value: insp.status },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'قائمة الفحص التفصيلية' : 'Grille de contrôle détaillée',
            columns: [
              { key: 'category', label: isAr ? 'الفئة' : 'Catégorie', widthWeight: 0.9 },
              { key: 'label', label: isAr ? 'العنصر' : 'Élément contrôlé', widthWeight: 1.8 },
              { key: 'condition', label: isAr ? 'الحالة' : 'État', widthWeight: 0.9 },
              { key: 'notes', label: isAr ? 'ملاحظات' : 'Observations', widthWeight: 1.6 },
            ],
            rows: detail.items.map((it) => ({
              category: it.category,
              label: isAr ? it.labelAr : it.labelFr,
              condition: condLabel(it.condition),
              notes: it.notes || '—',
            })),
          },
          {
            type: 'table',
            title: isAr ? 'الأضرار المسجلة' : 'Dommages relevés',
            columns: [
              { key: 'zone', label: isAr ? 'المنطقة' : 'Zone', widthWeight: 1 },
              { key: 'type', label: isAr ? 'النوع' : 'Type', widthWeight: 0.9 },
              { key: 'severity', label: isAr ? 'الخطورة' : 'Gravité', widthWeight: 0.9 },
              { key: 'description', label: isAr ? 'الوصف' : 'Description', widthWeight: 2 },
            ],
            rows: detail.damages.map((d) => ({
              zone: d.zoneCode,
              type: d.damageType,
              severity: d.severity,
              description: d.description,
            })),
          },
          ...(insp.exteriorNotes || insp.interiorNotes || insp.customerAcknowledgmentNotes
            ? [
                {
                  type: 'text_block' as const,
                  title: isAr ? 'ملاحظات المعاينة' : 'Notes extérieures & intérieures',
                  text: [insp.exteriorNotes, insp.interiorNotes, insp.customerAcknowledgmentNotes].filter(Boolean).join('\n'),
                },
              ]
            : []),
          {
            type: 'signatures',
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftImageDataUrl: insp.agencySignatureData,
            rightImageDataUrl: insp.customerSignatureData,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: detail.customer.fullName,
          },
        ],
        links: {
          contractId: insp.contractId,
          inspectionId: insp.id,
          customerId: detail.customer.id,
          vehicleId: detail.vehicle.id,
        },
      };
    }

    case 'DAMAGE_REPORT': {
      if (!params.contractId) throw new AuthError('VALIDATION_ERROR', 'Contrat requis pour le rapport des dommages');
      const ci = getContractInspections(db, params.contractId);
      const ctDetail = getContractDetail(db, params.contractId);
      const veh = getVehicleProfile(db, ctDetail.contract.vehicleId).vehicle;
      const cmp = ci.comparison;
      const preExisting = cmp?.preExistingDamages ?? ci.openVehicleDamages;
      const newlyDiscovered = cmp?.newlyDiscoveredDamages ?? [];
      const allDamages = [...preExisting, ...newlyDiscovered];
      const estTotal = newlyDiscovered.reduce((s, d) => s + Number(d.estimatedRepairCostMinor ?? 0), 0);

      return {
        title,
        subtitle: `${ctDetail.contract.contractNumber} · ${ctDetail.contract.customerName} · ${veh.matricule}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'ملخص المقارنة (انطلاق / عودة)' : 'Synthèse comparative Départ / Retour',
            columns: 2,
            items: [
              { label: isAr ? 'العقد' : 'Contrat', value: num(ctDetail.contract.contractNumber), emphasize: true },
              { label: isAr ? 'المركبة' : 'Véhicule', value: `${veh.brand} ${veh.model} (${num(veh.matricule)})` },
              { label: isAr ? 'المسافة المقطوعة' : 'Distance parcourue', value: cmp?.odometerDeltaKm != null ? `${num(cmp.odometerDeltaKm)} km` : '—' },
              { label: isAr ? 'فارق الوقود' : 'Variation carburant', value: cmp?.fuelDeltaPercent != null ? `${num(cmp.fuelDeltaPercent)} %` : '—' },
              { label: isAr ? 'أضرار سابقة' : 'Dommages préexistants', value: num(preExisting.length) },
              { label: isAr ? 'أضرار جديدة مكتشفة' : 'Nouveaux dommages', value: num(newlyDiscovered.length), emphasize: true },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'سجل الأضرار المقارن' : 'Détail des dommages constatés',
            columns: [
              { key: 'origin', label: isAr ? 'الأصل' : 'Origine', widthWeight: 1 },
              { key: 'zone', label: isAr ? 'المنطقة' : 'Zone', widthWeight: 1 },
              { key: 'severity', label: isAr ? 'الخطورة' : 'Gravité', widthWeight: 0.9 },
              { key: 'status', label: isAr ? 'الحالة' : 'Statut', widthWeight: 0.9 },
              { key: 'description', label: isAr ? 'الوصف' : 'Description', widthWeight: 1.8 },
              { key: 'cost', label: isAr ? 'التقدير' : 'Estimation', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: allDamages.map((d) => ({
              origin: d.isNewlyDiscovered ? (isAr ? 'جديد' : 'NOUVEAU') : isAr ? 'سابق' : 'Préexistant',
              zone: `${d.zoneCode} (${d.damageType})`,
              severity: d.severity,
              status: d.status,
              description: d.description,
              cost: d.estimatedRepairCostMinor != null ? money(d.estimatedRepairCostMinor) : '—',
            })),
          },
          {
            type: 'summary_box',
            title: isAr ? 'تقدير تكلفة الأضرار الجديدة' : 'Estimation financière',
            rows: [
              { label: isAr ? 'إجمالي التقديرات للأضرار الجديدة' : 'Total estimé nouveaux dommages', value: money(estTotal), highlight: true },
            ],
          },
          {
            type: 'signatures',
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftImageDataUrl: ci.returnInspection?.inspection.agencySignatureData ?? ci.departure?.inspection.agencySignatureData,
            rightImageDataUrl: ci.returnInspection?.inspection.customerSignatureData ?? ci.departure?.inspection.customerSignatureData,
            leftSubtitle: tpl.agencyName,
            rightSubtitle: ctDetail.contract.customerName,
          },
        ],
        links: {
          contractId: ctDetail.contract.id,
          inspectionId: ci.returnInspection?.inspection.id ?? ci.departure?.inspection.id ?? null,
          customerId: ctDetail.contract.customerId,
          vehicleId: ctDetail.contract.vehicleId,
        },
      };
    }

    case 'PAYMENT_RECEIPT': {
      if (!params.paymentId) throw new AuthError('VALIDATION_ERROR', 'Paiement requis pour le reçu');
      const p = db
        .prepare<[number], any>(
          `SELECT cp.*, rc.contract_number, rc.customer_id, rc.vehicle_id, rc.total_contract_amount_minor,
                  c.full_name AS customer_name, c.phone AS customer_phone,
                  v.matricule, v.brand, v.model, u.full_name AS recorded_by_name
           FROM contract_payments cp
           JOIN rental_contracts rc ON rc.id = cp.contract_id
           JOIN customers c ON c.id = rc.customer_id
           JOIN vehicles v ON v.id = rc.vehicle_id
           LEFT JOIN users u ON u.id = cp.recorded_by_user_id
           WHERE cp.id = ?`
        )
        .get(params.paymentId);
      if (!p) throw new AuthError('NOT_FOUND', 'Paiement introuvable');

      const totals = db
        .prepare<[number], { net_paid_minor: number }>(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'INFLOW' THEN amount_minor ELSE -amount_minor END), 0) AS net_paid_minor
           FROM contract_payments WHERE contract_id = ?`
        )
        .get(p.contract_id);
      const netPaid = Number(totals?.net_paid_minor ?? 0);
      const remaining = Math.max(0, Number(p.total_contract_amount_minor) - netPaid);
      const currency = (p.currency || 'DZD') as CurrencyCode;

      return {
        title,
        subtitle: `${p.receipt_number} · ${p.contract_number}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بيانات الوصل' : 'Références du règlement',
            columns: 2,
            items: [
              { label: isAr ? 'رقم الوصل' : 'N° Reçu', value: num(p.receipt_number), emphasize: true },
              { label: isAr ? 'تاريخ العملية' : 'Date paiement', value: dt(p.payment_date, true) },
              { label: isAr ? 'العقد' : 'Contrat', value: num(p.contract_number) },
              { label: isAr ? 'الزبون' : 'Client', value: `${p.customer_name} (${num(p.customer_phone)})` },
              { label: isAr ? 'المركبة' : 'Véhicule', value: `${p.brand} ${p.model} (${num(p.matricule)})` },
              { label: isAr ? 'وسيلة الدفع' : 'Mode de règlement', value: `${p.method}${p.payment_reference ? ` · ${p.payment_reference}` : ''}` },
            ],
          },
          {
            type: 'summary_box',
            title: isAr ? 'المبلغ والوضعية المالية' : 'Montant & situation du contrat',
            rows: [
              {
                label: p.direction === 'REFUND' ? (isAr ? 'مبلغ الاسترجاع' : 'Montant remboursé') : isAr ? 'المبلغ المدفوع' : 'Montant encaissé',
                value: money(Number(p.amount_minor), currency),
                highlight: true,
              },
              { label: isAr ? 'إجمالي العقد' : 'Total contrat', value: money(Number(p.total_contract_amount_minor), currency) },
              { label: isAr ? 'إجمالي المدفوع حتى الآن' : 'Total payé cumulé', value: money(netPaid, currency) },
              { label: isAr ? 'الباقي المستحق' : 'Solde restant dû', value: money(remaining, currency), highlight: true },
            ],
          },
          ...(p.description
            ? [{ type: 'text_block' as const, title: isAr ? 'البيان' : 'Libellé', text: p.description }]
            : []),
          {
            type: 'signatures',
            leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
            rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
            leftSubtitle: p.recorded_by_name || tpl.agencyName,
            rightSubtitle: p.customer_name,
          },
        ],
        links: {
          contractId: Number(p.contract_id),
          paymentId: Number(p.id),
          customerId: Number(p.customer_id),
          vehicleId: Number(p.vehicle_id),
        },
      };
    }

    case 'DEPOSIT_RECEIPT':
    case 'DEPOSIT_SETTLEMENT': {
      let depId = params.depositId ?? null;
      if (!depId && params.contractId) {
        const dRow = db.prepare<[number], { id: number }>('SELECT id FROM deposits WHERE contract_id = ?').get(params.contractId);
        depId = dRow?.id ?? null;
      }
      if (!depId) throw new AuthError('VALIDATION_ERROR', 'Caution requise');
      const det = getDepositDetail(db, depId);
      const dep = det.deposit;
      const currency = (dep.currency || 'DZD') as CurrencyCode;

      const sections: DocumentSectionBlock[] = [
        {
          type: 'kv_grid',
          title: isAr ? 'معلومات الكفالة' : 'Identification du dépôt de garantie',
          columns: 2,
          items: [
            { label: isAr ? 'العقد' : 'Contrat', value: num(dep.contractNumber), emphasize: true },
            { label: isAr ? 'الزبون' : 'Client', value: dep.customerName },
            { label: isAr ? 'المركبة' : 'Véhicule', value: dep.vehicleLabel },
            { label: isAr ? 'حالة الكفالة' : 'Statut caution', value: dep.status, emphasize: true },
            { label: isAr ? 'تاريخ الاستلام' : 'Date de dépôt', value: dt(dep.receivedDate, true) },
            { label: isAr ? 'تاريخ التصفية' : 'Date de règlement', value: dt(dep.returnedDate, true) },
          ],
        },
        {
          type: 'summary_box',
          title: isAr ? 'توازن مبلغ الضمان' : 'Situation de la caution',
          rows: [
            { label: isAr ? 'مبلغ الكفالة الأولي' : 'Montant initial consigné', value: money(dep.amountMinor, currency), highlight: true },
            { label: isAr ? 'المبلغ المقتطع' : 'Total retenu (dommages / frais)', value: money(dep.deductedAmountMinor, currency) },
            { label: isAr ? 'المبلغ المسترجع للزبون' : 'Montant restitué au client', value: money(dep.refundedAmountMinor, currency), highlight: true },
            { label: isAr ? 'الرصيد المتبقي قيد الحجز' : 'Solde encore bloqué', value: money(Math.max(0, dep.amountMinor - dep.deductedAmountMinor - dep.refundedAmountMinor), currency) },
          ],
        },
      ];

      if (params.documentKind === 'DEPOSIT_SETTLEMENT' || det.movements.length > 0) {
        sections.push({
          type: 'table',
          title: isAr ? 'حركات الكفالة والاقتطاعات' : 'Journal des mouvements & déductions',
          columns: [
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', widthWeight: 1 },
            { key: 'type', label: isAr ? 'العملية' : 'Opération', widthWeight: 1 },
            { key: 'reason', label: isAr ? 'التبرير' : 'Motif / Catégorie', widthWeight: 1.8 },
            { key: 'amount', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
          ],
          rows: det.movements.map((m) => ({
            date: dt(m.createdAt, false),
            type: `${m.movementType}${m.paymentMethod ? ` (${m.paymentMethod})` : ''}`,
            reason: [m.chargeCategory, m.reason].filter(Boolean).join(' · ') || '—',
            amount: money(m.amountMinor, currency),
          })),
        });
      }

      sections.push({
        type: 'text_block',
        title: isAr ? 'تنبيه قانوني ومحاسبي' : 'Mention de garantie',
        muted: true,
        text: isAr
          ? 'تُحفظ الكفالة كأمانة لضمان سلامة المركبة والالتزامات التعاقدية، وتُرد عند الإرجاع بعد معاينة الحالة العامة.'
          : 'La caution constitue un dépôt de garantie non assimilé à un loyer et est restituée conformément aux constatations de retour.',
      });

      sections.push({
        type: 'signatures',
        leftLabel: isAr ? tpl.signatureAgencyAr : tpl.signatureAgencyFr,
        rightLabel: isAr ? tpl.signatureCustomerAr : tpl.signatureCustomerFr,
        leftSubtitle: tpl.agencyName,
        rightSubtitle: dep.customerName,
      });

      return {
        title,
        subtitle: `${dep.contractNumber} · ${dep.customerName}`,
        sections,
        links: { contractId: dep.contractId, depositId: dep.id, customerId: dep.customerId, vehicleId: dep.vehicleId },
      };
    }

    case 'INVOICE': {
      if (!params.contractId) throw new AuthError('VALIDATION_ERROR', 'Contrat requis pour émettre la facture');
      const detail = getContractDetail(db, params.contractId);
      const c = detail.contract;
      const custProf = getCustomerProfile(db, c.customerId);
      const customer = custProf.customer;
      const company = custProf.company;
      const veh = getVehicleProfile(db, c.vehicleId).vehicle;
      const currency = (c.currency || 'DZD') as CurrencyCode;
      const taxRate = params.taxRatePercent ?? tpl.invoiceTaxRatePercent ?? 0;

      const grossSubtotal =
        c.baseRentalTotalMinor +
        c.extensionTotalMinor +
        c.extraKmChargeMinor +
        c.lateFeeMinor +
        c.damageChargeMinor +
        c.otherChargesMinor;
      const discount = c.discountMinor;
      const netHt = Math.max(0, grossSubtotal - discount);
      const taxMinor = Math.round((netHt * taxRate) / 100);
      const totalTtc = netHt + taxMinor;
      const paidNet = detail.payments.reduce((s, p) => s + (p.direction === 'INFLOW' ? p.amountMinor : -p.amountMinor), 0);

      const lineRows: Array<Record<string, string>> = [
        { item: isAr ? 'كراء المركبة الأساسي' : `Location véhicule (${veh.brand} ${veh.model} · ${veh.matricule})`, amount: money(c.baseRentalTotalMinor, currency) },
      ];
      if (c.extensionTotalMinor > 0) lineRows.push({ item: isAr ? 'تمديدات العقد' : 'Prolongations de contrat', amount: money(c.extensionTotalMinor, currency) });
      if (c.extraKmChargeMinor > 0) lineRows.push({ item: isAr ? 'كيلومترات إضافية' : 'Kilométrage supplémentaire', amount: money(c.extraKmChargeMinor, currency) });
      if (c.lateFeeMinor > 0) lineRows.push({ item: isAr ? 'غرامة التأخير' : 'Frais de retard', amount: money(c.lateFeeMinor, currency) });
      if (c.damageChargeMinor > 0) lineRows.push({ item: isAr ? 'تعويض الأضرار' : 'Refacturation dommages', amount: money(c.damageChargeMinor, currency) });
      if (c.otherChargesMinor > 0) lineRows.push({ item: isAr ? 'رسوم أخرى' : 'Autres frais', amount: money(c.otherChargesMinor, currency) });
      if (discount > 0) lineRows.push({ item: isAr ? 'تخفيض تجاري' : 'Remise commerciale', amount: `-${money(discount, currency)}` });

      const issueDateIso = new Date().toISOString().slice(0, 10);

      return {
        title,
        subtitle: `${c.contractNumber} · ${customer.fullName}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بيانات الفاتورة والزبون' : 'Facturation & client',
            columns: 2,
            items: [
              { label: isAr ? 'الزبون' : 'Facturé à', value: company?.companyName || customer.fullName, emphasize: true },
              { label: isAr ? 'العقد المرجعي' : 'Contrat de référence', value: num(c.contractNumber) },
              { label: isAr ? 'الهاتف / العنوان' : 'Tél / Adresse', value: [num(customer.phone), customer.address].filter(Boolean).join(' · ') },
              ...(company
                ? [{ label: isAr ? 'السجل / الرقم الجبائي للزبون' : 'RC / NIF Client', value: [company.rcNumber, company.nifNumber].filter(Boolean).join(' · ') || '—' }]
                : [{ label: isAr ? 'رقم التعريف' : 'CNI / Permis', value: num(customer.cniNumber || customer.drivingLicenceNumber) }]),
            ],
          },
          {
            type: 'table',
            title: isAr ? 'تفصيل البنود المفوترة' : 'Détail des prestations facturées',
            columns: [
              { key: 'item', label: isAr ? 'البيان' : 'Désignation', widthWeight: 3 },
              { key: 'amount', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1.2, align: isAr ? 'left' : 'right' },
            ],
            rows: lineRows,
          },
          {
            type: 'summary_box',
            title: isAr ? 'الإجمالي والرصيد' : 'Récapitulatif facture',
            rows: [
              { label: isAr ? 'المجموع الصافي' : 'Total net HT', value: money(netHt, currency) },
              { label: isAr ? `الضريبة (${num(taxRate)}%)` : `Taxe / TVA (${num(taxRate)}%)`, value: money(taxMinor, currency) },
              { label: isAr ? 'الإجمالي المستحق' : 'TOTAL FACTURÉ', value: money(totalTtc, currency), highlight: true },
              { label: isAr ? 'المبالغ المسددة' : 'Déjà réglé', value: money(paidNet, currency) },
              { label: isAr ? 'الباقي للدفع' : 'Net à payer', value: money(Math.max(0, totalTtc - paidNet), currency), highlight: true },
            ],
          },
          {
            type: 'text_block',
            title: isAr ? 'ملاحظة قانونية' : 'Mention de facturation',
            muted: true,
            text:
              (isAr ? tpl.invoiceDisclaimerAr : tpl.invoiceDisclaimerFr) +
              (tpl.invoiceFiscallyCompliant ? '' : isAr ? '\n(وضع الفوترة الداخلية غير الجبائية)' : '\n(Statut : document de facturation interne selon paramétrage agence)'),
          },
        ],
        links: { contractId: c.id, customerId: c.customerId, vehicleId: c.vehicleId },
        invoiceCreateData: {
          contractId: c.id,
          customerId: c.customerId,
          issueDate: issueDateIso,
          subtotalMinor: netHt,
          discountMinor: discount,
          taxRatePercent: taxRate,
          taxMinor,
          totalMinor: totalTtc,
          currency,
          isFiscallyCompliant: tpl.invoiceFiscallyCompliant,
          notes: params.notes ?? null,
        },
      };
    }

    case 'EXPENSE_RECEIPT': {
      if (!params.expenseId) throw new AuthError('VALIDATION_ERROR', 'Dépense requise');
      const e = db
        .prepare<[number], any>(
          `SELECT e.*, v.matricule, v.brand, v.model, s.name AS supplier_name, u.full_name AS recorded_by_name
           FROM expenses e
           LEFT JOIN vehicles v ON v.id = e.vehicle_id
           LEFT JOIN suppliers s ON s.id = e.supplier_id
           LEFT JOIN users u ON u.id = e.recorded_by_user_id
           WHERE e.id = ?`
        )
        .get(params.expenseId);
      if (!e) throw new AuthError('NOT_FOUND', 'Dépense introuvable');
      const currency = (e.currency || 'DZD') as CurrencyCode;

      return {
        title,
        subtitle: `${e.expense_number} · ${e.category}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بيانات المصروف' : 'Détails de la dépense',
            columns: 2,
            items: [
              { label: isAr ? 'المرجع' : 'N° Dépense', value: num(e.expense_number), emphasize: true },
              { label: isAr ? 'التاريخ' : 'Date', value: dt(e.expense_date) },
              { label: isAr ? 'الفئة' : 'Catégorie', value: e.category },
              { label: isAr ? 'الحالة' : 'Statut', value: e.status || 'POSTED' },
              { label: isAr ? 'المركبة المعنية' : 'Véhicule affecté', value: e.matricule ? `${e.brand} ${e.model} (${num(e.matricule)})` : isAr ? 'مصاريف عامة للوكالة' : 'Charge générale agence' },
              { label: isAr ? 'المورد' : 'Fournisseur', value: e.supplier_name || '—' },
              { label: isAr ? 'وسيلة الدفع' : 'Moyen de paiement', value: `${e.payment_method}${e.payment_reference ? ` · ${e.payment_reference}` : ''}` },
              { label: isAr ? 'سجلت من طرف' : 'Enregistré par', value: e.recorded_by_name || '—' },
            ],
          },
          {
            type: 'summary_box',
            title: isAr ? 'المبلغ المصروف' : 'Montant engagé',
            rows: [
              { label: isAr ? 'المبلغ الإجمالي' : 'Montant de la dépense', value: money(Number(e.amount_minor), currency), highlight: true },
            ],
          },
          { type: 'text_block', title: isAr ? 'البيان' : 'Description / Objet', text: e.description },
        ],
        links: {
          expenseId: Number(e.id),
          vehicleId: e.vehicle_id != null ? Number(e.vehicle_id) : null,
          maintenanceRecordId: e.maintenance_record_id != null ? Number(e.maintenance_record_id) : null,
        },
      };
    }

    case 'MAINTENANCE_REPORT': {
      if (!params.maintenanceRecordId) throw new AuthError('VALIDATION_ERROR', 'Intervention maintenance requise');
      const det = getMaintenanceRecordDetail(db, params.maintenanceRecordId);
      const r = det.record;

      return {
        title,
        subtitle: `${r.recordNumber || `MNT-${r.id}`} · ${r.vehicleMatricule}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بيانات التدخل' : 'Fiche d’intervention',
            columns: 2,
            items: [
              { label: isAr ? 'رقم التدخل' : 'N° Intervention', value: num(r.recordNumber || `MNT-${r.id}`), emphasize: true },
              { label: isAr ? 'نوع الصيانة' : 'Type', value: isAr ? r.maintenanceTypeNameAr : r.maintenanceTypeNameFr },
              { label: isAr ? 'المركبة' : 'Véhicule', value: r.vehicleLabel, emphasize: true },
              { label: isAr ? 'العداد المسجل' : 'Kilométrage relevé', value: `${num(r.odometerKm)} km` },
              { label: isAr ? 'التاريخ' : 'Date réalisation', value: dt(r.performedDate) },
              { label: isAr ? 'الحالة' : 'Statut', value: r.status },
              { label: isAr ? 'المورد / الورشة' : 'Atelier / Fournisseur', value: r.supplierName || r.technicianName || '—' },
              { label: isAr ? 'الموعد القادم' : 'Prochaine échéance', value: [dt(r.nextDueDate), r.nextDueOdometerKm != null ? `${num(r.nextDueOdometerKm)} km` : ''].filter(Boolean).join(' · ') },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'قطع الغيار المستهلكة من المخزون' : 'Pièces détachées consommées',
            columns: [
              { key: 'code', label: isAr ? 'الرمز' : 'Réf.', widthWeight: 1 },
              { key: 'name', label: isAr ? 'القطعة' : 'Désignation', widthWeight: 1.8 },
              { key: 'qty', label: isAr ? 'الكمية' : 'Qté', widthWeight: 0.7, align: 'center' },
              { key: 'unitCost', label: isAr ? 'سعر الوحدة' : 'Coût unit.', widthWeight: 1, align: isAr ? 'left' : 'right' },
              { key: 'total', label: isAr ? 'المجموع' : 'Sous-total', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: det.parts.map((pc) => ({
              code: pc.partCode,
              name: pc.partName,
              qty: num(pc.quantityUsed),
              unitCost: money(pc.unitCostMinor),
              total: money(pc.totalCostMinor),
            })),
          },
          {
            type: 'summary_box',
            title: isAr ? 'تكلفة الصيانة' : 'Récapitulatif des coûts',
            rows: [
              { label: isAr ? 'اليد العاملة' : 'Main d’œuvre', value: money(r.laborCostMinor) },
              { label: isAr ? 'قطع الغيار' : 'Pièces détachées', value: money(r.partsCostMinor) },
              { label: isAr ? 'التكلفة الإجمالية' : 'COÛT TOTAL', value: money(r.totalCostMinor), highlight: true },
            ],
          },
          { type: 'text_block', title: isAr ? 'الأشغال المنجزة' : 'Travaux effectués', text: [r.workDescription, r.notes].filter(Boolean).join('\n') },
        ],
        links: { maintenanceRecordId: r.id, vehicleId: r.vehicleId },
      };
    }

    case 'VEHICLE_HISTORY': {
      if (!params.vehicleId) throw new AuthError('VALIDATION_ERROR', 'Véhicule requis');
      const vehProf = getVehicleProfile(db, params.vehicleId);
      const overview = getVehicleMaintenanceOverview(db, params.vehicleId);
      const v = vehProf.vehicle;
      const docs = db.prepare<[number], any>('SELECT * FROM vehicle_documents WHERE vehicle_id = ? ORDER BY expiration_date ASC').all(params.vehicleId);
      const contracts = db
        .prepare<[number], any>(
          `SELECT rc.contract_number, rc.status, rc.start_date, rc.expected_return_date, rc.total_contract_amount_minor, c.full_name
           FROM rental_contracts rc JOIN customers c ON c.id = rc.customer_id
           WHERE rc.vehicle_id = ? ORDER BY rc.start_date DESC LIMIT 40`
        )
        .all(params.vehicleId);
      const expenses = db
        .prepare<[number], any>("SELECT expense_number, expense_date, category, amount_minor, description FROM expenses WHERE vehicle_id = ? AND status = 'POSTED' ORDER BY expense_date DESC LIMIT 40")
        .all(params.vehicleId);

      return {
        title,
        subtitle: `${v.brand} ${v.model} (${v.matricule})`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بطاقة المركبة' : 'Fiche technique du véhicule',
            columns: 2,
            items: [
              { label: isAr ? 'المركبة' : 'Modèle', value: `${v.brand} ${v.model} (${num(v.year)})`, emphasize: true },
              { label: isAr ? 'الترقيم' : 'Matricule', value: num(v.matricule), emphasize: true },
              { label: 'VIN', value: num(v.vin) },
              { label: isAr ? 'العداد الحالي' : 'Kilométrage actuel', value: `${num(v.currentOdometerKm)} km` },
              { label: isAr ? 'الفئة / الحالة' : 'Catégorie / Statut', value: `${v.category} · ${v.status}` },
              { label: isAr ? 'السعر اليومي الافتراضي' : 'Tarif journalier', value: money(v.defaultDailyRateMinor) },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'الوثائق الإدارية' : 'Documents administratifs',
            columns: [
              { key: 'docType', label: isAr ? 'الوثيقة' : 'Type', widthWeight: 1.2 },
              { key: 'num', label: isAr ? 'الرقم' : 'N°', widthWeight: 1.2 },
              { key: 'exp', label: isAr ? 'انتهاء الصلاحية' : 'Expiration', widthWeight: 1 },
            ],
            rows: docs.map((d) => ({ docType: d.doc_type, num: d.document_number || '—', exp: dt(d.expiration_date) })),
          },
          {
            type: 'table',
            title: isAr ? 'سجل العقود' : 'Historique des locations',
            columns: [
              { key: 'num', label: isAr ? 'العقد' : 'Contrat', widthWeight: 1 },
              { key: 'cust', label: isAr ? 'الزبون' : 'Client', widthWeight: 1.5 },
              { key: 'period', label: isAr ? 'الفترة' : 'Période', widthWeight: 1.4 },
              { key: 'total', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: contracts.map((c) => ({
              num: c.contract_number,
              cust: c.full_name,
              period: `${dt(c.start_date)} -> ${dt(c.expected_return_date)}`,
              total: money(Number(c.total_contract_amount_minor)),
            })),
          },
          {
            type: 'table',
            title: isAr ? 'سجل الصيانة' : 'Historique de maintenance',
            columns: [
              { key: 'date', label: isAr ? 'التاريخ' : 'Date', widthWeight: 0.9 },
              { key: 'type', label: isAr ? 'العملية' : 'Intervention', widthWeight: 1.5 },
              { key: 'km', label: isAr ? 'العداد' : 'Km', widthWeight: 0.8 },
              { key: 'cost', label: isAr ? 'التكلفة' : 'Coût', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: overview.records.slice(0, 40).map((mr) => ({
              date: dt(mr.performedDate),
              type: mr.workDescription,
              km: `${num(mr.odometerKm)} km`,
              cost: money(mr.totalCostMinor),
            })),
          },
          {
            type: 'table',
            title: isAr ? 'المصاريف المباشرة على المركبة' : 'Dépenses directes affectées',
            columns: [
              { key: 'ref', label: isAr ? 'المرجع' : 'Réf.', widthWeight: 1 },
              { key: 'date', label: isAr ? 'التاريخ' : 'Date', widthWeight: 0.9 },
              { key: 'cat', label: isAr ? 'الفئة' : 'Catégorie', widthWeight: 1 },
              { key: 'amt', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: expenses.map((ex) => ({
              ref: ex.expense_number,
              date: dt(ex.expense_date),
              cat: ex.category,
              amt: money(Number(ex.amount_minor)),
            })),
          },
        ],
        links: { vehicleId: params.vehicleId },
      };
    }

    case 'CUSTOMER_STATEMENT': {
      if (!params.customerId) throw new AuthError('VALIDATION_ERROR', 'Client requis pour le relevé de compte');
      const profile = getCustomerProfile(db, params.customerId);
      const cust = profile.customer;
      const fin = computeCustomerFinancialMetrics(db, params.customerId);

      const payments = db
        .prepare<[number], any>(
          `SELECT cp.receipt_number, cp.payment_date, cp.direction, cp.method, cp.amount_minor, cp.currency, rc.contract_number
           FROM contract_payments cp
           JOIN rental_contracts rc ON rc.id = cp.contract_id
           WHERE rc.customer_id = ?
           ORDER BY cp.payment_date DESC, cp.id DESC`
        )
        .all(params.customerId);

      const adjustments = db
        .prepare<[number], any>(
          `SELECT adjustment_date, adjustment_type, amount_minor, currency, reason
           FROM customer_financial_adjustments WHERE customer_id = ? ORDER BY adjustment_date DESC`
        )
        .all(params.customerId);

      return {
        title,
        subtitle: `${cust.fullName} · ${cust.phone}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'معلومات الزبون' : 'Identification du client',
            columns: 2,
            items: [
              { label: isAr ? 'الاسم الكامل' : 'Client', value: cust.fullName, emphasize: true },
              { label: isAr ? 'الهاتف' : 'Téléphone', value: num(cust.phone) },
              { label: isAr ? 'مستوى المخاطر' : 'Niveau de risque', value: cust.riskStatus },
              { label: isAr ? 'العنوان' : 'Adresse', value: cust.address || '—' },
            ],
          },
          {
            type: 'summary_box',
            title: isAr ? 'ملخص الحساب المالي' : 'Situation financière globale',
            rows: [
              { label: isAr ? 'إجمالي العقود المستحقة' : 'Total facturé (Contrats)', value: money(fin.totalChargedMinor) },
              { label: isAr ? 'إجمالي التعديلات الصافية' : 'Ajustements nets (Avoirs / Débits)', value: money(fin.debitAdjustmentsMinor - fin.creditAndWriteOffMinor) },
              { label: isAr ? 'إجمالي المدفوع الصافي' : 'Total réglé net', value: money(fin.netPaidMinor) },
              { label: isAr ? 'الرصيد المتبقي للدفع' : 'SOLDE RESTANT DÛ', value: money(fin.outstandingBalanceMinor), highlight: true },
              { label: isAr ? 'المبلغ المتأخر عن السداد' : 'Dont solde échu / en retard', value: money(fin.overdueDebtMinor) },
              { label: isAr ? 'الكفالات المحجوزة حالياً' : 'Cautions actuellement détenues', value: money(fin.heldDepositsMinor) },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'سجل العقود' : 'Contrats du client',
            columns: [
              { key: 'num', label: isAr ? 'العقد' : 'Contrat', widthWeight: 1 },
              { key: 'veh', label: isAr ? 'المركبة' : 'Véhicule', widthWeight: 1.5 },
              { key: 'dates', label: isAr ? 'الفترة' : 'Période', widthWeight: 1.3 },
              { key: 'status', label: isAr ? 'الحالة' : 'Statut', widthWeight: 0.8 },
              { key: 'total', label: isAr ? 'الإجمالي' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: profile.rentalHistory.map((r) => ({
              num: r.contractNumber,
              veh: r.vehicleLabel,
              dates: `${dt(r.startDate)} -> ${dt(r.expectedReturnDate)}`,
              status: r.status,
              total: money(r.totalContractAmountMinor, r.currency as CurrencyCode),
            })),
          },
          {
            type: 'table',
            title: isAr ? 'سجل المدفوعات والاسترجاعات' : 'Paiements & remboursements',
            columns: [
              { key: 'rec', label: isAr ? 'الوصل' : 'Reçu', widthWeight: 1 },
              { key: 'date', label: isAr ? 'التاريخ' : 'Date', widthWeight: 0.9 },
              { key: 'ctr', label: isAr ? 'العقد' : 'Contrat', widthWeight: 1 },
              { key: 'dir', label: isAr ? 'العملية' : 'Type', widthWeight: 1 },
              { key: 'amt', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: payments.map((p) => ({
              rec: p.receipt_number,
              date: dt(p.payment_date),
              ctr: p.contract_number,
              dir: `${p.direction} (${p.method})`,
              amt: money(Number(p.amount_minor), (p.currency || 'DZD') as CurrencyCode),
            })),
          },
          ...(adjustments.length > 0
            ? [
                {
                  type: 'table' as const,
                  title: isAr ? 'التسويات المالية' : 'Ajustements & avoirs',
                  columns: [
                    { key: 'date', label: isAr ? 'التاريخ' : 'Date', widthWeight: 0.9 },
                    { key: 'type', label: isAr ? 'النوع' : 'Type', widthWeight: 1 },
                    { key: 'reason', label: isAr ? 'السبب' : 'Motif', widthWeight: 1.8 },
                    { key: 'amt', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' as const : 'right' as const },
                  ],
                  rows: adjustments.map((a) => ({
                    date: dt(a.adjustment_date),
                    type: a.adjustment_type,
                    reason: a.reason,
                    amt: money(Number(a.amount_minor), (a.currency || 'DZD') as CurrencyCode),
                  })),
                },
              ]
            : []),
        ],
        links: { customerId: cust.id },
      };
    }

    case 'CASH_REGISTER_CLOSING': {
      let sid = params.cashSessionId ?? null;
      if (!sid) {
        const latest = db.prepare<[], { id: number }>('SELECT id FROM cash_register_sessions ORDER BY id DESC LIMIT 1').get();
        sid = latest?.id ?? null;
      }
      if (!sid) throw new AuthError('NOT_FOUND', 'Aucune session de caisse disponible');
      const det = getCashSessionDetail(db, sid);
      const s = det.session;

      return {
        title,
        subtitle: `${s.sessionDate} · ${s.status}`,
        sections: [
          {
            type: 'kv_grid',
            title: isAr ? 'بيانات جلسة الصندوق' : 'Identification de la session de caisse',
            columns: 2,
            items: [
              { label: isAr ? 'تاريخ الجلسة' : 'Date session', value: dt(s.sessionDate), emphasize: true },
              { label: isAr ? 'الحالة' : 'Statut', value: s.status },
              { label: isAr ? 'فتح بواسطة' : 'Ouverte par', value: `${s.openedByUsername || '—'} (${dt(s.openedAt, true)})` },
              { label: isAr ? 'إغلاق بواسطة' : 'Clôturée par', value: s.closedByUsername ? `${s.closedByUsername} (${dt(s.closedAt, true)})` : '—' },
            ],
          },
          {
            type: 'summary_box',
            title: isAr ? 'حساب والمطابقة النقدية' : 'Réconciliation de caisse',
            rows: [
              { label: isAr ? 'الرصيد الافتتاحي' : 'Fond d’ouverture', value: money(s.openingBalanceMinor) },
              { label: isAr ? 'إجمالي المداخيل النقدية' : 'Total encaissements espèces', value: money(s.cashReceivedMinor) },
              { label: isAr ? 'المبالغ المسترجعة نقداً' : 'Remboursements espèces', value: `-${money(s.cashRefundedMinor)}` },
              { label: isAr ? 'المصاريف النقدية' : 'Dépenses en espèces', value: `-${money(s.cashExpensesMinor)}` },
              { label: isAr ? 'تعديلات الصندوق' : 'Ajustements manuels', value: money(s.cashAdjustmentsMinor ?? 0) },
              { label: isAr ? 'الرصيد النظري المتوقع' : 'SOLDE THÉORIQUE ATTENDU', value: money(s.expectedClosingMinor), highlight: true },
              { label: isAr ? 'الرصيد الفعلي المعدود' : 'SOLDE RÉEL COMPTÉ', value: s.actualClosingMinor != null ? money(s.actualClosingMinor) : '—', highlight: true },
              { label: isAr ? 'فارق الصندوق' : 'Écart de caisse', value: s.discrepancyMinor != null ? money(s.discrepancyMinor) : '—' },
            ],
          },
          {
            type: 'table',
            title: isAr ? 'تفصيل الحركات النقدية' : 'Mouvements de caisse enregistrés',
            columns: [
              { key: 'time', label: isAr ? 'الوقت' : 'Horodatage', widthWeight: 1.1 },
              { key: 'type', label: isAr ? 'النوع' : 'Type', widthWeight: 1.2 },
              { key: 'desc', label: isAr ? 'البيان' : 'Libellé', widthWeight: 2 },
              { key: 'amt', label: isAr ? 'المبلغ' : 'Montant', widthWeight: 1, align: isAr ? 'left' : 'right' },
            ],
            rows: det.movements.map((m) => ({
              time: dt(m.createdAt, true),
              type: m.movementType,
              desc: m.description || '—',
              amt: money(m.amountMinor),
            })),
          },
          ...(s.discrepancyNotes || s.openingNotes
            ? [{ type: 'text_block' as const, title: isAr ? 'ملاحظات الإغلاق' : 'Observations ouverture / clôture', text: [s.openingNotes, s.discrepancyNotes].filter(Boolean).join('\n') }]
            : []),
          {
            type: 'signatures',
            leftLabel: isAr ? 'أمين الصندوق / الوكيل' : 'Caissier / Agent',
            rightLabel: isAr ? 'المدير / المراقبة' : 'Visa Direction',
            leftSubtitle: s.openedByUsername || '—',
            rightSubtitle: s.closedByUsername || tpl.agencyName,
          },
        ],
        links: { cashSessionId: s.id },
      };
    }

    case 'FINANCIAL_SUMMARY':
    case 'CUSTOM_REPORT': {
      const effectiveFilter: ReportFilter = params.reportFilter ?? {
        category: params.documentKind === 'FINANCIAL_SUMMARY' ? 'FINANCIAL' : 'CUSTOM',
        dateFrom: params.dateFrom ?? undefined,
        dateTo: params.dateTo ?? undefined,
        customerId: params.customerId ?? undefined,
        vehicleId: params.vehicleId ?? undefined,
        language: lang,
      };
      const dataset = generateReportDataset(db, { ...effectiveFilter, language: lang });
      return {
        title: isAr ? dataset.titleAr : dataset.titleFr,
        subtitle: `${dt(dataset.appliedFilters.dateFrom)} -> ${dt(dataset.appliedFilters.dateTo)}`,
        sections: reportDatasetToPdfSections(dataset, lang, numSys),
        links: {
          customerId: effectiveFilter.customerId ?? null,
          vehicleId: effectiveFilter.vehicleId ?? null,
        },
      };
    }
  }
}

export function serializeSnapshotPayload(payload: DocumentRenderPayload) {
  return {
    title: payload.title,
    subtitle: payload.subtitle ?? null,
    issueDateDisplay: payload.issueDateDisplay,
    sections: payload.sections,
  };
}
