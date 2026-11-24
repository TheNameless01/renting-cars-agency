import { IPC_CHANNELS, type ElectronBridgeAPI, type IpcChannel, type IpcResult } from '../../electron/ipc/contracts.ts';
import { PREVIEW_ENDPOINTS } from '../../shared/api/previewContracts.ts';
import type {
  AppLanguage,
  AppNotification,
  AuditLogEntry,
  AuthSession,
  BackupEncryptionMode,
  BackupRecord,
  BackupVerificationResult,
  CashMovementType,
  CashRegisterMovement,
  CashRegisterSession,
  ContractPricingItem,
  ContractStatus,
  CurrencyCode,
  Customer,
  CustomerAdjustmentType,
  CustomerCompany,
  CustomerDocument,
  CustomerRiskRecord,
  DamageResolutionRecord,
  DamageSeverity,
  DamageStatus,
  DamageType,
  DatabaseHealthReport,
  DepositChargeCategory,
  DepositStatus,
  DocumentFormat,
  DocumentKind,
  DocumentTemplateConfig,
  ExpenseCategory,
  GeneratedDocument,
  InspectionItem,
  InspectionItemCondition,
  InspectionPhoto,
  InspectionStage,
  InspectionStatus,
  InventoryMovement,
  InventoryMovementType,
  InventoryPart,
  Invoice,
  MaintenanceAlertState,
  MaintenancePartInput,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceType,
  MileageMode,
  NotificationSeverity,
  NumeralSystem,
  PaymentDirection,
  PaymentMethod,
  PermissionCode,
  ReportDataset,
  ReportExportFormat,
  ReportFilter,
  ReservationStatus,
  RiskLevel,
  RiskReason,
  RoleCode,
  Supplier,
  SystemPrinterInfo,
  VaultRecoveryInfo,
  Vehicle,
  VehicleDamage,
  VehicleDocType,
  VehicleDocument,
  VehicleFuelType,
  VehicleInspection,
  VehicleMaintenanceSchedule,
  VehicleStatus,
  VehicleTransmission,
} from '../../shared/types/domain.ts';

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
  }
}

export interface AuthStatusResponse {
  needsBootstrap: boolean;
  runtimeMode: 'desktop' | 'preview';
}

export interface WilayaDto {
  code: string;
  nameFr: string;
  nameAr: string;
  isNewlyCreated2026: boolean;
  parentWilayaCode: string | null;
  decreeReference: string | null;
  effectiveYear: number;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface UserWithPermissionsDto {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  roleCode: RoleCode;
  isActive: boolean;
  preferredLanguage: 'fr' | 'ar';
  preferredTheme: 'light' | 'dark';
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: PermissionCode[];
  permissionOverrides: Array<{ code: PermissionCode; granted: boolean }>;
}

export interface PermissionCatalogItem {
  id: number;
  code: PermissionCode;
  module: string;
  descriptionFr: string;
  descriptionAr: string;
}

export interface VehicleBlockedPeriodDto {
  id: number;
  vehicleId: number;
  blockType: 'MAINTENANCE' | 'ADMIN_HOLD' | 'OTHER';
  startDate: string;
  endDate: string;
  reason: string;
  isActive: boolean;
  createdAt: string;
}

export interface VehicleProfileDto {
  vehicle: Vehicle;
  documents: VehicleDocument[];
  blockedPeriods: VehicleBlockedPeriodDto[];
  rentalHistory: Array<{
    id: number;
    contractNumber: string;
    customerId: number;
    customerName: string;
    status: ContractStatus;
    startDate: string;
    expectedReturnDate: string;
    actualReturnDate: string | null;
    totalContractAmountMinor: number;
    currency: CurrencyCode;
  }>;
  reservations: Array<{
    id: number;
    reservationNumber: string;
    customerId: number;
    customerName: string;
    status: ReservationStatus;
    startDate: string;
    expectedReturnDate: string;
    estimatedTotalMinor: number;
  }>;
}

export interface CustomerListItemDto extends Customer {
  companyName: string | null;
  rcNumber: string | null;
  nifNumber: string | null;
  totalRentals: number;
}

export interface CustomerCustomRateDto {
  id: number;
  customerId: number;
  customerName?: string;
  vehicleCategory: string | null;
  vehicleId: number | null;
  vehicleLabel?: string | null;
  dailyRateMinor: number | null;
  weeklyRateMinor: number | null;
  monthlyRateMinor: number | null;
  defaultDiscountPercent: number;
  notes: string | null;
}

export interface CustomerProfileDto {
  customer: Customer;
  company: CustomerCompany | null;
  riskRecords: CustomerRiskRecord[];
  documents: CustomerDocument[];
  rentalHistory: Array<{
    id: number;
    contractNumber: string;
    vehicleId: number;
    vehicleLabel: string;
    status: ContractStatus;
    startDate: string;
    expectedReturnDate: string;
    actualReturnDate: string | null;
    totalContractAmountMinor: number;
    currency: CurrencyCode;
  }>;
  customRates: CustomerCustomRateDto[];
  stats: {
    totalRentals: number;
    totalChargedMinor: number;
    netPaidMinor: number;
    outstandingBalanceMinor: number;
    overdueDebtMinor: number;
    heldDepositsMinor: number;
  };
}

export interface CustomerEligibilityDto {
  eligible: boolean;
  requiresBlacklistOverride: boolean;
  riskStatus: RiskLevel;
  warnings: string[];
  blockers: string[];
}

export interface AvailabilityResultDto {
  available: boolean;
  conflicts: Array<{
    sourceType: 'VEHICLE_STATUS' | 'CONTRACT' | 'RESERVATION' | 'BLOCKED_PERIOD' | 'MAINTENANCE';
    sourceId: number | string;
    reference: string;
    startDate: string;
    endDate: string;
    details: string;
  }>;
}

export interface PlanningCalendarDto {
  vehicles: Array<{
    id: number;
    internalCode: string;
    matricule: string;
    brand: string;
    model: string;
    year: number;
    category: string;
    status: VehicleStatus;
    defaultDailyRateMinor: number;
  }>;
  events: Array<{
    eventType: 'CONTRACT' | 'RESERVATION' | 'BLOCKED_PERIOD' | 'MAINTENANCE';
    id: number;
    vehicleId: number;
    customerId: number | null;
    customerName: string | null;
    reference: string;
    status: string;
    startDate: string;
    endDate: string;
    actualReturnDate: string | null;
    notes: string | null;
  }>;
}

export interface ReservationListItemDto {
  id: number;
  reservationNumber: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  vehicleId: number;
  vehicleLabel: string;
  startDate: string;
  expectedReturnDate: string;
  estimatedTotalMinor: number;
  status: ReservationStatus;
  notes: string | null;
  createdAt: string;
}

export interface PriceCalculationDto {
  days: number;
  appliedTier: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEASONAL' | 'CUSTOMER_CUSTOM' | 'CUSTOM';
  appliedRuleSource: string;
  unitDailyRateMinor: number;
  grossTotalMinor: number;
  discountMinor: number;
  netTotalMinor: number;
  discountPercentEffective: number;
  maxAgentDiscountPercent: number;
  requiresAdminDiscountOverride: boolean;
  lineItems: Array<{
    itemType: string;
    label: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
  }>;
}

export interface PricingRulesDto {
  seasonalRates: Array<{
    id: number;
    name: string;
    vehicleCategory: string | null;
    vehicleId: number | null;
    vehicleLabel: string | null;
    startDate: string;
    endDate: string;
    dailyRateMinor: number;
    weeklyRateMinor: number | null;
    monthlyRateMinor: number | null;
    isActive: boolean;
  }>;
  customerRates: CustomerCustomRateDto[];
}

export interface ContractListItemDto {
  id: number;
  contractNumber: string;
  reservationId: number | null;
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerRiskStatus: RiskLevel;
  vehicleId: number;
  vehicleLabel: string;
  status: ContractStatus;
  startDate: string;
  originalEndDate: string;
  expectedReturnDate: string;
  actualReturnDate: string | null;
  departureOdometerKm: number;
  returnOdometerKm: number | null;
  mileageMode: MileageMode;
  includedTotalKm: number | null;
  currency: CurrencyCode;
  totalContractAmountMinor: number;
  paidNetMinor: number;
  outstandingMinor: number;
  depositAmountMinor: number;
  depositStatus: DepositStatus | null;
  createdAt: string;
}

export interface ContractDetailDto {
  contract: {
    id: number;
    contractNumber: string;
    reservationId: number | null;
    customerId: number;
    customerName: string;
    customerPhone: string;
    customerType: 'INDIVIDUAL' | 'COMPANY';
    customerRiskStatus: RiskLevel;
    vehicleId: number;
    vehicleLabel: string;
    vehicleYear: number;
    vehicleCurrentOdometerKm: number;
    vehicleDefaultDailyRateMinor: number;
    status: ContractStatus;
    startDate: string;
    originalEndDate: string;
    expectedReturnDate: string;
    actualReturnDate: string | null;
    departureOdometerKm: number;
    returnOdometerKm: number | null;
    odometerCorrectionReason: string | null;
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
    paidNetMinor: number;
    outstandingMinor: number;
    blacklistOverrideReason: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  pricingItems: ContractPricingItem[];
  extensions: Array<{
    id: number;
    contractId: number;
    previousReturnDate: string;
    newReturnDate: string;
    addedDays: number;
    additionalAmountMinor: number;
    additionalKmAllowance: number;
    notes: string | null;
    createdByUsername: string;
    createdAt: string;
  }>;
  payments: Array<{
    id: number;
    transactionCode: string;
    receiptNumber: string;
    direction: PaymentDirection;
    method: PaymentMethod;
    paymentReference: string | null;
    amountMinor: number;
    currency: CurrencyCode;
    paymentDate: string;
    description: string | null;
    reversalOfPaymentId: number | null;
    isReversed: boolean;
    createdAt: string;
  }>;
  deposit: {
    id: number;
    amountMinor: number;
    currency: CurrencyCode;
    status: DepositStatus;
    receivedDate: string;
    returnedDate: string | null;
    deductedAmountMinor: number;
    refundedAmountMinor: number;
    remainingHeldMinor: number;
    deductionReason: string | null;
    hasSupportingDoc: boolean;
    supportingDocOriginalName: string | null;
  } | null;
}

// Phase 3 Financial Management DTOs
export interface PaymentItemDto {
  id: number;
  transactionCode: string;
  receiptNumber: string;
  contractId: number;
  contractNumber: string;
  customerId: number;
  customerName: string;
  vehicleLabel: string;
  direction: PaymentDirection;
  method: PaymentMethod;
  paymentReference: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  paymentDate: string;
  description: string | null;
  recordedByUserId: number;
  recordedByUsername: string;
  reversalOfPaymentId: number | null;
  reversedByPaymentId: number | null;
  isReversed: boolean;
  createdAt: string;
}

export interface PaymentReceiptDto {
  payment: PaymentItemDto;
  agency: {
    name: string;
    address: string;
    phone: string;
    nif: string;
    rc: string;
  };
  contract: {
    id: number;
    contractNumber: string;
    vehicleLabel: string;
    startDate: string;
    expectedReturnDate: string;
    totalContractAmountMinor: number;
    paidNetMinor: number;
    outstandingMinor: number;
  };
  customer: {
    id: number;
    fullName: string;
    phone: string;
    address: string | null;
  };
  recordedByFullName: string;
}

export interface DepositListItemDto {
  id: number;
  contractId: number;
  contractNumber: string;
  contractStatus: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  vehicleId: number;
  vehicleLabel: string;
  amountMinor: number;
  currency: CurrencyCode;
  status: DepositStatus;
  receivedDate: string;
  returnedDate: string | null;
  deductedAmountMinor: number;
  refundedAmountMinor: number;
  remainingHeldMinor: number;
  deductionReason: string | null;
  receivedMethod: PaymentMethod;
  refundMethod: PaymentMethod | null;
  hasSupportingDoc: boolean;
  supportingDocOriginalName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrafficFineDto {
  id: number;
  contractId: number | null;
  contractNumber: string | null;
  vehicleId: number;
  vehicleLabel: string;
  customerId: number;
  customerName: string;
  fineType: 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER';
  referenceNumber: string | null;
  incurredDate: string;
  amountMinor: number;
  isPaidByCustomer: boolean;
  notes: string | null;
  createdAt: string;
}

export interface DepositDetailDto {
  deposit: DepositListItemDto;
  contractCharges: {
    damageChargeMinor: number;
    lateFeeMinor: number;
    extraKmChargeMinor: number;
    otherChargesMinor: number;
  };
  movements: Array<{
    id: number;
    depositId: number;
    movementType: 'RECEIVED' | 'DEDUCTED' | 'REFUNDED' | 'ADJUSTMENT';
    amountMinor: number;
    chargeCategory: DepositChargeCategory | null;
    trafficFineId: number | null;
    fineReference: string | null;
    paymentMethod: PaymentMethod | null;
    reason: string | null;
    recordedByUserId: number;
    recordedByUsername: string;
    createdAt: string;
  }>;
  fines: TrafficFineDto[];
}

export interface CashSessionSummaryDto extends CashRegisterSession {
  openedByUsername?: string;
  closedByUsername?: string | null;
}

export interface CashMovementDto extends CashRegisterMovement {
  recordedByUsername?: string;
  referenceCode?: string | null;
}

export interface CashSessionDetailDto {
  session: CashSessionSummaryDto;
  movements: CashMovementDto[];
}

export interface CashCurrentResponseDto {
  session: CashSessionSummaryDto | null;
  movements: CashMovementDto[];
  suggestedOpeningBalanceMinor: number;
  lastClosedDate: string | null;
}

export interface CustomerAccountDto {
  customerId: number;
  customerType: 'INDIVIDUAL' | 'COMPANY';
  fullName: string;
  companyName: string | null;
  phone: string;
  riskStatus: RiskLevel;
  totalRentals: number;
  activeContractsCount: number;
  overdueContractsCount: number;
  contractChargesMinor: number;
  debitAdjustmentsMinor: number;
  creditAndWriteOffMinor: number;
  totalChargedMinor: number;
  inflowsMinor: number;
  refundsMinor: number;
  netPaidMinor: number;
  outstandingBalanceMinor: number;
  overdueDebtMinor: number;
  heldDepositsMinor: number;
}

export interface CustomerLedgerDto {
  customer: {
    id: number;
    customerType: 'INDIVIDUAL' | 'COMPANY';
    fullName: string;
    companyName: string | null;
    phone: string;
    riskStatus: RiskLevel;
  };
  metrics: Omit<
    CustomerAccountDto,
    'customerId' | 'customerType' | 'fullName' | 'companyName' | 'phone' | 'riskStatus'
  >;
  contracts: Array<{
    id: number;
    contractNumber: string;
    vehicleLabel: string;
    status: ContractStatus;
    startDate: string;
    expectedReturnDate: string;
    currency: CurrencyCode;
    totalContractAmountMinor: number;
    adjustmentNetMinor: number;
    paidNetMinor: number;
    outstandingMinor: number;
    isOverdue: boolean;
  }>;
  payments: Array<{
    id: number;
    transactionCode: string;
    receiptNumber: string;
    contractId: number;
    contractNumber: string;
    direction: PaymentDirection;
    method: PaymentMethod;
    paymentReference: string | null;
    amountMinor: number;
    currency: CurrencyCode;
    paymentDate: string;
    description: string | null;
    recordedByUsername: string;
  }>;
  adjustments: Array<{
    id: number;
    adjustmentCode: string;
    customerId: number;
    contractId: number | null;
    contractNumber: string | null;
    adjustmentType: CustomerAdjustmentType;
    amountMinor: number;
    currency: CurrencyCode;
    adjustmentDate: string;
    reason: string;
    notes: string | null;
    authorizedByUsername: string;
    createdAt: string;
  }>;
  deposits: Array<{
    id: number;
    contractId: number;
    contractNumber: string;
    amountMinor: number;
    deductedAmountMinor: number;
    refundedAmountMinor: number;
    remainingHeldMinor: number;
    currency: CurrencyCode;
    status: DepositStatus;
    receivedDate: string;
  }>;
}

export interface ExpenseItemDto {
  id: number;
  expenseNumber: string;
  category: ExpenseCategory;
  vehicleId: number | null;
  vehicleLabel: string | null;
  supplierId: number | null;
  supplierName: string | null;
  maintenanceRecordId: number | null;
  amountMinor: number;
  currency: CurrencyCode;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  status: 'POSTED' | 'REVERSED';
  description: string;
  hasReceiptDoc: boolean;
  receiptOriginalName: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  reversedByUsername: string | null;
  recordedByUserId: number;
  recordedByUsername: string;
  createdAt: string;
}

export interface VehicleProfitabilityItemDto {
  vehicleId: number;
  internalCode: string;
  matricule: string;
  brand: string;
  model: string;
  category: string;
  contractCount: number;
  rentedDays: number;
  rentalRevenueMinor: number;
  collectedMinor: number;
  expensesMinor: number;
  netProfitMinor: number;
  acquisitionCostMinor: number | null;
  roiPercent: number | null;
}

export interface VehicleFinanceSummaryDto {
  vehicleId: number;
  expenses: ExpenseItemDto[];
  profitability: VehicleProfitabilityItemDto;
  totalFinesMinor: number;
  unpaidFinesMinor: number;
}

export interface FinancialDashboardReportDto {
  dateFrom: string;
  dateTo: string;
  currency: CurrencyCode;
  summary: {
    contractCount: number;
    rentalRevenueMinor: number;
    collectedNetMinor: number;
    paymentInflowsMinor: number;
    paymentRefundsMinor: number;
    expensesMinor: number;
    vehicleExpensesMinor: number;
    agencyExpensesMinor: number;
    netOperatingIncomeMinor: number;
    portfolioBilledMinor: number;
    portfolioCollectedNetMinor: number;
    portfolioOutstandingMinor: number;
    portfolioOverdueMinor: number;
    depositsCurrentlyHeldDzdMinor: number;
    depositsCurrentlyHeldEurMinor: number;
    depositsHeldCount: number;
    periodDepositsReceivedMinor: number;
    periodDepositsDeductedMinor: number;
    periodDepositsRefundedMinor: number;
    totalRefundsMinor: number;
    openCashSessionBalanceMinor: number | null;
    openCashSessionDate: string | null;
    lastClosedCashBalanceMinor: number;
    agencyOperatingCashNetMinor: number;
  };
  collectedByMethod: Record<PaymentMethod, number>;
  expensesByCategory: Array<{
    category: ExpenseCategory;
    vehicleMinor: number;
    agencyMinor: number;
    totalMinor: number;
  }>;
  dailyRevenue: Array<{
    date: string;
    contractRevenueMinor: number;
    adjustmentsNetMinor: number;
    totalRevenueMinor: number;
    collectedMinor: number;
    expensesMinor: number;
  }>;
  monthlyRevenue: Array<{
    month: string;
    contractRevenueMinor: number;
    adjustmentsNetMinor: number;
    totalRevenueMinor: number;
    collectedMinor: number;
    expensesMinor: number;
  }>;
  vehicleProfitability: VehicleProfitabilityItemDto[];
}

export type SupplierDto = Supplier;
export type CashMovementKind = CashMovementType;

export interface InspectionListItemDto extends VehicleInspection {
  contractNumber: string;
  contractStatus: string;
  expectedReturnDate: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  vehicleLabel: string;
  vehicleMatricule: string;
  inspectorName: string;
  inspectorUsername: string;
  photoCount: number;
  damageCount: number;
  newDamageCount: number;
  issueItemCount: number;
}

export interface InspectionChecklistDiffDto {
  itemKey: string;
  labelFr: string;
  labelAr: string;
  category: string;
  departureCondition: InspectionItemCondition | null;
  departureNotes: string | null;
  returnCondition: InspectionItemCondition | null;
  returnNotes: string | null;
  isDegraded: boolean;
  isMissingOnReturn: boolean;
}

export interface InspectionComparisonDto {
  departureInspection: VehicleInspection | null;
  returnInspection: VehicleInspection | null;
  odometerDeltaKm: number | null;
  fuelDeltaPercent: number | null;
  lateReturnMinutes: number;
  degradedItemsCount: number;
  missingAccessoriesCount: number;
  checklistDiffs: InspectionChecklistDiffDto[];
  newlyDiscoveredDamages: VehicleDamage[];
  preExistingDamages: VehicleDamage[];
}

export interface InspectionDetailDto {
  inspection: VehicleInspection & {
    inspectorName: string;
    inspectorUsername: string;
    finalizedByName: string | null;
  };
  contract: {
    id: number;
    contractNumber: string;
    status: string;
    startDate: string;
    expectedReturnDate: string;
    actualReturnDate: string | null;
    departureOdometerKm: number;
    returnOdometerKm: number | null;
  };
  vehicle: {
    id: number;
    internalCode: string;
    matricule: string;
    brand: string;
    model: string;
    year: number;
    color: string;
    category: string;
    currentOdometerKm: number;
  };
  customer: {
    id: number;
    customerType: string;
    fullName: string;
    phone: string;
    drivingLicenceNumber: string | null;
  };
  items: InspectionItem[];
  photos: InspectionPhoto[];
  damages: VehicleDamage[];
  comparison: InspectionComparisonDto | null;
}

export interface ContractInspectionsDto {
  contractId: number;
  departure: InspectionDetailDto | null;
  returnInspection: InspectionDetailDto | null;
  comparison: InspectionComparisonDto | null;
  openVehicleDamages: VehicleDamage[];
}

export interface VehicleDamageListItemDto extends VehicleDamage {
  vehicleLabel: string;
  vehicleMatricule: string;
  contractNumber: string | null;
  inspectionNumber: string | null;
  inspectionStage: InspectionStage | null;
  linkedExpenseNumber: string | null;
  reportedByName: string;
  resolutionHistory: DamageResolutionRecord[];
}

export interface InspectionPdfPayloadDto extends Omit<InspectionDetailDto, 'photos'> {
  photos: Array<InspectionPhoto & { dataUrl: string | null }>;
  agency: {
    name: string;
    commercialName: string;
    address: string;
    phone: string;
    email: string;
    nif: string;
    rc: string;
  };
}

// Phase 4 Step 2: Maintenance & Operational Alerts DTOs
export type { MaintenanceType, VehicleMaintenanceSchedule };
export type AppNotificationDto = AppNotification;

export interface VehicleMaintenanceDueItemDto {
  maintenanceTypeId: number;
  code: string;
  nameFr: string;
  nameAr: string;
  scheduleId: number | null;
  hasCustomSchedule: boolean;
  isScheduleActive: boolean;
  kmInterval: number | null;
  dayInterval: number | null;
  kmWarningThreshold: number;
  dayWarningThreshold: number;
  currentOdometerKm: number;
  lastRecordId: number | null;
  lastPerformedDate: string | null;
  lastOdometerKm: number | null;
  nextDueDate: string | null;
  nextDueOdometerKm: number | null;
  remainingKm: number | null;
  remainingDays: number | null;
  alertState: MaintenanceAlertState;
  activePlannedRecordId: number | null;
  activePlannedStatus: string | null;
  activePlannedDate: string | null;
  scheduleNotes: string | null;
}

export interface MaintenanceRecordListItemDto extends MaintenanceRecord {
  vehicleLabel: string;
  vehicleMatricule: string;
  maintenanceTypeCode: string;
  maintenanceTypeNameFr: string;
  maintenanceTypeNameAr: string;
  supplierName: string | null;
  recordedByUsername: string;
  linkedExpenseId: number | null;
  linkedExpenseNumber: string | null;
  blockIsActive: boolean;
}

export interface MaintenancePartUsedDto {
  id: number;
  maintenanceRecordId: number;
  partId: number;
  partCode: string;
  partName: string;
  quantityUsed: number;
  unitCostMinor: number;
  totalCostMinor: number;
}

export interface MaintenanceRecordDetailDto {
  record: MaintenanceRecordListItemDto;
  parts: MaintenancePartUsedDto[];
  blockedPeriod: {
    id: number;
    startDate: string;
    endDate: string;
    isActive: boolean;
    reason: string;
  } | null;
}

export interface VehicleMaintenanceOverviewDto {
  vehicleId: number;
  currentOdometerKm: number;
  status: VehicleStatus;
  dueSummary: VehicleMaintenanceDueItemDto[];
  records: MaintenanceRecordListItemDto[];
  alerts: AppNotificationDto[];
}

// Phase 4 Step 3: Spare Parts Inventory DTOs
export interface InventoryPartListItemDto extends InventoryPart {
  supplierName: string | null;
  stockValueMinor: number;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

export interface InventoryMovementListItemDto extends InventoryMovement {
  partCode: string;
  partName: string;
  unitLabel: string;
  maintenanceRecordNumber: string | null;
  vehicleLabel: string | null;
  supplierName: string | null;
  expenseNumber: string | null;
  recordedByUsername: string;
}

export interface InventoryOverviewDto {
  totalSkuCount: number;
  totalUnitsInStock: number;
  totalValuationMinor: number;
  lowStockCount: number;
  outOfStockCount: number;
  categories: string[];
  stockAlerts: AppNotificationDto[];
}

export interface InventoryPartDetailDto {
  part: InventoryPartListItemDto;
  movements: InventoryMovementListItemDto[];
}

/**
 * In-memory auth token only (never written to localStorage or sessionStorage).
 */
let memoryToken: string | null = null;
let sessionLockedHandler: (() => void) | null = null;

export function setInMemoryAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getInMemoryAuthToken(): string | null {
  return memoryToken;
}

export function setOnSessionLockedHandler(handler: (() => void) | null): void {
  sessionLockedHandler = handler;
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

async function callBackend<T>(
  ipcChannel: IpcChannel,
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  httpUrl: string,
  payload?: unknown
): Promise<T> {
  const notifyIfSessionLocked = (code?: string) => {
    if (
      code === 'LOCKED' &&
      memoryToken &&
      ipcChannel !== IPC_CHANNELS.AUTH_LOGIN &&
      ipcChannel !== IPC_CHANNELS.AUTH_UNLOCK &&
      ipcChannel !== IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN
    ) {
      sessionLockedHandler?.();
    }
  };

  if (typeof window !== 'undefined' && window.electronAPI) {
    const res: IpcResult<T> = await window.electronAPI.invoke(ipcChannel, {
      token: memoryToken,
      data: payload,
    });
    if (!res.ok) {
      notifyIfSessionLocked(res.error?.code);
      const err = new Error(res.error?.message || 'Erreur IPC') as Error & { code?: string };
      err.code = res.error?.code;
      throw err;
    }
    return res.data as T;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const response = await fetch(httpUrl, {
    method: httpMethod,
    headers,
    body: httpMethod !== 'GET' && httpMethod !== 'DELETE' && payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  const body = (await response.json()) as IpcResult<T>;
  if (!response.ok || !body.ok) {
    notifyIfSessionLocked(body.error?.code);
    const err = new Error(body.error?.message || `HTTP ${response.status}`) as Error & { code?: string };
    err.code = body.error?.code;
    throw err;
  }
  return body.data as T;
}

function buildQuery(params: Record<string, string | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') {
      qs.set(k, String(v));
    }
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export const erpClient = {
  getAuthStatus: () =>
    callBackend<AuthStatusResponse>(IPC_CHANNELS.AUTH_STATUS, 'GET', PREVIEW_ENDPOINTS.AUTH_STATUS),

  bootstrapAdmin: (payload: { username: string; fullName: string; password: string }) =>
    callBackend<AuthSession>(
      IPC_CHANNELS.AUTH_BOOTSTRAP_ADMIN,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_BOOTSTRAP,
      payload
    ),

  login: (payload: { username: string; password: string }) =>
    callBackend<AuthSession>(IPC_CHANNELS.AUTH_LOGIN, 'POST', PREVIEW_ENDPOINTS.AUTH_LOGIN, payload),

  me: () =>
    callBackend<AuthSession & { isLocked: boolean }>(
      IPC_CHANNELS.AUTH_ME,
      'GET',
      PREVIEW_ENDPOINTS.AUTH_ME
    ),

  lock: () =>
    callBackend<{ locked: boolean }>(IPC_CHANNELS.AUTH_LOCK, 'POST', PREVIEW_ENDPOINTS.AUTH_LOCK, {}),

  unlock: (password: string) =>
    callBackend<AuthSession>(IPC_CHANNELS.AUTH_UNLOCK, 'POST', PREVIEW_ENDPOINTS.AUTH_UNLOCK, {
      password,
    }),

  logout: () =>
    callBackend<{ loggedOut: boolean }>(
      IPC_CHANNELS.AUTH_LOGOUT,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_LOGOUT,
      {}
    ),

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    callBackend<{ changed: boolean }>(
      IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
      'POST',
      PREVIEW_ENDPOINTS.AUTH_CHANGE_PASSWORD,
      payload
    ),

  listUsers: () =>
    callBackend<UserWithPermissionsDto[]>(IPC_CHANNELS.USERS_LIST, 'GET', PREVIEW_ENDPOINTS.USERS),

  listPermissions: () =>
    callBackend<PermissionCatalogItem[]>(
      IPC_CHANNELS.USERS_PERMISSIONS,
      'GET',
      PREVIEW_ENDPOINTS.USERS_PERMISSIONS
    ),

  createUser: (payload: { username: string; fullName: string; password: string; roleCode: RoleCode }) =>
    callBackend<UserWithPermissionsDto>(
      IPC_CHANNELS.USERS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.USERS,
      payload
    ),

  updateUser: (payload: {
    userId: number;
    fullName?: string;
    roleCode?: RoleCode;
    isActive?: boolean;
    unlockAccount?: boolean;
    resetPassword?: string;
    permissionOverrides?: Array<{ code: PermissionCode; granted: boolean | null }>;
  }) =>
    callBackend<UserWithPermissionsDto>(
      IPC_CHANNELS.USERS_UPDATE,
      'PATCH',
      PREVIEW_ENDPOINTS.USERS,
      payload
    ),

  getAllSettings: () =>
    callBackend<Record<string, string>>(
      IPC_CHANNELS.SETTINGS_GET_ALL,
      'GET',
      PREVIEW_ENDPOINTS.SETTINGS
    ),

  updateSettingsBatch: (updates: Array<{ key: string; group: 'agency' | 'business' | 'documents' | 'app'; value: string }>) =>
    callBackend<Record<string, string>>(
      IPC_CHANNELS.SETTINGS_UPDATE_BATCH,
      'PUT',
      PREVIEW_ENDPOINTS.SETTINGS,
      { updates }
    ),

  listWilayas: (activeOnly = false) =>
    callBackend<WilayaDto[]>(
      IPC_CHANNELS.WILAYAS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.WILAYAS}?activeOnly=${activeOnly ? 'true' : 'false'}`,
      activeOnly ? { activeOnly: true } : undefined
    ),

  upsertWilaya: (payload: Omit<WilayaDto, 'updatedAt'>) =>
    callBackend<WilayaDto>(IPC_CHANNELS.WILAYAS_UPSERT, 'PUT', PREVIEW_ENDPOINTS.WILAYAS, payload),

  listAuditLogs: (limit = 100) =>
    callBackend<AuditLogEntry[]>(
      IPC_CHANNELS.AUDIT_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.AUDIT}?limit=${limit}`,
      { limit }
    ),

  // Phase 2: Fleet Management
  listVehicles: (filters?: { search?: string; status?: string; category?: string; includeArchived?: boolean }) =>
    callBackend<Vehicle[]>(
      IPC_CHANNELS.VEHICLES_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.VEHICLES}${buildQuery({
        search: filters?.search,
        status: filters?.status,
        category: filters?.category,
        includeArchived: filters?.includeArchived,
      })}`,
      filters
    ),

  getVehicleProfile: (id: number) =>
    callBackend<VehicleProfileDto>(
      IPC_CHANNELS.VEHICLES_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.VEHICLES}/${id}`,
      { id }
    ),

  createVehicle: (payload: {
    internalCode: string;
    matricule: string;
    vin?: string | null;
    brand: string;
    model: string;
    year: number;
    color: string;
    category: string;
    fuelType: VehicleFuelType;
    transmission: VehicleTransmission;
    seats: number;
    currentOdometerKm: number;
    acquisitionDate?: string | null;
    acquisitionCostMinor?: number | null;
    defaultDailyRateMinor: number;
    defaultWeeklyRateMinor?: number | null;
    defaultMonthlyRateMinor?: number | null;
    notes?: string | null;
  }) =>
    callBackend<Vehicle>(IPC_CHANNELS.VEHICLES_CREATE, 'POST', PREVIEW_ENDPOINTS.VEHICLES, payload),

  updateVehicle: (payload: {
    id: number;
    internalCode?: string;
    matricule?: string;
    vin?: string | null;
    brand?: string;
    model?: string;
    year?: number;
    color?: string;
    category?: string;
    fuelType?: VehicleFuelType;
    transmission?: VehicleTransmission;
    seats?: number;
    currentOdometerKm?: number;
    acquisitionDate?: string | null;
    acquisitionCostMinor?: number | null;
    defaultDailyRateMinor?: number;
    defaultWeeklyRateMinor?: number | null;
    defaultMonthlyRateMinor?: number | null;
    status?: VehicleStatus;
    notes?: string | null;
  }) =>
    callBackend<Vehicle>(
      IPC_CHANNELS.VEHICLES_UPDATE,
      'PATCH',
      `${PREVIEW_ENDPOINTS.VEHICLES}/${payload.id}`,
      payload
    ),

  archiveVehicle: (id: number) =>
    callBackend<{ archived: boolean }>(
      IPC_CHANNELS.VEHICLES_ARCHIVE,
      'POST',
      `${PREVIEW_ENDPOINTS.VEHICLES}/${id}/archive`,
      { id }
    ),

  upsertVehicleDoc: (payload: {
    id?: number;
    vehicleId: number;
    docType: VehicleDocType;
    documentNumber?: string | null;
    issueDate?: string | null;
    expirationDate: string;
    reminderDays: number;
    notes?: string | null;
  }) =>
    callBackend<VehicleDocument>(
      IPC_CHANNELS.VEHICLES_UPSERT_DOC,
      'POST',
      `${PREVIEW_ENDPOINTS.VEHICLES}/${payload.vehicleId}/documents`,
      payload
    ),

  createVehicleBlock: (payload: {
    vehicleId: number;
    blockType: 'MAINTENANCE' | 'ADMIN_HOLD' | 'OTHER';
    startDate: string;
    endDate: string;
    reason: string;
  }) =>
    callBackend<VehicleBlockedPeriodDto>(
      IPC_CHANNELS.VEHICLES_CREATE_BLOCK,
      'POST',
      `${PREVIEW_ENDPOINTS.VEHICLES}/${payload.vehicleId}/blocks`,
      payload
    ),

  releaseVehicleBlock: (blockId: number) =>
    callBackend<{ released: boolean }>(
      IPC_CHANNELS.VEHICLES_RELEASE_BLOCK,
      'POST',
      `${PREVIEW_ENDPOINTS.VEHICLES}/blocks/${blockId}/release`,
      { blockId }
    ),

  // Phase 2: Customers & Risk
  listCustomers: (filters?: {
    search?: string;
    customerType?: string;
    riskStatus?: string;
    includeArchived?: boolean;
  }) =>
    callBackend<CustomerListItemDto[]>(
      IPC_CHANNELS.CUSTOMERS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}${buildQuery({
        search: filters?.search,
        customerType: filters?.customerType,
        riskStatus: filters?.riskStatus,
        includeArchived: filters?.includeArchived,
      })}`,
      filters
    ),

  getCustomerProfile: (id: number) =>
    callBackend<CustomerProfileDto>(
      IPC_CHANNELS.CUSTOMERS_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${id}`,
      { id }
    ),

  createCustomer: (payload: {
    customerType: 'INDIVIDUAL' | 'COMPANY';
    fullName: string;
    dateOfBirth?: string | null;
    phone: string;
    secondaryPhone?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    commune?: string | null;
    cniNumber?: string | null;
    passportNumber?: string | null;
    drivingLicenceNumber?: string | null;
    drivingLicenceIssueDate?: string | null;
    drivingLicenceExpirationDate?: string | null;
    internalNotes?: string | null;
    company?: {
      companyName: string;
      legalRepresentative: string;
      rcNumber?: string | null;
      nifNumber?: string | null;
      nisNumber?: string | null;
      artNumber?: string | null;
      bonDeCommandeNumber?: string | null;
    } | null;
  }) =>
    callBackend<CustomerProfileDto>(
      IPC_CHANNELS.CUSTOMERS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.CUSTOMERS,
      payload
    ),

  updateCustomer: (payload: {
    id: number;
    customerType?: 'INDIVIDUAL' | 'COMPANY';
    fullName?: string;
    dateOfBirth?: string | null;
    phone?: string;
    secondaryPhone?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    commune?: string | null;
    cniNumber?: string | null;
    passportNumber?: string | null;
    drivingLicenceNumber?: string | null;
    drivingLicenceIssueDate?: string | null;
    drivingLicenceExpirationDate?: string | null;
    internalNotes?: string | null;
    company?: {
      companyName: string;
      legalRepresentative: string;
      rcNumber?: string | null;
      nifNumber?: string | null;
      nisNumber?: string | null;
      artNumber?: string | null;
      bonDeCommandeNumber?: string | null;
    } | null;
  }) =>
    callBackend<CustomerProfileDto>(
      IPC_CHANNELS.CUSTOMERS_UPDATE,
      'PATCH',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${payload.id}`,
      payload
    ),

  archiveCustomer: (id: number) =>
    callBackend<{ archived: boolean }>(
      IPC_CHANNELS.CUSTOMERS_ARCHIVE,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${id}/archive`,
      { id }
    ),

  addCustomerRisk: (payload: {
    customerId: number;
    riskLevel: RiskLevel;
    reason: RiskReason;
    description: string;
    incidentDate: string;
  }) =>
    callBackend<CustomerRiskRecord>(
      IPC_CHANNELS.CUSTOMERS_ADD_RISK,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${payload.customerId}/risk`,
      payload
    ),

  resolveCustomerRisk: (payload: {
    riskRecordId: number;
    resolutionNotes: string;
    nextCustomerRiskStatus?: RiskLevel;
  }) =>
    callBackend<CustomerRiskRecord>(
      IPC_CHANNELS.CUSTOMERS_RESOLVE_RISK,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/risk/${payload.riskRecordId}/resolve`,
      payload
    ),

  uploadCustomerDoc: (payload: {
    customerId: number;
    docCategory: CustomerDocument['docCategory'];
    originalFileName: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
    base64Data: string;
    documentNumber?: string | null;
    issueDate?: string | null;
    expirationDate?: string | null;
    reminderDays?: number;
    notes?: string | null;
    replaceDocId?: number | null;
  }) =>
    callBackend<CustomerDocument>(
      IPC_CHANNELS.CUSTOMERS_UPLOAD_DOC,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${payload.customerId}/documents`,
      payload
    ),

  updateCustomerDocMeta: (payload: {
    docId: number;
    documentNumber?: string | null;
    issueDate?: string | null;
    expirationDate?: string | null;
    reminderDays?: number;
    notes?: string | null;
  }) =>
    callBackend<CustomerDocument>(
      IPC_CHANNELS.CUSTOMERS_UPDATE_DOC_META,
      'PATCH',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/documents/${payload.docId}`,
      payload
    ),

  archiveCustomerDoc: (docId: number, reason?: string | null) =>
    callBackend<CustomerDocument>(
      IPC_CHANNELS.CUSTOMERS_ARCHIVE_DOC,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/documents/${docId}/archive`,
      { docId, reason }
    ),

  readCustomerDoc: (docId: number) =>
    callBackend<{ id: number; originalFileName: string; mimeType: string; base64Data: string }>(
      IPC_CHANNELS.CUSTOMERS_READ_DOC,
      'GET',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/documents/${docId}`,
      { docId }
    ),

  checkCustomerEligibility: (customerId: number, rentalEndDate: string) =>
    callBackend<CustomerEligibilityDto>(
      IPC_CHANNELS.CUSTOMERS_CHECK_ELIGIBILITY,
      'POST',
      `${PREVIEW_ENDPOINTS.CUSTOMERS}/${customerId}/eligibility`,
      { customerId, rentalEndDate }
    ),

  // Phase 2: Pricing Engine
  calculateRentalPrice: (payload: {
    vehicleId: number;
    customerId?: number | null;
    startDate: string;
    endDate: string;
    pricingTier?: 'AUTO' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
    customDailyRateMinor?: number | null;
    customTotalMinor?: number | null;
    discountType?: 'NONE' | 'FIXED' | 'PERCENT';
    discountValue?: number;
  }) =>
    callBackend<PriceCalculationDto>(
      IPC_CHANNELS.PRICING_CALCULATE,
      'POST',
      `${PREVIEW_ENDPOINTS.PRICING}/calculate`,
      payload
    ),

  listPricingRules: () =>
    callBackend<PricingRulesDto>(
      IPC_CHANNELS.PRICING_LIST_RULES,
      'GET',
      `${PREVIEW_ENDPOINTS.PRICING}/rules`
    ),

  createSeasonalRate: (payload: {
    name: string;
    vehicleCategory?: string | null;
    vehicleId?: number | null;
    startDate: string;
    endDate: string;
    dailyRateMinor: number;
    weeklyRateMinor?: number | null;
    monthlyRateMinor?: number | null;
  }) =>
    callBackend<any>(
      IPC_CHANNELS.PRICING_CREATE_SEASONAL,
      'POST',
      `${PREVIEW_ENDPOINTS.PRICING}/seasonal`,
      payload
    ),

  deleteSeasonalRate: (id: number) =>
    callBackend<{ deleted: boolean }>(
      IPC_CHANNELS.PRICING_DELETE_SEASONAL,
      'DELETE',
      `${PREVIEW_ENDPOINTS.PRICING}/seasonal/${id}`,
      { id }
    ),

  upsertCustomerCustomRate: (payload: {
    customerId: number;
    vehicleCategory?: string | null;
    vehicleId?: number | null;
    dailyRateMinor?: number | null;
    weeklyRateMinor?: number | null;
    monthlyRateMinor?: number | null;
    defaultDiscountPercent?: number;
    notes?: string | null;
  }) =>
    callBackend<CustomerCustomRateDto>(
      IPC_CHANNELS.PRICING_UPSERT_CUSTOMER_RATE,
      'POST',
      `${PREVIEW_ENDPOINTS.PRICING}/customer-rates`,
      payload
    ),

  // Phase 2: Planning & Reservations
  getPlanningCalendar: (startDate: string, endDate: string) =>
    callBackend<PlanningCalendarDto>(
      IPC_CHANNELS.PLANNING_CALENDAR,
      'GET',
      `${PREVIEW_ENDPOINTS.PLANNING}/calendar${buildQuery({ startDate, endDate })}`,
      { startDate, endDate }
    ),

  checkVehicleAvailability: (payload: {
    vehicleId: number;
    startDate: string;
    endDate: string;
    excludeContractId?: number | null;
    excludeReservationId?: number | null;
  }) =>
    callBackend<AvailabilityResultDto>(
      IPC_CHANNELS.PLANNING_CHECK_AVAILABILITY,
      'POST',
      `${PREVIEW_ENDPOINTS.PLANNING}/check-availability`,
      payload
    ),

  listReservations: (status?: string) =>
    callBackend<ReservationListItemDto[]>(
      IPC_CHANNELS.RESERVATIONS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.RESERVATIONS}${buildQuery({ status })}`,
      status ? { status } : undefined
    ),

  createReservation: (payload: {
    customerId: number;
    vehicleId: number;
    startDate: string;
    expectedReturnDate: string;
    estimatedTotalMinor: number;
    status: 'PENDING' | 'CONFIRMED';
    notes?: string | null;
  }) =>
    callBackend<ReservationListItemDto>(
      IPC_CHANNELS.RESERVATIONS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.RESERVATIONS,
      payload
    ),

  updateReservationStatus: (payload: {
    reservationId: number;
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW';
    notes?: string | null;
  }) =>
    callBackend<ReservationListItemDto>(
      IPC_CHANNELS.RESERVATIONS_UPDATE_STATUS,
      'PATCH',
      `${PREVIEW_ENDPOINTS.RESERVATIONS}/${payload.reservationId}/status`,
      payload
    ),

  // Phase 2: Rental Contracts & Extensions
  listContracts: (filters?: { status?: string; search?: string }) =>
    callBackend<ContractListItemDto[]>(
      IPC_CHANNELS.CONTRACTS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.CONTRACTS}${buildQuery({ status: filters?.status, search: filters?.search })}`,
      filters
    ),

  getContractDetail: (id: number) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.CONTRACTS}/${id}`,
      { id }
    ),

  createContract: (payload: {
    reservationId?: number | null;
    customerId: number;
    vehicleId: number;
    startDate: string;
    expectedReturnDate: string;
    departureOdometerKm: number;
    mileageMode: MileageMode;
    dailyMileageAllowanceKm?: number | null;
    includedTotalKm?: number | null;
    extraKmRateMinor: number;
    currency: CurrencyCode;
    baseRentalTotalMinor: number;
    discountMinor: number;
    depositAmountMinor: number;
    depositCurrency: CurrencyCode;
    initialPaymentMinor: number;
    initialPaymentMethod: PaymentMethod;
    initialPaymentReference?: string | null;
    blacklistOverrideReason?: string | null;
    notes?: string | null;
    initialStatus?: 'DRAFT' | 'CONFIRMED' | 'ACTIVE';
    pricingTier?: 'AUTO' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
    discountType?: 'NONE' | 'FIXED' | 'PERCENT';
    discountValue?: number;
    pricingBreakdownLabel?: string;
    discountAuthorizationReason?: string | null;
  }) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.CONTRACTS,
      payload
    ),

  activateContract: (contractId: number, departureOdometerKm?: number) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_ACTIVATE,
      'POST',
      `${PREVIEW_ENDPOINTS.CONTRACTS}/${contractId}/activate`,
      { contractId, departureOdometerKm }
    ),

  extendContract: (payload: {
    contractId: number;
    newReturnDate: string;
    additionalAmountMinor: number;
    additionalKmAllowance: number;
    notes?: string | null;
  }) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_EXTEND,
      'POST',
      `${PREVIEW_ENDPOINTS.CONTRACTS}/${payload.contractId}/extend`,
      payload
    ),

  completeContract: (payload: {
    contractId: number;
    actualReturnDate: string;
    returnOdometerKm: number;
    odometerCorrectionReason?: string | null;
    lateFeeMinor: number;
    damageChargeMinor: number;
    otherChargesMinor: number;
    notes?: string | null;
  }) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_COMPLETE,
      'POST',
      `${PREVIEW_ENDPOINTS.CONTRACTS}/${payload.contractId}/complete`,
      payload
    ),

  cancelContract: (contractId: number, reason: string) =>
    callBackend<ContractDetailDto>(
      IPC_CHANNELS.CONTRACTS_CANCEL,
      'POST',
      `${PREVIEW_ENDPOINTS.CONTRACTS}/${contractId}/cancel`,
      { contractId, reason }
    ),

  // Phase 3: Financial Management
  listPayments: (filters?: {
    contractId?: number;
    customerId?: number;
    method?: string;
    direction?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) =>
    callBackend<PaymentItemDto[]>(
      IPC_CHANNELS.FINANCE_LIST_PAYMENTS,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/payments${buildQuery({
        contractId: filters?.contractId ? String(filters.contractId) : undefined,
        customerId: filters?.customerId ? String(filters.customerId) : undefined,
        method: filters?.method,
        direction: filters?.direction,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        search: filters?.search,
      })}`,
      filters
    ),

  recordPayment: (payload: {
    contractId: number;
    direction: PaymentDirection;
    method: PaymentMethod;
    paymentReference?: string | null;
    amountMinor: number;
    currency: CurrencyCode;
    paymentDate: string;
    description?: string | null;
  }) =>
    callBackend<PaymentReceiptDto>(
      IPC_CHANNELS.FINANCE_RECORD_PAYMENT,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/payments`,
      payload
    ),

  reversePayment: (paymentId: number, reason: string) =>
    callBackend<PaymentReceiptDto>(
      IPC_CHANNELS.FINANCE_REVERSE_PAYMENT,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/payments/${paymentId}/reverse`,
      { paymentId, reason }
    ),

  getPaymentReceipt: (paymentId: number) =>
    callBackend<PaymentReceiptDto>(
      IPC_CHANNELS.FINANCE_GET_PAYMENT_RECEIPT,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/payments/${paymentId}/receipt`,
      { paymentId }
    ),

  listDeposits: (filters?: { status?: string; customerId?: number; search?: string }) =>
    callBackend<DepositListItemDto[]>(
      IPC_CHANNELS.FINANCE_LIST_DEPOSITS,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/deposits${buildQuery({
        status: filters?.status,
        customerId: filters?.customerId ? String(filters.customerId) : undefined,
        search: filters?.search,
      })}`,
      filters
    ),

  getDepositDetail: (depositId: number) =>
    callBackend<DepositDetailDto>(
      IPC_CHANNELS.FINANCE_GET_DEPOSIT_DETAIL,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/deposits/${depositId}`,
      { depositId }
    ),

  settleDeposit: (payload: {
    depositId: number;
    deductedAmountMinor: number;
    refundedAmountMinor: number;
    chargeCategory?: DepositChargeCategory | null;
    deductionReason?: string | null;
    refundMethod?: PaymentMethod;
    trafficFineId?: number | null;
    supportingDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }) =>
    callBackend<DepositDetailDto>(
      IPC_CHANNELS.FINANCE_SETTLE_DEPOSIT,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/deposits/${payload.depositId}/settle`,
      payload
    ),

  readDepositDoc: (depositId: number) =>
    callBackend<{ id: number; originalFileName: string; mimeType: string; base64Data: string }>(
      IPC_CHANNELS.FINANCE_READ_DEPOSIT_DOC,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/deposits/${depositId}/document`,
      { depositId }
    ),

  listTrafficFines: (filters?: { contractId?: number; customerId?: number }) =>
    callBackend<TrafficFineDto[]>(
      IPC_CHANNELS.FINANCE_LIST_FINES,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/fines${buildQuery({
        contractId: filters?.contractId ? String(filters.contractId) : undefined,
        customerId: filters?.customerId ? String(filters.customerId) : undefined,
      })}`,
      filters
    ),

  createTrafficFine: (payload: {
    contractId?: number | null;
    vehicleId: number;
    customerId: number;
    fineType: 'TRAFFIC' | 'RADAR' | 'PARKING' | 'OTHER';
    referenceNumber?: string | null;
    incurredDate: string;
    amountMinor: number;
    notes?: string | null;
  }) =>
    callBackend<TrafficFineDto>(
      IPC_CHANNELS.FINANCE_CREATE_FINE,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/fines`,
      payload
    ),

  listCustomerAccounts: (filters?: { search?: string; onlyWithBalance?: boolean; onlyOverdue?: boolean }) =>
    callBackend<CustomerAccountDto[]>(
      IPC_CHANNELS.FINANCE_CUSTOMER_ACCOUNTS,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/customers/accounts${buildQuery({
        search: filters?.search,
        onlyWithBalance: filters?.onlyWithBalance,
        onlyOverdue: filters?.onlyOverdue,
      })}`,
      filters
    ),

  getCustomerFinancialLedger: (customerId: number) =>
    callBackend<CustomerLedgerDto>(
      IPC_CHANNELS.FINANCE_CUSTOMER_LEDGER,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/customers/${customerId}/ledger`,
      { customerId }
    ),

  createCustomerAdjustment: (payload: {
    customerId: number;
    contractId?: number | null;
    adjustmentType: CustomerAdjustmentType;
    amountMinor: number;
    currency: CurrencyCode;
    adjustmentDate: string;
    reason: string;
    notes?: string | null;
  }) =>
    callBackend<CustomerLedgerDto>(
      IPC_CHANNELS.FINANCE_CREATE_CUSTOMER_ADJUSTMENT,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/customers/${payload.customerId}/adjustments`,
      payload
    ),

  listSuppliers: (includeArchived = false) =>
    callBackend<SupplierDto[]>(
      IPC_CHANNELS.FINANCE_LIST_SUPPLIERS,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/suppliers${buildQuery({
        includeArchived: includeArchived ? 'true' : undefined,
      })}`,
      { includeArchived }
    ),

  createSupplier: (payload: {
    id?: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    specialty?: string | null;
    nifNumber?: string | null;
    notes?: string | null;
    isArchived?: boolean;
  }) =>
    callBackend<SupplierDto>(
      IPC_CHANNELS.FINANCE_CREATE_SUPPLIER,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/suppliers`,
      payload
    ),

  upsertSupplier: (payload: {
    id?: number;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    wilayaCode?: string | null;
    specialty?: string | null;
    nifNumber?: string | null;
    notes?: string | null;
    isArchived?: boolean;
  }) =>
    callBackend<SupplierDto>(
      IPC_CHANNELS.FINANCE_UPSERT_SUPPLIER,
      payload.id ? 'PUT' : 'POST',
      payload.id ? `${PREVIEW_ENDPOINTS.FINANCE}/suppliers/${payload.id}` : `${PREVIEW_ENDPOINTS.FINANCE}/suppliers`,
      payload
    ),

  listExpenses: (filters?: {
    category?: string;
    vehicleId?: number;
    supplierId?: number;
    status?: string;
    scope?: 'ALL' | 'VEHICLE' | 'AGENCY';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) =>
    callBackend<ExpenseItemDto[]>(
      IPC_CHANNELS.FINANCE_LIST_EXPENSES,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/expenses${buildQuery({
        category: filters?.category,
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        supplierId: filters?.supplierId ? String(filters.supplierId) : undefined,
        status: filters?.status,
        scope: filters?.scope,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        search: filters?.search,
      })}`,
      filters
    ),

  recordExpense: (payload: {
    category: ExpenseCategory;
    vehicleId?: number | null;
    supplierId?: number | null;
    maintenanceRecordId?: number | null;
    amountMinor: number;
    currency: CurrencyCode;
    expenseDate: string;
    paymentMethod: PaymentMethod;
    paymentReference?: string | null;
    description: string;
    receiptDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }) =>
    callBackend<ExpenseItemDto>(
      IPC_CHANNELS.FINANCE_RECORD_EXPENSE,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/expenses`,
      payload
    ),

  reverseExpense: (expenseId: number, reason: string) =>
    callBackend<ExpenseItemDto>(
      IPC_CHANNELS.FINANCE_REVERSE_EXPENSE,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/expenses/${expenseId}/reverse`,
      { expenseId, reason }
    ),

  readExpenseDoc: (expenseId: number) =>
    callBackend<{ id: number; originalFileName: string; mimeType: string; base64Data: string }>(
      IPC_CHANNELS.FINANCE_READ_EXPENSE_DOC,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/expenses/${expenseId}/document`,
      { expenseId }
    ),

  getCurrentCashSession: () =>
    callBackend<CashCurrentResponseDto>(
      IPC_CHANNELS.FINANCE_CASH_SESSION_CURRENT,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/current`
    ),

  listCashSessions: (limit = 90) =>
    callBackend<CashSessionSummaryDto[]>(
      IPC_CHANNELS.FINANCE_CASH_SESSION_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions?limit=${limit}`,
      { limit }
    ),

  getCashSessionDetail: (sessionId: number) =>
    callBackend<CashSessionDetailDto>(
      IPC_CHANNELS.FINANCE_CASH_SESSION_DETAIL,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/${sessionId}`,
      { sessionId }
    ),

  openCashSession: (payload: {
    sessionDate?: string;
    openingBalanceMinor: number;
    openingNotes?: string | null;
  }) =>
    callBackend<CashSessionDetailDto>(
      IPC_CHANNELS.FINANCE_CASH_SESSION_OPEN,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/open`,
      payload
    ),

  closeCashSession: (payload: {
    sessionId: number;
    actualClosingMinor: number;
    discrepancyNotes?: string | null;
  }) =>
    callBackend<CashSessionDetailDto>(
      IPC_CHANNELS.FINANCE_CASH_SESSION_CLOSE,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/${payload.sessionId}/close`,
      payload
    ),

  recordCashAdjustment: (payload: {
    sessionId: number;
    amountDeltaMinor: number;
    reason: string;
  }) =>
    callBackend<CashSessionDetailDto>(
      IPC_CHANNELS.FINANCE_CASH_RECORD_ADJUSTMENT,
      'POST',
      `${PREVIEW_ENDPOINTS.FINANCE}/cash-register/sessions/${payload.sessionId}/adjustment`,
      payload
    ),

  getFinancialDashboardReports: (params?: { dateFrom?: string; dateTo?: string }) =>
    callBackend<FinancialDashboardReportDto>(
      IPC_CHANNELS.FINANCE_DASHBOARD_REPORTS,
      'GET',
      `${PREVIEW_ENDPOINTS.REPORTS}/dashboard${buildQuery({
        dateFrom: params?.dateFrom,
        dateTo: params?.dateTo,
      })}`,
      params
    ),

  getVehicleProfitabilityReport: (params?: {
    dateFrom?: string;
    dateTo?: string;
    includeArchived?: boolean;
  }) =>
    callBackend<VehicleProfitabilityItemDto[]>(
      IPC_CHANNELS.FINANCE_VEHICLE_PROFITABILITY,
      'GET',
      `${PREVIEW_ENDPOINTS.REPORTS}/vehicle-profitability${buildQuery({
        dateFrom: params?.dateFrom,
        dateTo: params?.dateTo,
        includeArchived: params?.includeArchived,
      })}`,
      params
    ),

  getVehicleFinanceSummary: (vehicleId: number) =>
    callBackend<VehicleFinanceSummaryDto>(
      IPC_CHANNELS.FINANCE_VEHICLE_SUMMARY,
      'GET',
      `${PREVIEW_ENDPOINTS.FINANCE}/vehicles/${vehicleId}/summary`,
      { vehicleId }
    ),

  exportFinancialCsv: (params?: { dateFrom?: string; dateTo?: string; lang?: 'fr' | 'ar' }) =>
    callBackend<{ fileName: string; csvContent: string }>(
      IPC_CHANNELS.FINANCE_EXPORT_CSV,
      'GET',
      `${PREVIEW_ENDPOINTS.REPORTS}/export-csv${buildQuery({
        dateFrom: params?.dateFrom,
        dateTo: params?.dateTo,
        lang: params?.lang,
      })}`,
      params
    ),

  // Phase 4 Step 1: Vehicle Inspections & Damage Management
  listInspections: (filters?: {
    vehicleId?: number;
    contractId?: number;
    stage?: InspectionStage | 'ALL';
    status?: InspectionStatus | 'ALL';
    onlyWithNewDamages?: boolean;
    search?: string;
  }) =>
    callBackend<InspectionListItemDto[]>(
      IPC_CHANNELS.INSPECTIONS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}${buildQuery({
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        contractId: filters?.contractId ? String(filters.contractId) : undefined,
        stage: filters?.stage,
        status: filters?.status,
        onlyWithNewDamages: filters?.onlyWithNewDamages,
        search: filters?.search,
      })}`,
      filters
    ),

  getInspectionDetail: (inspectionId: number) =>
    callBackend<InspectionDetailDto>(
      IPC_CHANNELS.INSPECTIONS_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/${inspectionId}`,
      { inspectionId }
    ),

  getContractInspections: (contractId: number) =>
    callBackend<ContractInspectionsDto>(
      IPC_CHANNELS.INSPECTIONS_GET_BY_CONTRACT,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/contract/${contractId}`,
      { contractId }
    ),

  createInspection: (payload: {
    contractId: number;
    stage: InspectionStage;
    odometerKm: number;
    fuelLevelPercent: number;
    exteriorNotes?: string | null;
    interiorNotes?: string | null;
    agencySignatureData?: string | null;
    customerSignatureData?: string | null;
    customerAcknowledged?: boolean;
    customerAcknowledgmentNotes?: string | null;
    inspectedAt?: string;
    finalizeNow?: boolean;
    items?: Array<{
      itemKey: string;
      category?: string;
      labelFr: string;
      labelAr: string;
      condition: InspectionItemCondition;
      notes?: string | null;
      sortOrder?: number;
    }>;
    damages?: Array<{
      zoneCode: string;
      diagramX?: number | null;
      diagramY?: number | null;
      damageType: DamageType;
      severity: DamageSeverity;
      description: string;
      isPreExisting?: boolean;
      isNewlyDiscovered?: boolean;
      estimatedRepairCostMinor?: number | null;
    }>;
  }) =>
    callBackend<InspectionDetailDto>(
      IPC_CHANNELS.INSPECTIONS_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.INSPECTIONS,
      payload
    ),

  updateInspectionDraft: (payload: {
    inspectionId: number;
    odometerKm?: number;
    fuelLevelPercent?: number;
    exteriorNotes?: string | null;
    interiorNotes?: string | null;
    agencySignatureData?: string | null;
    customerSignatureData?: string | null;
    customerAcknowledged?: boolean;
    customerAcknowledgmentNotes?: string | null;
    inspectedAt?: string;
    items?: Array<{
      itemKey: string;
      category?: string;
      labelFr: string;
      labelAr: string;
      condition: InspectionItemCondition;
      notes?: string | null;
      sortOrder?: number;
    }>;
  }) =>
    callBackend<InspectionDetailDto>(
      IPC_CHANNELS.INSPECTIONS_UPDATE,
      'PATCH',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/${payload.inspectionId}`,
      payload
    ),

  finalizeInspection: (inspectionId: number) =>
    callBackend<InspectionDetailDto>(
      IPC_CHANNELS.INSPECTIONS_FINALIZE,
      'POST',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/${inspectionId}/finalize`,
      { inspectionId }
    ),

  uploadInspectionPhoto: (payload: {
    inspectionId: number;
    damageId?: number | null;
    originalFileName: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    base64Data: string;
    caption?: string | null;
  }) =>
    callBackend<InspectionPhoto>(
      IPC_CHANNELS.INSPECTIONS_UPLOAD_PHOTO,
      'POST',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/${payload.inspectionId}/photos`,
      payload
    ),

  readInspectionPhoto: (photoId: number) =>
    callBackend<{
      id: number;
      inspectionId: number;
      damageId: number | null;
      originalFileName: string;
      mimeType: string;
      caption: string | null;
      base64Data: string;
    }>(
      IPC_CHANNELS.INSPECTIONS_READ_PHOTO,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/photos/${photoId}`,
      { photoId }
    ),

  deleteInspectionPhoto: (photoId: number) =>
    callBackend<{ deleted: boolean; id: number }>(
      IPC_CHANNELS.INSPECTIONS_DELETE_PHOTO,
      'DELETE',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/photos/${photoId}`,
      { photoId }
    ),

  getInspectionPdfPayload: (inspectionId: number) =>
    callBackend<InspectionPdfPayloadDto>(
      IPC_CHANNELS.INSPECTIONS_GET_PDF_PAYLOAD,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/${inspectionId}/pdf-payload`,
      { inspectionId }
    ),

  listVehicleDamages: (filters?: {
    vehicleId?: number;
    contractId?: number;
    inspectionId?: number;
    status?: DamageStatus | 'ALL';
    onlyNewlyDiscovered?: boolean;
  }) =>
    callBackend<VehicleDamageListItemDto[]>(
      IPC_CHANNELS.DAMAGES_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/damages${buildQuery({
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        contractId: filters?.contractId ? String(filters.contractId) : undefined,
        inspectionId: filters?.inspectionId ? String(filters.inspectionId) : undefined,
        status: filters?.status,
        onlyNewlyDiscovered: filters?.onlyNewlyDiscovered,
      })}`,
      filters
    ),

  addVehicleDamage: (payload: {
    vehicleId: number;
    contractId?: number | null;
    inspectionId?: number | null;
    zoneCode: string;
    diagramX?: number | null;
    diagramY?: number | null;
    damageType: DamageType;
    severity: DamageSeverity;
    description: string;
    isPreExisting?: boolean;
    isNewlyDiscovered?: boolean;
    estimatedRepairCostMinor?: number | null;
  }) =>
    callBackend<VehicleDamage>(
      IPC_CHANNELS.DAMAGES_ADD,
      'POST',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/damages`,
      payload
    ),

  updateDamageStatus: (payload: {
    damageId: number;
    newStatus: DamageStatus;
    notes: string;
    estimatedRepairCostMinor?: number | null;
    repairReference?: string | null;
    linkedExpenseId?: number | null;
  }) =>
    callBackend<VehicleDamageListItemDto>(
      IPC_CHANNELS.DAMAGES_UPDATE_STATUS,
      'PATCH',
      `${PREVIEW_ENDPOINTS.INSPECTIONS}/damages/${payload.damageId}/status`,
      payload
    ),

  // Phase 4 Step 2: Maintenance & Operational Alerts
  listMaintenanceTypes: (includeInactive = true) =>
    callBackend<MaintenanceType[]>(
      IPC_CHANNELS.MAINTENANCE_TYPES_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/types?includeInactive=${includeInactive ? 'true' : 'false'}`,
      { includeInactive }
    ),

  upsertMaintenanceType: (payload: {
    id?: number;
    code: string;
    nameFr: string;
    nameAr: string;
    defaultKmInterval?: number | null;
    defaultDayInterval?: number | null;
    kmWarningThreshold: number;
    dayWarningThreshold: number;
    isActive: boolean;
  }) =>
    callBackend<MaintenanceType>(
      IPC_CHANNELS.MAINTENANCE_TYPES_UPSERT,
      'POST',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/types`,
      payload
    ),

  getVehicleMaintenanceOverview: (vehicleId: number) =>
    callBackend<VehicleMaintenanceOverviewDto>(
      IPC_CHANNELS.MAINTENANCE_VEHICLE_OVERVIEW,
      'GET',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/vehicles/${vehicleId}/overview`,
      { vehicleId }
    ),

  upsertVehicleMaintenanceSchedule: (payload: {
    vehicleId: number;
    maintenanceTypeId: number;
    kmInterval?: number | null;
    dayInterval?: number | null;
    kmWarningThreshold: number;
    dayWarningThreshold: number;
    isActive: boolean;
    notes?: string | null;
  }) =>
    callBackend<{ schedule: VehicleMaintenanceSchedule; dueItem: VehicleMaintenanceDueItemDto }>(
      IPC_CHANNELS.MAINTENANCE_SCHEDULE_UPSERT,
      'PUT',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/schedules`,
      payload
    ),

  listMaintenance: (filters?: {
    vehicleId?: number;
    maintenanceTypeId?: number;
    status?: MaintenanceStatus | 'ALL';
    isEmergency?: boolean;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) =>
    callBackend<MaintenanceRecordListItemDto[]>(
      IPC_CHANNELS.MAINTENANCE_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}${buildQuery({
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        maintenanceTypeId: filters?.maintenanceTypeId ? String(filters.maintenanceTypeId) : undefined,
        status: filters?.status,
        isEmergency: filters?.isEmergency ? 'true' : undefined,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        search: filters?.search,
      })}`,
      filters
    ),

  getMaintenanceDetail: (recordId: number) =>
    callBackend<MaintenanceRecordDetailDto>(
      IPC_CHANNELS.MAINTENANCE_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/${recordId}`,
      { recordId }
    ),

  createMaintenance: (payload: {
    vehicleId: number;
    maintenanceTypeId: number;
    supplierId?: number | null;
    status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
    isEmergency?: boolean;
    workDescription: string;
    performedDate: string;
    scheduledStartDate?: string | null;
    scheduledEndDate?: string | null;
    odometerKm: number;
    nextDueDate?: string | null;
    nextDueOdometerKm?: number | null;
    laborCostMinor?: number;
    partsCostMinor?: number;
    partsUsed?: MaintenancePartInput[];
    technicianName?: string | null;
    notes?: string | null;
    blockVehicle?: boolean;
    recordInFinance?: boolean;
    financeCategory?: 'MAINTENANCE' | 'REPAIRS';
    financeExpenseScope?: 'TOTAL' | 'LABOR_ONLY';
    paymentMethod?: PaymentMethod;
    paymentReference?: string | null;
    invoiceDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }) =>
    callBackend<MaintenanceRecordDetailDto>(
      IPC_CHANNELS.MAINTENANCE_CREATE,
      'POST',
      PREVIEW_ENDPOINTS.MAINTENANCE,
      payload
    ),

  updateMaintenance: (payload: {
    recordId: number;
    status?: MaintenanceStatus;
    supplierId?: number | null;
    workDescription?: string;
    performedDate?: string;
    scheduledStartDate?: string | null;
    scheduledEndDate?: string | null;
    odometerKm?: number;
    nextDueDate?: string | null;
    nextDueOdometerKm?: number | null;
    laborCostMinor?: number;
    partsCostMinor?: number;
    partsUsed?: MaintenancePartInput[];
    technicianName?: string | null;
    notes?: string | null;
    blockVehicle?: boolean;
    recordInFinance?: boolean;
    financeCategory?: 'MAINTENANCE' | 'REPAIRS';
    financeExpenseScope?: 'TOTAL' | 'LABOR_ONLY';
    paymentMethod?: PaymentMethod;
    paymentReference?: string | null;
    invoiceDoc?: {
      originalFileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
      base64Data: string;
    } | null;
  }) =>
    callBackend<MaintenanceRecordDetailDto>(
      IPC_CHANNELS.MAINTENANCE_UPDATE,
      'PATCH',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/${payload.recordId}`,
      payload
    ),

  readMaintenanceInvoice: (recordId: number) =>
    callBackend<{ id: number; originalFileName: string; mimeType: string; base64Data: string }>(
      IPC_CHANNELS.MAINTENANCE_READ_INVOICE,
      'GET',
      `${PREVIEW_ENDPOINTS.MAINTENANCE}/${recordId}/invoice`,
      { recordId }
    ),

  listOperationalAlerts: (filters?: {
    includeResolved?: boolean;
    category?: string;
    severity?: NotificationSeverity | 'ALL';
    vehicleId?: number;
  }) =>
    callBackend<AppNotificationDto[]>(
      IPC_CHANNELS.NOTIFICATIONS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.NOTIFICATIONS}${buildQuery({
        includeResolved: filters?.includeResolved ? 'true' : undefined,
        category: filters?.category,
        severity: filters?.severity,
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
      })}`,
      filters
    ),

  syncOperationalAlerts: (referenceDate?: string) =>
    callBackend<AppNotificationDto[]>(
      IPC_CHANNELS.NOTIFICATIONS_SYNC_ALERTS,
      'POST',
      `${PREVIEW_ENDPOINTS.NOTIFICATIONS}/sync`,
      { referenceDate }
    ),

  markOperationalAlertRead: (alertId: number) =>
    callBackend<AppNotificationDto>(
      IPC_CHANNELS.NOTIFICATIONS_MARK_READ,
      'POST',
      `${PREVIEW_ENDPOINTS.NOTIFICATIONS}/${alertId}/read`,
      { alertId }
    ),

  resolveOperationalAlert: (alertId: number) =>
    callBackend<AppNotificationDto>(
      IPC_CHANNELS.NOTIFICATIONS_RESOLVE,
      'POST',
      `${PREVIEW_ENDPOINTS.NOTIFICATIONS}/${alertId}/resolve`,
      { alertId }
    ),

  // Phase 4 Step 3: Spare Parts Inventory
  getInventoryOverview: () =>
    callBackend<InventoryOverviewDto>(
      IPC_CHANNELS.INVENTORY_OVERVIEW,
      'GET',
      `${PREVIEW_ENDPOINTS.INVENTORY}/overview`
    ),

  listInventoryParts: (filters?: {
    category?: string;
    supplierId?: number;
    stockState?: 'ALL' | 'LOW' | 'OUT' | 'IN_STOCK';
    includeArchived?: boolean;
    search?: string;
  }) =>
    callBackend<InventoryPartListItemDto[]>(
      IPC_CHANNELS.INVENTORY_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.INVENTORY}/parts${buildQuery({
        category: filters?.category,
        supplierId: filters?.supplierId ? String(filters.supplierId) : undefined,
        stockState: filters?.stockState,
        includeArchived: filters?.includeArchived ? 'true' : undefined,
        search: filters?.search,
      })}`,
      filters
    ),

  getInventoryPartDetail: (partId: number) =>
    callBackend<InventoryPartDetailDto>(
      IPC_CHANNELS.INVENTORY_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.INVENTORY}/parts/${partId}`,
      { partId }
    ),

  upsertInventoryPart: (payload: {
    id?: number;
    partCode: string;
    partName: string;
    category: string;
    description?: string | null;
    unitLabel?: string;
    compatibleModels?: string | null;
    minimumStock: number;
    unitPurchasePriceMinor: number;
    supplierId?: number | null;
    storageLocation?: string | null;
    initialStock?: number;
    isArchived?: boolean;
  }) =>
    callBackend<InventoryPartDetailDto>(
      IPC_CHANNELS.INVENTORY_UPSERT_PART,
      'POST',
      `${PREVIEW_ENDPOINTS.INVENTORY}/parts`,
      payload
    ),

  archiveInventoryPart: (partId: number, archived = true) =>
    callBackend<InventoryPartDetailDto>(
      IPC_CHANNELS.INVENTORY_ARCHIVE_PART,
      'POST',
      `${PREVIEW_ENDPOINTS.INVENTORY}/parts/${partId}/archive`,
      { partId, archived }
    ),

  listInventoryMovements: (filters?: {
    partId?: number;
    movementType?: InventoryMovementType | 'ALL';
    vehicleId?: number;
    supplierId?: number;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
  }) =>
    callBackend<InventoryMovementListItemDto[]>(
      IPC_CHANNELS.INVENTORY_MOVEMENTS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.INVENTORY}/movements${buildQuery({
        partId: filters?.partId ? String(filters.partId) : undefined,
        movementType: filters?.movementType,
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        supplierId: filters?.supplierId ? String(filters.supplierId) : undefined,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        search: filters?.search,
        limit: filters?.limit ? String(filters.limit) : undefined,
      })}`,
      filters
    ),

  recordInventoryMovement: (payload: {
    partId: number;
    movementType: 'PURCHASE' | 'ENTRY' | 'WITHDRAWAL' | 'RETURN';
    quantity: number;
    unitCostMinor?: number;
    supplierId?: number | null;
    vehicleId?: number | null;
    maintenanceRecordId?: number | null;
    referenceCode?: string | null;
    movementDate?: string;
    notes?: string | null;
    recordInFinance?: boolean;
    paymentMethod?: PaymentMethod;
    paymentReference?: string | null;
  }) =>
    callBackend<{ movement: InventoryMovementListItemDto; part: InventoryPartListItemDto }>(
      IPC_CHANNELS.INVENTORY_RECORD_MOVEMENT,
      'POST',
      `${PREVIEW_ENDPOINTS.INVENTORY}/movements`,
      payload
    ),

  adjustInventoryStock: (payload: {
    partId: number;
    quantityDelta: number;
    overrideReason: string;
    notes?: string | null;
    movementDate?: string;
  }) =>
    callBackend<{ movement: InventoryMovementListItemDto; part: InventoryPartListItemDto }>(
      IPC_CHANNELS.INVENTORY_ADJUST_STOCK,
      'POST',
      `${PREVIEW_ENDPOINTS.INVENTORY}/adjust`,
      payload
    ),

  // Phase 5: Documents, Templates, Printing & Reports
  generateDocument: (payload: {
    documentKind: DocumentKind;
    format?: DocumentFormat;
    language?: AppLanguage;
    numeralSystem?: NumeralSystem;
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
  }) =>
    callBackend<{ document: GeneratedDocument; invoice: Invoice | null; pdfBase64: string }>(
      IPC_CHANNELS.DOCUMENTS_GENERATE,
      'POST',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/generate`,
      payload
    ),

  listDocuments: (filters?: {
    search?: string;
    documentKind?: DocumentKind;
    format?: DocumentFormat;
    customerId?: number;
    vehicleId?: number;
    contractId?: number;
    dateFrom?: string;
    dateTo?: string;
    isCopy?: boolean;
    limit?: number;
  }) =>
    callBackend<GeneratedDocument[]>(
      IPC_CHANNELS.DOCUMENTS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}${buildQuery({
        search: filters?.search,
        documentKind: filters?.documentKind,
        format: filters?.format,
        customerId: filters?.customerId ? String(filters.customerId) : undefined,
        vehicleId: filters?.vehicleId ? String(filters.vehicleId) : undefined,
        contractId: filters?.contractId ? String(filters.contractId) : undefined,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        isCopy: filters?.isCopy !== undefined ? String(filters.isCopy) : undefined,
        limit: filters?.limit ? String(filters.limit) : undefined,
      })}`,
      filters
    ),

  getDocument: (id: number) =>
    callBackend<GeneratedDocument>(
      IPC_CHANNELS.DOCUMENTS_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/${id}`,
      { id }
    ),

  readDocumentPdf: (id: number) =>
    callBackend<{ document: GeneratedDocument; originalFileName: string; mimeType: string; base64Data: string }>(
      IPC_CHANNELS.DOCUMENTS_READ,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/${id}/read`,
      { id }
    ),

  reprintDocument: (payload: {
    sourceDocumentId: number;
    format?: DocumentFormat;
    language?: AppLanguage;
  }) =>
    callBackend<{ document: GeneratedDocument; pdfBase64: string }>(
      IPC_CHANNELS.DOCUMENTS_REPRINT,
      'POST',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/${payload.sourceDocumentId}/reprint`,
      payload
    ),

  listPrinters: () =>
    callBackend<SystemPrinterInfo[]>(
      IPC_CHANNELS.DOCUMENTS_LIST_PRINTERS,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/printers`
    ),

  printDocument: (payload: {
    documentId: number;
    printerName?: string | null;
    silent?: boolean;
    copies?: number;
  }) =>
    callBackend<{ printed: boolean; printerName: string | null; copies: number; message?: string; document: GeneratedDocument }>(
      IPC_CHANNELS.DOCUMENTS_PRINT,
      'POST',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/${payload.documentId}/printed`,
      payload
    ),

  getDocumentTemplates: () =>
    callBackend<DocumentTemplateConfig>(
      IPC_CHANNELS.DOCUMENTS_TEMPLATES_GET,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/templates`
    ),

  updateDocumentTemplates: (payload: {
    defaultLanguage?: AppLanguage;
    defaultFormat?: DocumentFormat;
    thermalWidth?: '80MM' | '58MM';
    defaultPrinterA4?: string;
    defaultPrinterThermal?: string;
    showLogo?: boolean;
    showFiscalIds?: boolean;
    showSignatureBoxes?: boolean;
    invoiceFiscallyCompliant?: boolean;
    invoiceTaxRatePercent?: number;
    footerFr?: string;
    footerAr?: string;
    signatureAgencyFr?: string;
    signatureAgencyAr?: string;
    signatureCustomerFr?: string;
    signatureCustomerAr?: string;
    contractTermsFr?: string;
    contractTermsAr?: string;
    invoiceDisclaimerFr?: string;
    invoiceDisclaimerAr?: string;
    prefixes?: Partial<Record<DocumentKind, string>>;
  }) =>
    callBackend<DocumentTemplateConfig>(
      IPC_CHANNELS.DOCUMENTS_TEMPLATES_UPDATE,
      'PUT',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/templates`,
      payload
    ),

  uploadAgencyLogo: (payload: {
    originalFileName: string;
    mimeType: 'image/png' | 'image/jpeg';
    base64Data: string;
  }) =>
    callBackend<DocumentTemplateConfig>(
      IPC_CHANNELS.DOCUMENTS_LOGO_UPLOAD,
      'POST',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/logo`,
      payload
    ),

  readAgencyLogo: () =>
    callBackend<{ mimeType: string; base64Data: string } | null>(
      IPC_CHANNELS.DOCUMENTS_LOGO_READ,
      'GET',
      `${PREVIEW_ENDPOINTS.DOCUMENTS}/logo`
    ),

  generateReport: (filter: ReportFilter) =>
    callBackend<ReportDataset>(
      IPC_CHANNELS.REPORTS_GENERATE,
      'POST',
      `${PREVIEW_ENDPOINTS.REPORTS}/generate`,
      filter
    ),

  exportReportFile: (payload: {
    filter: ReportFilter;
    exportFormat: ReportExportFormat;
    pdfFormat?: 'A4_PDF' | 'A4_LANDSCAPE_PDF';
    language: AppLanguage;
    numeralSystem?: NumeralSystem;
  }) =>
    callBackend<{
      exportFormat: ReportExportFormat;
      fileName: string;
      mimeType: string;
      base64Data: string;
      document?: GeneratedDocument;
    }>(
      IPC_CHANNELS.REPORTS_EXPORT_FILE,
      'POST',
      `${PREVIEW_ENDPOINTS.REPORTS}/export`,
      payload
    ),

  // Phase 6: Backups, Health Diagnostics, Vault Recovery & Atomic Restore
  getDatabaseHealth: (deepIntegrity = true) =>
    callBackend<DatabaseHealthReport>(
      IPC_CHANNELS.BACKUPS_HEALTH,
      'GET',
      `${PREVIEW_ENDPOINTS.BACKUPS_HEALTH}${buildQuery({ deep: deepIntegrity ? 'true' : 'false' })}`,
      { deepIntegrity }
    ),

  listBackups: (limit = 100) =>
    callBackend<BackupRecord[]>(
      IPC_CHANNELS.BACKUPS_LIST,
      'GET',
      `${PREVIEW_ENDPOINTS.BACKUPS}${buildQuery({ limit: String(limit) })}`,
      { limit }
    ),

  createBackup: (payload: {
    backupType?: 'MANUAL' | 'AUTO';
    encryptionMode?: BackupEncryptionMode;
    passphrase?: string;
    destinationPath?: string | null;
    notes?: string | null;
  }) =>
    callBackend<{ backup: BackupRecord; verification: BackupVerificationResult }>(
      IPC_CHANNELS.BACKUPS_CREATE_MANUAL,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS,
      payload
    ),

  verifyBackup: (payload: {
    backupRecordId?: number;
    filePath?: string;
    base64Archive?: string;
    passphrase?: string;
    recoveryKey?: string;
  }) =>
    callBackend<BackupVerificationResult>(
      IPC_CHANNELS.BACKUPS_VERIFY,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS_VERIFY,
      payload
    ),

  exportBackup: (payload: { backupRecordId: number; destinationPath?: string }) =>
    callBackend<{
      fileName: string;
      exportedToPath?: string;
      base64Archive?: string;
      checksumSha256: string;
    }>(
      IPC_CHANNELS.BACKUPS_EXPORT,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS_EXPORT,
      payload
    ),

  importBackup: (payload: {
    sourcePath?: string;
    fileName?: string;
    base64Archive?: string;
    passphrase?: string;
    recoveryKey?: string;
  }) =>
    callBackend<{ backup: BackupRecord; verification: BackupVerificationResult }>(
      IPC_CHANNELS.BACKUPS_IMPORT,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS_IMPORT,
      payload
    ),

  getVaultRecoveryKey: (adminPassword: string) =>
    callBackend<VaultRecoveryInfo>(
      IPC_CHANNELS.BACKUPS_RECOVERY_KEY,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS_RECOVERY_KEY,
      { adminPassword }
    ),

  restoreBackup: (payload: {
    backupRecordId?: number;
    filePath?: string;
    base64Archive?: string;
    fileName?: string;
    passphrase?: string;
    recoveryKey?: string;
    adminPassword: string;
  }) =>
    callBackend<{
      restoredFrom: string;
      verification: BackupVerificationResult;
      preRestoreBackup: BackupRecord;
      healthReport: DatabaseHealthReport;
    }>(
      IPC_CHANNELS.BACKUPS_RESTORE,
      'POST',
      PREVIEW_ENDPOINTS.BACKUPS_RESTORE,
      payload
    ),

  pickBackupPath: async (payload: {
    mode: 'save' | 'open';
    defaultFileName?: string;
  }): Promise<{ canceled: boolean; filePath: string | null }> => {
    if (!isDesktopRuntime()) {
      return { canceled: true, filePath: null };
    }
    return callBackend<{ canceled: boolean; filePath: string | null }>(
      IPC_CHANNELS.BACKUPS_PICK_FILE,
      'POST',
      `${PREVIEW_ENDPOINTS.BACKUPS}/pick-file`,
      payload
    );
  },
};
