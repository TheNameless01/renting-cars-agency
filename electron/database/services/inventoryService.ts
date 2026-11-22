import type Database from 'better-sqlite3';
import type {
  InventoryMovement,
  InventoryMovementType,
  InventoryPart,
  PaymentMethod,
} from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { listOperationalAlerts, syncOperationalAlerts } from './alertService.ts';
import { writeAuditLog } from './auditService.ts';
import { recordExpense } from './expenseService.ts';

export interface InventoryPartListItem extends InventoryPart {
  supplierName: string | null;
  stockValueMinor: number;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

export interface InventoryMovementListItem extends InventoryMovement {
  partCode: string;
  partName: string;
  unitLabel: string;
  maintenanceRecordNumber: string | null;
  vehicleLabel: string | null;
  supplierName: string | null;
  expenseNumber: string | null;
  recordedByUsername: string;
}

function mapInventoryPart(r: any): InventoryPartListItem {
  const qty = Number(r.quantity_available ?? 0);
  const min = Number(r.minimum_stock ?? 0);
  const unitPrice = Number(r.unit_purchase_price_minor ?? 0);
  const stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' =
    qty <= 0 ? 'OUT_OF_STOCK' : qty <= min ? 'LOW_STOCK' : 'IN_STOCK';

  return {
    id: Number(r.id),
    partCode: r.part_code,
    partName: r.part_name,
    category: r.category,
    description: r.description ?? null,
    unitLabel: r.unit_label ?? 'PIECE',
    compatibleModels: r.compatible_models ?? null,
    quantityAvailable: qty,
    minimumStock: min,
    unitPurchasePriceMinor: unitPrice,
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    storageLocation: r.storage_location ?? null,
    lastPurchaseDate: r.last_purchase_date ?? null,
    isArchived: r.is_archived === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    supplierName: r.supplier_name ?? null,
    stockValueMinor: qty * unitPrice,
    stockStatus,
  };
}

function mapInventoryMovement(r: any): InventoryMovementListItem {
  return {
    id: Number(r.id),
    partId: Number(r.part_id),
    movementType: r.movement_type as InventoryMovementType,
    quantityDelta: Number(r.quantity_delta),
    unitCostMinor: Number(r.unit_cost_minor ?? 0),
    maintenanceRecordId: r.maintenance_record_id != null ? Number(r.maintenance_record_id) : null,
    vehicleId: r.vehicle_id != null ? Number(r.vehicle_id) : null,
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null,
    referenceCode: r.reference_code ?? null,
    expenseId: r.expense_id != null ? Number(r.expense_id) : null,
    movementDate: r.movement_date ?? String(r.created_at).slice(0, 10),
    notes: r.notes ?? null,
    overrideReason: r.override_reason ?? null,
    recordedByUserId: Number(r.recorded_by_user_id),
    createdAt: r.created_at,
    partCode: r.part_code,
    partName: r.part_name,
    unitLabel: r.unit_label ?? 'PIECE',
    maintenanceRecordNumber: r.maintenance_record_number ?? null,
    vehicleLabel: r.vehicle_label ?? null,
    supplierName: r.supplier_name ?? null,
    expenseNumber: r.expense_number ?? null,
    recordedByUsername: r.recorded_by_username,
  };
}

export function listInventoryParts(
  db: Database.Database,
  filters?: {
    category?: string;
    supplierId?: number;
    stockState?: 'ALL' | 'LOW' | 'OUT' | 'IN_STOCK';
    includeArchived?: boolean;
    search?: string;
  }
): InventoryPartListItem[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!filters?.includeArchived) {
    clauses.push('COALESCE(ip.is_archived, 0) = 0');
  }
  if (filters?.category && filters.category !== 'ALL') {
    clauses.push('ip.category = ?');
    params.push(filters.category);
  }
  if (filters?.supplierId) {
    clauses.push('ip.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters?.stockState === 'OUT') {
    clauses.push('ip.quantity_available <= 0');
  } else if (filters?.stockState === 'LOW') {
    clauses.push('ip.quantity_available > 0 AND ip.quantity_available <= ip.minimum_stock');
  } else if (filters?.stockState === 'IN_STOCK') {
    clauses.push('ip.quantity_available > ip.minimum_stock');
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(ip.part_code LIKE ? OR ip.part_name LIKE ? OR COALESCE(ip.compatible_models, '') LIKE ? OR COALESCE(ip.storage_location, '') LIKE ? OR COALESCE(s.name, '') LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT ip.*, s.name AS supplier_name
       FROM inventory_parts ip
       LEFT JOIN suppliers s ON s.id = ip.supplier_id
       ${where}
       ORDER BY
         CASE WHEN ip.quantity_available <= 0 THEN 0 WHEN ip.quantity_available <= ip.minimum_stock THEN 1 ELSE 2 END ASC,
         ip.part_name ASC,
         ip.id DESC`
    )
    .all(...params);

  return rows.map(mapInventoryPart);
}

export function getInventoryOverview(db: Database.Database) {
  const parts = listInventoryParts(db, { includeArchived: false });
  const totalSkuCount = parts.length;
  const totalUnitsInStock = parts.reduce((acc, p) => acc + p.quantityAvailable, 0);
  const totalValuationMinor = parts.reduce((acc, p) => acc + p.stockValueMinor, 0);
  const lowStockCount = parts.filter((p) => p.stockStatus === 'LOW_STOCK').length;
  const outOfStockCount = parts.filter((p) => p.stockStatus === 'OUT_OF_STOCK').length;
  const categories = Array.from(new Set(parts.map((p) => p.category))).sort((a, b) => a.localeCompare(b));
  const stockAlerts = listOperationalAlerts(db, { category: 'LOW_STOCK', includeResolved: false });

  return {
    totalSkuCount,
    totalUnitsInStock,
    totalValuationMinor,
    lowStockCount,
    outOfStockCount,
    categories,
    stockAlerts,
  };
}

export function listInventoryMovements(
  db: Database.Database,
  filters?: {
    partId?: number;
    movementType?: InventoryMovementType | 'ALL';
    vehicleId?: number;
    supplierId?: number;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    limit?: number;
  }
): InventoryMovementListItem[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.partId) {
    clauses.push('im.part_id = ?');
    params.push(filters.partId);
  }
  if (filters?.movementType && filters.movementType !== 'ALL') {
    clauses.push('im.movement_type = ?');
    params.push(filters.movementType);
  }
  if (filters?.vehicleId) {
    clauses.push('im.vehicle_id = ?');
    params.push(filters.vehicleId);
  }
  if (filters?.supplierId) {
    clauses.push('im.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters?.dateFrom) {
    clauses.push('substr(im.movement_date, 1, 10) >= ?');
    params.push(filters.dateFrom.slice(0, 10));
  }
  if (filters?.dateTo) {
    clauses.push('substr(im.movement_date, 1, 10) <= ?');
    params.push(filters.dateTo.slice(0, 10));
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(
      `(ip.part_code LIKE ? OR ip.part_name LIKE ? OR COALESCE(im.reference_code, '') LIKE ? OR COALESCE(im.notes, '') LIKE ? OR COALESCE(mr.record_number, '') LIKE ? OR COALESCE(v.matricule, '') LIKE ?)`
    );
    params.push(q, q, q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 250, 1), 1000);
  params.push(limit);

  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT im.*,
              ip.part_code,
              ip.part_name,
              ip.unit_label,
              mr.record_number AS maintenance_record_number,
              CASE WHEN v.id IS NOT NULL THEN (v.brand || ' ' || v.model || ' (' || v.matricule || ')') ELSE NULL END AS vehicle_label,
              s.name AS supplier_name,
              e.expense_number AS expense_number,
              u.username AS recorded_by_username
       FROM inventory_movements im
       JOIN inventory_parts ip ON ip.id = im.part_id
       JOIN users u ON u.id = im.recorded_by_user_id
       LEFT JOIN maintenance_records mr ON mr.id = im.maintenance_record_id
       LEFT JOIN vehicles v ON v.id = im.vehicle_id
       LEFT JOIN suppliers s ON s.id = im.supplier_id
       LEFT JOIN expenses e ON e.id = im.expense_id
       ${where}
       ORDER BY im.movement_date DESC, im.id DESC
       LIMIT ?`
    )
    .all(...params);

  return rows.map(mapInventoryMovement);
}

export function getInventoryPartDetail(db: Database.Database, partId: number) {
  const part = listInventoryParts(db, { includeArchived: true }).find((p) => p.id === partId);
  if (!part) throw new AuthError('NOT_FOUND', 'Pièce détachée introuvable');
  const movements = listInventoryMovements(db, { partId, limit: 150 });
  return { part, movements };
}

export function upsertInventoryPart(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
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
  }
) {
  const tx = db.transaction(() => {
    const cleanCode = input.partCode.trim().toUpperCase();
    if (input.supplierId != null) {
      const sup = db.prepare<[number], { id: number }>('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!sup) throw new AuthError('NOT_FOUND', 'Fournisseur introuvable');
    }

    if (input.id) {
      const existing = db.prepare<[number], any>('SELECT * FROM inventory_parts WHERE id = ?').get(input.id);
      if (!existing) throw new AuthError('NOT_FOUND', 'Pièce détachée introuvable');

      const dup = db
        .prepare<[string, number], { id: number }>('SELECT id FROM inventory_parts WHERE part_code = ? AND id != ?')
        .get(cleanCode, input.id);
      if (dup) throw new AuthError('CONFLICT', `Code pièce déjà utilisé : ${cleanCode}`);

      db.prepare(
        `UPDATE inventory_parts
         SET part_code = ?,
             part_name = ?,
             category = ?,
             description = ?,
             unit_label = ?,
             compatible_models = ?,
             minimum_stock = ?,
             unit_purchase_price_minor = ?,
             supplier_id = ?,
             storage_location = ?,
             is_archived = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(
        cleanCode,
        input.partName.trim(),
        input.category.trim(),
        input.description?.trim() || null,
        input.unitLabel?.trim() || 'PIECE',
        input.compatibleModels?.trim() || null,
        input.minimumStock,
        input.unitPurchasePriceMinor,
        input.supplierId ?? null,
        input.storageLocation?.trim() || null,
        input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : Number(existing.is_archived ?? 0),
        input.id
      );

      syncOperationalAlerts(db);
      const updated = getInventoryPartDetail(db, input.id);
      writeAuditLog(db, {
        userId: actor.id,
        usernameSnapshot: actor.username,
        operation: 'INVENTORY_PART_UPDATED',
        entityType: 'inventory_parts',
        entityId: input.id,
        previousValue: mapInventoryPart(existing),
        newValue: updated.part,
      });
      return updated;
    }

    const dup = db
      .prepare<[string], { id: number }>('SELECT id FROM inventory_parts WHERE part_code = ?')
      .get(cleanCode);
    if (dup) throw new AuthError('CONFLICT', `Code pièce déjà utilisé : ${cleanCode}`);

    const initialQty = Number(input.initialStock ?? 0);
    const today = new Date().toISOString().slice(0, 10);

    const res = db
      .prepare(
        `INSERT INTO inventory_parts (
          part_code, part_name, category, description, unit_label, compatible_models,
          quantity_available, minimum_stock, unit_purchase_price_minor, supplier_id,
          storage_location, last_purchase_date, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        cleanCode,
        input.partName.trim(),
        input.category.trim(),
        input.description?.trim() || null,
        input.unitLabel?.trim() || 'PIECE',
        input.compatibleModels?.trim() || null,
        input.minimumStock,
        input.unitPurchasePriceMinor,
        input.supplierId ?? null,
        input.storageLocation?.trim() || null,
        initialQty > 0 ? today : null
      );

    const partId = Number(res.lastInsertRowid);

    if (initialQty > 0) {
      db.prepare(
        `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          supplier_id, movement_date, notes, recorded_by_user_id
        ) VALUES (?, 'INITIAL_STOCK', ?, ?, ?, ?, ?, ?)`
      ).run(
        partId,
        initialQty,
        input.unitPurchasePriceMinor,
        input.supplierId ?? null,
        today,
        'Stock initial à la création de la fiche',
        actor.id
      );
      db.prepare('UPDATE inventory_parts SET quantity_available = ? WHERE id = ?').run(initialQty, partId);
    }

    syncOperationalAlerts(db);
    const created = getInventoryPartDetail(db, partId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INVENTORY_PART_CREATED',
      entityType: 'inventory_parts',
      entityId: partId,
      newValue: created.part,
    });

    return created;
  });

  return tx();
}

export function archiveInventoryPart(
  db: Database.Database,
  actor: { id: number; username: string },
  partId: number,
  archived = true
) {
  const tx = db.transaction(() => {
    const existing = db.prepare<[number], any>('SELECT * FROM inventory_parts WHERE id = ?').get(partId);
    if (!existing) throw new AuthError('NOT_FOUND', 'Pièce détachée introuvable');
    db.prepare(
      `UPDATE inventory_parts
       SET is_archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(archived ? 1 : 0, partId);

    syncOperationalAlerts(db);
    const updated = getInventoryPartDetail(db, partId);
    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: archived ? 'INVENTORY_PART_ARCHIVED' : 'INVENTORY_PART_UNARCHIVED',
      entityType: 'inventory_parts',
      entityId: partId,
      newValue: { isArchived: archived },
    });
    return updated;
  });

  return tx();
}

export function recordInventoryMovement(
  db: Database.Database,
  actor: { id: number; username: string },
  vaultRootDir: string,
  vaultKey: Buffer,
  input: {
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
  }
) {
  const tx = db.transaction(() => {
    const part = db.prepare<[number], any>('SELECT * FROM inventory_parts WHERE id = ?').get(input.partId);
    if (!part) throw new AuthError('NOT_FOUND', 'Pièce détachée introuvable');
    if (part.is_archived === 1) {
      throw new AuthError('CONFLICT', 'Impossible d’enregistrer un mouvement sur une pièce archivée');
    }

    if (input.supplierId != null) {
      const sup = db.prepare<[number], { id: number }>('SELECT id FROM suppliers WHERE id = ?').get(input.supplierId);
      if (!sup) throw new AuthError('NOT_FOUND', 'Fournisseur introuvable');
    }
    if (input.vehicleId != null) {
      const veh = db.prepare<[number], { id: number }>('SELECT id FROM vehicles WHERE id = ?').get(input.vehicleId);
      if (!veh) throw new AuthError('NOT_FOUND', 'Véhicule introuvable');
    }

    const qty = Math.abs(Math.trunc(input.quantity));
    if (qty <= 0) {
      throw new AuthError('VALIDATION_ERROR', 'La quantité doit être strictement positive');
    }

    const delta = input.movementType === 'WITHDRAWAL' ? -qty : qty;
    const currentQty = Number(part.quantity_available ?? 0);
    const nextQty = currentQty + delta;

    if (nextQty < 0) {
      throw new AuthError(
        'CONFLICT',
        `Stock insuffisant pour ${part.part_code} (${part.part_name}) : disponible ${currentQty}, demandé ${qty}.`
      );
    }

    const unitCost =
      input.unitCostMinor !== undefined
        ? Number(input.unitCostMinor)
        : Number(part.unit_purchase_price_minor ?? 0);
    const movDate = (input.movementDate || new Date().toISOString()).slice(0, 10);
    const effSupplierId = input.supplierId !== undefined ? input.supplierId : part.supplier_id ?? null;

    let linkedExpenseId: number | null = null;
    if (input.movementType === 'PURCHASE' && input.recordInFinance && unitCost * qty > 0) {
      const exp = recordExpense(db, actor, vaultRootDir, vaultKey, {
        category: 'SPARE_PARTS',
        vehicleId: input.vehicleId ?? null,
        supplierId: effSupplierId,
        amountMinor: unitCost * qty,
        currency: 'DZD',
        expenseDate: movDate,
        paymentMethod: input.paymentMethod ?? 'CASH',
        paymentReference: input.paymentReference ?? input.referenceCode ?? null,
        description: `Achat pièce ${part.part_code} · ${part.part_name} (×${qty})`,
      });
      linkedExpenseId = exp.id;
    }

    const res = db
      .prepare(
        `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          maintenance_record_id, vehicle_id, supplier_id, reference_code,
          expense_id, movement_date, notes, recorded_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.partId,
        input.movementType,
        delta,
        unitCost,
        input.maintenanceRecordId ?? null,
        input.vehicleId ?? null,
        effSupplierId,
        input.referenceCode?.trim() || null,
        linkedExpenseId,
        movDate,
        input.notes?.trim() || null,
        actor.id
      );

    const movId = Number(res.lastInsertRowid);

    const nextUnitPrice =
      (input.movementType === 'PURCHASE' || input.movementType === 'ENTRY') && unitCost > 0
        ? unitCost
        : Number(part.unit_purchase_price_minor ?? 0);
    const nextPurchaseDate =
      input.movementType === 'PURCHASE' ? movDate : part.last_purchase_date ?? null;

    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = ?,
           unit_purchase_price_minor = ?,
           last_purchase_date = ?,
           supplier_id = COALESCE(supplier_id, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextQty, nextUnitPrice, nextPurchaseDate, effSupplierId, input.partId);

    syncOperationalAlerts(db);

    const movement = listInventoryMovements(db, { partId: input.partId, limit: 20 }).find(
      (m) => m.id === movId
    )!;

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INVENTORY_MOVEMENT_RECORDED',
      entityType: 'inventory_movements',
      entityId: movId,
      newValue: {
        partId: input.partId,
        partCode: part.part_code,
        movementType: input.movementType,
        quantityDelta: delta,
        resultingQty: nextQty,
        linkedExpenseId,
      },
    });

    return {
      movement,
      part: getInventoryPartDetail(db, input.partId).part,
    };
  });

  return tx();
}

export function adjustInventoryStock(
  db: Database.Database,
  actor: { id: number; username: string },
  input: {
    partId: number;
    quantityDelta: number;
    overrideReason: string;
    notes?: string | null;
    movementDate?: string;
  }
) {
  const tx = db.transaction(() => {
    const part = db.prepare<[number], any>('SELECT * FROM inventory_parts WHERE id = ?').get(input.partId);
    if (!part) throw new AuthError('NOT_FOUND', 'Pièce détachée introuvable');
    if (part.is_archived === 1) {
      throw new AuthError('CONFLICT', 'Impossible d’ajuster le stock d’une pièce archivée');
    }

    const delta = Math.trunc(input.quantityDelta);
    if (delta === 0) {
      throw new AuthError('VALIDATION_ERROR', 'L’écart d’ajustement ne peut pas être zéro');
    }

    const currentQty = Number(part.quantity_available ?? 0);
    const nextQty = currentQty + delta;
    if (nextQty < 0) {
      throw new AuthError(
        'CONFLICT',
        `Ajustement refusé : le stock ne peut pas devenir négatif (${currentQty} + ${delta} = ${nextQty}).`
      );
    }

    const movDate = (input.movementDate || new Date().toISOString()).slice(0, 10);
    const unitCost = Number(part.unit_purchase_price_minor ?? 0);

    const res = db
      .prepare(
        `INSERT INTO inventory_movements (
          part_id, movement_type, quantity_delta, unit_cost_minor,
          movement_date, notes, override_reason, recorded_by_user_id
        ) VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.partId,
        delta,
        unitCost,
        movDate,
        input.notes?.trim() || null,
        input.overrideReason.trim(),
        actor.id
      );

    const movId = Number(res.lastInsertRowid);

    db.prepare(
      `UPDATE inventory_parts
       SET quantity_available = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(nextQty, input.partId);

    syncOperationalAlerts(db);

    const movement = listInventoryMovements(db, { partId: input.partId, limit: 20 }).find(
      (m) => m.id === movId
    )!;

    writeAuditLog(db, {
      userId: actor.id,
      usernameSnapshot: actor.username,
      operation: 'INVENTORY_STOCK_ADJUSTED',
      entityType: 'inventory_movements',
      entityId: movId,
      previousValue: { quantityAvailable: currentQty },
      newValue: { quantityAvailable: nextQty, quantityDelta: delta },
      reason: input.overrideReason.trim(),
    });

    return {
      movement,
      part: getInventoryPartDetail(db, input.partId).part,
    };
  });

  return tx();
}
