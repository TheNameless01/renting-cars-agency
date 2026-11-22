import type { AppLanguage } from '../../../shared/types/domain.ts';
import {
  VEHICLE_DIAGRAM_ZONES,
  getDiagramZoneLabel,
  type VehicleDiagramZoneCode,
} from '../../../shared/constants/inspections.ts';

export interface DiagramPin {
  id?: number | string;
  zoneCode: string;
  diagramX: number | null;
  diagramY: number | null;
  severity: string;
  isNewlyDiscovered?: boolean;
  status?: string;
  description?: string;
}

interface VehicleDamageDiagramProps {
  lang: AppLanguage;
  selectedZone?: string;
  selectedPoint?: { x: number; y: number } | null;
  pins: DiagramPin[];
  interactive?: boolean;
  onSelectZone?: (zoneCode: VehicleDiagramZoneCode, x: number, y: number) => void;
}

function pinColor(pin: DiagramPin): string {
  if (pin.status === 'REPAIRED') return '#10b981';
  if (pin.status === 'REJECTED') return '#64748b';
  if (pin.isNewlyDiscovered) return '#dc2626';
  if (pin.severity === 'CRITICAL' || pin.severity === 'MAJOR') return '#ea580c';
  return '#d97706';
}

export function VehicleDamageDiagram({
  lang,
  selectedZone,
  selectedPoint,
  pins,
  interactive = true,
  onSelectZone,
}: VehicleDamageDiagramProps) {
  const handleZoneClick = (zoneCode: VehicleDiagramZoneCode, defaultX: number, defaultY: number) => {
    if (!interactive || !onSelectZone) return;
    onSelectZone(zoneCode, defaultX, defaultY);
  };

  const zoneClass = (code: VehicleDiagramZoneCode) =>
    `transition-colors ${interactive ? 'cursor-pointer hover:fill-blue-200 dark:hover:fill-blue-900/60' : ''} ${
      selectedZone === code
        ? 'fill-blue-300/80 dark:fill-blue-800/80 stroke-blue-700 dark:stroke-blue-300'
        : 'fill-slate-100 dark:fill-slate-800 stroke-slate-400 dark:stroke-slate-600'
    }`;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full max-w-[260px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3">
        <svg
          viewBox="0 0 200 360"
          className="w-full h-auto select-none"
          role="img"
          aria-label={lang === 'ar' ? 'مخطط المركبة' : 'Schéma du véhicule'}
        >
          {/* Outer shadow / outline */}
          <rect
            x="34"
            y="18"
            width="132"
            height="324"
            rx="32"
            className="fill-slate-50 dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700"
            strokeWidth="1.5"
          />

          {/* Wheels */}
          <rect
            x="22"
            y="66"
            width="12"
            height="42"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('FRONT_LEFT_WHEEL')}
            onClick={() => handleZoneClick('FRONT_LEFT_WHEEL', 14, 24)}
          >
            <title>{getDiagramZoneLabel('FRONT_LEFT_WHEEL', lang)}</title>
          </rect>
          <rect
            x="166"
            y="66"
            width="12"
            height="42"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('FRONT_RIGHT_WHEEL')}
            onClick={() => handleZoneClick('FRONT_RIGHT_WHEEL', 86, 24)}
          >
            <title>{getDiagramZoneLabel('FRONT_RIGHT_WHEEL', lang)}</title>
          </rect>
          <rect
            x="22"
            y="248"
            width="12"
            height="42"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('REAR_LEFT_WHEEL')}
            onClick={() => handleZoneClick('REAR_LEFT_WHEEL', 14, 76)}
          >
            <title>{getDiagramZoneLabel('REAR_LEFT_WHEEL', lang)}</title>
          </rect>
          <rect
            x="166"
            y="248"
            width="12"
            height="42"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('REAR_RIGHT_WHEEL')}
            onClick={() => handleZoneClick('REAR_RIGHT_WHEEL', 86, 76)}
          >
            <title>{getDiagramZoneLabel('REAR_RIGHT_WHEEL', lang)}</title>
          </rect>

          {/* Mirrors */}
          <ellipse
            cx="27"
            cy="128"
            rx="8"
            ry="6"
            strokeWidth="1.5"
            className={zoneClass('LEFT_MIRROR')}
            onClick={() => handleZoneClick('LEFT_MIRROR', 13, 36)}
          >
            <title>{getDiagramZoneLabel('LEFT_MIRROR', lang)}</title>
          </ellipse>
          <ellipse
            cx="173"
            cy="128"
            rx="8"
            ry="6"
            strokeWidth="1.5"
            className={zoneClass('RIGHT_MIRROR')}
            onClick={() => handleZoneClick('RIGHT_MIRROR', 87, 36)}
          >
            <title>{getDiagramZoneLabel('RIGHT_MIRROR', lang)}</title>
          </ellipse>

          {/* Front & Rear Bumpers */}
          <path
            d="M 48 18 Q 100 8 152 18 L 148 38 Q 100 32 52 38 Z"
            strokeWidth="1.5"
            className={zoneClass('FRONT_BUMPER')}
            onClick={() => handleZoneClick('FRONT_BUMPER', 50, 7)}
          >
            <title>{getDiagramZoneLabel('FRONT_BUMPER', lang)}</title>
          </path>
          <path
            d="M 52 322 Q 100 328 148 322 L 152 342 Q 100 350 48 342 Z"
            strokeWidth="1.5"
            className={zoneClass('REAR_BUMPER')}
            onClick={() => handleZoneClick('REAR_BUMPER', 50, 93)}
          >
            <title>{getDiagramZoneLabel('REAR_BUMPER', lang)}</title>
          </path>

          {/* Hood */}
          <path
            d="M 56 42 L 144 42 L 138 104 L 62 104 Z"
            strokeWidth="1.5"
            className={zoneClass('HOOD')}
            onClick={() => handleZoneClick('HOOD', 50, 21)}
          >
            <title>{getDiagramZoneLabel('HOOD', lang)}</title>
          </path>

          {/* Windshield */}
          <path
            d="M 62 106 L 138 106 L 132 142 L 68 142 Z"
            strokeWidth="1.5"
            className={zoneClass('WINDSHIELD')}
            onClick={() => handleZoneClick('WINDSHIELD', 50, 34)}
          >
            <title>{getDiagramZoneLabel('WINDSHIELD', lang)}</title>
          </path>

          {/* Roof */}
          <rect
            x="66"
            y="144"
            width="68"
            height="88"
            rx="6"
            strokeWidth="1.5"
            className={zoneClass('ROOF')}
            onClick={() => handleZoneClick('ROOF', 50, 52)}
          >
            <title>{getDiagramZoneLabel('ROOF', lang)}</title>
          </rect>

          {/* Rear Window */}
          <path
            d="M 68 234 L 132 234 L 138 268 L 62 268 Z"
            strokeWidth="1.5"
            className={zoneClass('REAR_WINDOW')}
            onClick={() => handleZoneClick('REAR_WINDOW', 50, 70)}
          >
            <title>{getDiagramZoneLabel('REAR_WINDOW', lang)}</title>
          </path>

          {/* Trunk */}
          <path
            d="M 62 270 L 138 270 L 144 318 L 56 318 Z"
            strokeWidth="1.5"
            className={zoneClass('TRUNK')}
            onClick={() => handleZoneClick('TRUNK', 50, 82)}
          >
            <title>{getDiagramZoneLabel('TRUNK', lang)}</title>
          </path>

          {/* Left side fenders & doors */}
          <rect
            x="35"
            y="42"
            width="20"
            height="64"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('FRONT_LEFT_FENDER')}
            onClick={() => handleZoneClick('FRONT_LEFT_FENDER', 22, 21)}
          >
            <title>{getDiagramZoneLabel('FRONT_LEFT_FENDER', lang)}</title>
          </rect>
          <rect
            x="35"
            y="108"
            width="28"
            height="68"
            rx="3"
            strokeWidth="1.5"
            className={zoneClass('FRONT_LEFT_DOOR')}
            onClick={() => handleZoneClick('FRONT_LEFT_DOOR', 24, 40)}
          >
            <title>{getDiagramZoneLabel('FRONT_LEFT_DOOR', lang)}</title>
          </rect>
          <rect
            x="35"
            y="178"
            width="28"
            height="68"
            rx="3"
            strokeWidth="1.5"
            className={zoneClass('REAR_LEFT_DOOR')}
            onClick={() => handleZoneClick('REAR_LEFT_DOOR', 24, 59)}
          >
            <title>{getDiagramZoneLabel('REAR_LEFT_DOOR', lang)}</title>
          </rect>
          <rect
            x="35"
            y="248"
            width="20"
            height="68"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('REAR_LEFT_FENDER')}
            onClick={() => handleZoneClick('REAR_LEFT_FENDER', 22, 78)}
          >
            <title>{getDiagramZoneLabel('REAR_LEFT_FENDER', lang)}</title>
          </rect>

          {/* Right side fenders & doors */}
          <rect
            x="145"
            y="42"
            width="20"
            height="64"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('FRONT_RIGHT_FENDER')}
            onClick={() => handleZoneClick('FRONT_RIGHT_FENDER', 78, 21)}
          >
            <title>{getDiagramZoneLabel('FRONT_RIGHT_FENDER', lang)}</title>
          </rect>
          <rect
            x="137"
            y="108"
            width="28"
            height="68"
            rx="3"
            strokeWidth="1.5"
            className={zoneClass('FRONT_RIGHT_DOOR')}
            onClick={() => handleZoneClick('FRONT_RIGHT_DOOR', 76, 40)}
          >
            <title>{getDiagramZoneLabel('FRONT_RIGHT_DOOR', lang)}</title>
          </rect>
          <rect
            x="137"
            y="178"
            width="28"
            height="68"
            rx="3"
            strokeWidth="1.5"
            className={zoneClass('REAR_RIGHT_DOOR')}
            onClick={() => handleZoneClick('REAR_RIGHT_DOOR', 76, 59)}
          >
            <title>{getDiagramZoneLabel('REAR_RIGHT_DOOR', lang)}</title>
          </rect>
          <rect
            x="145"
            y="248"
            width="20"
            height="68"
            rx="4"
            strokeWidth="1.5"
            className={zoneClass('REAR_RIGHT_FENDER')}
            onClick={() => handleZoneClick('REAR_RIGHT_FENDER', 78, 78)}
          >
            <title>{getDiagramZoneLabel('REAR_RIGHT_FENDER', lang)}</title>
          </rect>

          {/* Front / Rear orientation labels */}
          <text x="100" y="29" textAnchor="middle" className="fill-slate-500 text-[7px] font-bold">
            {lang === 'ar' ? 'أمام' : 'AVANT'}
          </text>
          <text x="100" y="336" textAnchor="middle" className="fill-slate-500 text-[7px] font-bold">
            {lang === 'ar' ? 'خلف' : 'ARRIÈRE'}
          </text>

          {/* Existing damage pins */}
          {pins.map((pin, idx) => {
            const def = VEHICLE_DIAGRAM_ZONES.find((z) => z.code === pin.zoneCode);
            const px = ((pin.diagramX ?? def?.defaultX ?? 50) / 100) * 200;
            const py = ((pin.diagramY ?? def?.defaultY ?? 50) / 100) * 360;
            const fill = pinColor(pin);
            return (
              <g key={pin.id ?? `pin-${idx}`} className="pointer-events-none">
                <circle cx={px} cy={py} r="8" fill={fill} stroke="#ffffff" strokeWidth="2" />
                <text
                  x={px}
                  y={py + 3}
                  textAnchor="middle"
                  className="fill-white text-[8px] font-bold"
                >
                  {idx + 1}
                </text>
              </g>
            );
          })}

          {/* Selected draft point */}
          {selectedPoint && (
            <circle
              cx={(selectedPoint.x / 100) * 200}
              cy={(selectedPoint.y / 100) * 360}
              r="7"
              fill="none"
              stroke="#1d4ed8"
              strokeWidth="2.5"
              strokeDasharray="3 2"
            />
          )}
        </svg>
      </div>

      {/* Quick zone pills for interior / accessory zones */}
      {interactive && onSelectZone && (
        <div className="flex flex-wrap justify-center gap-1.5 max-w-[260px]">
          {(['INTERIOR_DASH', 'INTERIOR_SEATS', 'OTHER'] as VehicleDiagramZoneCode[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                const def = VEHICLE_DIAGRAM_ZONES.find((z) => z.code === code)!;
                onSelectZone(code, def.defaultX, def.defaultY);
              }}
              className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                selectedZone === code
                  ? 'border-blue-700 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950/60 dark:text-blue-200 font-semibold'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {getDiagramZoneLabel(code, lang)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
