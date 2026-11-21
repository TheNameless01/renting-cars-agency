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
  | 'finance:read'
  | 'finance:record_payment'
  | 'finance:manage_deposit'
  | 'finance:manage_expenses'
  | 'finance:cash_register'
  | 'finance:approve_adjustment'
  | 'maintenance:write'
  | 'inventory:read'
  | 'inventory:write'
  | 'inventory:override_negative'
  | 'documents:generate'
  | 'reports:view'
  | 'audit:view'
  | 'backups:manage'
  | 'backups:restore';

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
export type InspectionItemCondition = 'GOOD' | 'DAMAGED' | 'MISSING';

export interface VehicleInspection {
  id: number;
  inspectionNumber: string;
  contractId: number;
  vehicleId: number;
  stage: InspectionStage;
  odometerKm: number;
  fuelLevelPercent: number;
  exteriorNotes: string | null;
  interiorNotes: string | null;
  agencySignatureData: string | null;
  customerSignatureData: string | null;
  inspectorUserId: number;
  inspectedAt: string;
  createdAt: string;
}

export interface InspectionItem {
  id: number;
  inspectionId: number;
  itemKey: string;
  labelFr: string;
  labelAr: string;
  condition: InspectionItemCondition;
  notes: string | null;
}

export interface InspectionPhoto {
  id: number;
  inspectionId: number;
  filePath: string;
  caption: string | null;
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

export interface MaintenanceRecord {
  id: number;
  vehicleId: number;
  maintenanceTypeId: number;
  supplierId: number | null;
  workDescription: string;
  performedDate: string;
  odometerKm: number;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  laborCostMinor: number;
  partsCostMinor: number;
  totalCostMinor: number;
  invoiceFilePath: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export interface InventoryPart {
  id: number;
  partCode: string;
  partName: string;
  category: string;
  description: string | null;
  quantityAvailable: number;
  minimumStock: number;
  unitPurchasePriceMinor: number;
  supplierId: number | null;
  storageLocation: string | null;
  lastPurchaseDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementType = 'PURCHASE' | 'ENTRY' | 'WITHDRAWAL' | 'MAINTENANCE_USE' | 'ADJUSTMENT';

export interface InventoryMovement {
  id: number;
  partId: number;
  movementType: InventoryMovementType;
  quantityDelta: number;
  unitCostMinor: number;
  maintenanceRecordId: number | null;
  notes: string | null;
  overrideReason: string | null;
  recordedByUserId: number;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  specialty: string | null;
  nifNumber: string | null;
  notes: string | null;
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
  taxMinor: number;
  totalMinor: number;
  isFiscallyCompliant: boolean;
  pdfFilePath: string | null;
  createdByUserId: number;
  createdAt: string;
}

export type DocumentKind =
  | 'RENTAL_CONTRACT'
  | 'DEPARTURE_INSPECTION'
  | 'RETURN_INSPECTION'
  | 'INVOICE'
  | 'PAYMENT_RECEIPT'
  | 'DEPOSIT_RECEIPT';

export type DocumentFormat = 'A4_PDF' | 'THERMAL_58MM' | 'THERMAL_80MM';

export interface GeneratedDocument {
  id: number;
  documentNumber: string;
  documentKind: DocumentKind;
  format: DocumentFormat;
  contractId: number | null;
  paymentId: number | null;
  depositId: number | null;
  inspectionId: number | null;
  invoiceId: number | null;
  filePath: string;
  reprintCount: number;
  generatedByUserId: number;
  createdAt: string;
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

export interface BackupRecord {
  id: number;
  backupType: 'AUTO' | 'MANUAL' | 'PRE_RESTORE';
  destinationPath: string;
  fileSizeBytes: number;
  checksumSha256: string;
  status: 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  triggeredByUserId: number | null;
  createdAt: string;
}
