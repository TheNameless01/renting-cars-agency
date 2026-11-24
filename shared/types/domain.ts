export type AppLanguage = 'fr' | 'ar';
export type AppTheme = 'light' | 'dark';
export type NumeralSystem = 'latin' | 'arabic';
export type CurrencyCode = 'DZD' | 'EUR';
export type RoleCode = 'ADMIN' | 'AGENT';

export type PermissionCode =
  | 'users:manage'
  | 'settings:manage'
  | 'vehicles:read'
  | 'vehicles:write'
  | 'customers:read'
  | 'customers:write'
  | 'customers:override_blacklist'
  | 'contracts:read'
  | 'contracts:write'
  | 'contracts:extend'
  | 'contracts:cancel'
  | 'inspections:write'
  | 'inspections:view'
  | 'inspections:create'
  | 'inspections:update'
  | 'inspections:finalize'
  | 'inspections:manage_damage'
  | 'finance:read'
  | 'finance:record_payment'
  | 'finance:manage_deposit'
  | 'finance:manage_expenses'
  | 'finance:cash_register'
  | 'finance:approve_adjustment'
  | 'maintenance:write'
  | 'maintenance:view'
  | 'maintenance:create'
  | 'maintenance:update'
  | 'maintenance:complete'
  | 'maintenance:manage_types'
  | 'inventory:read'
  | 'inventory:write'
  | 'inventory:view'
  | 'inventory:manage_parts'
  | 'inventory:record_movements'
  | 'inventory:manage_suppliers'
  | 'inventory:adjust_stock'
  | 'inventory:override_negative'
  | 'documents:generate'
  | 'documents:view'
  | 'documents:reprint'
  | 'documents:manage_templates'
  | 'reports:view'
  | 'reports:export'
  | 'audit:view'
  | 'backups:manage'
  | 'backups:restore'
  | 'db:health';

export interface Role {
  id: number;
  code: RoleCode;
  nameFr: string;
  nameAr: string;
  description: string | null;
}

export interface User {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  roleCode: RoleCode;
  isActive: boolean;
  preferredLanguage: AppLanguage;
  preferredTheme: AppTheme;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  token: string;
  user: User;
  permissions: PermissionCode[];
  expiresAt: string;
  runtimeMode: 'desktop' | 'preview';
}

export type VehicleFuelType = 'ESSENCE' | 'DIESEL' | 'GPL' | 'OTHER';
export type VehicleTransmission = 'MANUAL' | 'AUTOMATIC';
export type VehicleStatus = 'AVAILABLE' | 'RENTED' | 'RESERVED' | 'MAINTENANCE';
export type VehicleDocType = 'CARTE_GRISE' | 'ASSURANCE' | 'VIGNETTE' | 'CONTROLE_TECHNIQUE';

export interface Vehicle {
  id: number;
  internalCode: string;
  matricule: string;
  vin: string | null;
  brand: string;
  model: string;
  year: number;
  color: string;
  category: string;
  fuelType: VehicleFuelType;
  transmission: VehicleTransmission;
  seats: number;
  currentOdometerKm: number;
  acquisitionDate: string | null;
  acquisitionCostMinor: number | null;
  defaultDailyRateMinor: number;
  defaultWeeklyRateMinor: number | null;
  defaultMonthlyRateMinor: number | null;
  status: VehicleStatus;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleDocument {
  id: number;
  vehicleId: number;
  docType: VehicleDocType;
  documentNumber: string | null;
  issueDate: string | null;
  expirationDate: string;
  reminderDays: number;
  filePath: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VehiclePhoto {
  id: number;
  vehicleId: number;
  filePath: string;
  caption: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export type CustomerType = 'INDIVIDUAL' | 'COMPANY';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLACKLISTED';
export type RiskReason =
  | 'UNPAID_DEBT'
  | 'TRAFFIC_FINE'
  | 'RADAR_FINE'
  | 'VEHICLE_DAMAGE'
  | 'LATE_RETURN'
  | 'CONTRACT_VIOLATION'
  | 'OTHER';

export interface Customer {
  id: number;
  customerType: CustomerType;
  fullName: string;
  dateOfBirth: string | null;
  phone: string;
  secondaryPhone: string | null;
  address: string | null;
  wilayaCode: string | null;
  commune: string | null;
  cniNumber: string | null;
  passportNumber: string | null;
  drivingLicenceNumber: string | null;
  drivingLicenceIssueDate: string | null;
  drivingLicenceExpirationDate: string | null;
  riskStatus: RiskLevel;
  internalNotes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCompany {
  id: number;
  customerId: number;
  companyName: string;
  legalRepresentative: string;
  rcNumber: string | null;
  nifNumber: string | null;
  nisNumber: string | null;
  artNumber: string | null;
  bonDeCommandeNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDocument {
  id: number;
  customerId: number;
  docCategory: 'CNI' | 'PASSPORT' | 'DRIVING_LICENCE' | 'COMPANY_RC' | 'COMPANY_NIF' | 'BON_COMMANDE' | 'OTHER';
  encryptedFilePath: string;
  originalFileName: string;
  mimeType: string;
  documentNumber: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  reminderDays: number;
  notes: string | null;
  isArchived: boolean;
  replacesDocId: number | null;
  replacedByDocId: number | null;
  archivedAt: string | null;
  archivedByUserId: number | null;
  uploadedByUserId: number;
  createdAt: string;
}

export interface CustomerRiskRecord {
  id: number;
  customerId: number;
  riskLevel: RiskLevel;
  reason: RiskReason;
  description: string;
  incidentDate: string;
  evidenceFilePath: string | null;
  reportedByUserId: number;
  isResolved: boolean;
  resolvedByUserId: number | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CONVERTED' | 'CANCELLED' | 'NO_SHOW';

export interface Reservation {
  id: number;
  reservationNumber: string;
  customerId: number;
  vehicleId: number;
  startDate: string;
  expectedReturnDate: string;
  estimatedTotalMinor: number;
  status: ReservationStatus;
  notes: string | null;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export type ContractStatus = 'DRAFT' | 'CONFIRMED' | 'ACTIVE' | 'EXTENDED' | 'COMPLETED' | 'CANCELLED';
export type MileageMode = 'UNLIMITED' | 'DAILY_ALLOWANCE' | 'CUSTOM_TOTAL';

export interface RentalContract {
  id: number;
  contractNumber: string;
  reservationId: number | null;
  customerId: number;
  vehicleId: number;
  status: ContractStatus;
  startDate: string;
  originalEndDate: string;
  expectedReturnDate: string;
  actualReturnDate: string | null;
  departureOdometerKm: number;
  returnOdometerKm: number | null;
  mileageMode: MileageMode;
  dailyMileageAllowanceKm: number | null;
  includedTotalKm: number | null;
  extraKmRateMinor: number;
  currency: CurrencyCode;
  baseRentalTotalMinor: number;
  discountMinor: number;
  extensionTotalMinor: number;
  extraKmChargeMinor: number;
  lateFeeMinor: number;
  damageChargeMinor: number;
  otherChargesMinor: number;
  totalContractAmountMinor: number;
  blacklistOverrideReason: string | null;
  blacklistOverrideByUserId: number | null;
  notes: string | null;
  createdByUserId: number;
  closedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RentalExtension {
  id: number;
  contractId: number;
  previousReturnDate: string;
  newReturnDate: string;
  addedDays: number;
  additionalAmountMinor: number;
  additionalKmAllowance: number;
  notes: string | null;
  createdByUserId: number;
  createdAt: string;
}

export type PricingItemType = 'DAILY_RATE' | 'WEEKLY_RATE' | 'MONTHLY_RATE' | 'SEASONAL_RATE' | 'CUSTOM_RATE' | 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT' | 'EXTRA_KM' | 'LATE_FEE' | 'DAMAGE' | 'ADJUSTMENT';

export interface ContractPricingItem {
  id: number;
  contractId: number;
  itemType: PricingItemType;
  label: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  isAuthorizedAdjustment: boolean;
  authorizedByUserId: number | null;
  createdAt: string;
}

export type PaymentMethod = 'CASH' | 'CCP' | 'BARIDIMOB' | 'BANK_TRANSFER' | 'OTHER';
export type PaymentDirection = 'INFLOW' | 'REFUND';

export interface ContractPayment {
  id: number;
  transactionCode: string;
  receiptNumber: string;
  contractId: number;
  customerId: number;
  direction: PaymentDirection;
  method: PaymentMethod;
  paymentReference: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  paymentDate: string;
  description: string | null;
  recordedByUserId: number;
  reversalOfPaymentId: number | null;
  createdAt: string;
}

export type DepositStatus = 'HELD' | 'RETURNED' | 'PARTIALLY_DEDUCTED' | 'FULLY_DEDUCTED';

export interface Deposit {
  id: number;
  contractId: number;
  customerId: number;
  amountMinor: number;
  currency: CurrencyCode;
  status: DepositStatus;
  receivedDate: string;
  returnedDate: string | null;
  deductedAmountMinor: number;
  refundedAmountMinor: number;
  deductionReason: string | null;
  receivedByUserId: number;
  settledByUserId: number | null;
  supportingDocPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DepositChargeCategory =
  | 'DAMAGE'
  | 'TRAFFIC_FINE'
  | 'LATE_FEE'
  | 'EXTRA_KM'
  | 'CLEANING'
  | 'FUEL'
  | 'OTHER';

export interface DepositMovement {
  id: number;
  depositId: number;
  movementType: 'RECEIVED' | 'DEDUCTED' | 'REFUNDED' | 'ADJUSTMENT';
  amountMinor: number;
  chargeCategory?: DepositChargeCategory | null;
  trafficFineId?: number | null;
  paymentMethod?: PaymentMethod | null;
  reason: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export type CustomerAdjustmentType = 'CREDIT_NOTE' | 'DEBIT_CHARGE' | 'WRITE_OFF';

export interface CustomerFinancialAdjustment {
  id: number;
  adjustmentCode: string;
  customerId: number;
  contractId: number | null;
  adjustmentType: CustomerAdjustmentType;
  amountMinor: number;
  currency: CurrencyCode;
  adjustmentDate: string;
  reason: string;
  notes: string | null;
  authorizedByUserId: number;
  reversalOfAdjustmentId: number | null;
  createdAt: string;
}

export type InspectionStage = 'DEPARTURE' | 'RETURN';
export type InspectionStatus = 'DRAFT' | 'FINALIZED';
export type InspectionItemCondition = 'GOOD' | 'DAMAGED' | 'MISSING';
export type DamageType = 'SCRATCH' | 'DENT' | 'CRACK' | 'BROKEN' | 'MISSING_ACCESSORY' | 'OTHER';
export type DamageSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';
export type DamageStatus = 'REPORTED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'UNDER_REPAIR' | 'REPAIRED' | 'REJECTED';

export interface VehicleInspection {
  id: number;
  inspectionNumber: string;
  contractId: number;
  vehicleId: number;
  stage: InspectionStage;
  status: InspectionStatus;
  odometerKm: number;
  fuelLevelPercent: number;
  exteriorNotes: string | null;
  interiorNotes: string | null;
  agencySignatureData: string | null;
  customerSignatureData: string | null;
  customerAcknowledged: boolean;
  customerAcknowledgmentNotes: string | null;
  lateReturnMinutes: number;
  mileageDeltaKm: number | null;
  inspectorUserId: number;
  inspectedAt: string;
  finalizedAt: string | null;
  finalizedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionItem {
  id: number;
  inspectionId: number;
  itemKey: string;
  category: string;
  labelFr: string;
  labelAr: string;
  condition: InspectionItemCondition;
  notes: string | null;
  sortOrder: number;
}

export interface InspectionPhoto {
  id: number;
  inspectionId: number;
  damageId: number | null;
  filePath: string;
  originalFileName: string | null;
  mimeType: string | null;
  caption: string | null;
  uploadedByUserId: number | null;
  createdAt: string;
}

export interface VehicleDamage {
  id: number;
  damageCode: string;
  vehicleId: number;
  contractId: number | null;
  inspectionId: number | null;
  zoneCode: string;
  diagramX: number | null;
  diagramY: number | null;
  damageType: DamageType;
  severity: DamageSeverity;
  description: string;
  isPreExisting: boolean;
  isNewlyDiscovered: boolean;
  status: DamageStatus;
  estimatedRepairCostMinor: number | null;
  repairReference: string | null;
  linkedExpenseId: number | null;
  reportedByUserId: number;
  reportedAt: string;
  updatedAt: string;
}

export interface DamageResolutionRecord {
  id: number;
  damageId: number;
  previousStatus: DamageStatus | null;
  newStatus: DamageStatus;
  notes: string;
  repairReference: string | null;
  linkedExpenseId: number | null;
  recordedByUserId: number;
  recordedByUsername?: string;
  createdAt: string;
}

export interface TrafficFine {
  id: number;
  contractId: number | null;
  vehicleId: number;
  customerId: number;
  fineType: 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER';
  referenceNumber: string | null;
  incurredDate: string;
  amountMinor: number;
  isPaidByCustomer: boolean;
  notes: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type MaintenanceAlertState = 'OK' | 'APPROACHING' | 'DUE' | 'OVERDUE';

export interface MaintenanceType {
  id: number;
  code: string;
  nameFr: string;
  nameAr: string;
  defaultKmInterval: number | null;
  defaultDayInterval: number | null;
  kmWarningThreshold: number;
  dayWarningThreshold: number;
  isActive: boolean;
}

export interface VehicleMaintenanceSchedule {
  id: number;
  vehicleId: number;
  maintenanceTypeId: number;
  kmInterval: number | null;
  dayInterval: number | null;
  kmWarningThreshold: number;
  dayWarningThreshold: number;
  isActive: boolean;
  notes: string | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: number;
  recordNumber: string | null;
  vehicleId: number;
  maintenanceTypeId: number;
  supplierId: number | null;
  status: MaintenanceStatus;
  isEmergency: boolean;
  workDescription: string;
  performedDate: string;
  scheduledStartDate: string | null;
  scheduledEndDate: string | null;
  odometerKm: number;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  laborCostMinor: number;
  partsCostMinor: number;
  totalCostMinor: number;
  technicianName: string | null;
  notes: string | null;
  invoiceFilePath: string | null;
  invoiceOriginalName: string | null;
  invoiceMimeType: string | null;
  blockedPeriodId: number | null;
  partsConsumedLocked: boolean;
  recordedByUserId: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenancePartInput {
  partId: number;
  quantityUsed: number;
  unitCostMinor?: number;
}

export interface InventoryPart {
  id: number;
  partCode: string;
  partName: string;
  category: string;
  description: string | null;
  unitLabel: string;
  compatibleModels: string | null;
  quantityAvailable: number;
  minimumStock: number;
  unitPurchasePriceMinor: number;
  supplierId: number | null;
  storageLocation: string | null;
  lastPurchaseDate: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementType =
  | 'INITIAL_STOCK'
  | 'PURCHASE'
  | 'ENTRY'
  | 'WITHDRAWAL'
  | 'MAINTENANCE_USE'
  | 'RETURN'
  | 'ADJUSTMENT';

export interface InventoryMovement {
  id: number;
  partId: number;
  movementType: InventoryMovementType;
  quantityDelta: number;
  unitCostMinor: number;
  maintenanceRecordId: number | null;
  vehicleId: number | null;
  supplierId: number | null;
  referenceCode: string | null;
  expenseId: number | null;
  movementDate: string;
  notes: string | null;
  overrideReason: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  wilayaCode: string | null;
  specialty: string | null;
  nifNumber: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseCategory =
  | 'MAINTENANCE'
  | 'REPAIRS'
  | 'SPARE_PARTS'
  | 'INSURANCE'
  | 'VIGNETTE'
  | 'TECHNICAL_INSPECTION'
  | 'CLEANING'
  | 'ADMINISTRATIVE'
  | 'OTHER';

export interface Expense {
  id: number;
  expenseNumber: string;
  category: ExpenseCategory;
  vehicleId: number | null;
  supplierId: number | null;
  maintenanceRecordId: number | null;
  amountMinor: number;
  currency: CurrencyCode;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  paymentReference?: string | null;
  status?: 'POSTED' | 'REVERSED';
  description: string;
  receiptFilePath: string | null;
  receiptOriginalName?: string | null;
  receiptMimeType?: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export type CashSessionStatus = 'OPEN' | 'CLOSED';
export type CashMovementType =
  | 'PAYMENT_INFLOW'
  | 'PAYMENT_REFUND'
  | 'DEPOSIT_INFLOW'
  | 'DEPOSIT_REFUND'
  | 'EXPENSE'
  | 'ADJUSTMENT';

export interface CashRegisterSession {
  id: number;
  sessionDate: string;
  status: CashSessionStatus;
  openingBalanceMinor: number;
  cashReceivedMinor: number;
  cashRefundedMinor: number;
  cashExpensesMinor: number;
  cashAdjustmentsMinor?: number;
  expectedClosingMinor: number;
  actualClosingMinor: number | null;
  discrepancyMinor: number | null;
  openingNotes?: string | null;
  discrepancyNotes: string | null;
  openedByUserId: number;
  closedByUserId: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface CashRegisterMovement {
  id: number;
  sessionId: number;
  movementType: CashMovementType;
  amountMinor: number;
  paymentId: number | null;
  depositMovementId: number | null;
  expenseId: number | null;
  description: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  contractId: number;
  customerId: number;
  issueDate: string;
  subtotalMinor: number;
  discountMinor?: number;
  taxMinor: number;
  taxRatePercent?: number;
  totalMinor: number;
  currency?: CurrencyCode;
  isFiscallyCompliant: boolean;
  pdfFilePath: string | null;
  notes?: string | null;
  createdByUserId: number;
  createdAt: string;
}

export type DocumentKind =
  | 'RENTAL_CONTRACT'
  | 'CONTRACT_AMENDMENT'
  | 'DEPARTURE_INSPECTION'
  | 'RETURN_INSPECTION'
  | 'DAMAGE_REPORT'
  | 'PAYMENT_RECEIPT'
  | 'DEPOSIT_RECEIPT'
  | 'DEPOSIT_SETTLEMENT'
  | 'INVOICE'
  | 'EXPENSE_RECEIPT'
  | 'MAINTENANCE_REPORT'
  | 'VEHICLE_HISTORY'
  | 'CUSTOMER_STATEMENT'
  | 'CASH_REGISTER_CLOSING'
  | 'FINANCIAL_SUMMARY'
  | 'CUSTOM_REPORT';

export type DocumentFormat = 'A4_PDF' | 'A4_LANDSCAPE_PDF' | 'THERMAL_80MM' | 'THERMAL_58MM';

export interface GeneratedDocument {
  id: number;
  documentNumber: string;
  documentKind: DocumentKind;
  format: DocumentFormat;
  title: string;
  language: AppLanguage;
  numeralSystem: NumeralSystem;
  contractId: number | null;
  paymentId: number | null;
  depositId: number | null;
  inspectionId: number | null;
  invoiceId: number | null;
  customerId: number | null;
  vehicleId: number | null;
  maintenanceRecordId: number | null;
  expenseId: number | null;
  cashSessionId: number | null;
  isCopy: boolean;
  sourceDocumentId: number | null;
  sourceDocumentNumber?: string | null;
  reprintCount: number;
  templateVersion: number;
  generationStatus: 'READY' | 'FAILED';
  filePath: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string | null;
  generatedByUserId: number;
  generatedByUsername: string;
  lastPrintedAt: string | null;
  lastPrintedByUserId: number | null;
  customerName?: string | null;
  vehicleLabel?: string | null;
  contractNumber?: string | null;
  createdAt: string;
}

export interface DocumentTemplateConfig {
  agencyName: string;
  agencyAddress: string;
  agencyPhone: string;
  agencyEmail: string;
  agencyWilayaCode: string;
  rcNumber: string;
  nifNumber: string;
  nisNumber: string;
  artNumber: string;
  logoVaultPath: string;
  logoMimeType: string;
  defaultLanguage: AppLanguage;
  defaultFormat: DocumentFormat;
  thermalWidth: '80MM' | '58MM';
  defaultPrinterA4: string;
  defaultPrinterThermal: string;
  showLogo: boolean;
  showFiscalIds: boolean;
  showSignatureBoxes: boolean;
  invoiceFiscallyCompliant: boolean;
  invoiceTaxRatePercent: number;
  templateVersion: number;
  footerFr: string;
  footerAr: string;
  signatureAgencyFr: string;
  signatureAgencyAr: string;
  signatureCustomerFr: string;
  signatureCustomerAr: string;
  contractTermsFr: string;
  contractTermsAr: string;
  invoiceDisclaimerFr: string;
  invoiceDisclaimerAr: string;
  prefixes: Record<DocumentKind, string>;
}

export interface SystemPrinterInfo {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
}

export type ReportCategory = 'FINANCIAL' | 'FLEET' | 'OPERATIONAL' | 'CUSTOM';
export type ReportExportFormat = 'CSV' | 'XLSX' | 'PDF';

export interface ReportFilter {
  category: ReportCategory;
  reportCode?: string;
  dateFrom?: string;
  dateTo?: string;
  customerId?: number | null;
  vehicleId?: number | null;
  documentKind?: DocumentKind | null;
  transactionType?: string | null;
  userId?: number | null;
  status?: string | null;
  expenseCategory?: string | null;
  includeSections?: string[];
  language?: AppLanguage;
}

export interface ReportDataset {
  category: ReportCategory;
  reportCode: string;
  titleFr: string;
  titleAr: string;
  generatedAt: string;
  appliedFilters: ReportFilter;
  accountingDisclosuresFr: string[];
  accountingDisclosuresAr: string[];
  kpis: Array<{
    key: string;
    labelFr: string;
    labelAr: string;
    valueDisplay: string;
    numericValue: number;
    unit?: string;
    tone?: 'neutral' | 'positive' | 'warning' | 'danger';
    noteFr?: string;
    noteAr?: string;
  }>;
  sections: Array<{
    id: string;
    titleFr: string;
    titleAr: string;
    columns: Array<{
      key: string;
      labelFr: string;
      labelAr: string;
      type: 'text' | 'number' | 'currency_minor' | 'date' | 'percent';
    }>;
    rows: Array<Record<string, string | number | boolean | null>>;
    totalsRow?: Record<string, string | number | null>;
  }>;
}

export type NotificationSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AppNotification {
  id: number;
  category: string;
  severity: NotificationSeverity;
  titleFr: string;
  titleAr: string;
  messageFr: string;
  messageAr: string;
  entityType: string | null;
  entityId: number | null;
  isRead: boolean;
  isResolved: boolean;
  dueDate: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  usernameSnapshot: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  previousValueJson: string | null;
  newValueJson: string | null;
  reason: string | null;
  createdAt: string;
}

export type BackupEncryptionMode = 'VAULT_RECOVERY_KEY' | 'PASSPHRASE';
export type BackupVerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED';

export interface BackupRecord {
  id: number;
  backupType: 'AUTO' | 'MANUAL' | 'PRE_RESTORE';
  destinationPath: string;
  fileName?: string;
  fileSizeBytes: number;
  checksumSha256: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  appVersion?: string;
  schemaVersion?: string;
  includesVault?: boolean;
  attachmentCount?: number;
  backupFormat?: string;
  isEncrypted?: boolean;
  encryptionMode?: BackupEncryptionMode;
  recoveryKeyFingerprint?: string | null;
  verifiedAt?: string | null;
  verificationStatus?: BackupVerificationStatus;
  verificationSummaryJson?: string | null;
  triggeredByUserId: number | null;
  triggeredByUsername?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface BackupVerificationResult {
  valid: boolean;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  archiveChecksumSha256: string;
  backupType: 'AUTO' | 'MANUAL' | 'PRE_RESTORE';
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  encryptionMode: BackupEncryptionMode;
  recoveryKeyFingerprint: string | null;
  integrityCheckOk: boolean;
  foreignKeyViolations: number;
  missingTables: string[];
  attachmentCount: number;
  verifiedAttachmentCount: number;
  missingAttachmentCount: number;
  recordCounts: {
    users: number;
    vehicles: number;
    customers: number;
    contracts: number;
    payments: number;
    generatedDocuments: number;
  };
  errorMessage: string | null;
}

export interface VaultRecoveryInfo {
  recoveryKey: string;
  fingerprint: string;
  protectionMode: 'dpapi_safestorage' | 'local_file_0600';
}

export type HealthSeverityStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface HealthCheckItem {
  key: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  messageFr: string;
  messageAr: string;
  details?: string | null;
}

export interface DatabaseHealthReport {
  overallStatus: HealthSeverityStatus;
  checkedAt: string;
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  schemaVersion: string;
  journalMode: string;
  synchronousMode: string;
  foreignKeysEnabled: boolean;
  integrityCheckOk: boolean;
  foreignKeyViolationsCount: number;
  migrationChecksumsOk: boolean;
  missingTables: string[];
  vaultAccessible: boolean;
  vaultProtectionMode: 'dpapi_safestorage' | 'local_file_0600';
  vaultFileCount: number;
  missingReferencedAttachments: number;
  freeDiskBytes: number | null;
  recordCounts: {
    users: number;
    vehicles: number;
    customers: number;
    contracts: number;
    payments: number;
    generatedDocuments: number;
    backups: number;
  };
  checks: HealthCheckItem[];
}

