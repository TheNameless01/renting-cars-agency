import { z } from 'zod';
import {
  ALGERIA_WILAYA_CODES,
  STANDARD_ALGERIAN_MATRICULE_REGEX,
} from '../constants/algeria.ts';

export const LoginSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(4).max(128),
});

export const BootstrapAdminSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
});

export const UnlockSessionSchema = z.object({
  password: z.string().min(1).max(128),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const CreateUserSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
  roleCode: z.enum(['ADMIN', 'AGENT']),
});

export const UpdateUserSchema = z.object({
  userId: z.number().int().positive(),
  fullName: z.string().trim().min(2).max(120).optional(),
  roleCode: z.enum(['ADMIN', 'AGENT']).optional(),
  isActive: z.boolean().optional(),
  unlockAccount: z.boolean().optional(),
  resetPassword: z.string().min(8).max(128).optional(),
  permissionOverrides: z
    .array(
      z.object({
        code: z.string().min(3),
        granted: z.boolean().nullable(),
      })
    )
    .optional(),
});

export const UpdateSettingsBatchSchema = z.object({
  updates: z
    .array(
      z.object({
        key: z.string().trim().min(2).max(120),
        group: z.enum(['agency', 'business', 'documents', 'app']),
        value: z.string().max(4000),
      })
    )
    .min(1),
});

export const UpsertWilayaSchema = z.object({
  code: z.string().trim().min(2).max(6).regex(/^[A-Za-z0-9_-]+$/),
  nameFr: z.string().trim().min(2).max(100),
  nameAr: z.string().trim().min(2).max(100),
  isNewlyCreated2026: z.boolean(),
  parentWilayaCode: z.string().trim().max(6).nullable().optional(),
  decreeReference: z.string().trim().max(120).nullable().optional(),
  effectiveYear: z.number().int().min(1962).max(2100),
  isActive: z.boolean(),
  notes: z.string().max(500).nullable().optional(),
});

export const CreateVehicleSchema = z.object({
  internalCode: z.string().trim().min(1).max(32),
  matricule: z
    .string()
    .trim()
    .min(5)
    .max(32)
    .refine(
      (val) => STANDARD_ALGERIAN_MATRICULE_REGEX.test(val) || val.length >= 5,
      'Matricule invalide'
    ),
  vin: z.string().trim().max(32).nullable().optional(),
  brand: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(64),
  year: z.number().int().min(1980).max(2035),
  color: z.string().trim().min(1).max(40),
  category: z.string().trim().min(1).max(64),
  fuelType: z.enum(['ESSENCE', 'DIESEL', 'GPL', 'OTHER']),
  transmission: z.enum(['MANUAL', 'AUTOMATIC']),
  seats: z.number().int().min(2).max(9),
  currentOdometerKm: z.number().int().min(0),
  acquisitionDate: z.string().nullable().optional(),
  acquisitionCostMinor: z.number().int().min(0).nullable().optional(),
  defaultDailyRateMinor: z.number().int().min(0),
  defaultWeeklyRateMinor: z.number().int().min(0).nullable().optional(),
  defaultMonthlyRateMinor: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const CreateCustomerSchema = z.object({
  customerType: z.enum(['INDIVIDUAL', 'COMPANY']),
  fullName: z.string().trim().min(2).max(160),
  dateOfBirth: z.string().nullable().optional(),
  phone: z.string().trim().min(6).max(32),
  secondaryPhone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  wilayaCode: z
    .string()
    .refine((c) => !c || ALGERIA_WILAYA_CODES.has(c), 'Code wilaya invalide (01-69)')
    .nullable()
    .optional(),
  commune: z.string().trim().max(100).nullable().optional(),
  cniNumber: z.string().trim().max(64).nullable().optional(),
  passportNumber: z.string().trim().max(64).nullable().optional(),
  drivingLicenceNumber: z.string().trim().max(64).nullable().optional(),
  drivingLicenceIssueDate: z.string().nullable().optional(),
  drivingLicenceExpirationDate: z.string().nullable().optional(),
  internalNotes: z.string().max(2000).nullable().optional(),
  company: z
    .object({
      companyName: z.string().trim().min(2).max(180),
      legalRepresentative: z.string().trim().min(2).max(160),
      rcNumber: z.string().trim().max(64).nullable().optional(),
      nifNumber: z.string().trim().max(64).nullable().optional(),
      nisNumber: z.string().trim().max(64).nullable().optional(),
      artNumber: z.string().trim().max(64).nullable().optional(),
      bonDeCommandeNumber: z.string().trim().max(64).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const CreateRiskRecordSchema = z.object({
  customerId: z.number().int().positive(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLACKLISTED']),
  reason: z.enum([
    'UNPAID_DEBT',
    'TRAFFIC_FINE',
    'RADAR_FINE',
    'VEHICLE_DAMAGE',
    'LATE_RETURN',
    'CONTRACT_VIOLATION',
    'OTHER',
  ]),
  description: z.string().trim().min(5).max(2000),
  incidentDate: z.string().min(8),
});

export const CreateContractSchema = z.object({
  reservationId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  startDate: z.string().min(10),
  expectedReturnDate: z.string().min(10),
  departureOdometerKm: z.number().int().min(0),
  mileageMode: z.enum(['UNLIMITED', 'DAILY_ALLOWANCE', 'CUSTOM_TOTAL']),
  dailyMileageAllowanceKm: z.number().int().min(0).nullable().optional(),
  includedTotalKm: z.number().int().min(0).nullable().optional(),
  extraKmRateMinor: z.number().int().min(0),
  currency: z.enum(['DZD', 'EUR']).default('DZD'),
  baseRentalTotalMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0).default(0),
  depositAmountMinor: z.number().int().min(0),
  depositCurrency: z.enum(['DZD', 'EUR']).default('DZD'),
  initialPaymentMinor: z.number().int().min(0).default(0),
  initialPaymentMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  initialPaymentReference: z.string().max(128).nullable().optional(),
  blacklistOverrideReason: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const ExtendContractSchema = z.object({
  contractId: z.number().int().positive(),
  newReturnDate: z.string().min(10),
  additionalAmountMinor: z.number().int().min(0),
  additionalKmAllowance: z.number().int().min(0).default(0),
  notes: z.string().max(1000).nullable().optional(),
});

export const RecordPaymentSchema = z.object({
  contractId: z.number().int().positive(),
  direction: z.enum(['INFLOW', 'REFUND']),
  method: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['DZD', 'EUR']).default('DZD'),
  paymentDate: z.string().min(8),
  description: z.string().trim().max(500).nullable().optional(),
});

export const ReversePaymentSchema = z.object({
  paymentId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const SettleDepositSchema = z.object({
  depositId: z.number().int().positive(),
  deductedAmountMinor: z.number().int().min(0),
  refundedAmountMinor: z.number().int().min(0),
  chargeCategory: z
    .enum(['DAMAGE', 'TRAFFIC_FINE', 'LATE_FEE', 'EXTRA_KM', 'CLEANING', 'FUEL', 'OTHER'])
    .nullable()
    .optional(),
  deductionReason: z.string().trim().max(500).nullable().optional(),
  refundMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  trafficFineId: z.number().int().positive().nullable().optional(),
  supportingDoc: z
    .object({
      originalFileName: z.string().trim().min(1).max(200),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
      base64Data: z.string().min(4).max(8_000_000),
    })
    .nullable()
    .optional(),
});

export const CreateTrafficFineSchema = z.object({
  contractId: z.number().int().positive().nullable().optional(),
  vehicleId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  fineType: z.enum(['TRAFFIC', 'RADAR', 'PARKING', 'OTHER']),
  referenceNumber: z.string().trim().max(100).nullable().optional(),
  incurredDate: z.string().min(8),
  amountMinor: z.number().int().positive(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const OpenCashSessionSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  openingBalanceMinor: z.number().int().min(0),
  openingNotes: z.string().trim().max(500).nullable().optional(),
});

export const CloseCashSessionSchema = z.object({
  sessionId: z.number().int().positive(),
  actualClosingMinor: z.number().int().min(0),
  discrepancyNotes: z.string().trim().max(500).nullable().optional(),
});

export const RecordCashAdjustmentSchema = z.object({
  sessionId: z.number().int().positive(),
  amountDeltaMinor: z.number().int().refine((n) => n !== 0, 'Le montant ne peut pas être zéro'),
  reason: z.string().trim().min(3).max(500),
});

export const CreateCustomerAdjustmentSchema = z.object({
  customerId: z.number().int().positive(),
  contractId: z.number().int().positive().nullable().optional(),
  adjustmentType: z.enum(['CREDIT_NOTE', 'DEBIT_CHARGE', 'WRITE_OFF']),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['DZD', 'EUR']).default('DZD'),
  adjustmentDate: z.string().min(8),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const CreateSupplierSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  wilayaCode: z.string().trim().max(10).nullable().optional(),
  specialty: z.string().trim().max(120).nullable().optional(),
  nifNumber: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  isArchived: z.boolean().optional(),
});

export const UpsertSupplierSchema = CreateSupplierSchema;

export const CreateExpenseSchema = z.object({
  category: z.enum([
    'MAINTENANCE',
    'REPAIRS',
    'SPARE_PARTS',
    'INSURANCE',
    'VIGNETTE',
    'TECHNICAL_INSPECTION',
    'CLEANING',
    'ADMINISTRATIVE',
    'OTHER',
  ]),
  vehicleId: z.number().int().positive().nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  maintenanceRecordId: z.number().int().positive().nullable().optional(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['DZD', 'EUR']).default('DZD'),
  expenseDate: z.string().min(8),
  paymentMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  paymentReference: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().min(2).max(500),
  receiptDoc: z
    .object({
      originalFileName: z.string().trim().min(1).max(200),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
      base64Data: z.string().min(4).max(8_000_000),
    })
    .nullable()
    .optional(),
});

export const ReverseExpenseSchema = z.object({
  expenseId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export const InventoryMovementSchema = z.object({
  partId: z.number().int().positive(),
  movementType: z.enum(['PURCHASE', 'ENTRY', 'WITHDRAWAL', 'MAINTENANCE_USE', 'ADJUSTMENT']),
  quantityDelta: z.number().int().refine((n) => n !== 0, 'La quantité ne peut pas être zéro'),
  unitCostMinor: z.number().int().min(0).default(0),
  maintenanceRecordId: z.number().int().positive().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  overrideReason: z.string().max(500).nullable().optional(),
});

// Phase 2 Additions
export const UpdateVehicleSchema = CreateVehicleSchema.partial().extend({
  id: z.number().int().positive(),
  status: z.enum(['AVAILABLE', 'RENTED', 'RESERVED', 'MAINTENANCE']).optional(),
});

export const UpsertVehicleDocSchema = z.object({
  id: z.number().int().positive().optional(),
  vehicleId: z.number().int().positive(),
  docType: z.enum(['CARTE_GRISE', 'ASSURANCE', 'VIGNETTE', 'CONTROLE_TECHNIQUE']),
  documentNumber: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().nullable().optional(),
  expirationDate: z.string().min(8),
  reminderDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().max(500).nullable().optional(),
});

export const CreateBlockedPeriodSchema = z.object({
  vehicleId: z.number().int().positive(),
  blockType: z.enum(['MAINTENANCE', 'ADMIN_HOLD', 'OTHER']),
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  reason: z.string().trim().min(3).max(500),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial().extend({
  id: z.number().int().positive(),
});

export const ResolveRiskRecordSchema = z.object({
  riskRecordId: z.number().int().positive(),
  resolutionNotes: z.string().trim().min(3).max(1000),
  nextCustomerRiskStatus: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLACKLISTED']).optional(),
});

export const UploadCustomerDocSchema = z.object({
  customerId: z.number().int().positive(),
  docCategory: z.enum(['CNI', 'PASSPORT', 'DRIVING_LICENCE', 'COMPANY_RC', 'COMPANY_NIF', 'BON_COMMANDE', 'OTHER']),
  originalFileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  base64Data: z.string().min(4).max(8_000_000),
  documentNumber: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  reminderDays: z.number().int().min(0).max(365).default(30).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  replaceDocId: z.number().int().positive().nullable().optional(),
});

export const UpdateCustomerDocMetaSchema = z.object({
  docId: z.number().int().positive(),
  documentNumber: z.string().trim().max(100).nullable().optional(),
  issueDate: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  reminderDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const ArchiveCustomerDocSchema = z.object({
  docId: z.number().int().positive(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const CreateReservationSchema = z.object({
  customerId: z.number().int().positive(),
  vehicleId: z.number().int().positive(),
  startDate: z.string().min(10),
  expectedReturnDate: z.string().min(10),
  estimatedTotalMinor: z.number().int().min(0).default(0),
  status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
  notes: z.string().max(1000).nullable().optional(),
});

export const UpdateReservationStatusSchema = z.object({
  reservationId: z.number().int().positive(),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW']),
  notes: z.string().max(1000).nullable().optional(),
});

export const CalculatePriceSchema = z.object({
  vehicleId: z.number().int().positive(),
  customerId: z.number().int().positive().nullable().optional(),
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  pricingTier: z.enum(['AUTO', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']).default('AUTO'),
  customDailyRateMinor: z.number().int().min(0).nullable().optional(),
  customTotalMinor: z.number().int().min(0).nullable().optional(),
  discountType: z.enum(['NONE', 'FIXED', 'PERCENT']).default('NONE'),
  discountValue: z.number().min(0).default(0),
});

export const CreateSeasonalRateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  vehicleCategory: z.string().trim().max(64).nullable().optional(),
  vehicleId: z.number().int().positive().nullable().optional(),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  dailyRateMinor: z.number().int().min(0),
  weeklyRateMinor: z.number().int().min(0).nullable().optional(),
  monthlyRateMinor: z.number().int().min(0).nullable().optional(),
});

export const UpsertCustomerCustomRateSchema = z.object({
  customerId: z.number().int().positive(),
  vehicleCategory: z.string().trim().max(64).nullable().optional(),
  vehicleId: z.number().int().positive().nullable().optional(),
  dailyRateMinor: z.number().int().min(0).nullable().optional(),
  weeklyRateMinor: z.number().int().min(0).nullable().optional(),
  monthlyRateMinor: z.number().int().min(0).nullable().optional(),
  defaultDiscountPercent: z.number().min(0).max(100).default(0),
  notes: z.string().max(500).nullable().optional(),
});

export const CreateContractPhase2Schema = CreateContractSchema.extend({
  initialStatus: z.enum(['DRAFT', 'CONFIRMED', 'ACTIVE']).default('CONFIRMED'),
  pricingTier: z.enum(['AUTO', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM']).default('AUTO'),
  discountType: z.enum(['NONE', 'FIXED', 'PERCENT']).default('NONE'),
  discountValue: z.number().min(0).default(0),
  pricingBreakdownLabel: z.string().max(240).optional(),
  discountAuthorizationReason: z.string().max(500).nullable().optional(),
});

export const CompleteContractSchema = z.object({
  contractId: z.number().int().positive(),
  actualReturnDate: z.string().min(10),
  returnOdometerKm: z.number().int().min(0),
  odometerCorrectionReason: z.string().max(500).nullable().optional(),
  lateFeeMinor: z.number().int().min(0).default(0),
  damageChargeMinor: z.number().int().min(0).default(0),
  otherChargesMinor: z.number().int().min(0).default(0),
  notes: z.string().max(1000).nullable().optional(),
});

// Phase 4 Step 1: Vehicle Inspections & Damage Management
export const InspectionItemInputSchema = z.object({
  itemKey: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40).default('GENERAL'),
  labelFr: z.string().trim().min(1).max(200),
  labelAr: z.string().trim().min(1).max(200),
  condition: z.enum(['GOOD', 'DAMAGED', 'MISSING']),
  notes: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const InspectionDamageInputSchema = z.object({
  zoneCode: z.string().trim().min(1).max(60),
  diagramX: z.number().min(0).max(100).nullable().optional(),
  diagramY: z.number().min(0).max(100).nullable().optional(),
  damageType: z.enum(['SCRATCH', 'DENT', 'CRACK', 'BROKEN', 'MISSING_ACCESSORY', 'OTHER']),
  severity: z.enum(['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL']),
  description: z.string().trim().min(2).max(1000),
  isPreExisting: z.boolean().optional(),
  isNewlyDiscovered: z.boolean().optional(),
  estimatedRepairCostMinor: z.number().int().min(0).nullable().optional(),
});

export const CreateInspectionSchema = z.object({
  contractId: z.number().int().positive(),
  stage: z.enum(['DEPARTURE', 'RETURN']),
  odometerKm: z.number().int().min(0),
  fuelLevelPercent: z.number().int().min(0).max(100),
  exteriorNotes: z.string().trim().max(2000).nullable().optional(),
  interiorNotes: z.string().trim().max(2000).nullable().optional(),
  agencySignatureData: z.string().max(500_000).nullable().optional(),
  customerSignatureData: z.string().max(500_000).nullable().optional(),
  customerAcknowledged: z.boolean().default(false),
  customerAcknowledgmentNotes: z.string().trim().max(1000).nullable().optional(),
  inspectedAt: z.string().min(10).optional(),
  finalizeNow: z.boolean().default(false),
  items: z.array(InspectionItemInputSchema).min(1).optional(),
  damages: z.array(InspectionDamageInputSchema).optional(),
});

export const UpdateInspectionDraftSchema = z.object({
  inspectionId: z.number().int().positive(),
  odometerKm: z.number().int().min(0).optional(),
  fuelLevelPercent: z.number().int().min(0).max(100).optional(),
  exteriorNotes: z.string().trim().max(2000).nullable().optional(),
  interiorNotes: z.string().trim().max(2000).nullable().optional(),
  agencySignatureData: z.string().max(500_000).nullable().optional(),
  customerSignatureData: z.string().max(500_000).nullable().optional(),
  customerAcknowledged: z.boolean().optional(),
  customerAcknowledgmentNotes: z.string().trim().max(1000).nullable().optional(),
  inspectedAt: z.string().min(10).optional(),
  items: z.array(InspectionItemInputSchema).min(1).optional(),
});

export const UploadInspectionPhotoSchema = z.object({
  inspectionId: z.number().int().positive(),
  damageId: z.number().int().positive().nullable().optional(),
  originalFileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64Data: z.string().min(4).max(8_000_000),
  caption: z.string().trim().max(300).nullable().optional(),
});

export const AddVehicleDamageSchema = InspectionDamageInputSchema.extend({
  vehicleId: z.number().int().positive(),
  contractId: z.number().int().positive().nullable().optional(),
  inspectionId: z.number().int().positive().nullable().optional(),
});

export const UpdateDamageStatusSchema = z.object({
  damageId: z.number().int().positive(),
  newStatus: z.enum(['REPORTED', 'UNDER_REVIEW', 'CONFIRMED', 'UNDER_REPAIR', 'REPAIRED', 'REJECTED']),
  notes: z.string().trim().min(2).max(1000),
  estimatedRepairCostMinor: z.number().int().min(0).nullable().optional(),
  repairReference: z.string().trim().max(120).nullable().optional(),
  linkedExpenseId: z.number().int().positive().nullable().optional(),
});

// Phase 4 Step 2: Maintenance Management & Alerts
export const UpsertMaintenanceTypeSchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(2).max(50),
  nameFr: z.string().trim().min(2).max(150),
  nameAr: z.string().trim().min(2).max(150),
  defaultKmInterval: z.number().int().positive().nullable().optional(),
  defaultDayInterval: z.number().int().positive().nullable().optional(),
  kmWarningThreshold: z.number().int().min(0).default(1000),
  dayWarningThreshold: z.number().int().min(0).default(14),
  isActive: z.boolean().default(true),
});

export const UpsertVehicleMaintenanceScheduleSchema = z.object({
  vehicleId: z.number().int().positive(),
  maintenanceTypeId: z.number().int().positive(),
  kmInterval: z.number().int().positive().nullable().optional(),
  dayInterval: z.number().int().positive().nullable().optional(),
  kmWarningThreshold: z.number().int().min(0).default(1000),
  dayWarningThreshold: z.number().int().min(0).default(14),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const MaintenanceDocUploadSchema = z.object({
  originalFileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  base64Data: z.string().min(4).max(12_000_000),
});

export const MaintenancePartUsageSchema = z.object({
  partId: z.number().int().positive(),
  quantityUsed: z.number().int().positive(),
  unitCostMinor: z.number().int().min(0).optional(),
});

export const CreateMaintenanceRecordSchema = z.object({
  vehicleId: z.number().int().positive(),
  maintenanceTypeId: z.number().int().positive(),
  supplierId: z.number().int().positive().nullable().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED']).default('COMPLETED'),
  isEmergency: z.boolean().default(false),
  workDescription: z.string().trim().min(3).max(2000),
  performedDate: z.string().min(10).max(30),
  scheduledStartDate: z.string().min(10).max(30).nullable().optional(),
  scheduledEndDate: z.string().min(10).max(30).nullable().optional(),
  odometerKm: z.number().int().min(0),
  nextDueDate: z.string().min(10).max(30).nullable().optional(),
  nextDueOdometerKm: z.number().int().min(0).nullable().optional(),
  laborCostMinor: z.number().int().min(0).default(0),
  partsCostMinor: z.number().int().min(0).default(0),
  partsUsed: z.array(MaintenancePartUsageSchema).optional(),
  technicianName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  blockVehicle: z.boolean().default(false),
  recordInFinance: z.boolean().default(false),
  financeCategory: z.enum(['MAINTENANCE', 'REPAIRS']).default('MAINTENANCE'),
  financeExpenseScope: z.enum(['TOTAL', 'LABOR_ONLY']).default('TOTAL'),
  paymentMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  paymentReference: z.string().trim().max(120).nullable().optional(),
  invoiceDoc: MaintenanceDocUploadSchema.nullable().optional(),
});

export const UpdateMaintenanceRecordSchema = z.object({
  recordId: z.number().int().positive(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  workDescription: z.string().trim().min(3).max(2000).optional(),
  performedDate: z.string().min(10).max(30).optional(),
  scheduledStartDate: z.string().min(10).max(30).nullable().optional(),
  scheduledEndDate: z.string().min(10).max(30).nullable().optional(),
  odometerKm: z.number().int().min(0).optional(),
  nextDueDate: z.string().min(10).max(30).nullable().optional(),
  nextDueOdometerKm: z.number().int().min(0).nullable().optional(),
  laborCostMinor: z.number().int().min(0).optional(),
  partsCostMinor: z.number().int().min(0).optional(),
  partsUsed: z.array(MaintenancePartUsageSchema).optional(),
  technicianName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  blockVehicle: z.boolean().optional(),
  recordInFinance: z.boolean().optional(),
  financeCategory: z.enum(['MAINTENANCE', 'REPAIRS']).optional(),
  financeExpenseScope: z.enum(['TOTAL', 'LABOR_ONLY']).optional(),
  paymentMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).optional(),
  paymentReference: z.string().trim().max(120).nullable().optional(),
  invoiceDoc: MaintenanceDocUploadSchema.nullable().optional(),
});

// Phase 4 Step 3: Spare Parts Inventory
export const UpsertInventoryPartSchema = z.object({
  id: z.number().int().positive().optional(),
  partCode: z.string().trim().min(2).max(60),
  partName: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).nullable().optional(),
  unitLabel: z.string().trim().min(1).max(30).default('PIECE'),
  compatibleModels: z.string().trim().max(300).nullable().optional(),
  minimumStock: z.number().int().min(0).default(1),
  unitPurchasePriceMinor: z.number().int().min(0).default(0),
  supplierId: z.number().int().positive().nullable().optional(),
  storageLocation: z.string().trim().max(120).nullable().optional(),
  initialStock: z.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
});

export const RecordInventoryMovementSchema = z.object({
  partId: z.number().int().positive(),
  movementType: z.enum(['PURCHASE', 'ENTRY', 'WITHDRAWAL', 'RETURN']),
  quantity: z.number().int().positive(),
  unitCostMinor: z.number().int().min(0).optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  vehicleId: z.number().int().positive().nullable().optional(),
  maintenanceRecordId: z.number().int().positive().nullable().optional(),
  referenceCode: z.string().trim().max(100).nullable().optional(),
  movementDate: z.string().min(8).max(30).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  recordInFinance: z.boolean().default(false),
  paymentMethod: z.enum(['CASH', 'CCP', 'BARIDIMOB', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
  paymentReference: z.string().trim().max(120).nullable().optional(),
});

export const AdjustInventoryStockSchema = z.object({
  partId: z.number().int().positive(),
  quantityDelta: z.number().int().refine((n) => n !== 0, 'La quantité d’ajustement ne peut pas être zéro'),
  overrideReason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(500).nullable().optional(),
  movementDate: z.string().min(8).max(30).optional(),
});

// Phase 5: Documents, Templates, Printing, and Reports
export const DocumentKindEnum = z.enum([
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
]);

export const DocumentFormatEnum = z.enum([
  'A4_PDF',
  'A4_LANDSCAPE_PDF',
  'THERMAL_80MM',
  'THERMAL_58MM',
]);

export const ReportFilterSchema = z.object({
  category: z.enum(['FINANCIAL', 'FLEET', 'OPERATIONAL', 'CUSTOM']),
  reportCode: z.string().trim().max(64).optional(),
  dateFrom: z.string().max(32).optional(),
  dateTo: z.string().max(32).optional(),
  customerId: z.number().int().positive().nullable().optional(),
  vehicleId: z.number().int().positive().nullable().optional(),
  documentKind: DocumentKindEnum.nullable().optional(),
  transactionType: z.string().trim().max(64).nullable().optional(),
  userId: z.number().int().positive().nullable().optional(),
  status: z.string().trim().max(64).nullable().optional(),
  expenseCategory: z.string().trim().max(64).nullable().optional(),
  includeSections: z.array(z.string().trim().max(64)).optional(),
  language: z.enum(['fr', 'ar']).optional(),
});

export const GenerateDocumentSchema = z.object({
  documentKind: DocumentKindEnum,
  format: DocumentFormatEnum.optional(),
  language: z.enum(['fr', 'ar']).default('fr'),
  numeralSystem: z.enum(['latin', 'arabic']).default('latin'),
  contractId: z.number().int().positive().nullable().optional(),
  extensionId: z.number().int().positive().nullable().optional(),
  paymentId: z.number().int().positive().nullable().optional(),
  depositId: z.number().int().positive().nullable().optional(),
  inspectionId: z.number().int().positive().nullable().optional(),
  invoiceId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  vehicleId: z.number().int().positive().nullable().optional(),
  maintenanceRecordId: z.number().int().positive().nullable().optional(),
  expenseId: z.number().int().positive().nullable().optional(),
  cashSessionId: z.number().int().positive().nullable().optional(),
  dateFrom: z.string().max(32).nullable().optional(),
  dateTo: z.string().max(32).nullable().optional(),
  reportFilter: ReportFilterSchema.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
});

export const ListDocumentsSchema = z.object({
  search: z.string().trim().max(120).optional(),
  documentKind: DocumentKindEnum.optional(),
  format: DocumentFormatEnum.optional(),
  customerId: z.number().int().positive().optional(),
  vehicleId: z.number().int().positive().optional(),
  contractId: z.number().int().positive().optional(),
  dateFrom: z.string().max(32).optional(),
  dateTo: z.string().max(32).optional(),
  isCopy: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const ReprintDocumentSchema = z.object({
  sourceDocumentId: z.number().int().positive(),
  format: DocumentFormatEnum.optional(),
  language: z.enum(['fr', 'ar']).optional(),
});

export const PrintDocumentSchema = z.object({
  documentId: z.number().int().positive(),
  printerName: z.string().trim().max(255).nullable().optional(),
  silent: z.boolean().default(false),
  copies: z.number().int().min(1).max(10).default(1),
});

export const UploadAgencyLogoSchema = z.object({
  originalFileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  base64Data: z.string().min(4).max(4_000_000),
});

export const UpdateDocumentTemplatesSchema = z.object({
  defaultLanguage: z.enum(['fr', 'ar']).optional(),
  defaultFormat: DocumentFormatEnum.optional(),
  thermalWidth: z.enum(['80MM', '58MM']).optional(),
  defaultPrinterA4: z.string().max(255).optional(),
  defaultPrinterThermal: z.string().max(255).optional(),
  showLogo: z.boolean().optional(),
  showFiscalIds: z.boolean().optional(),
  showSignatureBoxes: z.boolean().optional(),
  invoiceFiscallyCompliant: z.boolean().optional(),
  invoiceTaxRatePercent: z.number().min(0).max(100).optional(),
  footerFr: z.string().max(600).optional(),
  footerAr: z.string().max(600).optional(),
  signatureAgencyFr: z.string().max(200).optional(),
  signatureAgencyAr: z.string().max(200).optional(),
  signatureCustomerFr: z.string().max(200).optional(),
  signatureCustomerAr: z.string().max(200).optional(),
  contractTermsFr: z.string().max(3000).optional(),
  contractTermsAr: z.string().max(3000).optional(),
  invoiceDisclaimerFr: z.string().max(600).optional(),
  invoiceDisclaimerAr: z.string().max(600).optional(),
  prefixes: z.record(DocumentKindEnum, z.string().trim().min(1).max(16)).optional(),
});

export const ExportReportSchema = z.object({
  filter: ReportFilterSchema,
  exportFormat: z.enum(['CSV', 'XLSX', 'PDF']),
  pdfFormat: z.enum(['A4_PDF', 'A4_LANDSCAPE_PDF']).optional(),
  language: z.enum(['fr', 'ar']).default('fr'),
  numeralSystem: z.enum(['latin', 'arabic']).default('latin'),
});

// Phase 6: Production Backups, Verification, Recovery Key & Atomic Restore
export const CreateBackupSchema = z.object({
  backupType: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
  encryptionMode: z.enum(['VAULT_RECOVERY_KEY', 'PASSPHRASE']).default('VAULT_RECOVERY_KEY'),
  passphrase: z.string().min(8).max(128).optional(),
  destinationPath: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const VerifyBackupSchema = z.object({
  backupRecordId: z.number().int().positive().optional(),
  filePath: z.string().trim().max(500).optional(),
  base64Archive: z.string().max(150_000_000).optional(),
  passphrase: z.string().min(1).max(128).optional(),
  recoveryKey: z.string().trim().min(10).max(200).optional(),
});

export const RestoreBackupSchema = z.object({
  backupRecordId: z.number().int().positive().optional(),
  filePath: z.string().trim().max(500).optional(),
  base64Archive: z.string().max(150_000_000).optional(),
  fileName: z.string().trim().max(200).optional(),
  passphrase: z.string().min(1).max(128).optional(),
  recoveryKey: z.string().trim().min(10).max(200).optional(),
  adminPassword: z.string().min(1).max(128),
});

export const ExportBackupSchema = z.object({
  backupRecordId: z.number().int().positive(),
  destinationPath: z.string().trim().min(3).max(500).optional(),
});

export const ImportBackupSchema = z.object({
  sourcePath: z.string().trim().max(500).optional(),
  fileName: z.string().trim().max(200).optional(),
  base64Archive: z.string().max(150_000_000).optional(),
  passphrase: z.string().min(1).max(128).optional(),
  recoveryKey: z.string().trim().min(10).max(200).optional(),
});

export const ShowRecoveryKeySchema = z.object({
  adminPassword: z.string().min(1).max(128),
});

