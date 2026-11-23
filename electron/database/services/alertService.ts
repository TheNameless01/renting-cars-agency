import type Database from 'better-sqlite3';
import type {
  AppNotification,
  MaintenanceAlertState,
  NotificationSeverity,
  VehicleDocType,
} from '../../../shared/types/domain.ts';
import { AuthError } from '../../security/rbac.ts';
import { writeAuditLog } from './auditService.ts';

export interface VehicleMaintenanceDueItem {
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

function addDaysToIsoDate(dateStr: string, days: number): string {
  const base = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const a = Date.parse(`${fromDateStr.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toDateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function docTypeLabelFr(docType: VehicleDocType): string {
  switch (docType) {
    case 'CARTE_GRISE':
      return 'Carte grise';
    case 'ASSURANCE':
      return 'Assurance';
    case 'VIGNETTE':
      return 'Vignette';
    case 'CONTROLE_TECHNIQUE':
      return 'Contrôle technique';
  }
}

function docTypeLabelAr(docType: VehicleDocType): string {
  switch (docType) {
    case 'CARTE_GRISE':
      return 'البطاقة الرمادية';
    case 'ASSURANCE':
      return 'التأمين';
    case 'VIGNETTE':
      return 'قسيمة السيارات';
    case 'CONTROLE_TECHNIQUE':
      return 'المراقبة التقنية';
  }
}

function mapNotification(r: any): AppNotification {
  return {
    id: r.id,
    category: r.category,
    severity: r.severity as NotificationSeverity,
    titleFr: r.title_fr,
    titleAr: r.title_ar,
    messageFr: r.message_fr,
    messageAr: r.message_ar,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    isRead: r.is_read === 1,
    isResolved: r.is_resolved === 1,
    dueDate: r.due_date ?? null,
    createdAt: r.created_at,
  };
}

function upsertNotification(
  db: Database.Database,
  params: {
    dedupeKey: string;
    category: string;
    severity: NotificationSeverity;
    titleFr: string;
    titleAr: string;
    messageFr: string;
    messageAr: string;
    entityType: string;
    entityId: number;
    dueDate: string | null;
  }
) {
  const existing = db
    .prepare<[string], { id: number; severity: string; is_resolved: number }>(
      'SELECT id, severity, is_resolved FROM notifications WHERE dedupe_key = ?'
    )
    .get(params.dedupeKey);

  if (existing) {
    const escalated = existing.severity !== 'CRITICAL' && params.severity === 'CRITICAL';
    db.prepare(
      `UPDATE notifications
       SET category = ?,
           severity = ?,
           title_fr = ?,
           title_ar = ?,
           message_fr = ?,
           message_ar = ?,
           entity_type = ?,
           entity_id = ?,
           due_date = ?,
           is_resolved = 0,
           is_read = CASE WHEN ? = 1 OR is_resolved = 1 THEN 0 ELSE is_read END
       WHERE id = ?`
    ).run(
      params.category,
      params.severity,
      params.titleFr,
      params.titleAr,
      params.messageFr,
      params.messageAr,
      params.entityType,
      params.entityId,
      params.dueDate,
      escalated ? 1 : 0,
      existing.id
    );
    return;
  }

  db.prepare(
    `INSERT INTO notifications (
      category, severity, title_fr, title_ar, message_fr, message_ar,
      entity_type, entity_id, dedupe_key, is_read, is_resolved, due_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).run(
    params.category,
    params.severity,
    params.titleFr,
    params.titleAr,
    params.messageFr,
    params.messageAr,
    params.entityType,
    params.entityId,
    params.dedupeKey,
    params.dueDate
  );
}

export function getVehicleMaintenanceDueSummary(
  db: Database.Database,
  vehicleId: number,
  referenceDate?: string
): VehicleMaintenanceDueItem[] {
  const vehicle = db
    .prepare<[number], { id: number; current_odometer_km: number; acquisition_date: string | null }>(
      'SELECT id, current_odometer_km, acquisition_date FROM vehicles WHERE id = ?'
    )
    .get(vehicleId);
  if (!vehicle) {
    throw new AuthError('NOT_FOUND', 'Véhicule introuvable');
  }

  const today = (referenceDate || new Date().toISOString()).slice(0, 10);
  const currentKm = Number(vehicle.current_odometer_km ?? 0);

  const types = db
    .prepare<[], any>('SELECT * FROM maintenance_types WHERE is_active = 1 ORDER BY id ASC')
    .all();

  const schedules = db
    .prepare<[number], any>('SELECT * FROM vehicle_maintenance_schedules WHERE vehicle_id = ?')
    .all(vehicleId);
  const scheduleByType = new Map<number, any>();
  for (const s of schedules) scheduleByType.set(Number(s.maintenance_type_id), s);

  const lastCompletedStmt = db.prepare<[number, number], any>(
    `SELECT id, performed_date, odometer_km, next_due_date, next_due_odometer_km
     FROM maintenance_records
     WHERE vehicle_id = ? AND maintenance_type_id = ? AND status = 'COMPLETED'
     ORDER BY performed_date DESC, id DESC
     LIMIT 1`
  );

  const activePlannedStmt = db.prepare<[number, number], any>(
    `SELECT id, status, COALESCE(scheduled_start_date, performed_date) AS planned_date
     FROM maintenance_records
     WHERE vehicle_id = ? AND maintenance_type_id = ? AND status IN ('SCHEDULED', 'IN_PROGRESS')
     ORDER BY COALESCE(scheduled_start_date, performed_date) ASC, id DESC
     LIMIT 1`
  );

  const items: VehicleMaintenanceDueItem[] = [];

  for (const mt of types) {
    const sched = scheduleByType.get(Number(mt.id)) ?? null;
    const isScheduleActive = sched ? sched.is_active === 1 : true;
    const kmInterval: number | null = sched ? sched.km_interval : mt.default_km_interval;
    const dayInterval: number | null = sched ? sched.day_interval : mt.default_day_interval;
    const kmWarningThreshold = Number(
      sched ? sched.km_warning_threshold : mt.km_warning_threshold ?? 1000
    );
    const dayWarningThreshold = Number(
      sched ? sched.day_warning_threshold : mt.day_warning_threshold ?? 14
    );

    const lastCompleted = lastCompletedStmt.get(vehicleId, mt.id);
    const activePlanned = activePlannedStmt.get(vehicleId, mt.id);

    let nextDueOdometerKm: number | null = null;
    let nextDueDate: string | null = null;

    if (lastCompleted) {
      nextDueOdometerKm =
        lastCompleted.next_due_odometer_km != null
          ? Number(lastCompleted.next_due_odometer_km)
          : kmInterval != null
            ? Number(lastCompleted.odometer_km) + Number(kmInterval)
            : null;
      nextDueDate =
        lastCompleted.next_due_date ??
        (dayInterval != null ? addDaysToIsoDate(lastCompleted.performed_date, Number(dayInterval)) : null);
    } else if (isScheduleActive) {
      if (kmInterval != null) {
        nextDueOdometerKm = Number(kmInterval);
      }
      if (dayInterval != null && vehicle.acquisition_date) {
        nextDueDate = addDaysToIsoDate(vehicle.acquisition_date, Number(dayInterval));
      }
    }

    const remainingKm = nextDueOdometerKm != null ? nextDueOdometerKm - currentKm : null;
    const remainingDays = nextDueDate != null ? diffCalendarDays(today, nextDueDate) : null;

    let alertState: MaintenanceAlertState = 'OK';
    if (isScheduleActive) {
      if ((remainingKm != null && remainingKm < 0) || (remainingDays != null && remainingDays < 0)) {
        alertState = 'OVERDUE';
      } else if (
        (remainingKm != null && remainingKm <= 0) ||
        (remainingDays != null && remainingDays <= 0)
      ) {
        alertState = 'DUE';
      } else if (
        (remainingKm != null && remainingKm <= kmWarningThreshold) ||
        (remainingDays != null && remainingDays <= dayWarningThreshold)
      ) {
        alertState = 'APPROACHING';
      }
    }

    items.push({
      maintenanceTypeId: Number(mt.id),
      code: mt.code,
      nameFr: mt.name_fr,
      nameAr: mt.name_ar,
      scheduleId: sched ? Number(sched.id) : null,
      hasCustomSchedule: Boolean(sched),
      isScheduleActive,
      kmInterval: kmInterval != null ? Number(kmInterval) : null,
      dayInterval: dayInterval != null ? Number(dayInterval) : null,
      kmWarningThreshold,
      dayWarningThreshold,
      currentOdometerKm: currentKm,
      lastRecordId: lastCompleted ? Number(lastCompleted.id) : null,
      lastPerformedDate: lastCompleted ? String(lastCompleted.performed_date) : null,
      lastOdometerKm: lastCompleted ? Number(lastCompleted.odometer_km) : null,
      nextDueDate,
      nextDueOdometerKm,
      remainingKm,
      remainingDays,
      alertState,
      activePlannedRecordId: activePlanned ? Number(activePlanned.id) : null,
      activePlannedStatus: activePlanned ? String(activePlanned.status) : null,
      activePlannedDate: activePlanned ? String(activePlanned.planned_date) : null,
      scheduleNotes: sched?.notes ?? null,
    });
  }

  return items;
}

const SYNC_MANAGED_CATEGORIES = [
  'MAINTENANCE_DUE',
  'MAINTENANCE_OVERDUE',
  'VEHICLE_DOCUMENT',
  'CUSTOMER_DOCUMENT',
  'MILEAGE_ANOMALY',
  'LOW_STOCK',
];

export function syncOperationalAlerts(db: Database.Database, referenceDate?: string) {
  const today = (referenceDate || new Date().toISOString()).slice(0, 10);
  const activeKeys = new Set<string>();

  const vehicles = db
    .prepare<[], any>(
      `SELECT id, brand, model, matricule, current_odometer_km
       FROM vehicles
       WHERE is_archived = 0
       ORDER BY id ASC`
    )
    .all();

  for (const v of vehicles) {
    const vehicleLabel = `${v.brand} ${v.model} (${v.matricule})`;
    const dueItems = getVehicleMaintenanceDueSummary(db, v.id, today);

    // 1. Maintenance interval alerts (km + calendar)
    for (const item of dueItems) {
      if (!item.isScheduleActive || item.alertState === 'OK') continue;
      const dedupeKey = `maint_due:v${v.id}:t${item.maintenanceTypeId}`;
      activeKeys.add(dedupeKey);

      const isCritical = item.alertState === 'OVERDUE' || item.alertState === 'DUE';
      const category = isCritical ? 'MAINTENANCE_OVERDUE' : 'MAINTENANCE_DUE';
      const severity: NotificationSeverity = isCritical ? 'CRITICAL' : 'WARNING';

      const partsFr: string[] = [];
      const partsAr: string[] = [];
      if (item.remainingKm != null) {
        partsFr.push(
          item.remainingKm < 0
            ? `dépassée de ${Math.abs(item.remainingKm).toLocaleString()} km`
            : item.remainingKm === 0
              ? 'échéance atteinte (0 km restant)'
              : `${item.remainingKm.toLocaleString()} km restants`
        );
        partsAr.push(
          item.remainingKm < 0
            ? `تجاوزت بـ ${Math.abs(item.remainingKm).toLocaleString()} كم`
            : item.remainingKm === 0
              ? 'بلغت الأجل (0 كم متبقية)'
              : `متبقي ${item.remainingKm.toLocaleString()} كم`
        );
      }
      if (item.remainingDays != null) {
        partsFr.push(
          item.remainingDays < 0
            ? `retard ${Math.abs(item.remainingDays)} j`
            : item.remainingDays === 0
              ? "échéance aujourd'hui"
              : `${item.remainingDays} j restants`
        );
        partsAr.push(
          item.remainingDays < 0
            ? `متأخرة بـ ${Math.abs(item.remainingDays)} يوم`
            : item.remainingDays === 0
              ? 'تستحق اليوم'
              : `متبقي ${item.remainingDays} يوم`
        );
      }

      const titleFr =
        item.alertState === 'OVERDUE'
          ? `Maintenance en retard : ${item.nameFr} · ${v.matricule}`
          : item.alertState === 'DUE'
            ? `Maintenance due : ${item.nameFr} · ${v.matricule}`
            : `Maintenance proche : ${item.nameFr} · ${v.matricule}`;

      const titleAr =
        item.alertState === 'OVERDUE'
          ? `صيانة متأخرة: ${item.nameAr} · ${v.matricule}`
          : item.alertState === 'DUE'
            ? `صيانة مستحقة: ${item.nameAr} · ${v.matricule}`
            : `صيانة وشيكة: ${item.nameAr} · ${v.matricule}`;

      upsertNotification(db, {
        dedupeKey,
        category,
        severity,
        titleFr,
        titleAr,
        messageFr: `${vehicleLabel} — ${item.nameFr} (${partsFr.join(' · ')})`,
        messageAr: `${vehicleLabel} — ${item.nameAr} (${partsAr.join(' · ')})`,
        entityType: 'vehicle',
        entityId: Number(v.id),
        dueDate: item.nextDueDate,
      });
    }

    // 2. Vehicle documents expiring/expired (Assurance, Vignette, Contrôle technique, Carte grise)
    const docs = db
      .prepare<[number], any>('SELECT * FROM vehicle_documents WHERE vehicle_id = ?')
      .all(v.id);

    for (const d of docs) {
      const remDays = diffCalendarDays(today, d.expiration_date);
      const threshold = Number(d.reminder_days ?? 30);
      if (remDays > threshold) continue;

      const dedupeKey = `veh_doc:v${v.id}:d${d.id}`;
      activeKeys.add(dedupeKey);
      const expired = remDays < 0;
      const severity: NotificationSeverity = expired ? 'CRITICAL' : 'WARNING';
      const labelFr = docTypeLabelFr(d.doc_type as VehicleDocType);
      const labelAr = docTypeLabelAr(d.doc_type as VehicleDocType);

      upsertNotification(db, {
        dedupeKey,
        category: 'VEHICLE_DOCUMENT',
        severity,
        titleFr: expired
          ? `${labelFr} expiré(e) · ${v.matricule}`
          : `${labelFr} expire bientôt · ${v.matricule}`,
        titleAr: expired
          ? `انتهت صلاحية ${labelAr} · ${v.matricule}`
          : `تنتهي صلاحية ${labelAr} قريباً · ${v.matricule}`,
        messageFr: expired
          ? `${vehicleLabel} — ${labelFr} expiré(e) depuis ${Math.abs(remDays)} jour(s) (${d.expiration_date}).`
          : `${vehicleLabel} — ${labelFr} expire dans ${remDays} jour(s) (${d.expiration_date}).`,
        messageAr: expired
          ? `${vehicleLabel} — ${labelAr} منتهية الصلاحية منذ ${Math.abs(remDays)} يوم (${d.expiration_date}).`
          : `${vehicleLabel} — ${labelAr} تنتهي خلال ${remDays} يوم (${d.expiration_date}).`,
        entityType: 'vehicle',
        entityId: Number(v.id),
        dueDate: d.expiration_date,
      });
    }

    // 3. Mileage anomaly detection across maintenance timeline
    const mRecords = db
      .prepare<[number], { id: number; performed_date: string; odometer_km: number; record_number: string | null }>(
        `SELECT id, performed_date, odometer_km, record_number
         FROM maintenance_records
         WHERE vehicle_id = ? AND status != 'CANCELLED'
         ORDER BY performed_date ASC, id ASC`
      )
      .all(v.id);
    let maxSeenKm = 0;
    for (const mr of mRecords) {
      const km = Number(mr.odometer_km);
      if (km < maxSeenKm) {
        const dedupeKey = `mileage_anomaly:m${mr.id}`;
        activeKeys.add(dedupeKey);
        upsertNotification(db, {
          dedupeKey,
          category: 'MILEAGE_ANOMALY',
          severity: 'WARNING',
          titleFr: `Anomalie kilométrique · ${v.matricule}`,
          titleAr: `تناقض في قراءة العداد · ${v.matricule}`,
          messageFr: `${vehicleLabel} — Intervention ${mr.record_number ?? `#${mr.id}`} (${mr.performed_date}) saisie à ${km.toLocaleString()} km alors qu'un relevé antérieur indiquait ${maxSeenKm.toLocaleString()} km.`,
          messageAr: `${vehicleLabel} — تدخل ${mr.record_number ?? `#${mr.id}`} (${mr.performed_date}) مسجل بـ ${km.toLocaleString()} كم أقل من قراءة سابقة (${maxSeenKm.toLocaleString()} كم).`,
          entityType: 'vehicle',
          entityId: Number(v.id),
          dueDate: mr.performed_date.slice(0, 10),
        });
      } else {
        maxSeenKm = km;
      }
    }
  }

  // 4. Overdue planned/in-progress maintenance records
  const overdueRecords = db
    .prepare<[string], any>(
      `SELECT mr.id, mr.record_number, mr.vehicle_id, mr.status, mr.work_description,
              COALESCE(mr.scheduled_end_date, mr.scheduled_start_date, mr.performed_date) AS target_date,
              v.brand, v.model, v.matricule
       FROM maintenance_records mr
       JOIN vehicles v ON v.id = mr.vehicle_id
       WHERE v.is_archived = 0
         AND mr.status IN ('SCHEDULED', 'IN_PROGRESS')
         AND substr(COALESCE(mr.scheduled_end_date, mr.scheduled_start_date, mr.performed_date), 1, 10) < ?`
    )
    .all(today);

  for (const rec of overdueRecords) {
    const dedupeKey = `maint_record_overdue:r${rec.id}`;
    activeKeys.add(dedupeKey);
    const vehicleLabel = `${rec.brand} ${rec.model} (${rec.matricule})`;
    const ref = rec.record_number || `MNT-${rec.id}`;
    const targetDay = String(rec.target_date).slice(0, 10);

    upsertNotification(db, {
      dedupeKey,
      category: 'MAINTENANCE_OVERDUE',
      severity: 'CRITICAL',
      titleFr: `Intervention non clôturée (${ref}) · ${rec.matricule}`,
      titleAr: `عملية صيانة متأخرة عن الموعد (${ref}) · ${rec.matricule}`,
      messageFr: `${vehicleLabel} — ${rec.work_description} prévue pour le ${targetDay}.`,
      messageAr: `${vehicleLabel} — ${rec.work_description} مبرمجة ليوم ${targetDay}.`,
      entityType: 'maintenance_record',
      entityId: Number(rec.id),
      dueDate: targetDay,
    });
  }

  // 5. Spare-parts low stock / out-of-stock alerts (dedupe stock_low:p<id>)
  const lowParts = db
    .prepare<[], any>(
      `SELECT id, part_code, part_name, quantity_available, minimum_stock, unit_label
       FROM inventory_parts
       WHERE COALESCE(is_archived, 0) = 0 AND quantity_available <= minimum_stock
       ORDER BY id ASC`
    )
    .all();

  for (const part of lowParts) {
    const qty = Number(part.quantity_available);
    const min = Number(part.minimum_stock);
    const dedupeKey = `stock_low:p${part.id}`;
    activeKeys.add(dedupeKey);
    const outOfStock = qty <= 0;

    upsertNotification(db, {
      dedupeKey,
      category: 'LOW_STOCK',
      severity: outOfStock ? 'CRITICAL' : 'WARNING',
      titleFr: outOfStock
        ? `Rupture de stock : ${part.part_code} · ${part.part_name}`
        : `Stock bas : ${part.part_code} · ${part.part_name}`,
      titleAr: outOfStock
        ? `نفاد المخزون: ${part.part_code} · ${part.part_name}`
        : `مخزون منخفض: ${part.part_code} · ${part.part_name}`,
      messageFr: outOfStock
        ? `Stock épuisé (0 ${part.unit_label || 'PIECE'} disponible, seuil minimum ${min}). Réapprovisionnement requis.`
        : `Quantité disponible ${qty} ≤ seuil minimum ${min} (${part.unit_label || 'PIECE'}).`,
      messageAr: outOfStock
        ? `نفدت الكمية من المخزون (0 ${part.unit_label || 'PIECE'}، الحد الأدنى ${min}). يرجى التزود.`
        : `الكمية المتوفرة ${qty} أقل أو تساوي الحد الأدنى ${min} (${part.unit_label || 'PIECE'}).`,
      entityType: 'inventory_part',
      entityId: Number(part.id),
      dueDate: today,
    });
  }

  // 6. Customer documents & driving licences expiring / expired
  const customerDocs = db
    .prepare<[], any>(
      `SELECT cd.id, cd.customer_id, cd.doc_category, cd.original_file_name,
              cd.expiration_date, cd.reminder_days, c.full_name, c.phone
       FROM customer_documents cd
       JOIN customers c ON c.id = cd.customer_id
       WHERE c.is_archived = 0
         AND COALESCE(cd.is_archived, 0) = 0
         AND cd.expiration_date IS NOT NULL
         AND trim(cd.expiration_date) != ''`
    )
    .all();

  const custDocLabelsFr: Record<string, string> = {
    CNI: 'Carte nationale (CNI)',
    PASSPORT: 'Passeport',
    DRIVING_LICENCE: 'Permis de conduire',
    COMPANY_RC: 'Registre de commerce',
    COMPANY_NIF: 'NIF société',
    BON_COMMANDE: 'Bon de commande',
    OTHER: 'Document client',
  };
  const custDocLabelsAr: Record<string, string> = {
    CNI: 'بطاقة التعريف الوطنية',
    PASSPORT: 'جواز السفر',
    DRIVING_LICENCE: 'رخصة السياقة',
    COMPANY_RC: 'السجل التجاري',
    COMPANY_NIF: 'الرقم الجبائي NIF',
    BON_COMMANDE: 'سند الطلب',
    OTHER: 'وثيقة الزبون',
  };

  for (const cd of customerDocs) {
    const remDays = diffCalendarDays(today, String(cd.expiration_date));
    const threshold = Number(cd.reminder_days ?? 30);
    if (remDays > threshold) continue;

    const dedupeKey = `cust_doc:c${cd.customer_id}:d${cd.id}`;
    activeKeys.add(dedupeKey);
    const expired = remDays < 0;
    const lblFr = custDocLabelsFr[cd.doc_category] ?? cd.doc_category;
    const lblAr = custDocLabelsAr[cd.doc_category] ?? cd.doc_category;

    upsertNotification(db, {
      dedupeKey,
      category: 'CUSTOMER_DOCUMENT',
      severity: expired ? 'CRITICAL' : 'WARNING',
      titleFr: expired ? `${lblFr} expiré(e) · ${cd.full_name}` : `${lblFr} expire bientôt · ${cd.full_name}`,
      titleAr: expired ? `انتهت صلاحية ${lblAr} · ${cd.full_name}` : `تنتهي صلاحية ${lblAr} قريباً · ${cd.full_name}`,
      messageFr: expired
        ? `${cd.full_name} (${cd.phone}) — ${lblFr} (${cd.original_file_name}) expiré depuis ${Math.abs(remDays)} jour(s) (${cd.expiration_date}).`
        : `${cd.full_name} (${cd.phone}) — ${lblFr} (${cd.original_file_name}) expire dans ${remDays} jour(s) (${cd.expiration_date}).`,
      messageAr: expired
        ? `${cd.full_name} (${cd.phone}) — ${lblAr} (${cd.original_file_name}) منتهية الصلاحية منذ ${Math.abs(remDays)} يوم (${cd.expiration_date}).`
        : `${cd.full_name} (${cd.phone}) — ${lblAr} (${cd.original_file_name}) تنتهي خلال ${remDays} يوم (${cd.expiration_date}).`,
      entityType: 'customer',
      entityId: Number(cd.customer_id),
      dueDate: String(cd.expiration_date).slice(0, 10),
    });
  }

  const expiringLicences = db
    .prepare<[], any>(
      `SELECT id, full_name, phone, driving_licence_number, driving_licence_expiration_date
       FROM customers
       WHERE is_archived = 0
         AND driving_licence_expiration_date IS NOT NULL
         AND trim(driving_licence_expiration_date) != ''`
    )
    .all();

  for (const cust of expiringLicences) {
    const remDays = diffCalendarDays(today, String(cust.driving_licence_expiration_date));
    if (remDays > 30) continue;
    const dedupeKey = `cust_lic:c${cust.id}`;
    activeKeys.add(dedupeKey);
    const expired = remDays < 0;

    upsertNotification(db, {
      dedupeKey,
      category: 'CUSTOMER_DOCUMENT',
      severity: expired ? 'CRITICAL' : 'WARNING',
      titleFr: expired
        ? `Permis de conduire expiré · ${cust.full_name}`
        : `Permis de conduire expire bientôt · ${cust.full_name}`,
      titleAr: expired
        ? `انتهت صلاحية رخصة السياقة · ${cust.full_name}`
        : `تنتهي صلاحية رخصة السياقة قريباً · ${cust.full_name}`,
      messageFr: expired
        ? `${cust.full_name} (${cust.phone}) — Permis ${cust.driving_licence_number ?? ''} expiré depuis ${Math.abs(remDays)} jour(s) (${cust.driving_licence_expiration_date}).`
        : `${cust.full_name} (${cust.phone}) — Permis ${cust.driving_licence_number ?? ''} expire dans ${remDays} jour(s) (${cust.driving_licence_expiration_date}).`,
      messageAr: expired
        ? `${cust.full_name} (${cust.phone}) — رخصة السياقة ${cust.driving_licence_number ?? ''} منتهية منذ ${Math.abs(remDays)} يوم (${cust.driving_licence_expiration_date}).`
        : `${cust.full_name} (${cust.phone}) — رخصة السياقة ${cust.driving_licence_number ?? ''} تنتهي خلال ${remDays} يوم (${cust.driving_licence_expiration_date}).`,
      entityType: 'customer',
      entityId: Number(cust.id),
      dueDate: String(cust.driving_licence_expiration_date).slice(0, 10),
    });
  }

  // Auto-resolve stale alerts in managed categories once cleared
  const placeholders = SYNC_MANAGED_CATEGORIES.map(() => '?').join(', ');
  const existingOpen = db
    .prepare<string[], { id: number; dedupe_key: string | null }>(
      `SELECT id, dedupe_key FROM notifications
       WHERE is_resolved = 0 AND category IN (${placeholders})`
    )
    .all(...SYNC_MANAGED_CATEGORIES);

  const resolveStmt = db.prepare('UPDATE notifications SET is_resolved = 1 WHERE id = ?');
  for (const row of existingOpen) {
    if (!row.dedupe_key || !activeKeys.has(row.dedupe_key)) {
      resolveStmt.run(row.id);
    }
  }

  return listOperationalAlerts(db, { includeResolved: false });
}

export function listOperationalAlerts(
  db: Database.Database,
  filters?: {
    includeResolved?: boolean;
    category?: string;
    severity?: NotificationSeverity | 'ALL';
    vehicleId?: number;
  }
): AppNotification[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (!filters?.includeResolved) {
    clauses.push('is_resolved = 0');
  }
  if (filters?.category && filters.category !== 'ALL') {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.severity && filters.severity !== 'ALL') {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.vehicleId) {
    clauses.push("entity_type = 'vehicle' AND entity_id = ?");
    params.push(filters.vehicleId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare<Array<string | number>, any>(
      `SELECT * FROM notifications
       ${where}
       ORDER BY
         is_resolved ASC,
         CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END ASC,
         COALESCE(due_date, created_at) ASC,
         id DESC`
    )
    .all(...params);

  return rows.map(mapNotification);
}

export function markAlertRead(db: Database.Database, alertId: number): AppNotification {
  const existing = db.prepare<[number], any>('SELECT * FROM notifications WHERE id = ?').get(alertId);
  if (!existing) throw new AuthError('NOT_FOUND', 'Alerte introuvable');
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(alertId);
  return mapNotification(db.prepare<[number], any>('SELECT * FROM notifications WHERE id = ?').get(alertId));
}

export function resolveAlert(
  db: Database.Database,
  actor: { id: number; username: string },
  alertId: number
): AppNotification {
  const existing = db.prepare<[number], any>('SELECT * FROM notifications WHERE id = ?').get(alertId);
  if (!existing) throw new AuthError('NOT_FOUND', 'Alerte introuvable');
  db.prepare('UPDATE notifications SET is_resolved = 1, is_read = 1 WHERE id = ?').run(alertId);
  writeAuditLog(db, {
    userId: actor.id,
    usernameSnapshot: actor.username,
    operation: 'OPERATIONAL_ALERT_RESOLVED',
    entityType: 'notifications',
    entityId: alertId,
    newValue: { dedupeKey: existing.dedupe_key, category: existing.category },
  });
  return mapNotification(db.prepare<[number], any>('SELECT * FROM notifications WHERE id = ?').get(alertId));
}
