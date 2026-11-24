import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DEFAULT_INSPECTION_CHECKLIST } from '../../../shared/constants/inspections.ts';
import type {
  DamageResolutionRecord,
  DamageSeverity,
  DamageStatus,
  DamageType,
  InspectionItem,
  InspectionItemCondition,
  InspectionPhoto,
  InspectionStage,
  InspectionStatus,
  VehicleDamage,
  VehicleInspection,
} from '../../../shared/types/domain.ts';
import { decryptBuffer, encryptBuffer, resolveConfinedPath } from '../../security/crypto.ts';
import { validateAndDecodeUpload } from '../../security/fileValidation.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';

function mapInspection(r: any): VehicleInspection {
  return {
    id: r.id,
    inspectionNumber: r.inspection_number,
    contractId: r.contract_id,
    vehicleId: r.vehicle_id,
    stage: r.stage as InspectionStage,
    status: (r.status ?? 'DRAFT') as InspectionStatus,
    odometerKm: Number(r.odometer_km),
    fuelLevelPercent: Number(r.fuel_level_percent),
    exteriorNotes: r.exterior_notes ?? null,
    interiorNotes: r.interior_notes ?? null,
    agencySignatureData: r.agency_signature_data ?? null,
    customerSignatureData: r.customer_signature_data ?? null,
    customerAcknowledged: r.customer_acknowledged === 1,
    customerAcknowledgmentNotes: r.customer_acknowledgment_notes ?? null,
    lateReturnMinutes: Number(r.late_return_minutes ?? 0),
    mileageDeltaKm: r.mileage_delta_km != null ? Number(r.mileage_delta_km) : null,
    inspectorUserId: r.inspector_user_id,
    inspectedAt: r.inspected_at,
    finalizedAt: r.finalized_at ?? null,
    finalizedByUserId: r.finalized_by_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  };
}

function mapItem(r: any): InspectionItem {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    itemKey: r.item_key,
    category: r.category ?? 'GENERAL',
    labelFr: r.label_fr,
    labelAr: r.label_ar,
    condition: r.condition as InspectionItemCondition,
    notes: r.notes ?? null,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

function mapPhoto(r: any): InspectionPhoto {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    damageId: r.damage_id ?? null,
    filePath: r.file_path,
    originalFileName: r.original_file_name ?? null,
    mimeType: r.mime_type ?? null,
    caption: r.caption ?? null,
    uploadedByUserId: r.uploaded_by_user_id ?? null,
    createdAt: r.created_at,
  };
}

function mapDamage(r: any): VehicleDamage {
  return {
    id: r.id,
    damageCode: r.damage_code,
    vehicleId: r.vehicle_id,
    contractId: r.contract_id ?? null,
    inspectionId: r.inspection_id ?? null,
    zoneCode: r.zone_code,
    diagramX: r.diagram_x != null ? Number(r.diagram_x) : null,
    diagramY: r.diagram_y != null ? Number(r.diagram_y) : null,
    damageType: r.damage_type as DamageType,
    severity: r.severity as DamageSeverity,
    description: r.description,
    isPreExisting: r.is_pre_existing === 1,
    isNewlyDiscovered: r.is_newly_discovered === 1,
    status: r.status as DamageStatus,
    estimatedRepairCostMinor:
      r.estimated_repair_cost_minor != null ? Number(r.estimated_repair_cost_minor) : null,
    repairReference: r.repair_reference ?? null,
    linkedExpenseId: r.linked_expense_id ?? null,
    reportedByUserId: r.reported_by_user_id,
    reportedAt: r.reported_at,
    updatedAt: r.updated_at,
  };
}

function mapDamageResolution(r: any): DamageResolutionRecord {
  return {
    id: r.id,
    damageId: r.damage_id,
    previousStatus: (r.previous_status ?? null) as DamageStatus | null,
    newStatus: r.new_status as DamageStatus,
    notes: r.notes,
    repairReference: r.repair_reference ?? null,
    linkedExpenseId: r.linked_expense_id ?? null,
    recordedByUserId: r.recorded_by_user_id,
    recordedByUsername: r.recorded_by_username ?? undefined,
    createdAt: r.created_at,
  };
}

function generateInspectionNumber(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const row = db.prepare<[], { max_id: number }>('SELECT COALESCE(MAX(id), 0) AS max_id FROM vehicle_inspections').get();
  const next = (row?.max_id ?? 0) + 1;
  return `EDL-${year}-${String(next).padStart(5, '0')}`;
}

function generateDamageCode(db: Database.Database): string {
  const year = new Date().getUTCFullYear();
  const row = db.prepare<[], { max_id: number }>('SELECT COALESCE(MAX(id), 0) AS max_id FROM vehicle_damages').get();
  const next = (row?.max_id ?? 0) + 1;
  return `DMG-${year}-${String(next).padStart(5, '0')}`;
}

function computeReturnDeltas(
  db: Database.Database,
  contractRow: any,
  returnOdometerKm: number,
  inspectedAt: string
): { mileageDeltaKm: number; lateReturnMinutes: number } {
  const depRow = db
    .prepare<[number], { odometer_km: number }>(
      "SELECT odometer_km FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
    )
    .get(contractRow.id);

  const baseOdometer = depRow ? Number(depRow.odometer_km) : Number(contractRow.departure_odometer_km ?? 0);
  const mileageDeltaKm = Math.max(0, returnOdometerKm - baseOdometer);

  const expectedMs = Date.parse(contractRow.expected_return_date);
  const actualMs = Date.parse(inspectedAt);
  const lateReturnMinutes =
    !Number.isNaN(expectedMs) && !Number.isNaN(actualMs) && actualMs > expectedMs
      ? Math.round((actualMs - expectedMs) / 60000)
      : 0;

  return { mileageDeltaKm, lateReturnMinutes };
}

export function buildDepartureReturnComparison(
  db: Database.Database,
  contractId: number
) {
  const depRow = db
    .prepare<[number], any>(
      "SELECT * FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
    )
    .get(contractId);
  const retRow = db
    .prepare<[number], any>(
      "SELECT * FROM vehicle_inspections WHERE contract_id = ? AND stage = 'RETURN'"
    )
    .get(contractId);

  if (!depRow && !retRow) return null;

  const depItems = depRow
    ? db
        .prepare<[number], any>('SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC')
        .all(depRow.id)
        .map(mapItem)
    : [];
  const retItems = retRow
    ? db
        .prepare<[number], any>('SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC')
        .all(retRow.id)
        .map(mapItem)
    : [];

  const depDamages = depRow
    ? db
        .prepare<[number], any>('SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC')
        .all(depRow.id)
        .map(mapDamage)
    : [];
  const retDamages = retRow
    ? db
        .prepare<[number], any>('SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC')
        .all(retRow.id)
        .map(mapDamage)
    : [];

  const depMap = new Map<string, InspectionItem>();
  for (const item of depItems) depMap.set(item.itemKey, item);
  const retMap = new Map<string, InspectionItem>();
  for (const item of retItems) retMap.set(item.itemKey, item);

  const allKeys = Array.from(new Set([...depMap.keys(), ...retMap.keys()]));
  const conditionRank: Record<InspectionItemCondition, number> = {
    GOOD: 0,
    DAMAGED: 1,
    MISSING: 2,
  };

  const checklistDiffs = allKeys.map((key) => {
    const dep = depMap.get(key) ?? null;
    const ret = retMap.get(key) ?? null;
    const isDegraded = Boolean(
      dep && ret && conditionRank[ret.condition] > conditionRank[dep.condition]
    );
    const isMissingOnReturn = Boolean(
      ret && ret.condition === 'MISSING' && (!dep || dep.condition !== 'MISSING')
    );
    return {
      itemKey: key,
      labelFr: ret?.labelFr ?? dep?.labelFr ?? key,
      labelAr: ret?.labelAr ?? dep?.labelAr ?? key,
      category: ret?.category ?? dep?.category ?? 'GENERAL',
      departureCondition: dep?.condition ?? null,
      departureNotes: dep?.notes ?? null,
      returnCondition: ret?.condition ?? null,
      returnNotes: ret?.notes ?? null,
      isDegraded,
      isMissingOnReturn,
    };
  });

  const contract = db
    .prepare<[number], any>('SELECT departure_odometer_km, expected_return_date FROM rental_contracts WHERE id = ?')
    .get(contractId);

  const odometerDeltaKm =
    retRow != null
      ? Math.max(
          0,
          Number(retRow.odometer_km) -
            Number(depRow ? depRow.odometer_km : contract?.departure_odometer_km ?? 0)
        )
      : null;

  const fuelDeltaPercent =
    depRow && retRow
      ? Number(retRow.fuel_level_percent) - Number(depRow.fuel_level_percent)
      : null;

  const newlyDiscoveredDamages = retDamages.filter((d) => d.isNewlyDiscovered);
  const preExistingDamages = [
    ...depDamages,
    ...retDamages.filter((d) => d.isPreExisting && !d.isNewlyDiscovered),
  ];

  return {
    departureInspection: depRow ? mapInspection(depRow) : null,
    returnInspection: retRow ? mapInspection(retRow) : null,
    odometerDeltaKm,
    fuelDeltaPercent,
    lateReturnMinutes: retRow ? Number(retRow.late_return_minutes ?? 0) : 0,
    degradedItemsCount: checklistDiffs.filter((d) => d.isDegraded).length,
    missingAccessoriesCount: checklistDiffs.filter((d) => d.isMissingOnReturn).length,
    checklistDiffs,
    newlyDiscoveredDamages,
    preExistingDamages,
  };
}

export function listInspections(
  db: Database.Database,
  filters?: {
    vehicleId?: number;
    contractId?: number;
    stage?: InspectionStage | 'ALL';
    status?: InspectionStatus | 'ALL';
    onlyWithNewDamages?: boolean;
    search?: string;
  }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.vehicleId) {
    clauses.push('vi.vehicle_id = ?');
    params.push(filters.vehicleId);
  }
  if (filters?.contractId) {
    clauses.push('vi.contract_id = ?');
    params.push(filters.contractId);
  }
  if (filters?.stage && filters.stage !== 'ALL') {
    clauses.push('vi.stage = ?');
    params.push(filters.stage);
  }
  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('vi.status = ?');
    params.push(filters.status);
  }
  if (filters?.onlyWithNewDamages) {
    clauses.push(
      'EXISTS (SELECT 1 FROM vehicle_damages vd WHERE vd.inspection_id = vi.id AND vd.is_newly_discovered = 1)'
    );
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      '(vi.inspection_number LIKE ? OR rc.contract_number LIKE ? OR c.full_name LIKE ? OR v.matricule LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)'
    );
    params.push(q, q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT vi.*,
              rc.contract_number,
              rc.status AS contract_status,
              rc.expected_return_date,
              c.id AS customer_id,
              c.full_name AS customer_name,
              c.phone AS customer_phone,
              v.brand || ' ' || v.model AS vehicle_label,
              v.matricule AS vehicle_matricule,
              u.full_name AS inspector_name,
              u.username AS inspector_username,
              (SELECT COUNT(*) FROM inspection_photos ip WHERE ip.inspection_id = vi.id) AS photo_count,
              (SELECT COUNT(*) FROM vehicle_damages vd WHERE vd.inspection_id = vi.id) AS damage_count,
              (SELECT COUNT(*) FROM vehicle_damages vd WHERE vd.inspection_id = vi.id AND vd.is_newly_discovered = 1) AS new_damage_count,
              (SELECT COUNT(*) FROM inspection_items ii WHERE ii.inspection_id = vi.id AND ii.condition != 'GOOD') AS issue_item_count
       FROM vehicle_inspections vi
       JOIN rental_contracts rc ON rc.id = vi.contract_id
       JOIN customers c ON c.id = rc.customer_id
       JOIN vehicles v ON v.id = vi.vehicle_id
       JOIN users u ON u.id = vi.inspector_user_id
       ${where}
       ORDER BY vi.inspected_at DESC, vi.id DESC`
    )
    .all(...params);

  return rows.map((r) => ({
    ...mapInspection(r),
    contractNumber: r.contract_number as string,
    contractStatus: r.contract_status as string,
    expectedReturnDate: r.expected_return_date as string,
    customerId: Number(r.customer_id),
    customerName: r.customer_name as string,
    customerPhone: r.customer_phone as string,
    vehicleLabel: r.vehicle_label as string,
    vehicleMatricule: r.vehicle_matricule as string,
    inspectorName: r.inspector_name as string,
    inspectorUsername: r.inspector_username as string,
    photoCount: Number(r.photo_count ?? 0),
    damageCount: Number(r.damage_count ?? 0),
    newDamageCount: Number(r.new_damage_count ?? 0),
    issueItemCount: Number(r.issue_item_count ?? 0),
  }));
}

export function getInspectionDetail(db: Database.Database, inspectionId: number) {
  const row = db
    .prepare<[number], any>(
      `SELECT vi.*,
              u.full_name AS inspector_name,
              u.username AS inspector_username,
              fu.full_name AS finalized_by_name
       FROM vehicle_inspections vi
       JOIN users u ON u.id = vi.inspector_user_id
       LEFT JOIN users fu ON fu.id = vi.finalized_by_user_id
       WHERE vi.id = ?`
    )
    .get(inspectionId);

  if (!row) {
    throw new AuthError('NOT_FOUND', 'État des lieux introuvable');
  }

  const contractRow = db
    .prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?')
    .get(row.contract_id);
  const vehicleRow = db
    .prepare<[number], any>('SELECT * FROM vehicles WHERE id = ?')
    .get(row.vehicle_id);
  const customerRow = db
    .prepare<[number], any>('SELECT * FROM customers WHERE id = ?')
    .get(contractRow.customer_id);

  const items = db
    .prepare<[number], any>('SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY sort_order ASC, id ASC')
    .all(inspectionId)
    .map(mapItem);

  const photos = db
    .prepare<[number], any>('SELECT * FROM inspection_photos WHERE inspection_id = ? ORDER BY id ASC')
    .all(inspectionId)
    .map(mapPhoto);

  const damages = db
    .prepare<[number], any>('SELECT * FROM vehicle_damages WHERE inspection_id = ? ORDER BY id ASC')
    .all(inspectionId)
    .map(mapDamage);

  const comparison =
    row.stage === 'RETURN' ? buildDepartureReturnComparison(db, row.contract_id) : null;

  return {
    inspection: {
      ...mapInspection(row),
      inspectorName: row.inspector_name as string,
      inspectorUsername: row.inspector_username as string,
      finalizedByName: (row.finalized_by_name ?? null) as string | null,
    },
    contract: {
      id: contractRow.id as number,
      contractNumber: contractRow.contract_number as string,
      status: contractRow.status as string,
      startDate: contractRow.start_date as string,
      expectedReturnDate: contractRow.expected_return_date as string,
      actualReturnDate: (contractRow.actual_return_date ?? null) as string | null,
      departureOdometerKm: Number(contractRow.departure_odometer_km),
      returnOdometerKm:
        contractRow.return_odometer_km != null ? Number(contractRow.return_odometer_km) : null,
    },
    vehicle: {
      id: vehicleRow.id as number,
      internalCode: vehicleRow.internal_code as string,
      matricule: vehicleRow.matricule as string,
      brand: vehicleRow.brand as string,
      model: vehicleRow.model as string,
      year: Number(vehicleRow.year),
      color: vehicleRow.color as string,
      category: vehicleRow.category as string,
      currentOdometerKm: Number(vehicleRow.current_odometer_km),
    },
    customer: {
      id: customerRow.id as number,
      customerType: customerRow.customer_type as string,
      fullName: customerRow.full_name as string,
      phone: customerRow.phone as string,
      drivingLicenceNumber: (customerRow.driving_licence_number ?? null) as string | null,
    },
    items,
    photos,
    damages,
    comparison,
  };
}

export function getContractInspections(db: Database.Database, contractId: number) {
  const contractRow = db
    .prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?')
    .get(contractId);
  if (!contractRow) {
    throw new AuthError('NOT_FOUND', 'Contrat introuvable');
  }

  const depRow = db
    .prepare<[number], { id: number }>(
      "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = 'DEPARTURE'"
    )
    .get(contractId);
  const retRow = db
    .prepare<[number], { id: number }>(
      "SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = 'RETURN'"
    )
    .get(contractId);

  const preExistingVehicleDamages = db
    .prepare<[number], any>(
      "SELECT * FROM vehicle_damages WHERE vehicle_id = ? AND status != 'REPAIRED' AND status != 'REJECTED' ORDER BY reported_at DESC"
    )
    .all(contractRow.vehicle_id)
    .map(mapDamage);

  return {
    contractId,
    departure: depRow ? getInspectionDetail(db, depRow.id) : null,
    returnInspection: retRow ? getInspectionDetail(db, retRow.id) : null,
    comparison: buildDepartureReturnComparison(db, contractId),
    openVehicleDamages: preExistingVehicleDamages,
  };
}

export function createInspection(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
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
  }
) {
  const tx = db.transaction(() => {
    const contractRow = db
      .prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?')
      .get(input.contractId);
    if (!contractRow) {
      throw new AuthError('NOT_FOUND', 'Contrat introuvable');
    }
    if (contractRow.status === 'CANCELLED') {
      throw new AuthError('CONFLICT', 'Impossible de créer un état des lieux pour un contrat annulé');
    }

    const existingStage = db
      .prepare<[number, string], { id: number }>(
        'SELECT id FROM vehicle_inspections WHERE contract_id = ? AND stage = ?'
      )
      .get(input.contractId, input.stage);
    if (existingStage) {
      throw new AuthError(
        'CONFLICT',
        input.stage === 'DEPARTURE'
          ? 'Un état des lieux départ existe déjà pour ce contrat (non remplaçable)'
          : 'Un état des lieux retour existe déjà pour ce contrat'
      );
    }

    const inspectedAt = input.inspectedAt?.trim() || new Date().toISOString();
    const deltas =
      input.stage === 'RETURN'
        ? computeReturnDeltas(db, contractRow, input.odometerKm, inspectedAt)
        : { mileageDeltaKm: null, lateReturnMinutes: 0 };

    const inspectionNumber = generateInspectionNumber(db);
    const status: InspectionStatus = input.finalizeNow ? 'FINALIZED' : 'DRAFT';
    const finalizedAt = input.finalizeNow ? new Date().toISOString() : null;
    const finalizedByUserId = input.finalizeNow ? actor.id : null;

    const res = db
      .prepare(
        `INSERT INTO vehicle_inspections (
          inspection_number, contract_id, vehicle_id, stage, status, odometer_km,
          fuel_level_percent, exterior_notes, interior_notes, agency_signature_data,
          customer_signature_data, customer_acknowledged, customer_acknowledgment_notes,
          late_return_minutes, mileage_delta_km, inspector_user_id, inspected_at,
          finalized_at, finalized_by_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
      )
      .run(
        inspectionNumber,
        input.contractId,
        contractRow.vehicle_id,
        input.stage,
        status,
        input.odometerKm,
        input.fuelLevelPercent,
        input.exteriorNotes?.trim() || null,
        input.interiorNotes?.trim() || null,
        input.agencySignatureData || null,
        input.customerSignatureData || null,
        input.customerAcknowledged ? 1 : 0,
        input.customerAcknowledgmentNotes?.trim() || null,
        deltas.lateReturnMinutes,
        deltas.mileageDeltaKm,
        actor.id,
        inspectedAt,
        finalizedAt,
        finalizedByUserId
      );

    const inspectionId = Number(res.lastInsertRowid);

    const itemsToInsert =
      input.items && input.items.length > 0
        ? input.items
        : DEFAULT_INSPECTION_CHECKLIST.map((tpl) => ({
            itemKey: tpl.itemKey,
            category: tpl.category,
            labelFr: tpl.labelFr,
            labelAr: tpl.labelAr,
            condition: 'GOOD' as InspectionItemCondition,
            notes: null,
            sortOrder: tpl.sortOrder,
          }));

    const insertItemStmt = db.prepare(
      `INSERT INTO inspection_items (
        inspection_id, item_key, category, label_fr, label_ar, condition, notes, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    itemsToInsert.forEach((item, idx) => {
      insertItemStmt.run(
        inspectionId,
        item.itemKey,
        item.category || 'GENERAL',
        item.labelFr,
        item.labelAr,
        item.condition,
        item.notes?.trim() || null,
        item.sortOrder ?? idx + 1
      );
    });

    if (input.damages && input.damages.length > 0) {
      for (const dmg of input.damages) {
        const isPreExisting =
          dmg.isPreExisting !== undefined ? dmg.isPreExisting : input.stage === 'DEPARTURE';
        const isNewlyDiscovered =
          dmg.isNewlyDiscovered !== undefined
            ? dmg.isNewlyDiscovered
            : input.stage === 'RETURN' && !isPreExisting;
        const damageCode = generateDamageCode(db);
        const dmgRes = db
          .prepare(
            `INSERT INTO vehicle_damages (
              damage_code, vehicle_id, contract_id, inspection_id, zone_code,
              diagram_x, diagram_y, damage_type, severity, description,
              is_pre_existing, is_newly_discovered, status, estimated_repair_cost_minor,
              reported_by_user_id, reported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, ?)`
          )
          .run(
            damageCode,
            contractRow.vehicle_id,
            input.contractId,
            inspectionId,
            dmg.zoneCode,
            dmg.diagramX ?? null,
            dmg.diagramY ?? null,
            dmg.damageType,
            dmg.severity,
            dmg.description.trim(),
            isPreExisting ? 1 : 0,
            isNewlyDiscovered ? 1 : 0,
            dmg.estimatedRepairCostMinor ?? null,
            actor.id,
            inspectedAt
          );

        db.prepare(
          `INSERT INTO damage_resolution_records (
            damage_id, previous_status, new_status, notes, recorded_by_user_id
          ) VALUES (?, NULL, 'REPORTED', ?, ?)`
        ).run(
          Number(dmgRes.lastInsertRowid),
          `Signalé lors de l’état des lieux ${inspectionNumber} (${input.stage})`,
          actor.id
        );
      }
    }

    // Update vehicle odometer upward if inspected odometer is higher (monotonic forward)
    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.odometerKm, contractRow.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: input.finalizeNow ? 'INSPECTION_CREATED_AND_FINALIZED' : 'INSPECTION_CREATED',
      entityType: 'vehicle_inspections',
      entityId: inspectionId,
      newValue: {
        inspectionNumber,
        contractId: input.contractId,
        vehicleId: contractRow.vehicle_id,
        stage: input.stage,
        status,
        odometerKm: input.odometerKm,
        fuelLevelPercent: input.fuelLevelPercent,
        damageCount: input.damages?.length ?? 0,
      },
    });

    return getInspectionDetail(db, inspectionId);
  });

  return tx();
}

export function updateInspectionDraft(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
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
  }
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM vehicle_inspections WHERE id = ?')
      .get(input.inspectionId);
    if (!current) {
      throw new AuthError('NOT_FOUND', 'État des lieux introuvable');
    }
    if (current.status === 'FINALIZED') {
      throw new AuthError(
        'CONFLICT',
        'Cet état des lieux est définitivement validé et ne peut plus être modifié'
      );
    }

    const contractRow = db
      .prepare<[number], any>('SELECT * FROM rental_contracts WHERE id = ?')
      .get(current.contract_id);

    const nextOdo = input.odometerKm ?? Number(current.odometer_km);
    const nextFuel = input.fuelLevelPercent ?? Number(current.fuel_level_percent);
    const nextInspectedAt = input.inspectedAt?.trim() || current.inspected_at;

    const deltas =
      current.stage === 'RETURN'
        ? computeReturnDeltas(db, contractRow, nextOdo, nextInspectedAt)
        : { mileageDeltaKm: null, lateReturnMinutes: 0 };

    db.prepare(
      `UPDATE vehicle_inspections
       SET odometer_km = ?,
           fuel_level_percent = ?,
           exterior_notes = ?,
           interior_notes = ?,
           agency_signature_data = ?,
           customer_signature_data = ?,
           customer_acknowledged = ?,
           customer_acknowledgment_notes = ?,
           late_return_minutes = ?,
           mileage_delta_km = ?,
           inspected_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(
      nextOdo,
      nextFuel,
      input.exteriorNotes !== undefined ? input.exteriorNotes?.trim() || null : current.exterior_notes,
      input.interiorNotes !== undefined ? input.interiorNotes?.trim() || null : current.interior_notes,
      input.agencySignatureData !== undefined ? input.agencySignatureData || null : current.agency_signature_data,
      input.customerSignatureData !== undefined ? input.customerSignatureData || null : current.customer_signature_data,
      input.customerAcknowledged !== undefined
        ? input.customerAcknowledged
          ? 1
          : 0
        : current.customer_acknowledged,
      input.customerAcknowledgmentNotes !== undefined
        ? input.customerAcknowledgmentNotes?.trim() || null
        : current.customer_acknowledgment_notes,
      deltas.lateReturnMinutes,
      deltas.mileageDeltaKm,
      nextInspectedAt,
      input.inspectionId
    );

    if (input.items && input.items.length > 0) {
      db.prepare('DELETE FROM inspection_items WHERE inspection_id = ?').run(input.inspectionId);
      const insertItemStmt = db.prepare(
        `INSERT INTO inspection_items (
          inspection_id, item_key, category, label_fr, label_ar, condition, notes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      input.items.forEach((item, idx) => {
        insertItemStmt.run(
          input.inspectionId,
          item.itemKey,
          item.category || 'GENERAL',
          item.labelFr,
          item.labelAr,
          item.condition,
          item.notes?.trim() || null,
          item.sortOrder ?? idx + 1
        );
      });
    }

    db.prepare(
      `UPDATE vehicles
       SET current_odometer_km = MAX(current_odometer_km, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextOdo, current.vehicle_id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INSPECTION_UPDATED',
      entityType: 'vehicle_inspections',
      entityId: input.inspectionId,
      previousValue: { odometerKm: current.odometer_km, fuelLevelPercent: current.fuel_level_percent },
      newValue: { odometerKm: nextOdo, fuelLevelPercent: nextFuel },
    });

    return getInspectionDetail(db, input.inspectionId);
  });

  return tx();
}

export function finalizeInspection(
  db: Database.Database,
  actor: { id: number; username: string },
  inspectionId: number
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM vehicle_inspections WHERE id = ?')
      .get(inspectionId);
    if (!current) {
      throw new AuthError('NOT_FOUND', 'État des lieux introuvable');
    }
    if (current.status === 'FINALIZED') {
      throw new AuthError('CONFLICT', 'Cet état des lieux est déjà finalisé');
    }

    db.prepare(
      `UPDATE vehicle_inspections
       SET status = 'FINALIZED',
           finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           finalized_by_user_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(actor.id, inspectionId);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INSPECTION_FINALIZED',
      entityType: 'vehicle_inspections',
      entityId: inspectionId,
      newValue: {
        inspectionNumber: current.inspection_number,
        stage: current.stage,
        contractId: current.contract_id,
      },
    });

    return getInspectionDetail(db, inspectionId);
  });

  return tx();
}

export function uploadInspectionPhoto(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
    inspectionId: number;
    damageId?: number | null;
    originalFileName: string;
    mimeType: string;
    base64Data: string;
    caption?: string | null;
  }
): InspectionPhoto {
  const inspection = db
    .prepare<[number], any>('SELECT * FROM vehicle_inspections WHERE id = ?')
    .get(input.inspectionId);
  if (!inspection) throw new AuthError('NOT_FOUND', 'État des lieux introuvable');
  if (inspection.status === 'FINALIZED') {
    throw new AuthError(
      'CONFLICT',
      'Impossible d’ajouter une photo à un état des lieux déjà finalisé'
    );
  }

  if (input.damageId != null) {
    const dmg = db
      .prepare<[number], any>('SELECT id, vehicle_id FROM vehicle_damages WHERE id = ?')
      .get(input.damageId);
    if (!dmg || dmg.vehicle_id !== inspection.vehicle_id) {
      throw new AuthError('VALIDATION_ERROR', 'Dommage introuvable pour ce véhicule');
    }
  }

  const validated = validateAndDecodeUpload({
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  const encryptedBytes = encryptBuffer(validated.bytes, vaultKey);
  const opaqueName = `insp_${input.inspectionId}_${crypto.randomUUID()}.enc`;
  const relativePath = path.join('inspections', opaqueName);
  const fullPath = resolveConfinedPath(vaultRootDir, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encryptedBytes, { mode: 0o600 });

  const res = db
    .prepare(
      `INSERT INTO inspection_photos (
        inspection_id, damage_id, file_path, original_file_name, mime_type, caption, uploaded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.inspectionId,
      input.damageId ?? null,
      relativePath,
      validated.safeFileName,
      validated.mimeType,
      input.caption?.trim() || null,
      actor.id
    );

  const photoId = Number(res.lastInsertRowid);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'INSPECTION_PHOTO_UPLOADED',
    entityType: 'inspection_photos',
    entityId: photoId,
    newValue: { inspectionId: input.inspectionId, damageId: input.damageId ?? null },
  });

  return mapPhoto(db.prepare<[number], any>('SELECT * FROM inspection_photos WHERE id = ?').get(photoId));
}

export function readInspectionPhoto(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  photoId: number
) {
  const row = db.prepare<[number], any>('SELECT * FROM inspection_photos WHERE id = ?').get(photoId);
  if (!row) throw new AuthError('NOT_FOUND', 'Photo d’inspection introuvable');

  const fullPath = resolveConfinedPath(vaultRootDir, row.file_path);
  const encryptedBytes = fs.readFileSync(fullPath);
  const plainBytes = decryptBuffer(encryptedBytes, vaultKey);

  return {
    id: row.id as number,
    inspectionId: row.inspection_id as number,
    damageId: (row.damage_id ?? null) as number | null,
    originalFileName: (row.original_file_name ?? `photo-${row.id}.jpg`) as string,
    mimeType: (row.mime_type ?? 'image/jpeg') as string,
    caption: (row.caption ?? null) as string | null,
    base64Data: plainBytes.toString('base64'),
  };
}

export function deleteInspectionPhoto(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  photoId: number
) {
  const tx = db.transaction(() => {
    const row = db.prepare<[number], any>('SELECT * FROM inspection_photos WHERE id = ?').get(photoId);
    if (!row) throw new AuthError('NOT_FOUND', 'Photo d’inspection introuvable');

    const insp = db
      .prepare<[number], any>('SELECT id, status FROM vehicle_inspections WHERE id = ?')
      .get(row.inspection_id);
    if (insp?.status === 'FINALIZED') {
      throw new AuthError(
        'CONFLICT',
        'Impossible de supprimer une photo d’un état des lieux finalisé'
      );
    }

    db.prepare('DELETE FROM inspection_photos WHERE id = ?').run(photoId);
    try {
      const fullPath = resolveConfinedPath(vaultRootDir, row.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch {
      // Non-blocking cleanup
    }

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INSPECTION_PHOTO_DELETED',
      entityType: 'inspection_photos',
      entityId: photoId,
      previousValue: { inspectionId: row.inspection_id, caption: row.caption },
    });

    return { deleted: true, id: photoId };
  });

  return tx();
}

export function addVehicleDamage(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
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
  }
) {
  const tx = db.transaction(() => {
    const vehicle = db.prepare<[number], any>('SELECT id FROM vehicles WHERE id = ?').get(input.vehicleId);
    if (!vehicle) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');

    let stage: InspectionStage | null = null;
    if (input.inspectionId != null) {
      const insp = db
        .prepare<[number], any>('SELECT * FROM vehicle_inspections WHERE id = ?')
        .get(input.inspectionId);
      if (!insp) throw new AuthError('NOT_FOUND', 'État des lieux introuvable');
      if (insp.vehicle_id !== input.vehicleId) {
        throw new AuthError('VALIDATION_ERROR', 'L’état des lieux ne correspond pas à ce véhicule');
      }
      if (insp.status === 'FINALIZED') {
        throw new AuthError(
          'CONFLICT',
          'Impossible d’ajouter un dommage sur un état des lieux déjà finalisé'
        );
      }
      stage = insp.stage as InspectionStage;
    }

    const isPreExisting =
      input.isPreExisting !== undefined ? input.isPreExisting : stage === 'DEPARTURE';
    const isNewlyDiscovered =
      input.isNewlyDiscovered !== undefined
        ? input.isNewlyDiscovered
        : stage === 'RETURN' && !isPreExisting;

    const damageCode = generateDamageCode(db);
    const res = db
      .prepare(
        `INSERT INTO vehicle_damages (
          damage_code, vehicle_id, contract_id, inspection_id, zone_code,
          diagram_x, diagram_y, damage_type, severity, description,
          is_pre_existing, is_newly_discovered, status, estimated_repair_cost_minor,
          reported_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?)`
      )
      .run(
        damageCode,
        input.vehicleId,
        input.contractId ?? null,
        input.inspectionId ?? null,
        input.zoneCode,
        input.diagramX ?? null,
        input.diagramY ?? null,
        input.damageType,
        input.severity,
        input.description.trim(),
        isPreExisting ? 1 : 0,
        isNewlyDiscovered ? 1 : 0,
        input.estimatedRepairCostMinor ?? null,
        actor.id
      );

    const damageId = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO damage_resolution_records (
        damage_id, previous_status, new_status, notes, recorded_by_user_id
      ) VALUES (?, NULL, 'REPORTED', ?, ?)`
    ).run(damageId, input.description.trim(), actor.id);

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_DAMAGE_REPORTED',
      entityType: 'vehicle_damages',
      entityId: damageId,
      newValue: {
        damageCode,
        vehicleId: input.vehicleId,
        inspectionId: input.inspectionId ?? null,
        zoneCode: input.zoneCode,
        damageType: input.damageType,
        severity: input.severity,
      },
    });

    return mapDamage(db.prepare<[number], any>('SELECT * FROM vehicle_damages WHERE id = ?').get(damageId));
  });

  return tx();
}

export function listVehicleDamages(
  db: Database.Database,
  filters?: {
    vehicleId?: number;
    contractId?: number;
    inspectionId?: number;
    status?: DamageStatus | 'ALL';
    onlyNewlyDiscovered?: boolean;
  }
) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.vehicleId) {
    clauses.push('vd.vehicle_id = ?');
    params.push(filters.vehicleId);
  }
  if (filters?.contractId) {
    clauses.push('vd.contract_id = ?');
    params.push(filters.contractId);
  }
  if (filters?.inspectionId) {
    clauses.push('vd.inspection_id = ?');
    params.push(filters.inspectionId);
  }
  if (filters?.status && filters.status !== 'ALL') {
    clauses.push('vd.status = ?');
    params.push(filters.status);
  }
  if (filters?.onlyNewlyDiscovered) {
    clauses.push('vd.is_newly_discovered = 1');
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT vd.*,
              v.brand || ' ' || v.model AS vehicle_label,
              v.matricule AS vehicle_matricule,
              rc.contract_number,
              vi.inspection_number,
              vi.stage AS inspection_stage,
              e.expense_number AS linked_expense_number,
              u.full_name AS reported_by_name
       FROM vehicle_damages vd
       JOIN vehicles v ON v.id = vd.vehicle_id
       LEFT JOIN rental_contracts rc ON rc.id = vd.contract_id
       LEFT JOIN vehicle_inspections vi ON vi.id = vd.inspection_id
       LEFT JOIN expenses e ON e.id = vd.linked_expense_id
       JOIN users u ON u.id = vd.reported_by_user_id
       ${where}
       ORDER BY vd.reported_at DESC, vd.id DESC`
    )
    .all(...params);

  const historyStmt = db.prepare<[number], any>(
    `SELECT drr.*, u.username AS recorded_by_username
     FROM damage_resolution_records drr
     JOIN users u ON u.id = drr.recorded_by_user_id
     WHERE drr.damage_id = ?
     ORDER BY drr.created_at ASC, drr.id ASC`
  );

  return rows.map((r) => ({
    ...mapDamage(r),
    vehicleLabel: r.vehicle_label as string,
    vehicleMatricule: r.vehicle_matricule as string,
    contractNumber: (r.contract_number ?? null) as string | null,
    inspectionNumber: (r.inspection_number ?? null) as string | null,
    inspectionStage: (r.inspection_stage ?? null) as InspectionStage | null,
    linkedExpenseNumber: (r.linked_expense_number ?? null) as string | null,
    reportedByName: r.reported_by_name as string,
    resolutionHistory: historyStmt.all(r.id).map(mapDamageResolution),
  }));
}

export function updateDamageStatus(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    damageId: number;
    newStatus: DamageStatus;
    notes: string;
    estimatedRepairCostMinor?: number | null;
    repairReference?: string | null;
    linkedExpenseId?: number | null;
  }
) {
  const tx = db.transaction(() => {
    const current = db
      .prepare<[number], any>('SELECT * FROM vehicle_damages WHERE id = ?')
      .get(input.damageId);
    if (!current) {
      throw new AuthError('NOT_FOUND', 'Dommage introuvable');
    }

    if (input.linkedExpenseId != null) {
      const exp = db
        .prepare<[number], { id: number }>('SELECT id FROM expenses WHERE id = ?')
        .get(input.linkedExpenseId);
      if (!exp) {
        throw new AuthError('NOT_FOUND', 'Dépense financière liée introuvable');
      }
    }

    const nextEstimated =
      input.estimatedRepairCostMinor !== undefined
        ? input.estimatedRepairCostMinor
        : current.estimated_repair_cost_minor;
    const nextRepairRef =
      input.repairReference !== undefined ? input.repairReference?.trim() || null : current.repair_reference;
    const nextExpenseId =
      input.linkedExpenseId !== undefined ? input.linkedExpenseId : current.linked_expense_id;

    db.prepare(
      `UPDATE vehicle_damages
       SET status = ?,
           estimated_repair_cost_minor = ?,
           repair_reference = ?,
           linked_expense_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(input.newStatus, nextEstimated, nextRepairRef, nextExpenseId, input.damageId);

    db.prepare(
      `INSERT INTO damage_resolution_records (
        damage_id, previous_status, new_status, notes, repair_reference, linked_expense_id, recorded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.damageId,
      current.status,
      input.newStatus,
      input.notes.trim(),
      nextRepairRef,
      nextExpenseId,
      actor.id
    );

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'VEHICLE_DAMAGE_STATUS_UPDATED',
      entityType: 'vehicle_damages',
      entityId: input.damageId,
      previousValue: { status: current.status },
      newValue: {
        status: input.newStatus,
        repairReference: nextRepairRef,
        linkedExpenseId: nextExpenseId,
      },
      reason: input.notes.trim(),
    });

    const [updated] = listVehicleDamages(db, { vehicleId: current.vehicle_id }).filter(
      (d) => d.id === input.damageId
    );
    return updated;
  });

  return tx();
}

export function getInspectionPdfPayload(
  db: Database.Database,
  vaultRootDir: string,
  vaultKey: Buffer,
  inspectionId: number
) {
  const detail = getInspectionDetail(db, inspectionId);
  const settingRows = db
    .prepare<[], { setting_key: string; setting_value: string }>(
      "SELECT setting_key, setting_value FROM application_settings WHERE setting_group = 'agency'"
    )
    .all();
  const agency: Record<string, string> = {};
  for (const r of settingRows) agency[r.setting_key] = r.setting_value;

  const decryptedPhotos = detail.photos.map((p) => {
    try {
      const dec = readInspectionPhoto(db, vaultRootDir, vaultKey, p.id);
      return {
        ...p,
        dataUrl: `data:${dec.mimeType};base64,${dec.base64Data}`,
      };
    } catch {
      return {
        ...p,
        dataUrl: null,
      };
    }
  });

  return {
    ...detail,
    photos: decryptedPhotos,
    agency: {
      name: agency['agency.name'] || 'Agence Location Auto',
      commercialName: agency['agency.commercial_name'] || '',
      address: agency['agency.address'] || '',
      phone: agency['agency.phone'] || '',
      email: agency['agency.email'] || '',
      nif: agency['agency.nif'] || '',
      rc: agency['agency.rc'] || '',
    },
  };
}
