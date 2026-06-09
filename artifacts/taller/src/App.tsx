import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  getGetTallerStateQueryOptions,
  useSaveTallerState,
  getGetCurrentUserQueryOptions,
  getListUsersQueryOptions,
  getListRolesQueryOptions,
  useLogin,
  useLogout,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useGetEquipoHistory,
} from "@workspace/api-client-react";
import type {
  User,
  Role,
  ModulePermission,
  RolePermissions,
  AuthSession,
  TallerState,
  EquipoHistoryEntry,
} from "@workspace/api-client-react";

// ── Permissions model (mirrors backend MODULES) ────────────────
const MODULES = ["dashboard", "taller", "venta", "kpis", "layout", "tecnicos", "licencias", "admin"] as const;
type ModuleId = (typeof MODULES)[number];
type PermAction = "view" | "create" | "edit" | "delete";
const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: "Dashboard",
  taller: "Taller",
  venta: "Venta / GPV",
  kpis: "KPIs",
  layout: "Layout",
  tecnicos: "Técnicos",
  licencias: "Licencias",
  admin: "Administración",
};
const ACTION_LABELS: Record<PermAction, string> = {
  view: "Ver", create: "Crear", edit: "Editar", delete: "Eliminar",
};
const emptyPerm = (): ModulePermission => ({ view: false, create: false, edit: false, delete: false });

const DEFAULT_TECNICOS = [
  "LUKAS ROBERTO GUILLER","KASPARIAN CHRISTIAN G","TWERDOCHLIB CLAUDIO",
  "GONZALEZ JOSE","VERA ABEL DOLORES","SZAPLAY MATIAS","PEREIRO RODOLFO",
  "URQUIA LUCAS AGUSTIN","SANSOGNE HERNAN ALBERTO","RIVERO CHANIL ALAN",
  "GIMENEZ MARCOS","CABAÑA JESUS","DE LA FUENTE ERIK","LASTRETTI ALAN",
  "HUANCA FACUNDO","CASTRO NEGUEN","RAMIREZ ALEX",
];

const ESTADOS_TALLER = [
  "Esperando turno",
  "A inspeccionar",
  "En lavadero",
  "En proceso",
  "En espera de materiales",
  "En proveedor",
];
const ESTADO_LISTO = "Listo";
const ESTADO_DISP = "Disponible";
const ESTADO_VEND = "Vendido";
const ESTADOS_ACTIVOS = new Set([...ESTADOS_TALLER, ESTADO_LISTO]);
// equipos que aún se están trabajando (excluye "Listo") — base para alertas de demora
const EN_PROCESO = new Set(ESTADOS_TALLER);
const DIAS_GPV = 90;

const ST: Record<string, { bg: string; color: string; border: string }> = {
  "Esperando turno":         { bg:"rgba(100,116,139,.14)", color:"#94a3b8", border:"rgba(100,116,139,.3)" },
  "A inspeccionar":          { bg:"rgba(168,85,247,.14)",  color:"#c084fc", border:"rgba(168,85,247,.3)" },
  "En lavadero":             { bg:"rgba(14,165,233,.14)",  color:"#38bdf8", border:"rgba(14,165,233,.3)" },
  "En proceso":              { bg:"rgba(59,130,246,.14)",  color:"#60a5fa", border:"rgba(59,130,246,.3)" },
  "En espera de materiales": { bg:"rgba(245,158,11,.14)",  color:"#fbbf24", border:"rgba(245,158,11,.3)" },
  "En proveedor":            { bg:"rgba(244,63,94,.14)",   color:"#fb7185", border:"rgba(244,63,94,.3)"  },
  "Listo":                   { bg:"rgba(16,185,129,.14)",  color:"#34d399", border:"rgba(16,185,129,.3)" },
  "Disponible":              { bg:"rgba(99,102,241,.14)",  color:"#818cf8", border:"rgba(99,102,241,.3)" },
  "Vendido":                 { bg:"rgba(20,184,166,.14)",  color:"#2dd4bf", border:"rgba(20,184,166,.3)" },
};

const ACOLORS = ["#10b981","#3b82f6","#a855f7","#f59e0b","#ef4444","#14b8a6","#6366f1","#ec4899","#84cc16","#f97316","#06b6d4","#8b5cf6","#d946ef","#22c55e","#eab308","#64748b","#0ea5e9"];
const aColor = (n: string) => { let h=0; for (let i=0;i<n.length;i++) h=(h*31+n.charCodeAt(i))&0xfffffff; return ACOLORS[h%ACOLORS.length]; };
const inits = (n: string) => (n||"").split(" ").map((w: string)=>w[0]).join("").slice(0,2).toUpperCase();
const dDesde = (f: string) => f ? Math.floor((Date.now()-new Date(f).getTime())/86400000) : 0;
const dGPV = (f: string) => DIAS_GPV - dDesde(f);
// días (con signo) entre HOY y una fecha YYYY-MM-DD. >0 faltan, 0 hoy, <0 atrasado
const diasHasta = (f?: string): number | null => {
  if (!f) return null;
  const [y, m, d] = f.split("-").map(Number);
  const [ty, tm, td] = hoyISO().split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
};
// ¿equipo en proceso y pasado de su fecha estimada de entrega?
const estaAtrasado = (e: Equipo): boolean => {
  if (!e.fechaEstimada || !EN_PROCESO.has(e.estado)) return false;
  const d = diasHasta(e.fechaEstimada);
  return d !== null && d < 0;
};

interface Equipo {
  id: number;
  destino: string;
  modelo: string;
  interno: string;
  accesorio: string;
  cliente: string;
  fechaIngreso: string;
  falla: string;
  estado: string;
  tecnicos: string[];
  observacion: string;
  prioridad: string;
  enVentaDesde?: string;
  fechaEstimada?: string;
}

interface GPVEntry {
  id: number;
  modelo: string;
  interno: string;
  cliente: string;
  fechaEntrega: string;
  observacion: string;
  estado: string;
}

// ── Licencias (gestión de personal) ────────────────────────────
interface Saldo { francos: number; vacaciones: number; examenes: number }
interface LicMov {
  id: number;
  tecnico: string;
  tipo: string;        // franco|vacaciones|examen|matrimonio|maternidad|tramites|mudanza|sin_goce|otra|ajuste
  tipoOtra?: string;   // texto libre cuando tipo === "otra"
  saldoTipo?: string;  // para ajuste: francos|vacaciones|examenes
  desde?: string;
  hasta?: string;
  dias: number;
  observacion: string;
  createdAt: string;
  createdBy: string;
}
interface LicenciasState { saldos: Record<string, Saldo>; registros: LicMov[] }

const SALDO_KEYS = ["francos", "vacaciones", "examenes"] as const;
type SaldoKey = (typeof SALDO_KEYS)[number];
const SALDO_LABELS: Record<SaldoKey, string> = {
  francos: "Francos",
  vacaciones: "Vacaciones",
  examenes: "Examen / Estudio",
};

const LIC_TIPOS: { id: string; label: string; saldo: SaldoKey | null }[] = [
  { id: "franco",     label: "Franco",                  saldo: "francos" },
  { id: "vacaciones", label: "Vacaciones",              saldo: "vacaciones" },
  { id: "examen",     label: "Examen / Estudio",        saldo: "examenes" },
  { id: "matrimonio", label: "Matrimonio",              saldo: null },
  { id: "maternidad", label: "Maternidad / Paternidad", saldo: null },
  { id: "tramites",   label: "Trámites",                saldo: null },
  { id: "mudanza",    label: "Mudanza",                 saldo: null },
  { id: "sin_goce",   label: "Sin goce de sueldo",      saldo: null },
  { id: "otra",       label: "Otra",                    saldo: null },
];
const LIC_TIPO_MAP: Record<string, { label: string; saldo: SaldoKey | null }> =
  Object.fromEntries(LIC_TIPOS.map(t => [t.id, { label: t.label, saldo: t.saldo }]));
const licTipoLabel = (m: LicMov): string => {
  if (m.tipo === "ajuste") return "Ajuste de saldo";
  if (m.tipo === "otra") return m.tipoOtra?.trim() || "Otra";
  return LIC_TIPO_MAP[m.tipo]?.label ?? m.tipo;
};

const emptySaldo = (): Saldo => ({ francos: 0, vacaciones: 0, examenes: 0 });
const round1 = (n: number) => Math.round(n * 10) / 10;
const newLicId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtFecha = (s?: string) => (s ? s.split("-").reverse().join("/") : "");

// cantidad de días inclusiva entre dos fechas YYYY-MM-DD
const diasEntre = (desde: string, hasta: string): number => {
  if (!desde || !hasta) return 0;
  const d = new Date(desde).getTime(), h = new Date(hasta).getTime();
  if (isNaN(d) || isNaN(h) || h < d) return 0;
  return Math.floor((h - d) / 86400000) + 1;
};

// licencia vigente hoy para un técnico (excluye ajustes)
const licenciaHoy = (registros: LicMov[], tecnico: string): LicMov | null => {
  const today = hoyISO();
  for (const r of registros) {
    if (r.tecnico !== tecnico || r.tipo === "ajuste") continue;
    if (r.desde && r.hasta && r.desde <= today && today <= r.hasta) return r;
  }
  return null;
};
const normLicencias = (l?: Partial<LicenciasState> | null): LicenciasState => ({
  saldos: l?.saldos ?? {},
  registros: Array.isArray(l?.registros) ? l!.registros! : [],
});

const buildOcup = (equipos: Equipo[], excId: number | null = null) => {
  const m: Record<string, number> = {};
  equipos.forEach(e => {
    if (e.id === excId || !ESTADOS_ACTIVOS.has(e.estado)) return;
    (e.tecnicos || []).forEach(t => { m[t] = (m[t] || 0) + 1; });
  });
  return m;
};

const normalizeEquipo = (e: Partial<Equipo>): Equipo => ({
  id: e.id!,
  destino: e.destino || "alquiler",
  modelo: e.modelo || "",
  interno: e.interno || "",
  accesorio: e.accesorio || "",
  cliente: e.cliente || "",
  fechaIngreso: e.fechaIngreso || "",
  falla: e.falla || "",
  estado: e.estado || "A inspeccionar",
  tecnicos: (e as any).tecnicos || ((e as any).asignado ? [(e as any).asignado] : []),
  observacion: e.observacion || "",
  prioridad: e.prioridad || "ninguna",
  enVentaDesde: e.enVentaDesde,
  fechaEstimada: e.fechaEstimada,
});

// ── Icons ─────────────────────────────────────────────────────
const P: Record<string, string> = {
  dashboard: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  wrench:    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  tag:       "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
  users:     "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  plus:      "M12 5v14M5 12h14",
  edit:      "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash:     "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  check:     "M20 6 9 17l-5-5",
  x:         "M18 6 6 18M6 6l12 12",
  save:      "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  alert:     "M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zM12 8v4M12 16h.01",
  clock:     "M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zM12 6v6l4 2",
  lock:      "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
  truck:     "M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 21a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  logout:    "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  chevL:     "M15 18l-6-6 6-6",
  chevR:     "M9 18l6-6-6-6",
  arrowR:    "M5 12h14M12 5l7 7-7 7",
  filter:    "M22 3H2l8 9.46V19l4 2V12.46L22 3",
  shield:    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  calendar:  "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  minus:     "M5 12h14",
  sortAsc:   "M3 6h18M7 12h10M11 18h4",
  sortDesc:  "M3 18h18M7 12h10M11 6h4",
  sort:      "M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4",
  pencil:    "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
  bar:       "M18 20V10M12 20V4M6 20v-6",
  sync:      "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  kpi:       "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  download:  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
};

function Ico({ n, s = 16, c = "currentColor" }: { n: string; s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block" }}>
      <path d={P[n] || ""} />
    </svg>
  );
}

// ── CSS ───────────────────────────────────────────────────────
const CSS = `
html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0f1117}
.app{--bg:#0f1117;--bg2:#161b27;--bg3:#1e2435;--bg4:#242b3d;
  --bo:rgba(255,255,255,.07);--bo2:rgba(255,255,255,.13);
  --t:#e8eaf0;--t2:#9aa3b8;--t3:#5c6480;
  --gr:#15803d;--gr2:#16a34a;--gr3:rgba(21,128,61,.15);
  --bl:#3b82f6;--em:#10b981;--am:#f59e0b;--ro:#ef4444;--pu:#a855f7;--te:#14b8a6;
  --r:8px;--r2:12px;
  font-family:system-ui,sans-serif;background:var(--bg);color:var(--t);
  width:100%;height:100vh;overflow:hidden;display:flex;flex-direction:column}
.app .login{display:flex;align-items:center;justify-content:center;height:100vh}
.app .lcard{background:var(--bg2);border:1px solid var(--bo2);border-radius:var(--r2);padding:36px 32px;width:340px;max-width:90vw}
.app .lerr{font-size:12px;color:var(--ro);margin-top:6px;display:flex;align-items:center;gap:5px}
.app .shell{display:flex;width:100%;height:100vh;overflow:hidden}
.app .sidebar{width:220px;background:var(--bg2);border-right:1px solid var(--bo);display:flex;flex-direction:column;transition:width .2s;flex-shrink:0}
.app .sidebar.col{width:58px}
.app .sbhd{padding:13px 14px;border-bottom:1px solid var(--bo);display:flex;align-items:center;gap:8px;flex-shrink:0}
.app .sbnav{flex:1;padding:6px 0;overflow:hidden}
.app .sblbl{font-size:10px;font-weight:700;color:var(--t3);letter-spacing:.07em;text-transform:uppercase;padding:10px 14px 4px}
.app .ni{display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;transition:background .15s;overflow:hidden}
.app .ni:hover{background:rgba(255,255,255,.04)}
.app .ni.act{background:var(--gr3)}
.app .ni.act .nilbl{color:var(--t);font-weight:600}
.app .nilbl{font-size:13px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app .nb{margin-left:auto;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;background:rgba(59,130,246,.15);color:var(--bl);border:1px solid rgba(59,130,246,.25);flex-shrink:0}
.app .na{margin-left:auto;font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;background:rgba(245,158,11,.15);color:var(--am);border:1px solid rgba(245,158,11,.25);flex-shrink:0}
.app .sbft{padding:10px 14px;border-top:1px solid var(--bo);flex-shrink:0}
.app .main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.app .topbar{background:var(--bg2);border-bottom:1px solid var(--bo);padding:11px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}
.app .content{flex:1;padding:16px 18px;overflow-y:auto}
.app .content::-webkit-scrollbar{width:4px}
.app .content::-webkit-scrollbar-thumb{background:var(--bo2);border-radius:99px}
.app .srch{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--bo);border-radius:var(--r);padding:6px 11px;width:240px}
.app .srch input{background:none;border:none;outline:none;font-size:13px;color:var(--t);width:100%}
.app .srch input::placeholder{color:var(--t3)}
.app .sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.app .sc{background:var(--bg2);border:1px solid var(--bo);border-radius:var(--r2);padding:13px 15px;border-top:3px solid}
.app .tw{background:var(--bg2);border:1px solid var(--bo);border-radius:var(--r2);overflow:hidden;margin-bottom:0}
.app .th{padding:12px 16px;border-bottom:1px solid var(--bo);display:flex;align-items:center;gap:8px}
.app .tt{font-size:14px;font-weight:700;color:var(--t)}
.app .ts{overflow-x:auto}
.app table{width:100%;border-collapse:collapse;font-size:13px}
.app th{padding:8px 13px;text-align:left;font-size:10px;color:var(--t3);font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--bo);white-space:nowrap;user-select:none}
.app th.sortable{cursor:pointer}
.app th.sortable:hover{color:var(--t2)}
.app th.sort-active{color:var(--em)}
.app td{padding:9px 13px;border-bottom:1px solid var(--bo);vertical-align:middle}
.app tr:last-child td{border-bottom:none}
.app tr:hover td{background:rgba(255,255,255,.02)}
.app .badge{display:inline-flex;align-items:center;font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap}
.app .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border-radius:var(--r);border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s}
.app .btnp{background:var(--gr);color:#fff}
.app .btnp:hover{background:var(--gr2)}
.app .btns{background:var(--bg3);color:var(--t2);border:1px solid var(--bo)}
.app .btns:hover{background:var(--bg4)}
.app .btnd{background:rgba(239,68,68,.12);color:var(--ro);border:1px solid rgba(239,68,68,.2)}
.app .btnd:hover{background:rgba(239,68,68,.22)}
.app .btni{padding:5px;background:transparent;color:var(--t3);border:none;border-radius:var(--r);cursor:pointer;display:inline-flex;align-items:center}
.app .btni:hover{background:var(--bg3);color:var(--t)}
.app .btnb{background:rgba(59,130,246,.12);color:var(--bl);border:1px solid rgba(59,130,246,.2)}
.app .btnb:hover{background:rgba(59,130,246,.22)}
.app .fb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.app .chip{padding:4px 11px;border-radius:99px;font-size:11px;font-weight:600;border:1px solid var(--bo);background:transparent;color:var(--t3);cursor:pointer;transition:all .15s;white-space:nowrap}
.app .chip:hover{border-color:var(--bo2);color:var(--t2)}
.app .chip.on{background:var(--gr3);border-color:rgba(21,128,61,.4);color:var(--em)}
.app .sep{width:1px;height:16px;background:var(--bo);margin:0 2px;flex-shrink:0}
.app .overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;z-index:1000}
.app .modal{background:var(--bg2);border:1px solid var(--bo2);border-radius:var(--r2);width:560px;max-width:calc(100vw - 32px);height:min(88vh,720px);display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden}
.app .modalsm{height:auto!important;max-height:90vh}
.app .mh{padding:14px 18px;border-bottom:1px solid var(--bo);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.app .mt{font-size:14px;font-weight:700;color:var(--t)}
.app .mb{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.app .mb::-webkit-scrollbar{width:4px}
.app .mb::-webkit-scrollbar-thumb{background:var(--bo2);border-radius:99px}
.app .mf{padding:11px 18px;border-top:1px solid var(--bo);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0}
.app .fr{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.app .fg{display:flex;flex-direction:column;gap:4px}
.app .fl{font-size:10px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.05em}
.app .fi,.app .fta{background:var(--bg3);border:1px solid var(--bo);border-radius:var(--r);padding:7px 10px;font-size:13px;color:var(--t);outline:none;width:100%;transition:border .15s;font-family:inherit;box-sizing:border-box}
.app .fi:focus,.app .fta:focus{border-color:var(--gr2)}
.app .fta{resize:vertical;min-height:64px}
.app .fsel{background:var(--bg3);border:1px solid var(--bo);border-radius:var(--r);padding:7px 10px;font-size:13px;color:var(--t);outline:none}
.app .fsel option{background:var(--bg3)}
.app .inp{background:var(--bg3);border:1px solid var(--bo);border-radius:var(--r);padding:7px 10px;font-size:13px;color:var(--t);outline:none;width:100%;transition:border .15s;font-family:inherit;box-sizing:border-box}
.app .inp:focus{border-color:var(--gr2)}
.app select.inp{cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;padding-right:30px}
.app .inp option{background:var(--bg3);color:var(--t)}
.app textarea.inp{resize:vertical;min-height:64px}
.app .trow{display:flex;gap:8px}
.app .tbtn{flex:1;padding:8px;border-radius:var(--r);font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--bo);background:var(--bg3);color:var(--t3);transition:all .15s;text-align:center}
.app .twrap{display:flex;flex-direction:column;gap:6px;padding:6px 0 0}
.app .toast{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--bo2);border-radius:var(--r);padding:9px 14px;font-size:13px;color:var(--t)}
.app .tok{border-left:3px solid var(--em)}
.app .terr{border-left:3px solid var(--ro)}
.app .tinf{border-left:3px solid var(--bl)}
.app .ibox{background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.18);border-radius:var(--r);padding:9px 13px;font-size:12px;color:var(--t2);line-height:1.5}
.app .empty{padding:32px;text-align:center;color:var(--t3);font-size:13px}
.app .sync-dot{width:6px;height:6px;border-radius:50%;background:var(--em);animation:pulse 1.4s ease-in-out infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
.app .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.app .kpi-card{background:var(--bg2);border:1px solid var(--bo);border-radius:var(--r2);padding:16px;border-top:3px solid}
.app .kpi-val{font-size:32px;font-weight:800;line-height:1;margin-bottom:4px}
.app .kpi-lbl{font-size:11px;color:var(--t3);line-height:1.4}
.app .kpi-sub{font-size:11px;font-weight:600;margin-top:4px}
.app .bar-row{display:flex;align-items:center;gap:10px;padding:5px 0}
.app .bar-bg{flex:1;height:6px;background:var(--bo);border-radius:99px;overflow:hidden}
.app .bar-fill{height:100%;border-radius:99px;transition:width .4s}
.app .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.app .grid22{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.app .sub-tab-bar{display:flex;gap:4px;margin-bottom:14px;background:var(--bg3);border-radius:var(--r2);padding:3px;width:fit-content}
.app .sub-tab{background:none;border:none;color:var(--t3);font-size:12px;font-weight:600;padding:5px 16px;border-radius:var(--r);cursor:pointer;transition:all .15s}
.app .sub-tab.active{background:var(--bg2);color:var(--t);box-shadow:0 1px 3px rgba(0,0,0,.25)}
.app .sub-tab:hover:not(.active){color:var(--t2)}
.app .bay-grid{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
.app .bay-card{flex:0 0 auto;width:148px;min-height:180px;background:var(--bg3);border:1px solid var(--bo);border-radius:var(--r2);display:flex;flex-direction:column;overflow:hidden;transition:border-color .15s}
.app .bay-card.high-cap{width:168px;border-color:rgba(59,130,246,.25)}
.app .bay-card:hover{border-color:var(--bl)}
.app .bay-hd{padding:8px 10px 6px;border-bottom:1px solid var(--bo);display:flex;align-items:center;gap:6px}
.app .bay-num{font-size:16px;font-weight:800;color:var(--t);line-height:1}
.app .bay-cap{font-size:9px;color:var(--t3);margin-left:auto}
.app .bay-body{flex:1;display:flex;flex-direction:column;gap:6px;padding:8px}
.app .bay-chip{display:flex;align-items:center;gap:5px;background:var(--bg2);border-radius:var(--r);padding:5px 7px;cursor:pointer;transition:background .12s}
.app .bay-chip:hover{background:rgba(59,130,246,.1)}
.app .bay-chip-venta{background:rgba(168,85,247,.07)}
.app .bay-chip-venta:hover{background:rgba(168,85,247,.15)}
.app .bay-add{display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 6px;border-radius:var(--r);border:1px dashed var(--bo);color:var(--t3);font-size:11px;cursor:pointer;transition:all .15s;margin-top:auto;background:none;width:100%}
.app .bay-add:hover{border-color:var(--bl);color:var(--bl);background:rgba(59,130,246,.06)}
.app .slot-picker{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:200}
.app .slot-picker-box{background:var(--bg2);border:1px solid var(--bo);border-radius:var(--r2);width:430px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.app .slot-picker-list{overflow-y:auto;flex:1}
.app .sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.app .ri{display:flex;align-items:center;gap:11px;padding:8px 16px;border-bottom:1px solid var(--bo)}
.app .ri:last-child{border-bottom:none}
.app .prow{display:flex;align-items:center;gap:11px;padding:5px 0}
.app .pbg{width:68px;height:4px;background:var(--bo);border-radius:99px;overflow:hidden}
.app .tsec{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:5px}
.app .tdot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.app .tgrid{display:flex;flex-wrap:wrap;gap:5px}
.app .tc{display:flex;align-items:center;gap:5px;padding:4px 9px 4px 4px;border-radius:99px;border:1px solid var(--bo);background:var(--bg3);cursor:pointer;font-size:11px;font-weight:600;transition:all .15s}
.app .tc:hover{border-color:var(--bo2)}
.app .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.app .tec-row{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--bo)}
.app .tec-row:last-child{border-bottom:none}
.app .srch-result:hover{background:rgba(255,255,255,.04)}
.app .gs-wrap{position:relative}
.app .gs-panel{position:absolute;right:0;top:calc(100% + 6px);width:360px;background:var(--bg2);border:1px solid var(--bo2);border-radius:var(--r2);box-shadow:0 8px 32px rgba(0,0,0,.55);z-index:500;overflow:hidden;max-height:420px;overflow-y:auto}
.app .hist-timeline{display:flex;flex-direction:column}
.app .hist-row{display:flex;gap:12px;padding:0 0 20px;position:relative}
.app .hist-row:not(:last-child):before{content:"";position:absolute;left:13px;top:30px;bottom:0;width:1px;background:var(--bo)}
.app .hist-dot{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid}
.app .hist-body{flex:1;min-width:0;padding-top:3px}
.app .hist-campo{font-size:12px;font-weight:700;color:var(--t);margin-bottom:4px}
.app .hist-vals{font-size:11px;color:var(--t3);display:flex;flex-direction:column;gap:3px}
.app .hist-ts{font-size:10px;color:var(--t3);margin-top:5px;display:flex;align-items:center;gap:4px}
.app .mobnav{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--bg2);border-top:1px solid var(--bo);z-index:200}
.app .mobnav-item{flex:1;display:flex;flex-direction:column;align-items:center;padding:9px 4px 8px;gap:3px;cursor:pointer;color:var(--t3);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:none;background:none}
.app .mobnav-item.act{color:var(--em)}
@media(max-width:768px){
  html,body,#root{overflow:auto}
  .app{overflow:auto;height:auto;min-height:100vh}
  .app .shell{height:auto;min-height:100vh;padding-bottom:62px}
  .app .sidebar{display:none!important}
  .app .main{height:auto;overflow:unset}
  .app .content{padding:10px;overflow-y:unset}
  .app .modal{width:100%!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;border-radius:0!important}
  .app .topbar{padding:8px 10px}
  .app .mobnav{display:flex}
  .app .kpi-grid{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
  .app .grid2,.app .grid22,.app .grid3{grid-template-columns:1fr}
  .app .fr{grid-template-columns:1fr}
  .app .srch{width:160px}
  .app .gs-panel{width:calc(100vw - 20px);right:-10px}
  .app .bay-grid{padding-bottom:8px}
  .app .sub-tab-bar{width:100%}
  .app .sh{flex-wrap:wrap;gap:8px}
}
`;

// ── Atoms ─────────────────────────────────────────────────────
function StBadge({ s }: { s: string }) {
  const c = ST[s] || { bg: "rgba(139,150,168,.1)", color: "#9aa3b8", border: "rgba(139,150,168,.2)" };
  return <span className="badge" style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>{s}</span>;
}

function DestBadge({ d }: { d: string }) {
  const isVenta = d === "venta";
  return (
    <span className="badge" style={{
      background: isVenta ? "rgba(168,85,247,.12)" : "rgba(59,130,246,.12)",
      color:      isVenta ? "#c084fc" : "#60a5fa",
      border:     isVenta ? "1px solid rgba(168,85,247,.25)" : "1px solid rgba(59,130,246,.25)",
    }}>
      {isVenta ? "Venta" : "Alquiler"}
    </span>
  );
}

function GPVBadge({ f }: { f: string }) {
  const r = dGPV(f);
  if (r <= 0) return <span style={{ fontSize: 12, color: "var(--t3)" }}>Vencida ({-r}d)</span>;
  return <span style={{ fontSize: 13, fontWeight: 700, color: r <= 15 ? "var(--am)" : "var(--em)" }}>{r}d {r <= 15 ? "⚠" : "✓"}</span>;
}

// Indicador de fecha estimada de entrega + estado (faltan / hoy / atrasado)
function EntregaEst({ e }: { e: Equipo }) {
  if (!e.fechaEstimada) return <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>;
  const d = diasHasta(e.fechaEstimada);
  const enProc = EN_PROCESO.has(e.estado);
  let color = "var(--t3)", txt = "";
  if (d === null) return <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>;
  if (!enProc) { color = "var(--t3)"; txt = "—"; }
  else if (d < 0) { color = "var(--ro)"; txt = `Atrasado ${-d}d`; }
  else if (d === 0) { color = "var(--am)"; txt = "Vence hoy"; }
  else if (d <= 3) { color = "var(--am)"; txt = `Faltan ${d}d`; }
  else { color = "var(--em)"; txt = `Faltan ${d}d`; }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--t3)" }}>{fmtFecha(e.fechaEstimada)}</span>
      {txt !== "—" && <span style={{ fontSize: 10.5, fontWeight: 700, color }}>{txt}</span>}
    </div>
  );
}

function TecChips({ tecnicos = [] }: { tecnicos?: string[] }) {
  if (!tecnicos.length) return <span style={{ color: "var(--t3)", fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {tecnicos.map(t => {
        const col = aColor(t);
        return (
          <div key={t} title={t} style={{ display: "flex", alignItems: "center", gap: 4, background: `${col}18`, border: `1px solid ${col}35`, borderRadius: 99, padding: "2px 8px 2px 4px", fontSize: 11 }}>
            <div style={{ width: 17, height: 17, borderRadius: "50%", background: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{inits(t)}</div>
            <span style={{ color: col, fontWeight: 600, whiteSpace: "nowrap" }}>{t.split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── TecSelector ───────────────────────────────────────────────
function TecSelector({ selected, onChange, ocupados, tecnicos, enLicencia }: {
  selected: string[];
  onChange: (v: string[]) => void;
  ocupados: Record<string, number>;
  tecnicos: string[];
  enLicencia?: Set<string>;
}) {
  const lic = enLicencia ?? new Set<string>();
  const disp = tecnicos.filter(t => !ocupados[t]);
  const ocup = tecnicos.filter(t => ocupados[t]);
  const toggle = (t: string) => onChange(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]);

  function Chip({ t }: { t: string }) {
    const sel = selected.includes(t);
    const jobs = ocupados[t] || 0;
    const busy = jobs > 0;
    const onLic = lic.has(t);
    const col = aColor(t);
    return (
      <button type="button" onClick={() => toggle(t)} className="tc"
        style={{
          borderColor: sel ? col : onLic ? "rgba(244,63,94,.35)" : busy ? "rgba(245,158,11,.3)" : "var(--bo)",
          background:  sel ? `${col}20` : onLic ? "rgba(244,63,94,.07)" : busy ? "rgba(245,158,11,.06)" : "var(--bg3)",
        }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: sel ? col : "var(--bg4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: sel ? "#fff" : "var(--t3)", flexShrink: 0 }}>{inits(t)}</div>
        <span style={{ color: sel ? col : onLic ? "var(--ro)" : busy ? "var(--am)" : "var(--t2)" }}>{t}</span>
        {onLic && <span style={{ fontSize: 10, color: "var(--ro)", background: "rgba(244,63,94,.12)", borderRadius: 99, padding: "0 5px" }}>licencia</span>}
        {busy && <span style={{ fontSize: 10, color: "var(--am)", background: "rgba(245,158,11,.12)", borderRadius: 99, padding: "0 4px" }}>{jobs}</span>}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {selected.length > 0 && (
        <div style={{ background: "rgba(59,130,246,.07)", border: "1px solid rgba(59,130,246,.18)", borderRadius: "var(--r)", padding: "9px 11px" }}>
          <div className="tsec" style={{ color: "var(--bl)" }}>Asignados ({selected.length})</div>
          <div className="tgrid">{selected.map(t => <Chip key={t} t={t} />)}</div>
        </div>
      )}
      {disp.filter(t => !selected.includes(t)).length > 0 && (
        <div>
          <div className="tsec" style={{ color: "var(--em)" }}><div className="tdot" style={{ background: "var(--em)" }} />Disponibles</div>
          <div className="tgrid">{disp.filter(t => !selected.includes(t)).map(t => <Chip key={t} t={t} />)}</div>
        </div>
      )}
      {ocup.filter(t => !selected.includes(t)).length > 0 && (
        <div>
          <div className="tsec" style={{ color: "var(--am)" }}><div className="tdot" style={{ background: "var(--am)" }} />Ocupados — asignables igual</div>
          <div className="tgrid">{ocup.filter(t => !selected.includes(t)).map(t => <Chip key={t} t={t} />)}</div>
        </div>
      )}
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────
function Toasts({ toasts }: { toasts: { id: number; msg: string; type: string }[] }) {
  if (!toasts.length) return null;
  return (
    <div className="twrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type === "ok" ? "tok" : t.type === "err" ? "terr" : "tinf"}`}>
          <Ico n={t.type === "ok" ? "check" : t.type === "err" ? "x" : "alert"} s={14} c={t.type === "ok" ? "var(--em)" : t.type === "err" ? "var(--ro)" : "var(--bl)"} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Confirm ───────────────────────────────────────────────────
function Confirm({ msg, onOk, onCancel }: { msg: string; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="overlay">
      <div className="modal modalsm" style={{ width: 340 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="trash" s={15} c="var(--ro)" />
            <span className="mt">¿Eliminar?</span>
          </div>
          <button className="btni" onClick={onCancel}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb" style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: "var(--t2)" }}>{msg}</p>
        </div>
        <div className="mf">
          <button className="btn btns" onClick={onCancel}>Cancelar</button>
          <button className="btn btnd" onClick={onOk}><Ico n="trash" s={13} c="var(--ro)" />Eliminar</button>
        </div>
      </div>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { mutate: login, isPending } = useLogin();

  const tryLogin = () => {
    if (!username.trim() || !pw) { setErr("Ingresá usuario y contraseña"); return; }
    setErr(null);
    login(
      { data: { username: username.trim(), password: pw } },
      {
        onSuccess: () => { setErr(null); onLogin(); },
        onError: (e: unknown) => {
          const status = (e as { status?: number })?.status;
          setErr(status === 401 ? "Usuario o contraseña incorrectos" : "No se pudo iniciar sesión. Reintentá.");
          setPw("");
        },
      },
    );
  };

  return (
    <div className="login">
      <div className="lcard">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--gr3)", border: "1px solid rgba(21,128,61,.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ico n="wrench" s={22} c="var(--em)" />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--t)" }}>Gestión de activos</div>
            <div style={{ fontSize: 11, color: "var(--t3)" }}>Movimiento de Suelo</div>
          </div>
        </div>
        <div style={{ height: 1, background: "var(--bo)", marginBottom: 18 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="fg">
            <label className="fl" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Ico n="users" s={11} c="var(--t3)" />Usuario
            </label>
            <input
              className="fi" type="text" value={username} placeholder="usuario" autoFocus autoComplete="username"
              onChange={e => { setUsername(e.target.value); setErr(null); }}
              onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            />
          </div>
          <div className="fg">
            <label className="fl" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Ico n="lock" s={11} c="var(--t3)" />Contraseña
            </label>
            <input
              className="fi" type="password" value={pw} placeholder="••••••••••••" autoComplete="current-password"
              onChange={e => { setPw(e.target.value); setErr(null); }}
              onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            />
          </div>
          {err && (
            <div className="lerr">
              <Ico n="alert" s={13} c="var(--ro)" />{err}
            </div>
          )}
          <button className="btn btnp" style={{ justifyContent: "center", marginTop: 4, opacity: isPending ? 0.7 : 1 }}
            disabled={isPending} onClick={tryLogin}>
            <Ico n="arrowR" s={15} c="#fff" />{isPending ? "Ingresando…" : "Ingresar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History helpers ────────────────────────────────────────────
const CAMPO_LABELS: Record<string, string> = {
  ingreso: "Ingreso registrado", eliminado: "Eliminado del taller",
  estado: "Cambio de estado", tecnicos: "Técnicos asignados",
  prioridad: "Prioridad", falla: "Falla / Trabajo",
  observacion: "Observación", cliente: "Cliente",
  modelo: "Modelo", destino: "Destino",
};
const CAMPO_ICO: Record<string, string> = {
  ingreso: "plus", eliminado: "trash", estado: "sync",
  tecnicos: "users", prioridad: "alert", default: "edit",
};
const CAMPO_COLOR: Record<string, string> = {
  ingreso: "#10b981", eliminado: "#ef4444", estado: "#3b82f6",
  tecnicos: "#6366f1", prioridad: "#f59e0b", falla: "#8b5cf6",
  observacion: "#9aa3b8", cliente: "#9aa3b8", modelo: "#9aa3b8", destino: "#9aa3b8",
};

function HistoryEntry({ entry }: { entry: EquipoHistoryEntry }) {
  const color  = CAMPO_COLOR[entry.campo] || "#9aa3b8";
  const label  = CAMPO_LABELS[entry.campo] || entry.campo;
  const ico    = CAMPO_ICO[entry.campo]   || CAMPO_ICO.default;
  const isPure = entry.campo === "ingreso" || entry.campo === "eliminado";
  const ts     = new Date(entry.timestamp).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <div className="hist-row">
      <div className="hist-dot" style={{ background: `${color}18`, borderColor: `${color}44`, color }}>
        <Ico n={ico} s={12} />
      </div>
      <div className="hist-body">
        <div className="hist-campo">{label}</div>
        {!isPure && (
          <div className="hist-vals">
            {entry.valorAnterior != null && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ color: "var(--ro)", fontWeight: 700, fontSize: 12 }}>−</span>
                <span style={{ textDecoration: "line-through", color: "var(--t3)" }}>{entry.valorAnterior || "—"}</span>
              </div>
            )}
            {entry.valorNuevo != null && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ color: "#10b981", fontWeight: 700, fontSize: 12 }}>+</span>
                <span style={{ color: "var(--t2)" }}>{entry.valorNuevo || "—"}</span>
              </div>
            )}
          </div>
        )}
        {isPure && (entry.valorNuevo || entry.valorAnterior) && (
          <div className="hist-vals">
            <span style={{ color: "var(--t2)" }}>{entry.valorNuevo || entry.valorAnterior}</span>
          </div>
        )}
        <div className="hist-ts">
          <Ico n="clock" s={10} c="var(--t3)" />{ts} · <span style={{ fontWeight: 600 }}>{entry.usuario}</span>
        </div>
      </div>
    </div>
  );
}

// ── GlobalSearch ───────────────────────────────────────────────
function GlobalSearch({ equipos, onOpen }: { equipos: Equipo[]; onOpen: (e: Equipo) => void }) {
  const [q, setQ]       = useState("");
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const results = q.trim().length < 2 ? [] : equipos.filter(e => {
    const ql = q.toLowerCase();
    return [e.modelo, e.interno, e.cliente, e.falla, e.observacion]
      .some(f => f?.toLowerCase().includes(ql));
  }).slice(0, 12);

  return (
    <div className="gs-wrap" ref={ref}>
      <div className="srch" style={{ width: 200 }}>
        <Ico n="filter" s={14} c="var(--t3)" />
        <input
          placeholder="Buscar equipo…"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {q && (
          <button className="btni" style={{ padding: 2, marginRight: -2 }}
            onClick={() => { setQ(""); setOpen(false); }}>
            <Ico n="x" s={11} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="gs-panel">
          <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--bo)", fontSize: 10, color: "var(--t3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
            {results.length} resultado{results.length !== 1 ? "s" : ""}
          </div>
          {results.map(e => {
            const c = ST[e.estado] || {};
            const isActive = ESTADOS_ACTIVOS.has(e.estado);
            const dias = dDesde(e.fechaIngreso);
            const alertColor = isActive && dias >= 90 ? "var(--ro)" : isActive && dias >= 60 ? "var(--am)" : isActive && dias >= 30 ? "#f97316" : null;
            return (
              <div
                key={e.id}
                className="srch-result"
                onClick={() => { onOpen(e); setOpen(false); setQ(""); }}
                style={{ padding: "8px 12px", borderBottom: "1px solid var(--bo)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.modelo}
                    {e.interno && <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 6, fontFamily: "monospace" }}>{e.interno}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.cliente || "Sin cliente"} · {e.estado}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  <span className="badge" style={{ fontSize: 10, background: c.bg, color: c.color, border: `1px solid ${c.border}`, padding: "1px 6px" }}>{e.estado}</span>
                  {alertColor && <span style={{ fontSize: 10, fontWeight: 700, color: alertColor }}>{dias}d ⚠</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TallerModal ───────────────────────────────────────────────
function TallerModal({ item, allEquipos, onSave, onClose, tecnicos, canEdit = true, enLicencia }: {
  item: Equipo | null;
  allEquipos: Equipo[];
  onSave: (f: Partial<Equipo>) => void;
  onClose: () => void;
  tecnicos: string[];
  canEdit?: boolean;
  enLicencia?: Set<string>;
}) {
  const [modalTab, setModalTab] = useState<"datos" | "historial">("datos");
  const [form, setForm] = useState<Partial<Equipo>>(item || {
    destino: "alquiler", modelo: "", interno: "", accesorio: "", cliente: "",
    fechaIngreso: new Date().toISOString().slice(0, 10),
    falla: "", estado: "A inspeccionar", tecnicos: [], observacion: "", prioridad: "ninguna",
  });
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const ocup = buildOcup(allEquipos, item?.id ?? null);
  const estados = form.destino === "venta" ? [...ESTADOS_TALLER, ESTADO_LISTO] : ESTADOS_TALLER;

  const { data: rawHistory = [], isLoading: histLoading } = useGetEquipoHistory(
    item?.id ?? 0,
  );
  const history = item ? rawHistory : [];

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="wrench" s={15} c="var(--em)" />
            <span className="mt">{item ? item.modelo : "Registrar ingreso"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {item && (
              <div className="sub-tab-bar" style={{ marginBottom: 0 }}>
                <button className={`sub-tab${modalTab === "datos" ? " active" : ""}`} onClick={() => setModalTab("datos")}>Datos</button>
                <button className={`sub-tab${modalTab === "historial" ? " active" : ""}`} onClick={() => setModalTab("historial")}>
                  Historial{history.length > 0 ? ` (${history.length})` : ""}
                </button>
              </div>
            )}
            <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
          </div>
        </div>

        {modalTab === "datos" && (
          <div className="mb">
            <div className="fg">
              <div className="fl">Destino del equipo</div>
              <div className="trow">
                {([["alquiler", "Alquiler / Flota"], ["venta", "Venta de usado"]] as [string, string][]).map(([k, l]) => (
                  <button key={k} type="button" className="tbtn"
                    onClick={() => { set("destino", k); if (k === "alquiler" && form.estado === ESTADO_LISTO) set("estado", "A inspeccionar"); }}
                    style={{
                      borderColor: form.destino === k ? (k === "venta" ? "#a855f7" : "var(--bl)") : "var(--bo)",
                      background:  form.destino === k ? (k === "venta" ? "rgba(168,85,247,.12)" : "rgba(59,130,246,.12)") : "var(--bg3)",
                      color:       form.destino === k ? (k === "venta" ? "#c084fc" : "var(--bl)") : "var(--t3)",
                    }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="fr">
              <div className="fg">
                <label className="fl">Modelo *</label>
                <input className="fi" value={form.modelo || ""} onChange={e => set("modelo", e.target.value)} placeholder="Ej: PC350" />
              </div>
              <div className="fg">
                <label className="fl">Nº Interno</label>
                <input className="fi" value={form.interno || ""} onChange={e => set("interno", e.target.value)} placeholder="Ej: EX-001" />
              </div>
            </div>

            <div className="fr">
              <div className="fg">
                <label className="fl">Accesorio</label>
                <input className="fi" value={form.accesorio || ""} onChange={e => set("accesorio", e.target.value)} placeholder="Ej: A061550" />
              </div>
              <div className="fg">
                <label className="fl">Fecha ingreso</label>
                <input type="date" className="fi" value={form.fechaIngreso || ""} onChange={e => set("fechaIngreso", e.target.value)} />
              </div>
            </div>

            <div className="fg">
              <label className="fl">Entrega estimada <span style={{ color: "var(--t3)", fontWeight: 400 }}>(opcional)</span></label>
              <input type="date" className="fi" value={form.fechaEstimada || ""} onChange={e => set("fechaEstimada", e.target.value)} />
            </div>

            <div className="fg">
              <label className="fl">Cliente / Propietario</label>
              <input className="fi" value={form.cliente || ""} onChange={e => set("cliente", e.target.value)}
                placeholder={form.destino === "venta" ? "Stock propio" : "Nombre o empresa"} />
            </div>

            <div className="fg">
              <div className="fl">Estado en taller</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {estados.map(s => {
                  const c = ST[s] || {};
                  const act = form.estado === s;
                  return (
                    <button key={s} type="button" onClick={() => set("estado", s)} className={`chip ${act ? "on" : ""}`}
                      style={{ borderColor: act ? c.border : "var(--bo)", background: act ? c.bg : "transparent", color: act ? c.color : "var(--t3)" }}>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="fg">
              <div className="fl">Prioridad</div>
              <div style={{ display: "flex", gap: 6 }}>
                {([["ninguna", "Sin prioridad", "var(--t3)", "var(--bo)"], ["amarillo", "Media", "var(--am)", "rgba(245,158,11,.3)"], ["rojo", "Alta", "var(--ro)", "rgba(239,68,68,.3)"]] as [string, string, string, string][]).map(([k, l, col, bc]) => (
                  <button key={k} type="button" onClick={() => set("prioridad", k)} className={`chip ${form.prioridad === k ? "on" : ""}`}
                    style={{ borderColor: form.prioridad === k ? bc : "var(--bo)", background: form.prioridad === k ? `${col}18` : "transparent", color: form.prioridad === k ? col : "var(--t3)" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="fg">
              <div className="fl">
                Técnicos {(form.tecnicos?.length ?? 0) > 0 && <span style={{ color: "var(--bl)" }}>({form.tecnicos!.length})</span>}
              </div>
              <TecSelector selected={form.tecnicos || []} onChange={v => set("tecnicos", v)} ocupados={ocup} tecnicos={tecnicos} enLicencia={enLicencia} />
            </div>

            <div className="fg">
              <label className="fl">Falla / Trabajo</label>
              <textarea className="fta" value={form.falla || ""} onChange={e => set("falla", e.target.value)} placeholder="Describir falla o trabajo…" />
            </div>
            <div className="fg">
              <label className="fl">Observaciones</label>
              <textarea className="fta" value={form.observacion || ""} onChange={e => set("observacion", e.target.value)} placeholder="Repuestos, estado, notas…" />
            </div>
          </div>
        )}

        {modalTab === "historial" && (
          <div className="mb">
            {histLoading ? (
              <div className="empty">Cargando historial…</div>
            ) : (history as EquipoHistoryEntry[]).length === 0 ? (
              <div className="empty">Sin historial registrado para este equipo.</div>
            ) : (
              <div className="hist-timeline">
                {(history as EquipoHistoryEntry[]).map(h => (
                  <HistoryEntry key={h.id} entry={h} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mf">
          <button className="btn btns" onClick={onClose}>{canEdit ? "Cancelar" : "Cerrar"}</button>
          {canEdit && modalTab === "datos" && (
            <button className="btn btnp" onClick={() => { if (!form.modelo?.trim()) return; onSave(form); }}>
              <Ico n="save" s={14} c="#fff" />{item ? "Guardar" : "Registrar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ModalEntrega ──────────────────────────────────────────────
function ModalEntrega({ equipo, onConfirm, onClose }: { equipo: Equipo; onConfirm: (fecha: string, cliente: string) => void; onClose: () => void }) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [cliente, setCliente] = useState("");
  const vence = fecha ? new Date(new Date(fecha).getTime() + DIAS_GPV * 86400000).toLocaleDateString("es-AR") : "";

  return (
    <div className="overlay">
      <div className="modal modalsm" style={{ width: 400 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="truck" s={15} c="var(--bl)" />
            <span className="mt">Entregar — {equipo.modelo}</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb">
          <div className="ibox">Al confirmar inicia el período de <strong>GPV de {DIAS_GPV} días</strong>.</div>
          <div className="fg">
            <label className="fl">Fecha de entrega</label>
            <input type="date" className="fi" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="fg">
            <label className="fl">Cliente comprador</label>
            <input className="fi" value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre o empresa" />
          </div>
          {fecha && <div style={{ fontSize: 12, color: "var(--t3)" }}>GPV vence: <strong style={{ color: "var(--t)" }}>{vence}</strong></div>}
        </div>
        <div className="mf">
          <button className="btn btns" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={() => onConfirm(fecha, cliente)}>
            <Ico n="check" s={14} c="#fff" />Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ModalGPV ──────────────────────────────────────────────────
function ModalGPV({ item, onSave, onClose, canEdit = true }: { item: GPVEntry | null; onSave: (f: Partial<GPVEntry>) => void; onClose: () => void; canEdit?: boolean }) {
  const [form, setForm] = useState<Partial<GPVEntry>>(item || { modelo: "", interno: "", cliente: "", fechaEntrega: new Date().toISOString().slice(0, 10), observacion: "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const vence = form.fechaEntrega ? new Date(new Date(form.fechaEntrega).getTime() + DIAS_GPV * 86400000).toLocaleDateString("es-AR") : "";

  return (
    <div className="overlay">
      <div className="modal modalsm">
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="shield" s={15} c="var(--em)" />
            <span className="mt">{item ? "Editar GPV" : "Registrar venta"}</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb">
          <div className="fr">
            <div className="fg">
              <label className="fl">Modelo *</label>
              <input className="fi" value={form.modelo || ""} onChange={e => set("modelo", e.target.value)} />
            </div>
            <div className="fg">
              <label className="fl">Nº Interno</label>
              <input className="fi" value={form.interno || ""} onChange={e => set("interno", e.target.value)} />
            </div>
          </div>
          <div className="fg">
            <label className="fl">Cliente</label>
            <input className="fi" value={form.cliente || ""} onChange={e => set("cliente", e.target.value)} />
          </div>
          <div className="fg">
            <label className="fl">Fecha entrega</label>
            <input type="date" className="fi" value={form.fechaEntrega || ""} onChange={e => set("fechaEntrega", e.target.value)} />
          </div>
          <div className="fg">
            <label className="fl">Observaciones</label>
            <textarea className="fta" value={form.observacion || ""} onChange={e => set("observacion", e.target.value)} />
          </div>
          {form.fechaEntrega && <div className="ibox">GPV vence: <strong>{vence}</strong></div>}
        </div>
        <div className="mf">
          <button className="btn btns" onClick={onClose}>{canEdit ? "Cancelar" : "Cerrar"}</button>
          {canEdit && (
            <button className="btn btnp" onClick={() => { if (!form.modelo?.trim()) return; onSave({ ...form, estado: ESTADO_VEND }); }}>
              <Ico n="save" s={14} c="#fff" />{item ? "Guardar" : "Registrar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TecnicosModal ─────────────────────────────────────────────
function TecnicosModal({ tecnicos, onSave, onClose, canEdit }: {
  tecnicos: string[];
  onSave: (t: string[]) => void;
  onClose: () => void;
  canEdit: boolean;
}) {
  const [list, setList] = useState<string[]>([...tecnicos]);
  const [newName, setNewName] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const addTec = () => {
    const v = newName.trim().toUpperCase();
    if (!v || list.includes(v)) return;
    setList(l => [...l, v]);
    setNewName("");
  };

  const startEdit = (i: number) => {
    setEditIdx(i);
    setEditVal(list[i]);
  };

  const saveEdit = () => {
    const v = editVal.trim().toUpperCase();
    if (!v || (list.includes(v) && list[editIdx!] !== v)) { setEditIdx(null); return; }
    setList(l => l.map((x, i) => i === editIdx ? v : x));
    setEditIdx(null);
  };

  const deleteTec = (i: number) => {
    setList(l => l.filter((_, idx) => idx !== i));
    setConfirmDel(null);
  };

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 500, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="users" s={15} c="var(--te)" />
            <span className="mt">Gestión de técnicos</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>

        {/* Add form — fixed, never scrolls */}
        {canEdit && (
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bo)", flexShrink: 0 }}>
            <div className="fl" style={{ marginBottom: 6 }}>Agregar técnico</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="fi"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nombre completo (se guardará en mayúsculas)"
                onKeyDown={e => { if (e.key === "Enter") addTec(); }}
                style={{ flex: 1 }}
              />
              <button className="btn btnp" onClick={addTec} style={{ flexShrink: 0 }}>
                <Ico n="plus" s={14} c="#fff" />Agregar
              </button>
            </div>
          </div>
        )}

        {/* Scrollable technician list */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ padding: "4px 0" }}>
            {list.length === 0 ? (
              <div className="empty">Sin técnicos registrados</div>
            ) : list.map((t, i) => {
              const col = aColor(t);
              if (editIdx === i) {
                return (
                  <div key={i} className="tec-row">
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${col}22`, border: `1px solid ${col}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: col, flexShrink: 0 }}>{inits(t)}</div>
                    <input
                      className="fi"
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditIdx(null); }}
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <button className="btn btnp" style={{ fontSize: 11, padding: "4px 10px" }} onClick={saveEdit}>
                      <Ico n="check" s={12} c="#fff" />Guardar
                    </button>
                    <button className="btni" onClick={() => setEditIdx(null)}><Ico n="x" s={14} /></button>
                  </div>
                );
              }
              return (
                <div key={i} className="tec-row">
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${col}22`, border: `1px solid ${col}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: col, flexShrink: 0 }}>{inits(t)}</div>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--t)" }}>{t}</span>
                  {canEdit && <button className="btni" onClick={() => startEdit(i)} title="Editar"><Ico n="edit" s={14} /></button>}
                  {canEdit && <button className="btni" onClick={() => setConfirmDel(i)} title="Eliminar"><Ico n="trash" s={14} c="var(--ro)" /></button>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mf">
          <button className="btn btns" onClick={onClose}>{canEdit ? "Cancelar" : "Cerrar"}</button>
          {canEdit && (
            <button className="btn btnp" onClick={() => { onSave(list); onClose(); }}>
              <Ico n="save" s={14} c="#fff" />Guardar lista
            </button>
          )}
        </div>

        {confirmDel !== null && (
          <div className="overlay" style={{ zIndex: 2000 }}>
            <div className="modal modalsm" style={{ width: 340 }}>
              <div className="mh">
                <span className="mt">¿Eliminar técnico?</span>
                <button className="btni" onClick={() => setConfirmDel(null)}><Ico n="x" s={15} /></button>
              </div>
              <div className="mb" style={{ padding: 16 }}>
                <p style={{ fontSize: 13, color: "var(--t2)" }}>Se eliminará a <strong>{list[confirmDel]}</strong> de la lista. Los equipos que tengan este técnico asignado conservarán su referencia.</p>
              </div>
              <div className="mf">
                <button className="btn btns" onClick={() => setConfirmDel(null)}>Cancelar</button>
                <button className="btn btnd" onClick={() => deleteTec(confirmDel)}><Ico n="trash" s={13} c="var(--ro)" />Eliminar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────
function Dashboard({ equipos, gpvList, tecnicos, enLicencia }: { equipos: Equipo[]; gpvList: GPVEntry[]; tecnicos: string[]; enLicencia: Set<string> }) {
  const enT = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado));
  const disp = equipos.filter(e => e.estado === ESTADO_DISP);
  const gpvV = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0);
  const gpvA = gpvV.filter(g => dGPV(g.fechaEntrega) <= 15);
  const gpvVn = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) <= 0);
  const cE = (s: string) => equipos.filter(e => e.estado === s).length;
  const ocup = buildOcup(equipos);
  const topT = tecnicos.map(t => ({ t, j: ocup[t] || 0 })).filter(x => x.j > 0).sort((a, b) => b.j - a.j).slice(0, 5);
  const libres = tecnicos.filter(t => !ocup[t] && !enLicencia.has(t));
  const enLic = tecnicos.filter(t => enLicencia.has(t));

  const atrasados = equipos.filter(estaAtrasado).sort((a, b) => (diasHasta(a.fechaEstimada) ?? 0) - (diasHasta(b.fechaEstimada) ?? 0));

  const stats = [
    { l: "En taller",         v: enT.length,                               c: "var(--bl)" },
    { l: "Entregas atrasadas", v: atrasados.length,                        c: "var(--ro)" },
    { l: "Disponibles venta", v: disp.length,                              c: "var(--pu)" },
    { l: "GPV por vencer",    v: gpvA.length,                              c: "var(--am)" },
    { l: "GPV vencidas",      v: gpvVn.length,                             c: "var(--ro)" },
    { l: "Técnicos libres",   v: libres.length,                            c: "var(--te)" },
  ];

  return (
    <div>
      <div className="sg">
        {stats.map(s => (
          <div key={s.l} className="sc" style={{ borderTopColor: s.c }}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, marginBottom: 5, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "var(--t3)", lineHeight: 1.35 }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="tw">
          <div className="th"><Ico n="wrench" s={14} c="var(--bl)" /><span className="tt">Estado del taller</span></div>
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
            {[...ESTADOS_TALLER, ESTADO_LISTO].map(s => {
              const c = ST[s] || { color: "var(--t3)" };
              const cnt = cE(s);
              const pct = equipos.length ? Math.min(100, cnt / equipos.length * 100) : 0;
              return (
                <div key={s} className="prow">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "var(--t2)", flex: 1 }}>{s}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: cnt > 0 ? c.color : "var(--t3)", minWidth: 20, textAlign: "right" }}>{cnt}</span>
                  <div className="pbg">
                    <div style={{ height: "100%", width: `${pct}%`, background: c.color, borderRadius: 99 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="tw">
          <div className="th">
            <Ico n="users" s={14} c="var(--te)" />
            <span className="tt">Técnicos</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--t3)" }}>{libres.length} libres</span>
          </div>
          {topT.length === 0 ? (
            <div className="empty">Sin técnicos asignados</div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              {topT.map(({ t, j }) => {
                const col = aColor(t);
                return (
                  <div key={t} className="ri">
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${col}22`, border: `1px solid ${col}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: col, flexShrink: 0 }}>{inits(t)}</div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: "var(--t)" }}>{t}</div></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 48, height: 4, background: "var(--bo)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, j * 33)}%`, background: col, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: col, minWidth: 42, textAlign: "right" }}>{j} eq</span>
                    </div>
                  </div>
                );
              })}
              {libres.length > 0 && (
                <div style={{ padding: "8px 16px", borderTop: "1px solid var(--bo)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--em)", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".07em" }}>Libres</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {libres.map(t => (
                      <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "rgba(16,185,129,.08)", color: "var(--em)", border: "1px solid rgba(16,185,129,.15)", fontWeight: 600 }}>{t.split(" ")[0]}</span>
                    ))}
                  </div>
                </div>
              )}
              {enLic.length > 0 && (
                <div style={{ padding: "8px 16px", borderTop: "1px solid var(--bo)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--am)", marginBottom: 5, textTransform: "uppercase", letterSpacing: ".07em" }}>De licencia</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {enLic.map(t => (
                      <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "rgba(245,158,11,.08)", color: "var(--am)", border: "1px solid rgba(245,158,11,.15)", fontWeight: 600 }}>{t.split(" ")[0]}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="tw">
          <div className="th">
            <Ico n="alert" s={14} c="var(--am)" />
            <span className="tt">GPV por vencer</span>
            {gpvA.length > 0 && <span className="na" style={{ marginLeft: "auto" }}>{gpvA.length}</span>}
          </div>
          {gpvA.length === 0 ? (
            <div className="empty">Sin GPV próximas a vencer ✓</div>
          ) : (
            gpvA.map(g => {
              const r = dGPV(g.fechaEntrega);
              const vence = new Date(new Date(g.fechaEntrega).getTime() + DIAS_GPV * 86400000).toLocaleDateString("es-AR");
              return (
                <div key={g.id} className="ri">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: r <= 5 ? "var(--ro)" : "var(--am)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t)" }}>{g.modelo}</div>
                    <div style={{ fontSize: 11, color: "var(--t3)" }}>{g.cliente}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: r <= 5 ? "var(--ro)" : "var(--am)" }}>{r}d</div>
                    <div style={{ fontSize: 10, color: "var(--t3)" }}>{vence}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="tw">
          <div className="th">
            <Ico n="alert" s={14} c="var(--ro)" />
            <span className="tt">Entregas atrasadas</span>
            {atrasados.length > 0 && <span className="na" style={{ marginLeft: "auto", background: "rgba(244,63,94,.15)", color: "var(--ro)" }}>{atrasados.length}</span>}
          </div>
          {atrasados.length === 0 ? (
            <div className="empty">Sin entregas atrasadas ✓</div>
          ) : (
            atrasados.slice(0, 6).map(e => {
              const d = diasHasta(e.fechaEstimada) ?? 0;
              return (
                <div key={e.id} className="ri">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ro)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t)" }}>{e.modelo}</div>
                    <div style={{ fontSize: 11, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.cliente || "Stock propio"} · {e.estado}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ro)" }}>{-d}d</div>
                    <div style={{ fontSize: 10, color: "var(--t3)" }}>{fmtFecha(e.fechaEstimada)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="tw">
          <div className="th"><Ico n="clock" s={14} c="var(--t3)" /><span className="tt">Últimos ingresos</span></div>
          {[...equipos].sort((a, b) => new Date(b.fechaIngreso).getTime() - new Date(a.fechaIngreso).getTime()).slice(0, 5).map(m => {
            const c = ST[m.estado] || {};
            return (
              <div key={m.id} className="ri">
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t)" }}>
                    {m.modelo}
                    {m.destino === "venta" && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 99, background: "rgba(168,85,247,.12)", color: "#c084fc", border: "1px solid rgba(168,85,247,.2)", fontWeight: 700, marginLeft: 4 }}>VENTA</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3)" }}>{m.cliente || "Stock propio"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 99, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontWeight: 600 }}>{m.estado}</span>
                  <span style={{ fontSize: 11, color: "var(--t3)" }}>{dDesde(m.fechaIngreso)}d</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── SortIcon ──────────────────────────────────────────────────
function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: "asc" | "desc" }) {
  if (sortCol !== col) return <Ico n="sort" s={11} c="var(--t3)" />;
  return <Ico n={sortDir === "asc" ? "sortAsc" : "sortDesc"} s={11} c="var(--em)" />;
}

// ── TallerPage ────────────────────────────────────────────────
function TallerPage({ equipos, onAdd, onEdit, onDelete, onListo, search, tecnicos, canCreate, canEdit, canDelete }: {
  equipos: Equipo[];
  onAdd: () => void;
  onEdit: (m: Equipo) => void;
  onDelete: (m: Equipo) => void;
  onListo: (m: Equipo) => void;
  search: string;
  tecnicos: string[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [ef, setEf] = useState("Activos");
  const [df, setDf] = useState("Todos");
  const [tf, setTf] = useState("Todos");
  const [sortCol, setSortCol] = useState("fechaIngreso");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const ocup = buildOcup(equipos);
  const tecConEq = tecnicos.filter(t => ocup[t]);

  const fil = equipos.filter(m => {
    const q = search.toLowerCase();
    const mS = !q || [m.modelo, m.interno, m.accesorio, m.cliente, m.falla, m.observacion, ...(m.tecnicos || [])].some(f => f?.toLowerCase().includes(q));
    const mE = ef === "Todos" ? true : ef === "Activos" ? ESTADOS_ACTIVOS.has(m.estado) : m.estado === ef;
    const mD = df === "Todos" || m.destino === df;
    const mT = tf === "Todos" || (m.tecnicos || []).includes(tf);
    return mS && mE && mD && mT;
  });

  const sorted = [...fil].sort((a, b) => {
    let va: string | number = "";
    let vb: string | number = "";
    switch (sortCol) {
      case "modelo":   va = a.modelo.toLowerCase();   vb = b.modelo.toLowerCase(); break;
      case "cliente":  va = a.cliente.toLowerCase();  vb = b.cliente.toLowerCase(); break;
      case "estado":   va = a.estado.toLowerCase();   vb = b.estado.toLowerCase(); break;
      case "destino":  va = a.destino.toLowerCase();  vb = b.destino.toLowerCase(); break;
      case "dias":     va = dDesde(a.fechaIngreso);   vb = dDesde(b.fechaIngreso); break;
      case "fechaIngreso": va = a.fechaIngreso; vb = b.fechaIngreso; break;
      case "fechaEstimada": va = a.fechaEstimada || "9999"; vb = b.fechaEstimada || "9999"; break;
      case "prioridad": {
        const pOrd: Record<string, number> = { rojo: 0, amarillo: 1, ninguna: 2 };
        va = pOrd[a.prioridad] ?? 2; vb = pOrd[b.prioridad] ?? 2; break;
      }
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const thProps = (col: string) => ({
    className: `sortable ${sortCol === col ? "sort-active" : ""}`,
    onClick: () => toggleSort(col),
    style: { cursor: "pointer" as const },
  });

  const exportExcel = () => {
    const data = sorted.map(m => ({
      "Modelo": m.modelo,
      "Nº Interno": m.interno || "",
      "Accesorio": m.accesorio || "",
      "Cliente": m.cliente || "",
      "Destino": m.destino === "venta" ? "Venta" : "Alquiler",
      "Estado": m.estado,
      "Prioridad": m.prioridad === "rojo" ? "Alta" : m.prioridad === "amarillo" ? "Media" : "—",
      "Técnicos": ((m.tecnicos || []) as string[]).join(", "),
      "Días en taller": dDesde(m.fechaIngreso),
      "Fecha ingreso": m.fechaIngreso,
      "Entrega estimada": m.fechaEstimada || "",
      "Estado entrega": (() => {
        if (!m.fechaEstimada || !EN_PROCESO.has(m.estado)) return "";
        const d = diasHasta(m.fechaEstimada);
        if (d === null) return "";
        return d < 0 ? `Atrasado ${-d}d` : d === 0 ? "Vence hoy" : `Faltan ${d}d`;
      })(),
      "Falla / Trabajo": m.falla || "",
      "Observación": m.observacion || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Taller");
    XLSX.writeFile(wb, `taller_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <div className="sh">
        <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 600 }}>
          {sorted.length} equipo{sorted.length !== 1 ? "s" : ""} <span style={{ color: "var(--t3)", fontWeight: 400 }}>en esta vista</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {sorted.length > 0 && (
            <button className="btn btns" onClick={exportExcel} title="Exportar a Excel">
              <Ico n="download" s={14} c="var(--em)" />Excel
            </button>
          )}
          {canCreate && <button className="btn btnp" onClick={onAdd}><Ico n="plus" s={14} c="#fff" />Registrar ingreso</button>}
        </div>
      </div>

      <div className="fb">
        <Ico n="filter" s={12} c="var(--t3)" />
        {[{ k: "Activos", l: "En taller" }, { k: "Todos", l: "Todos" }, ...ESTADOS_TALLER.map(s => ({ k: s, l: s })), { k: ESTADO_LISTO, l: "Listo" }].map(f => (
          <button key={f.k} className={`chip ${ef === f.k ? "on" : ""}`} onClick={() => setEf(f.k)}>{f.l}</button>
        ))}
        <div className="sep" />
        {["Todos", "alquiler", "venta"].map(d => (
          <button key={d} className={`chip ${df === d ? "on" : ""}`} onClick={() => setDf(d)}>
            {d === "Todos" ? "Todos" : d === "venta" ? "Venta" : "Alquiler"}
          </button>
        ))}
        {tecConEq.length > 0 && (
          <>
            <div className="sep" />
            <select className="fsel" value={tf} onChange={e => setTf(e.target.value)}>
              <option value="Todos">Todos los técnicos</option>
              {tecConEq.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="tw">
        <div className="ts">
          <table>
            <thead>
              <tr>
                <th {...thProps("modelo")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Equipo <SortIcon col="modelo" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th {...thProps("destino")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Destino <SortIcon col="destino" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th {...thProps("cliente")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Cliente <SortIcon col="cliente" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th>Falla</th>
                <th {...thProps("estado")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Estado <SortIcon col="estado" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th>Técnicos</th>
                <th {...thProps("fechaIngreso")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Ingreso <SortIcon col="fechaIngreso" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th {...thProps("dias")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Días <SortIcon col="dias" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th {...thProps("fechaEstimada")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Entrega est. <SortIcon col="fechaEstimada" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th {...thProps("prioridad")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Prior. <SortIcon col="prioridad" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th>Obs.</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!sorted.length ? (
                <tr><td colSpan={12}><div className="empty">No hay equipos</div></td></tr>
              ) : sorted.map(m => {
                const dias = dDesde(m.fechaIngreso);
                const isActive = ESTADOS_ACTIVOS.has(m.estado);
                const diasColor = isActive && dias >= 90 ? "var(--ro)" : isActive && dias >= 60 ? "var(--am)" : isActive && dias >= 30 ? "#f97316" : "var(--t3)";
                const isRojo = m.prioridad === "rojo";
                return (
                  <tr key={m.id} style={{ background: isRojo ? "rgba(239,68,68,.04)" : "" }}>
                    <td>
                      {isRojo && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--ro)", marginRight: 6, verticalAlign: "middle" }} />}
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{m.modelo}</span>
                      {m.interno && <div style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace" }}>{m.interno}</div>}
                      {m.accesorio && <div style={{ fontSize: 10, color: "var(--t3)" }}>{m.accesorio}</div>}
                    </td>
                    <td><DestBadge d={m.destino} /></td>
                    <td style={{ fontSize: 13 }}>{m.cliente || <span style={{ color: "var(--t3)" }}>—</span>}</td>
                    <td><div style={{ fontSize: 12, color: "var(--t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>{m.falla || "—"}</div></td>
                    <td><StBadge s={m.estado} /></td>
                    <td style={{ minWidth: 120 }}><TecChips tecnicos={m.tecnicos} /></td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--t3)" }}>{m.fechaIngreso}</td>
                    <td>
                      <span style={{ fontSize: 13, fontWeight: 700, color: diasColor }}>
                        {dias}d
                      </span>
                    </td>
                    <td><EntregaEst e={m} /></td>
                    <td>
                      {m.prioridad === "rojo" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "rgba(239,68,68,.12)", color: "var(--ro)", border: "1px solid rgba(239,68,68,.2)", fontWeight: 700 }}>Alta</span>}
                      {m.prioridad === "amarillo" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "rgba(245,158,11,.12)", color: "var(--am)", border: "1px solid rgba(245,158,11,.2)", fontWeight: 700 }}>Media</span>}
                      {m.prioridad === "ninguna" && <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ maxWidth: 140, fontSize: 11, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.observacion || "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}>
                        {canEdit && <button className="btni" onClick={() => onEdit(m)}><Ico n="edit" s={14} /></button>}
                        {canEdit && m.estado === ESTADO_LISTO && m.destino === "venta" && (
                          <button className="btn btnb" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onListo(m)}>
                            <Ico n="arrowR" s={12} c="var(--bl)" />Disp.
                          </button>
                        )}
                        {canEdit && m.estado === ESTADO_LISTO && m.destino === "alquiler" && (
                          <button className="btn btnp" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onListo(m)}>
                            <Ico n="check" s={12} c="#fff" />Entrega
                          </button>
                        )}
                        {canDelete && <button className="btni" onClick={() => onDelete(m)}><Ico n="trash" s={14} c="var(--ro)" /></button>}
                        {!canEdit && !canDelete && <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── VentaPage ─────────────────────────────────────────────────
function VentaPage({ disponibles, gpvList, onEntrega, onEditGPV, onDeleteGPV, onAddGPV, onEditDisp, search, canCreate, canEdit, canDelete }: {
  disponibles: Equipo[];
  gpvList: GPVEntry[];
  onEntrega: (m: Equipo) => void;
  onEditGPV: (g: GPVEntry) => void;
  onDeleteGPV: (g: GPVEntry) => void;
  onAddGPV: () => void;
  onEditDisp: (m: Equipo) => void;
  search: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [sub, setSub] = useState("disponibles");
  const [gf, setGf] = useState("Todos");

  const fD = disponibles.filter(m => {
    const q = search.toLowerCase();
    return !q || [m.modelo, m.interno, m.cliente].some(f => f?.toLowerCase().includes(q));
  });

  const fG = gpvList.filter(g => {
    const q = search.toLowerCase();
    const mS = !q || [g.modelo, g.interno, g.cliente].some(f => f?.toLowerCase().includes(q));
    const r = dGPV(g.fechaEntrega);
    const mF = gf === "Todos" ? true : gf === "vigentes" ? r > 0 : gf === "vencer" ? r > 0 && r <= 15 : r <= 0;
    return mS && mF;
  });

  return (
    <div>
      <div className="sh" style={{ justifyContent: "flex-end" }}>
        {canCreate && <button className="btn btnp" onClick={onAddGPV}><Ico n="plus" s={14} c="#fff" />Registrar venta</button>}
      </div>

      <div className="fb">
        {[{ k: "disponibles", l: `Disponibles (${disponibles.length})` }, { k: "gpv", l: `GPV (${gpvList.length})` }].map(s => (
          <button key={s.k} className={`chip ${sub === s.k ? "on" : ""}`} onClick={() => setSub(s.k)}>{s.l}</button>
        ))}
        {sub === "gpv" && (
          <>
            <div className="sep" />
            {[["Todos", "Todos"], ["vigentes", "Vigentes"], ["vencer", "Por vencer ≤15d"], ["vencidas", "Vencidas"]].map(([k, l]) => (
              <button key={k} className={`chip ${gf === k ? "on" : ""}`} onClick={() => setGf(k)}>{l}</button>
            ))}
          </>
        )}
      </div>

      {sub === "disponibles" && (
        <div className="tw">
          <div className="ts">
            <table>
              <thead>
                <tr>
                  <th>Equipo</th><th>Accesorio</th><th>Cliente</th><th>Observación</th><th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {!fD.length ? (
                  <tr><td colSpan={5}><div className="empty">Sin equipos disponibles</div></td></tr>
                ) : fD.map(m => (
                  <tr key={m.id}>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{m.modelo}</span>
                      {m.interno && <div style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace" }}>{m.interno}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--t3)" }}>{m.accesorio || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--t2)" }}>{m.cliente || "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--t3)", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.observacion || "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}>
                        {canEdit && <button className="btni" title="Editar" onClick={() => onEditDisp(m)}>
                          <Ico n="edit" s={14} />
                        </button>}
                        {canEdit && <button className="btn btnp" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onEntrega(m)}>
                          <Ico n="truck" s={12} c="#fff" />Entregar
                        </button>}
                        {!canEdit && <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === "gpv" && (
        <div className="tw">
          <div className="ts">
            <table>
              <thead>
                <tr>
                  <th>Equipo</th><th>Cliente</th><th>F. Entrega</th><th>GPV restante</th><th>Obs.</th><th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {!fG.length ? (
                  <tr><td colSpan={6}><div className="empty">Sin registros GPV</div></td></tr>
                ) : fG.map(g => (
                  <tr key={g.id}>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{g.modelo}</span>
                      {g.interno && <div style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace" }}>{g.interno}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>{g.cliente || <span style={{ color: "var(--t3)" }}>—</span>}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace", color: "var(--t3)" }}>{g.fechaEntrega}</td>
                    <td><GPVBadge f={g.fechaEntrega} /></td>
                    <td style={{ fontSize: 11, color: "var(--t3)", maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.observacion || "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}>
                        {canEdit && <button className="btni" onClick={() => onEditGPV(g)}><Ico n="edit" s={14} /></button>}
                        {canDelete && <button className="btni" onClick={() => onDeleteGPV(g)}><Ico n="trash" s={14} c="var(--ro)" /></button>}
                        {!canEdit && !canDelete && <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPIsPage ──────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-bg">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

type KpiSubTab = "general" | "flota" | "venta";

function KPIsPage({ equipos, gpvList, tecnicos: _tecList, onOpenEquipo }: {
  equipos: Equipo[];
  gpvList: GPVEntry[];
  tecnicos: string[];
  onOpenEquipo: (e: Equipo) => void;
}) {
  const [subTab, setSubTab] = useState<KpiSubTab>("general");
  const allActivos = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado));
  const scope = subTab === "flota"
    ? allActivos.filter(e => e.destino === "alquiler")
    : subTab === "venta"
    ? allActivos.filter(e => e.destino === "venta")
    : allActivos;
  const total = equipos.length;

  // ── Dept effort (General only) ──
  const asigFlota = allActivos.filter(e => e.destino === "alquiler").reduce((s, e) => s + (e.tecnicos?.filter(t => (t as string)?.trim()).length ?? 0), 0);
  const asigVenta = allActivos.filter(e => e.destino === "venta").reduce((s, e) => s + (e.tecnicos?.filter(t => (t as string)?.trim()).length ?? 0), 0);
  const totalAsig = asigFlota + asigVenta || 1;
  const flotaPct  = Math.round(asigFlota / totalAsig * 100);
  const ventaPct  = 100 - flotaPct;

  const byEstado = [...ESTADOS_TALLER, ESTADO_LISTO].map(s => ({
    s, count: scope.filter(e => e.estado === s).length,
    color: ST[s]?.color || "var(--t3)",
  }));
  const maxByEstado = Math.max(1, ...byEstado.map(x => x.count));

  const prioRojo     = scope.filter(e => e.prioridad === "rojo").length;
  const prioAmarillo = scope.filter(e => e.prioridad === "amarillo").length;
  const prioNinguna  = scope.filter(e => e.prioridad === "ninguna" || !e.prioridad).length;

  const ageBuckets = [
    { label: "0-7d",   min: 0,  max: 7,        color: "#10b981" },
    { label: "7-14d",  min: 7,  max: 14,       color: "#3b82f6" },
    { label: "14-30d", min: 14, max: 30,       color: "#f59e0b" },
    { label: "30-60d", min: 30, max: 60,       color: "#f97316" },
    { label: "60-90d", min: 60, max: 90,       color: "#ef4444" },
    { label: "+90d",   min: 90, max: Infinity, color: "#dc2626" },
  ].map(b => ({ ...b, count: scope.filter(e => { const d = dDesde(e.fechaIngreso); return d >= b.min && d < b.max; }).length }));
  const maxAge = Math.max(1, ...ageBuckets.map(b => b.count));

  const avgTotal = scope.length
    ? Math.round(scope.reduce((a, e) => a + dDesde(e.fechaIngreso), 0) / scope.length)
    : 0;

  // Cumplimiento de plazos: sobre equipos en proceso con fecha estimada
  const conPlazo = scope.filter(e => e.fechaEstimada && EN_PROCESO.has(e.estado));
  const atrasadosScope = conPlazo.filter(e => { const d = diasHasta(e.fechaEstimada); return d !== null && d < 0; });
  const enPlazo = conPlazo.length - atrasadosScope.length;
  const cumplimiento = conPlazo.length ? Math.round(enPlazo / conPlazo.length * 100) : null;

  const bottlenecks = [...scope]
    .sort((a, b) => dDesde(b.fechaIngreso) - dDesde(a.fechaIngreso))
    .slice(0, 6);

  const modelMap: Record<string, number> = {};
  scope.forEach(e => { modelMap[e.modelo] = (modelMap[e.modelo] || 0) + 1; });
  const topModels = Object.entries(modelMap).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxModel = Math.max(1, ...topModels.map(([, c]) => c));

  const gpvVigentes   = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0).length;
  const gpvPorVencer  = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0 && dGPV(g.fechaEntrega) <= 15).length;
  const gpvVencidas   = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) <= 0).length;
  const gpvTotal      = gpvList.length;

  const avgByEstado = [...ESTADOS_TALLER, ESTADO_LISTO].map(s => {
    const items = scope.filter(e => e.estado === s && e.fechaIngreso);
    const avg = items.length ? Math.round(items.reduce((a, e) => a + dDesde(e.fechaIngreso), 0) / items.length) : 0;
    return { s, avg, count: items.length, color: ST[s]?.color || "var(--t3)" };
  }).filter(x => x.count > 0);
  const maxAvg = Math.max(1, ...avgByEstado.map(x => x.avg));

  const Card = ({ val, lbl, color, sub }: { val: number | string; lbl: string; color: string; sub?: string }) => (
    <div className="kpi-card" style={{ borderTopColor: color }}>
      <div className="kpi-val" style={{ color }}>{val}</div>
      <div className="kpi-lbl">{lbl}</div>
      {sub && <div className="kpi-sub" style={{ color }}>{sub}</div>}
    </div>
  );

  const tabLbl = subTab === "general" ? "taller" : subTab === "flota" ? "Flota" : "Venta";

  const downloadReport = () => {
    const now = new Date();
    const fecha = now.toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" });
    const hora  = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const nombre = subTab === "flota" ? "Flota (Alquiler)" : "Venta de Usado";
    const rows = scope.map(e => {
      const dias = dDesde(e.fechaIngreso);
      const tecs = ((e.tecnicos as string[]) || []).filter(t => (t as string)?.trim()).join(", ") || "—";
      const prio = e.prioridad === "rojo" ? "Alta" : e.prioridad === "amarillo" ? "Media" : "—";
      return `<tr>
        <td>${e.modelo}</td><td>${e.interno || "—"}</td><td>${e.cliente || "Stock"}</td>
        <td>${e.estado}</td>
        <td style="text-align:right;${dias > 30 ? "color:#dc2626;font-weight:700" : ""}">${dias}d</td>
        <td>${tecs}</td><td>${prio}</td><td style="max-width:200px;word-break:break-word">${e.observacion || "—"}</td>
      </tr>`;
    }).join("");
    const avgByEstRow = avgByEstado.map(x => `<tr><td>${x.s}</td><td style="text-align:right">${x.avg}d</td><td style="text-align:right">${x.count}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>Reporte ${nombre} — ${fecha}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;color:#111;background:#fff;padding:36px;font-size:13px}
h1{font-size:22px;font-weight:800;margin-bottom:3px}
.sub{color:#666;font-size:12px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}
.cv{font-size:24px;font-weight:800;line-height:1}
.cl{font-size:10px;color:#888;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{background:#f9fafb;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;border-bottom:2px solid #e5e7eb}
td{padding:7px 10px;border-bottom:1px solid #f3f4f6;vertical-align:top}
.h2{font-size:14px;font-weight:700;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e5e7eb}
.side{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.footer{margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:11px;color:#aaa;display:flex;justify-content:space-between}
@media print{button{display:none}body{padding:20px}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
  <div>
    <h1>Reporte — ${nombre}</h1>
    <div class="sub">Gestión de Activos · Movimiento de Suelo · ${fecha} · ${hora}hs</div>
  </div>
  <button onclick="window.print()" style="background:#111;color:#fff;border:none;padding:9px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">Imprimir / Guardar PDF</button>
</div>
<div class="grid">
  <div class="card"><div class="cv">${scope.length}</div><div class="cl">Equipos activos</div></div>
  <div class="card"><div class="cv" style="color:${avgTotal>20?"#dc2626":avgTotal>10?"#d97706":"#059669"}">${avgTotal}d</div><div class="cl">Promedio días en taller</div></div>
  <div class="card"><div class="cv" style="color:${prioRojo>0?"#dc2626":"#111"}">${prioRojo}</div><div class="cl">Prioridad alta</div></div>
  <div class="card"><div class="cv">${scope.filter(e=>(e.tecnicos as string[])?.some((t:string)=>t?.trim())).length}</div><div class="cl">Con técnico asignado</div></div>
</div>
<div class="h2">Listado de equipos</div>
<table>
  <thead><tr><th>Modelo</th><th>Interno</th><th>Cliente</th><th>Estado</th><th style="text-align:right">Días</th><th>Técnicos</th><th>Prioridad</th><th>Observaciones</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="side">
  <div>
    <div class="h2">Tiempo promedio por estado</div>
    <table><thead><tr><th>Estado</th><th style="text-align:right">Prom.</th><th style="text-align:right">Equipos</th></tr></thead><tbody>${avgByEstRow}</tbody></table>
  </div>
</div>
<div class="footer">
  <span>Gestión de Activos — Movimiento de Suelo</span>
  <span>${scope.length} equipo${scope.length!==1?"s":""} · Generado ${fecha} ${hora}hs</span>
</div>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="sub-tab-bar" style={{ marginBottom: 0 }}>
          {(["general", "flota", "venta"] as KpiSubTab[]).map(t => (
            <button key={t} className={`sub-tab${subTab === t ? " active" : ""}`} onClick={() => setSubTab(t)}>
              {t === "general" ? "General" : t === "flota" ? "Flota" : "Venta"}
            </button>
          ))}
        </div>
        {subTab !== "general" && (
          <button className="btn" style={{ fontSize: 11, padding: "5px 14px", display: "flex", alignItems: "center", gap: 6 }}
            onClick={downloadReport}>
            <Ico n="save" s={13} c="var(--t2)" />Descargar reporte
          </button>
        )}
      </div>

      <div className="kpi-grid">
        <Card val={scope.length} lbl={`Activos en ${tabLbl}`} color="var(--bl)" />
        <Card val={avgTotal + "d"} lbl="Promedio días en taller" color={avgTotal > 20 ? "var(--ro)" : avgTotal > 10 ? "var(--am)" : "var(--em)"} />
        <Card val={prioRojo} lbl="Prioridad alta (urgentes)" color="var(--ro)" sub={prioRojo > 0 ? "Requieren atención" : "Sin urgentes ✓"} />
        <Card
          val={atrasadosScope.length}
          lbl="Entregas atrasadas"
          color={atrasadosScope.length > 0 ? "var(--ro)" : "var(--em)"}
          sub={cumplimiento === null ? "Sin fechas cargadas" : `${cumplimiento}% en plazo (${conPlazo.length})`}
        />
        {subTab === "general" ? (
          <>
            <Card val={gpvPorVencer} lbl="GPV próximas a vencer" color={gpvPorVencer > 0 ? "var(--am)" : "var(--em)"} sub={`de ${gpvTotal} en cartera`} />
            <Card val={gpvVencidas} lbl="GPV vencidas" color={gpvVencidas > 0 ? "var(--ro)" : "var(--t3)"} />
            <div className="kpi-card" style={{ borderTopColor: "#10b981", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" }}>
              {(() => {
                const circ = 2 * Math.PI * 36;
                const flotaArc = flotaPct / 100 * circ;
                const ventaArc = circ - flotaArc;
                return (
                  <>
                    <svg viewBox="0 0 100 100" width={86} height={86} style={{ display: "block", flexShrink: 0 }}>
                      <circle cx="50" cy="50" r="36" fill="none" stroke="#1e2535" strokeWidth="13" />
                      <g transform="rotate(-90, 50, 50)">
                        {flotaArc > 0 && (
                          <circle cx="50" cy="50" r="36" fill="none" stroke="#10b981" strokeWidth="13"
                            strokeDasharray={`${flotaArc} ${circ}`} />
                        )}
                        {ventaArc > 0 && (
                          <circle cx="50" cy="50" r="36" fill="none" stroke="#f59e0b" strokeWidth="13"
                            strokeDasharray={`${ventaArc} ${circ}`}
                            transform={`rotate(${flotaPct * 3.6}, 50, 50)`} />
                        )}
                      </g>
                      <text x="50" y="48" textAnchor="middle" fill="#e8eaf0" fontSize="17" fontWeight="800">{flotaPct}%</text>
                      <text x="50" y="62" textAnchor="middle" fill="#5c6480" fontSize="8" fontWeight="700" letterSpacing="0.5">FLOTA</text>
                    </svg>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block", flexShrink: 0 }} />
                        <span style={{ color: "#10b981", fontWeight: 700 }}>{flotaPct}%</span>
                        <span style={{ color: "var(--t3)" }}>Flota</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
                        <span style={{ color: "#f59e0b", fontWeight: 700 }}>{ventaPct}%</span>
                        <span style={{ color: "var(--t3)" }}>Venta</span>
                      </span>
                    </div>
                    <div className="kpi-lbl">Esfuerzo técnico</div>
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          <>
            <Card val={prioAmarillo} lbl="Prioridad media" color="var(--am)" />
            <Card val={prioNinguna} lbl="Sin prioridad asignada" color="var(--t3)" />
            <Card val={scope.filter(e => (e.tecnicos as string[])?.some(t => t?.trim())).length} lbl="Con técnico asignado" color="var(--em)" />
          </>
        )}
      </div>

      <div className="grid22" style={{ marginBottom: 14 }}>
        <div className="tw">
          <div className="th"><Ico n="bar" s={14} c="var(--bl)" /><span className="tt">Distribución por estado</span></div>
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            {byEstado.map(({ s, count, color }) => (
              <div key={s} className="bar-row">
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--t2)", width: 170, flexShrink: 0 }}>{s}</span>
                <MiniBar value={count} max={maxByEstado} color={color} />
                <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? color : "var(--t3)", minWidth: 22, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tw">
          <div className="th"><Ico n="clock" s={14} c="var(--am)" /><span className="tt">Antigüedad en taller</span></div>
          <div style={{ padding: "10px 16px" }}>
            {ageBuckets.map(({ label, count, color }) => (
              <div key={label} className="bar-row">
                <span style={{ fontSize: 12, color: "var(--t2)", width: 70, flexShrink: 0 }}>{label}</span>
                <MiniBar value={count} max={maxAge} color={color} />
                <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? color : "var(--t3)", minWidth: 22, textAlign: "right" }}>{count}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--bo)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--t3)" }}>Promedio general</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: avgTotal > 20 ? "var(--ro)" : avgTotal > 10 ? "var(--am)" : "var(--em)" }}>{avgTotal}d</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid3" style={{ marginBottom: 14 }}>
        <div className="tw">
          <div className="th"><Ico n="alert" s={14} c="var(--ro)" /><span className="tt">Prioridades</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Alta",           count: prioRojo,     color: "var(--ro)", bg: "rgba(239,68,68,.1)" },
              { label: "Media",          count: prioAmarillo, color: "var(--am)", bg: "rgba(245,158,11,.1)" },
              { label: "Sin prioridad",  count: prioNinguna,  color: "var(--t3)", bg: "var(--bg3)" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: "var(--r)", background: bg }}>
                <span style={{ fontSize: 12, color: "var(--t2)" }}>{label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        {subTab === "general" ? (
          <div className="tw">
            <div className="th"><Ico n="shield" s={14} c="var(--em)" /><span className="tt">GPV / Garantías</span></div>
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Vigentes",       count: gpvVigentes - gpvPorVencer, color: "var(--em)", bg: "rgba(16,185,129,.08)" },
                { label: "Por vencer ≤15d",count: gpvPorVencer,               color: "var(--am)", bg: "rgba(245,158,11,.08)" },
                { label: "Vencidas",       count: gpvVencidas,                color: "var(--ro)", bg: "rgba(239,68,68,.08)" },
              ].map(({ label, count, color, bg }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: "var(--r)", background: bg }}>
                  <span style={{ fontSize: 12, color: "var(--t2)" }}>{label}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color }}>{count}</span>
                </div>
              ))}
              {gpvTotal === 0 && <div className="empty" style={{ padding: 8 }}>Sin registros GPV</div>}
            </div>
          </div>
        ) : (
          <div className="tw">
            <div className="th"><Ico n="wrench" s={14} c="var(--te)" /><span className="tt">Promedio días por estado</span></div>
            <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
              {avgByEstado.length === 0 ? <div className="empty">Sin datos</div> : avgByEstado.map(({ s, avg, count, color }) => (
                <div key={s} className="bar-row">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "var(--t2)", width: 130, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                  <MiniBar value={avg} max={maxAvg} color={color} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: avg > 14 ? "var(--am)" : color, minWidth: 36, textAlign: "right" }}>{avg}d</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tw">
          <div className="th"><Ico n="kpi" s={14} c="var(--am)" /><span className="tt">Cuellos de botella</span><span style={{ marginLeft: "auto", fontSize: 10, color: "var(--bl)" }}>click → observaciones</span></div>
          {bottlenecks.length === 0 ? <div className="empty">Sin equipos activos</div> : bottlenecks.map((m, i) => {
            const dias = dDesde(m.fechaIngreso);
            const col = dias > 60 ? "#dc2626" : dias > 30 ? "var(--ro)" : dias > 14 ? "var(--am)" : "var(--t2)";
            const st = ST[m.estado] || {};
            return (
              <div key={m.id} className="ri" style={{ cursor: "pointer" }} onClick={() => onOpenEquipo(m)} title="Ver detalle y observaciones">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", minWidth: 16 }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t)" }}>{m.modelo}
                    {m.interno && <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace", marginLeft: 5 }}>{m.interno}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 1 }}>{m.cliente || "Stock propio"}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: col }}>{dias}d</span>
                  <div style={{ marginTop: 2 }}><span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: st.bg, color: st.color, border: `1px solid ${st.border}`, fontWeight: 600 }}>{m.estado}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {subTab === "general" && (
        <div className="tw" style={{ marginBottom: 14 }}>
          <div className="th"><Ico n="wrench" s={14} c="var(--te)" /><span className="tt">Promedio días por estado</span></div>
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            {avgByEstado.length === 0 ? <div className="empty">Sin datos</div> : avgByEstado.map(({ s, avg, count, color }) => (
              <div key={s} className="bar-row">
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "var(--t2)", width: 155, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                <MiniBar value={avg} max={maxAvg} color={color} />
                <span style={{ fontSize: 13, fontWeight: 700, color: avg > 14 ? "var(--am)" : color, minWidth: 36, textAlign: "right" }}>{avg}d</span>
                <span style={{ fontSize: 10, color: "var(--t3)", minWidth: 24, textAlign: "right" }}>({count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topModels.length > 0 && (
        <div className="tw">
          <div className="th"><Ico n="tag" s={14} c="var(--bl)" /><span className="tt">Modelos con mayor presencia</span><span style={{ marginLeft: "auto", fontSize: 10, color: "var(--t3)" }}>activos en taller</span></div>
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            {topModels.map(([model, count]) => {
              const col = aColor(model);
              return (
                <div key={model} className="bar-row">
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: col, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t)", width: 140, flexShrink: 0 }}>{model}</span>
                  <MiniBar value={count} max={maxModel} color={col} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: col, minWidth: 20, textAlign: "right" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LayoutPage ─────────────────────────────────────────────────
// LayoutState: bayId ("1"–"9") → array of equipo IDs
type LayoutState = Record<string, number[]>;

// Zone labels per bay
const BAY_ZONE: Record<string, string> = {
  "1": "Light", "2": "Light",
  "9": "Martillos",
};
const getBayZone = (id: string) => BAY_ZONE[id] ?? "Heavy";

const BAYS_CONFIG = Array.from({ length: 9 }, (_, i) => ({
  id: String(i + 1),
  label: `Bahía ${i + 1}`,
  highCap: i < 2,
}));

function LayoutPage({ equipos, layout, onUpdateLayout, onOpenEquipo, canEdit }: {
  equipos: Equipo[];
  layout: LayoutState;
  onUpdateLayout: (l: LayoutState) => void;
  onOpenEquipo: (e: Equipo) => void;
  canEdit: boolean;
}) {
  const [picker, setPicker] = useState<string | null>(null); // bayId being assigned
  const [pickerSearch, setPickerSearch] = useState("");
  const activos = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado));

  // equipo → bay index for "already placed" detection
  const equipoBay: Record<number, string> = {};
  Object.entries(layout).forEach(([bid, ids]) => {
    (ids || []).forEach(id => { equipoBay[id] = bid; });
  });

  const getBayEqs = (bayId: string): Equipo[] =>
    (layout[bayId] || []).map(id => equipos.find(e => e.id === id)).filter(Boolean) as Equipo[];

  const addToBay = (bayId: string, equipoId: number) => {
    const nl: LayoutState = {};
    // Copy all bays, removing this equipoId from wherever it was
    Object.entries(layout).forEach(([bid, ids]) => {
      nl[bid] = (ids || []).filter(id => id !== equipoId);
    });
    nl[bayId] = [...(nl[bayId] || []), equipoId];
    // Clean empty bays
    Object.keys(nl).forEach(k => { if (!nl[k].length) delete nl[k]; });
    onUpdateLayout(nl);
    setPicker(null);
  };

  const removeFromBay = (e: React.MouseEvent, bayId: string, equipoId: number) => {
    e.stopPropagation();
    const nl = { ...layout };
    nl[bayId] = (nl[bayId] || []).filter(id => id !== equipoId);
    if (!nl[bayId].length) delete nl[bayId];
    onUpdateLayout(nl);
  };

  const placedIds = new Set(Object.values(layout).flat());
  const placedCnt = [...placedIds].filter(id => activos.some(e => e.id === id)).length;
  const unplaced = activos.filter(e => !placedIds.has(e.id));

  const pickerList = activos.filter(e => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return e.modelo.toLowerCase().includes(q) ||
      (e.interno || "").toLowerCase().includes(q) ||
      (e.cliente || "").toLowerCase().includes(q);
  }).sort((a, b) => {
    const ap = equipoBay[a.id] != null, bp = equipoBay[b.id] != null;
    if (ap !== bp) return ap ? 1 : -1;
    return a.modelo.localeCompare(b.modelo);
  });

  return (
    <div>
      <div className="sh">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t)" }}>Layout del Taller</div>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 1 }}>
            {placedCnt} de {activos.length} equipos ubicados
            <span style={{ margin: "0 6px", color: "var(--bo)" }}>·</span>
            <span style={{ color: "var(--bl)" }}>Flota</span>
            <span style={{ color: "var(--pu)", marginLeft: 8 }}>Venta</span>
          </div>
        </div>
        {canEdit && placedCnt > 0 && (
          <button className="btn" style={{ fontSize: 11, padding: "4px 12px" }}
            onClick={() => { if (window.confirm("¿Limpiar todas las posiciones?")) onUpdateLayout({}); }}>
            Limpiar todo
          </button>
        )}
      </div>

      {/* Bay grid — 9 bays, scrollable horizontally */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "var(--t3)" }}>← Izquierda (Bahía 9)</span>
          <div style={{ flex: 1, height: 1, background: "var(--bo)" }} />
          <span style={{ fontSize: 11, color: "var(--t3)" }}>(Bahía 1) Derecha →</span>
        </div>
        <div className="bay-grid">
          {[...BAYS_CONFIG].reverse().map(bay => {
            const eqs = getBayEqs(bay.id);
            return (
              <div key={bay.id} className={`bay-card${bay.highCap ? " high-cap" : ""}`}>
                <div className="bay-hd">
                  <span className="bay-num">{bay.id}</span>
                  <span style={{
                    fontSize: 9, padding: "1px 5px", borderRadius: 99, marginLeft: 4,
                    background: getBayZone(bay.id) === "Light" ? "rgba(59,130,246,.12)" : getBayZone(bay.id) === "Martillos" ? "rgba(245,158,11,.12)" : "rgba(168,85,247,.1)",
                    color: getBayZone(bay.id) === "Light" ? "var(--bl)" : getBayZone(bay.id) === "Martillos" ? "var(--am)" : "var(--pu)",
                    fontWeight: 700,
                  }}>{getBayZone(bay.id)}</span>
                  <span className="bay-cap">{eqs.length} eq</span>
                </div>
                <div className="bay-body">
                  {eqs.map(eq => {
                    const isVenta = eq.destino === "venta";
                    const st = ST[eq.estado] || {};
                    const dias = dDesde(eq.fechaIngreso);
                    const urgente = dias > 30;
                    return (
                      <div key={eq.id} className={`bay-chip${isVenta ? " bay-chip-venta" : ""}`}
                        onClick={() => onOpenEquipo(eq)} title={`${eq.modelo} · ${dias}d en taller`}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                          background: isVenta ? "var(--pu)" : "var(--bl)" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {eq.modelo}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}>
                            <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 99,
                              background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                              {eq.estado.slice(0, 8)}
                            </span>
                            <span style={{ fontSize: 9, fontWeight: 700,
                              color: urgente ? "var(--ro)" : "var(--t3)" }}>{dias}d</span>
                          </div>
                        </div>
                        {canEdit && <button
                          onClick={e => removeFromBay(e, bay.id, eq.id)}
                          style={{ background: "none", border: "none", cursor: "pointer",
                            color: "var(--t3)", fontSize: 14, lineHeight: 1, padding: "0 2px",
                            flexShrink: 0, display: "flex", alignItems: "center" }}
                          title="Quitar de la bahía">×</button>}
                      </div>
                    );
                  })}
                  {canEdit && <button className="bay-add" onClick={() => { setPicker(bay.id); setPickerSearch(""); }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                    <span>Agregar</span>
                  </button>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Senda peatonal */}
        <div style={{
          marginTop: 10, height: 22, borderRadius: "var(--r)",
          background: "repeating-linear-gradient(90deg, rgba(245,158,11,.18) 0px, rgba(245,158,11,.18) 18px, transparent 18px, transparent 28px)",
          border: "1px solid rgba(245,158,11,.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(245,158,11,.7)", letterSpacing: 3 }}>SENDA PEATONAL</span>
        </div>
      </div>

      {/* Unplaced equipos */}
      {unplaced.length > 0 && (
        <div className="tw">
          <div className="th">
            <Ico n="wrench" s={14} c="var(--t3)" />
            <span className="tt">Sin ubicar</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", marginLeft: 6 }}>{unplaced.length}</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--bl)" }}>click → ver equipo</span>
          </div>
          {unplaced.map(eq => {
            const st = ST[eq.estado] || {};
            const dias = dDesde(eq.fechaIngreso);
            return (
              <div key={eq.id} className="ri" style={{ cursor: "pointer" }} onClick={() => onOpenEquipo(eq)}>
                <div style={{ width: 8, height: 8, borderRadius: "50%",
                  background: eq.destino === "venta" ? "var(--pu)" : "var(--bl)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--t)" }}>{eq.modelo}</span>
                  {eq.interno && <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace", marginLeft: 6 }}>{eq.interno}</span>}
                  <div style={{ fontSize: 10, color: "var(--t3)" }}>{eq.cliente || "Stock"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99,
                    background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{eq.estado}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dias > 30 ? "var(--ro)" : "var(--t3)" }}>{dias}d</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Picker modal */}
      {picker && (
        <div className="slot-picker" onClick={() => setPicker(null)}>
          <div className="slot-picker-box" onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--bo)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t)" }}>Agregar a Bahía {picker}</div>
                <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                  {BAYS_CONFIG.find(b => b.id === picker)?.highCap
                    ? "Alta capacidad — podés agregar 2 o 3 equipos"
                    : "Seleccioná el equipo a ubicar"}
                </div>
              </div>
              <button className="btn" onClick={() => setPicker(null)} style={{ padding: "3px 10px", fontSize: 12 }}>✕</button>
            </div>
            <div style={{ padding: "10px 16px" }}>
              <input autoFocus className="inp" placeholder="Buscar modelo, interno, cliente…"
                value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                style={{ width: "100%" }} />
            </div>
            <div className="slot-picker-list">
              {pickerList.length === 0 && <div className="empty">Sin equipos activos</div>}
              {pickerList.map(eq => {
                const alreadyInBay = equipoBay[eq.id];
                const st = ST[eq.estado] || {};
                return (
                  <div key={eq.id} className="ri" style={{ cursor: "pointer", opacity: alreadyInBay === picker ? .4 : 1 }}
                    onClick={() => alreadyInBay !== picker && addToBay(picker!, eq.id)}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%",
                      background: eq.destino === "venta" ? "var(--pu)" : "var(--bl)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t)" }}>{eq.modelo}
                        {eq.interno && <span style={{ fontSize: 10, color: "var(--t3)", fontFamily: "monospace", marginLeft: 5 }}>{eq.interno}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--t3)" }}>{eq.cliente || "Stock"}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99,
                        background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{eq.estado}</span>
                      {alreadyInBay && (
                        <span style={{ fontSize: 9, color: alreadyInBay === picker ? "var(--t3)" : "var(--am)" }}>
                          {alreadyInBay === picker ? "Ya en esta bahía" : `Mover desde ${alreadyInBay}`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: User modal ─────────────────────────────────────────
function UserModal({ item, roles, onSave, onClose }: {
  item: User | null;
  roles: Role[];
  onSave: (form: { username?: string; nombre?: string; password?: string; roleId: number; activo: boolean }) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(item?.username ?? "");
  const [nombre, setNombre] = useState(item?.nombre ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<number>(item?.roleId ?? roles[0]?.id ?? 0);
  const [activo, setActivo] = useState<boolean>(item?.activo ?? true);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!item;

  const submit = () => {
    if (!isEdit && !username.trim()) { setErr("El usuario es obligatorio"); return; }
    if (!isEdit && password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres"); return; }
    if (isEdit && password && password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres"); return; }
    if (!roleId) { setErr("Seleccioná un rol"); return; }
    onSave({
      username: isEdit ? undefined : username.trim(),
      nombre: nombre.trim() || undefined,
      password: password ? password : undefined,
      roleId,
      activo,
    });
  };

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="users" s={15} c="var(--em)" />
            <span className="mt">{isEdit ? "Editar usuario" : "Nuevo usuario"}</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="fg">
            <label className="fl">Usuario</label>
            <input className="fi" value={username} disabled={isEdit}
              placeholder="usuario" autoComplete="off"
              onChange={e => { setUsername(e.target.value); setErr(null); }} />
          </div>
          <div className="fg">
            <label className="fl">Nombre</label>
            <input className="fi" value={nombre} placeholder="Nombre completo"
              onChange={e => setNombre(e.target.value)} />
          </div>
          <div className="fg">
            <label className="fl">{isEdit ? "Nueva contraseña (opcional)" : "Contraseña"}</label>
            <input className="fi" type="password" value={password} autoComplete="new-password"
              placeholder={isEdit ? "Dejar en blanco para no cambiar" : "Mínimo 6 caracteres"}
              onChange={e => { setPassword(e.target.value); setErr(null); }} />
          </div>
          <div className="fg">
            <label className="fl">Rol</label>
            <select className="fi" value={roleId} onChange={e => setRoleId(Number(e.target.value))}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--t2)", cursor: "pointer" }}>
            <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
            Usuario activo
          </label>
          {err && <div className="lerr"><Ico n="alert" s={13} c="var(--ro)" />{err}</div>}
        </div>
        <div className="mf">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={submit}><Ico n="check" s={14} c="#fff" />Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── Admin: Role modal (permissions matrix) ─────────────────────
function RoleModal({ item, onSave, onClose }: {
  item: Role | null;
  onSave: (form: { name: string; permissions: RolePermissions }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [perms, setPerms] = useState<RolePermissions>(() => {
    const base: RolePermissions = {};
    for (const m of MODULES) base[m] = { ...(item?.permissions?.[m] ?? emptyPerm()) };
    return base;
  });
  const [err, setErr] = useState<string | null>(null);

  const toggle = (m: ModuleId, a: PermAction) =>
    setPerms(p => ({ ...p, [m]: { ...p[m], [a]: !p[m][a] } }));

  const submit = () => {
    if (!name.trim()) { setErr("El nombre del rol es obligatorio"); return; }
    onSave({ name: name.trim(), permissions: perms });
  };

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="shield" s={15} c="var(--em)" />
            <span className="mt">{item ? "Editar rol" : "Nuevo rol"}</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fg">
            <label className="fl">Nombre del rol</label>
            <input className="fi" value={name} placeholder="Ej: Supervisor"
              onChange={e => { setName(e.target.value); setErr(null); }} />
          </div>
          <div>
            <div className="fl" style={{ marginBottom: 8 }}>Permisos por módulo</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "var(--t3)", textAlign: "left" }}>
                  <th style={{ padding: "4px 6px", fontWeight: 600 }}>Módulo</th>
                  {(["view", "create", "edit", "delete"] as PermAction[]).map(a => (
                    <th key={a} style={{ padding: "4px 6px", fontWeight: 600, textAlign: "center" }}>{ACTION_LABELS[a]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULES.map(m => (
                  <tr key={m} style={{ borderTop: "1px solid var(--bo)" }}>
                    <td style={{ padding: "6px", color: "var(--t2)", fontWeight: 600 }}>{MODULE_LABELS[m]}</td>
                    {(["view", "create", "edit", "delete"] as PermAction[]).map(a => (
                      <td key={a} style={{ padding: "6px", textAlign: "center" }}>
                        <input type="checkbox" checked={perms[m][a]} onChange={() => toggle(m, a)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {err && <div className="lerr"><Ico n="alert" s={13} c="var(--ro)" />{err}</div>}
        </div>
        <div className="mf">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={submit}><Ico n="check" s={14} c="#fff" />Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── Admin page ─────────────────────────────────────────────────
function AdminPage({ can, toast, currentUserId }: {
  can: (m: ModuleId, a: PermAction) => boolean;
  toast: (msg: string, type?: string) => void;
  currentUserId: number | null;
}) {
  const qc = useQueryClient();
  const [sub, setSub] = useState<"users" | "roles">("users");
  const [userModal, setUserModal] = useState<{ item: User | null } | null>(null);
  const [roleModal, setRoleModal] = useState<{ item: Role | null } | null>(null);

  const usersQ = useQuery({ ...getListUsersQueryOptions() });
  const rolesQ = useQuery({ ...getListRolesQueryOptions() });
  const users = usersQ.data ?? [];
  const roles = rolesQ.data ?? [];

  const { mutate: createUser } = useCreateUser();
  const { mutate: updateUser } = useUpdateUser();
  const { mutate: deleteUser } = useDeleteUser();
  const { mutate: createRole } = useCreateRole();
  const { mutate: updateRole } = useUpdateRole();
  const { mutate: deleteRole } = useDeleteRole();

  const invUsers = () => qc.invalidateQueries({ queryKey: getListUsersQueryOptions().queryKey });
  const invRoles = () => qc.invalidateQueries({ queryKey: getListRolesQueryOptions().queryKey });

  const onErr = (e: unknown, fallback: string) => {
    const status = (e as { status?: number })?.status;
    const data = (e as { data?: { error?: string } })?.data;
    toast(data?.error || (status === 409 ? "Ya existe un registro con ese nombre" : fallback), "err");
  };

  const saveUser = (form: { username?: string; nombre?: string; password?: string; roleId: number; activo: boolean }) => {
    const editing = userModal?.item;
    if (editing) {
      updateUser(
        { id: editing.id, data: { nombre: form.nombre, password: form.password, roleId: form.roleId, activo: form.activo } },
        { onSuccess: () => { invUsers(); toast("Usuario actualizado", "inf"); setUserModal(null); }, onError: e => onErr(e, "No se pudo actualizar el usuario") },
      );
    } else {
      createUser(
        { data: { username: form.username!, nombre: form.nombre, password: form.password!, roleId: form.roleId, activo: form.activo } },
        { onSuccess: () => { invUsers(); toast("Usuario creado"); setUserModal(null); }, onError: e => onErr(e, "No se pudo crear el usuario") },
      );
    }
  };

  const removeUser = (u: User) => {
    if (u.id === currentUserId) { toast("No podés eliminar tu propio usuario", "err"); return; }
    if (!window.confirm(`¿Eliminar al usuario "${u.username}"?`)) return;
    deleteUser({ id: u.id }, { onSuccess: () => { invUsers(); toast(`Usuario "${u.username}" eliminado`, "err"); }, onError: e => onErr(e, "No se pudo eliminar el usuario") });
  };

  const saveRole = (form: { name: string; permissions: RolePermissions }) => {
    const editing = roleModal?.item;
    if (editing) {
      updateRole(
        { id: editing.id, data: { name: form.name, permissions: form.permissions } },
        { onSuccess: () => { invRoles(); toast("Rol actualizado", "inf"); setRoleModal(null); }, onError: e => onErr(e, "No se pudo actualizar el rol") },
      );
    } else {
      createRole(
        { data: { name: form.name, permissions: form.permissions } },
        { onSuccess: () => { invRoles(); toast("Rol creado"); setRoleModal(null); }, onError: e => onErr(e, "No se pudo crear el rol") },
      );
    }
  };

  const removeRole = (r: Role) => {
    if (r.isSystem) { toast("No se puede eliminar un rol del sistema", "err"); return; }
    if (!window.confirm(`¿Eliminar el rol "${r.name}"? Los usuarios con este rol deben reasignarse.`)) return;
    deleteRole({ id: r.id }, { onSuccess: () => { invRoles(); invUsers(); toast(`Rol "${r.name}" eliminado`, "err"); }, onError: e => onErr(e, "No se pudo eliminar el rol. Puede tener usuarios asignados.") });
  };

  const permCount = (r: Role) => MODULES.filter(m => r.permissions?.[m]?.view).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="sub-tab-bar" style={{ marginBottom: 0 }}>
          <button className={`sub-tab${sub === "users" ? " active" : ""}`} onClick={() => setSub("users")}>Usuarios</button>
          <button className={`sub-tab${sub === "roles" ? " active" : ""}`} onClick={() => setSub("roles")}>Roles</button>
        </div>
        {sub === "users" && can("admin", "create") && (
          <button className="btn btnp" style={{ fontSize: 11, padding: "5px 14px" }} onClick={() => setUserModal({ item: null })}>
            <Ico n="plus" s={13} c="#fff" />Nuevo usuario
          </button>
        )}
        {sub === "roles" && can("admin", "create") && (
          <button className="btn btnp" style={{ fontSize: 11, padding: "5px 14px" }} onClick={() => setRoleModal({ item: null })}>
            <Ico n="plus" s={13} c="#fff" />Nuevo rol
          </button>
        )}
      </div>

      {sub === "users" && (
        <div className="tw">
          <div className="th"><Ico n="users" s={14} c="var(--bl)" /><span className="tt">Usuarios</span><span style={{ marginLeft: 6, fontSize: 11, color: "var(--t3)" }}>{users.length}</span></div>
          {usersQ.isLoading ? <div className="empty">Cargando…</div> : users.length === 0 ? <div className="empty">Sin usuarios</div> : users.map(u => (
            <div key={u.id} className="ri">
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: aColor(u.username), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{inits(u.nombre || u.username)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t)" }}>{u.nombre || u.username}
                  <span style={{ fontSize: 11, color: "var(--t3)", fontFamily: "monospace", marginLeft: 6 }}>@{u.username}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--t3)" }}>{u.roleName}</div>
              </div>
              <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 99, background: u.activo ? "rgba(16,185,129,.12)" : "rgba(100,116,139,.14)", color: u.activo ? "var(--em)" : "var(--t3)", border: `1px solid ${u.activo ? "rgba(16,185,129,.3)" : "rgba(100,116,139,.3)"}` }}>{u.activo ? "Activo" : "Inactivo"}</span>
              {can("admin", "edit") && <button className="btni" title="Editar" onClick={() => setUserModal({ item: u })}><Ico n="pencil" s={14} /></button>}
              {can("admin", "delete") && <button className="btni" title="Eliminar" onClick={() => removeUser(u)}><Ico n="trash" s={14} c="var(--ro)" /></button>}
            </div>
          ))}
        </div>
      )}

      {sub === "roles" && (
        <div className="tw">
          <div className="th"><Ico n="shield" s={14} c="var(--em)" /><span className="tt">Roles</span><span style={{ marginLeft: 6, fontSize: 11, color: "var(--t3)" }}>{roles.length}</span></div>
          {rolesQ.isLoading ? <div className="empty">Cargando…</div> : roles.length === 0 ? <div className="empty">Sin roles</div> : roles.map(r => (
            <div key={r.id} className="ri">
              <Ico n="shield" s={16} c={r.isSystem ? "var(--am)" : "var(--t3)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t)" }}>{r.name}
                  {r.isSystem && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(245,158,11,.12)", color: "var(--am)", marginLeft: 8 }}>Sistema</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--t3)" }}>{permCount(r)} módulo{permCount(r) !== 1 ? "s" : ""} con acceso</div>
              </div>
              {can("admin", "edit") && <button className="btni" title="Editar" onClick={() => setRoleModal({ item: r })}><Ico n="pencil" s={14} /></button>}
              {can("admin", "delete") && !r.isSystem && <button className="btni" title="Eliminar" onClick={() => removeRole(r)}><Ico n="trash" s={14} c="var(--ro)" /></button>}
            </div>
          ))}
        </div>
      )}

      {userModal && <UserModal item={userModal.item} roles={roles} onSave={saveUser} onClose={() => setUserModal(null)} />}
      {roleModal && <RoleModal item={roleModal.item} onSave={saveRole} onClose={() => setRoleModal(null)} />}
    </div>
  );
}

// ── Licencias: celda de saldo editable ────────────────────────
function SaldoCell({ value, editable, onSet }: { value: number; editable: boolean; onSet: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const neg = value < 0;
  const commit = () => {
    const n = parseFloat(draft.replace(",", "."));
    setEditing(false);
    if (!isNaN(n)) onSet(round1(n));
  };
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        step="0.5"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{ width: 64, padding: "4px 6px", textAlign: "center", fontSize: 13, fontWeight: 800, background: "var(--bg2)", border: "1px solid var(--bl)", borderRadius: 6, color: "var(--t)" }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      title={editable ? "Click para editar el saldo" : undefined}
      style={{
        minWidth: 52, padding: "4px 8px", borderRadius: 6, fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums",
        cursor: editable ? "pointer" : "default",
        color: neg ? "var(--ro)" : value > 0 ? "var(--t)" : "var(--t3)",
        background: neg ? "rgba(244,63,94,.1)" : "transparent",
        border: editable ? "1px dashed var(--bo)" : "1px solid transparent",
      }}
    >
      {value}
    </button>
  );
}

// ── LicCalendar (disponibilidad mensual) ──────────────────────
const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEM = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const isoYMD = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function LicCalendar({ tecnicos, registros }: { tecnicos: string[]; registros: LicMov[] }) {
  const today = hoyISO();
  const [ano, mes] = today.split("-").map(Number);
  const [cur, setCur] = useState<{ y: number; m: number }>({ y: ano, m: mes - 1 });
  const [selDay, setSelDay] = useState<string | null>(null);

  // licencias con rango (excluye ajustes y sin fechas)
  const conRango = registros.filter(r => r.tipo !== "ajuste" && r.desde && r.hasta);

  // técnicos de licencia en una fecha dada (un registro por técnico)
  const enLicEl = (ymd: string): LicMov[] => {
    const porTec = new Map<string, LicMov>();
    for (const r of conRango) {
      if (r.desde! <= ymd && ymd <= r.hasta! && !porTec.has(r.tecnico)) porTec.set(r.tecnico, r);
    }
    return [...porTec.values()];
  };

  // construir grilla del mes (semana Lun-Dom)
  const primero = new Date(cur.y, cur.m, 1);
  const offset = (primero.getDay() + 6) % 7; // 0=Lun
  const diasMes = new Date(cur.y, cur.m + 1, 0).getDate();
  const celdas: (number | null)[] = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasMes; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const navMes = (delta: number) => {
    setSelDay(null);
    setCur(c => {
      const nm = c.m + delta;
      return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });
  };

  const detalle = selDay ? enLicEl(selDay) : [];
  const disponibles = selDay ? tecnicos.filter(t => !detalle.some(r => r.tecnico === t)) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ padding: 14 }}>
        {/* Encabezado mes */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="calendar" s={15} c="var(--bl)" />
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--t)" }}>{MESES_ES[cur.m]} {cur.y}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="btn btns" onClick={() => navMes(-1)} title="Mes anterior" style={{ padding: "5px 9px" }}>‹</button>
            <button className="btn btns" onClick={() => { setSelDay(null); setCur({ y: ano, m: mes - 1 }); }} style={{ padding: "5px 10px", fontSize: 12 }}>Hoy</button>
            <button className="btn btns" onClick={() => navMes(1)} title="Mes siguiente" style={{ padding: "5px 9px" }}>›</button>
          </div>
        </div>

        {/* Días de la semana */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5, marginBottom: 5 }}>
          {DIAS_SEM.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "var(--t3)", textTransform: "uppercase", letterSpacing: ".04em" }}>{d}</div>
          ))}
        </div>

        {/* Grilla */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>
          {celdas.map((d, i) => {
            if (d === null) return <div key={i} />;
            const ymd = isoYMD(cur.y, cur.m, d);
            const enLic = enLicEl(ymd);
            const n = enLic.length;
            const esHoy = ymd === today;
            const sel = ymd === selDay;
            const fin = [5, 6].includes((new Date(cur.y, cur.m, d).getDay() + 6) % 7);
            return (
              <button
                key={i}
                onClick={() => setSelDay(sel ? null : ymd)}
                style={{
                  position: "relative", aspectRatio: "1 / 1", minHeight: 46, padding: 5,
                  display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start",
                  border: sel ? "1.5px solid var(--bl)" : esHoy ? "1.5px solid var(--am)" : "1px solid var(--bo)",
                  borderRadius: "var(--r)", cursor: "pointer", textAlign: "left",
                  background: sel ? "rgba(59,130,246,.10)" : fin ? "var(--bg3)" : "var(--bg2)",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: esHoy ? 800 : 600, color: esHoy ? "var(--am)" : "var(--t2)" }}>{d}</span>
                {n > 0 && (
                  <span style={{
                    marginTop: "auto", alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                    fontSize: 10, fontWeight: 800, padding: "2px 0", borderRadius: 5,
                    background: n >= 4 ? "rgba(244,63,94,.16)" : n >= 2 ? "rgba(245,158,11,.16)" : "rgba(59,130,246,.14)",
                    color: n >= 4 ? "var(--ro)" : n >= 2 ? "var(--am)" : "var(--bl)",
                  }}>{n} fuera</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Leyenda */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 10.5, color: "var(--t3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(59,130,246,.5)" }} /> 1 técnico fuera</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(245,158,11,.6)" }} /> 2–3 fuera</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(244,63,94,.6)" }} /> 4+ fuera</span>
        </div>
      </div>

      {/* Detalle del día */}
      {selDay && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
            <Ico n="users" s={15} c="var(--bl)" />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t)" }}>Detalle del {fmtFecha(selDay)}</span>
            <span style={{ fontSize: 11, color: "var(--t3)", marginLeft: "auto" }}>{disponibles.length}/{tecnicos.length} disponibles</span>
          </div>
          {detalle.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--em)", display: "flex", alignItems: "center", gap: 6 }}>
              <Ico n="check" s={14} c="var(--em)" /> Todo el personal disponible este día.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{detalle.length} técnico(s) de licencia:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {detalle.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(244,63,94,.07)", border: "1px solid rgba(244,63,94,.25)", borderRadius: "var(--r)", padding: "7px 11px" }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: aColor(r.tecnico), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{inits(r.tecnico)}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t)" }}>{r.tecnico}</div>
                      <div style={{ fontSize: 10.5, color: "var(--ro)" }}>{licTipoLabel(r)} · {fmtFecha(r.desde)}–{fmtFecha(r.hasta)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LicenciasPage ─────────────────────────────────────────────
function LicenciasPage({ tecnicos, licencias, canCreate, canEdit, canDelete, onRegistrar, onSumar, onSetSaldo, onDelete }: {
  tecnicos: string[];
  licencias: LicenciasState;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onRegistrar: () => void;
  onSumar: () => void;
  onSetSaldo: (tecnico: string, key: SaldoKey, value: number) => void;
  onDelete: (m: LicMov) => void;
}) {
  const [view, setView] = useState<"gestion" | "calendario">("gestion");
  const [fTec, setFTec] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const registros = licencias.registros || [];
  const saldos = licencias.saldos || {};

  const enLicencia = tecnicos
    .map(t => ({ t, lic: licenciaHoy(registros, t) }))
    .filter((x): x is { t: string; lic: LicMov } => !!x.lic);

  const regs = [...registros]
    .filter(r => (!fTec || r.tecnico === fTec) && (!fTipo || (fTipo === "ajuste" ? r.tipo === "ajuste" : r.tipo === fTipo)))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  useEffect(() => { setPage(0); }, [fTec, fTipo, perPage]);
  const totalPages = Math.max(1, Math.ceil(regs.length / perPage));
  const curPage = Math.min(page, totalPages - 1);
  const pageRegs = regs.slice(curPage * perPage, curPage * perPage + perPage);
  const desde1 = regs.length === 0 ? 0 : curPage * perPage + 1;
  const hasta1 = Math.min(regs.length, curPage * perPage + perPage);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Acciones + cambio de vista */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {canCreate && (
          <button className="btn btnp" onClick={onRegistrar}>
            <Ico n="plus" s={15} c="#fff" /> Registrar licencia
          </button>
        )}
        {canEdit && (
          <button className="btn btns" onClick={onSumar}>
            <Ico n="calendar" s={15} /> Sumar días a saldos
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 0, border: "1px solid var(--bo)", borderRadius: "var(--r)", overflow: "hidden" }}>
          {([["gestion", "Gestión"], ["calendario", "Calendario"]] as const).map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontSize: 12, fontWeight: 700, padding: "7px 14px", border: "none", cursor: "pointer",
                background: view === v ? "var(--bl)" : "transparent",
                color: view === v ? "#fff" : "var(--t3)",
              }}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {view === "calendario" && <LicCalendar tecnicos={tecnicos} registros={registros} />}

      {view === "gestion" && (<>
      {/* Disponibilidad hoy */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          <Ico n="users" s={15} c="var(--bl)" />
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t)" }}>Disponibilidad de hoy</span>
          <span style={{ fontSize: 11, color: "var(--t3)" }}>{fmtFecha(hoyISO())}</span>
        </div>
        {enLicencia.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--em)", display: "flex", alignItems: "center", gap: 6 }}>
            <Ico n="check" s={14} c="var(--em)" /> Todo el personal disponible.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "var(--t3)", marginBottom: 8 }}>
              {enLicencia.length} de {tecnicos.length} técnico(s) de licencia hoy:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {enLicencia.map(({ t, lic }) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(244,63,94,.07)", border: "1px solid rgba(244,63,94,.25)", borderRadius: "var(--r)", padding: "7px 11px" }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: aColor(t), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{inits(t)}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t)" }}>{t}</div>
                    <div style={{ fontSize: 10.5, color: "var(--ro)" }}>{licTipoLabel(lic)} · regresa {fmtFecha(lic.hasta)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Saldos por técnico */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--bo)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="calendar" s={15} c="var(--em)" />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t)" }}>Saldos por técnico</span>
          </div>
          {canEdit && <span style={{ fontSize: 10.5, color: "var(--t3)" }}>Click en un valor para ajustarlo</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Técnico</th>
                {SALDO_KEYS.map(k => <th key={k} style={{ textAlign: "center" }}>{SALDO_LABELS[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {tecnicos.map(t => {
                const s = saldos[t] ?? emptySaldo();
                return (
                  <tr key={t}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: aColor(t), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{inits(t)}</div>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--t2)" }}>{t}</span>
                      </div>
                    </td>
                    {SALDO_KEYS.map(k => (
                      <td key={k} style={{ textAlign: "center" }}>
                        <SaldoCell value={s[k] ?? 0} editable={canEdit} onSet={v => onSetSaldo(t, k, v)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Registro de movimientos */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--bo)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="list" s={15} c="var(--bl)" />
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t)" }}>Historial de licencias y ajustes</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="inp" value={fTec} onChange={e => setFTec(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", width: "auto" }}>
              <option value="">Todos los técnicos</option>
              {tecnicos.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="inp" value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", width: "auto" }}>
              <option value="">Todos los tipos</option>
              {LIC_TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              <option value="ajuste">Ajuste de saldo</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Registrado</th>
                <th style={{ textAlign: "left" }}>Por</th>
                <th style={{ textAlign: "left" }}>Técnico</th>
                <th style={{ textAlign: "left" }}>Tipo</th>
                <th style={{ textAlign: "left" }}>Período</th>
                <th style={{ textAlign: "center" }}>Días</th>
                <th style={{ textAlign: "left" }}>Observación</th>
                {canDelete && <th></th>}
              </tr>
            </thead>
            <tbody>
              {regs.length === 0 ? (
                <tr><td colSpan={canDelete ? 8 : 7} style={{ textAlign: "center", padding: 22, color: "var(--t3)", fontSize: 12.5 }}>Sin registros.</td></tr>
              ) : pageRegs.map(r => {
                const ajuste = r.tipo === "ajuste";
                const contable = !ajuste && !!LIC_TIPO_MAP[r.tipo]?.saldo;
                const signo = ajuste ? (r.dias >= 0 ? "+" : "") : "−";
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11.5, color: "var(--t3)", whiteSpace: "nowrap" }}>
                      {fmtFecha((r.createdAt || "").slice(0, 10))}
                      {r.createdAt && <span style={{ color: "var(--t3)", opacity: 0.75, marginLeft: 5 }}>{new Date(r.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--t2)", whiteSpace: "nowrap" }}>{r.createdBy || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--t2)" }}>{r.tecnico}</td>
                    <td>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        color: ajuste ? "var(--bl)" : contable ? "var(--em)" : "var(--am)",
                        background: ajuste ? "rgba(59,130,246,.12)" : contable ? "rgba(16,185,129,.12)" : "rgba(245,158,11,.12)" }}>
                        {licTipoLabel(r)}{ajuste && r.saldoTipo ? ` · ${SALDO_LABELS[r.saldoTipo as SaldoKey]}` : ""}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5, color: "var(--t3)", whiteSpace: "nowrap" }}>{r.desde ? `${fmtFecha(r.desde)} → ${fmtFecha(r.hasta)}` : "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: ajuste ? (r.dias >= 0 ? "var(--em)" : "var(--ro)") : "var(--t2)" }}>
                      {signo}{Math.abs(r.dias)}
                    </td>
                    <td style={{ fontSize: 11.5, color: "var(--t3)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.observacion || "—"}</td>
                    {canDelete && (
                      <td style={{ textAlign: "right" }}>
                        <button className="btni" title="Eliminar registro" onClick={() => onDelete(r)}><Ico n="trash" s={14} c="var(--ro)" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {regs.length > 0 && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--bo)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--t3)" }}>
              <span>Líneas:</span>
              <select className="inp" value={perPage} onChange={e => setPerPage(Number(e.target.value))} style={{ fontSize: 12, padding: "4px 6px", width: "auto" }}>
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>{desde1}–{hasta1} de {regs.length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="btn btns" disabled={curPage <= 0} onClick={() => setPage(0)} title="Primera" style={{ padding: "5px 8px" }}>«</button>
              <button className="btn btns" disabled={curPage <= 0} onClick={() => setPage(curPage - 1)} title="Anterior" style={{ padding: "5px 8px" }}>‹</button>
              <span style={{ fontSize: 11.5, color: "var(--t2)", minWidth: 96, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>Hoja {curPage + 1} de {totalPages}</span>
              <button className="btn btns" disabled={curPage >= totalPages - 1} onClick={() => setPage(curPage + 1)} title="Siguiente" style={{ padding: "5px 8px" }}>›</button>
              <button className="btn btns" disabled={curPage >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Última" style={{ padding: "5px 8px" }}>»</button>
            </div>
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}

// ── RegistrarLicenciaModal ────────────────────────────────────
function RegistrarLicenciaModal({ tecnicos, saldos, onSave, onClose }: {
  tecnicos: string[];
  saldos: Record<string, Saldo>;
  onSave: (mov: Omit<LicMov, "id" | "createdAt" | "createdBy">) => void;
  onClose: () => void;
}) {
  const [tecnico, setTecnico] = useState(tecnicos[0] || "");
  const [tipo, setTipo] = useState("franco");
  const [tipoOtra, setTipoOtra] = useState("");
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [dias, setDias] = useState(1);
  const [diasManual, setDiasManual] = useState(false);
  const [obs, setObs] = useState("");

  useEffect(() => {
    if (!diasManual) setDias(diasEntre(desde, hasta));
  }, [desde, hasta, diasManual]);

  const info = LIC_TIPO_MAP[tipo];
  const saldoKey = info?.saldo ?? null;
  const curSaldo = saldoKey ? (saldos[tecnico]?.[saldoKey] ?? 0) : null;
  const nuevoSaldo = saldoKey != null && curSaldo != null ? round1(curSaldo - dias) : null;

  const valid = tecnico && desde && hasta && dias > 0 && (tipo !== "otra" || tipoOtra.trim());

  const submit = () => {
    if (!valid) return;
    onSave({
      tecnico, tipo,
      tipoOtra: tipo === "otra" ? tipoOtra.trim() : undefined,
      desde, hasta, dias, observacion: obs.trim(),
    });
  };

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 460 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="calendar" s={16} c="var(--em)" />
            <span className="mt">Registrar licencia</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="fg">
            <label className="fl">Técnico</label>
            <select className="inp" value={tecnico} onChange={e => setTecnico(e.target.value)}>
              {tecnicos.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="fg">
            <label className="fl">Tipo de licencia</label>
            <select className="inp" value={tipo} onChange={e => setTipo(e.target.value)}>
              {LIC_TIPOS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          {tipo === "otra" && (
            <div className="fg">
              <label className="fl">Detalle</label>
              <input className="inp" value={tipoOtra} onChange={e => setTipoOtra(e.target.value)} placeholder="Especificar motivo…" />
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">Desde</label>
              <input className="inp" type="date" value={desde} onChange={e => { setDesde(e.target.value); if (e.target.value > hasta) setHasta(e.target.value); }} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">Hasta</label>
              <input className="inp" type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
            </div>
            <div className="fg" style={{ width: 90 }}>
              <label className="fl">Días</label>
              <input className="inp" type="number" step="0.5" min="0" value={dias}
                onChange={e => { setDiasManual(true); setDias(parseFloat(e.target.value) || 0); }} />
            </div>
          </div>
          {saldoKey && (
            <div style={{ fontSize: 12, padding: "9px 11px", borderRadius: "var(--r)", background: "var(--bg3)", border: "1px solid var(--bo)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--t3)" }}>Saldo de {SALDO_LABELS[saldoKey]}</span>
              <span style={{ fontWeight: 700, color: "var(--t2)" }}>
                {curSaldo} <span style={{ color: "var(--t3)" }}>→</span> <span style={{ color: (nuevoSaldo ?? 0) < 0 ? "var(--ro)" : "var(--em)" }}>{nuevoSaldo}</span>
              </span>
            </div>
          )}
          <div className="fg">
            <label className="fl">Observación</label>
            <textarea className="inp" rows={2} value={obs} onChange={e => setObs(e.target.value)} placeholder="Opcional…" />
          </div>
        </div>
        <div className="mf">
          <button className="btn btng" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" disabled={!valid} onClick={submit}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

// ── SumarDiasModal ────────────────────────────────────────────
function SumarDiasModal({ tecnicos, onSave, onClose }: {
  tecnicos: string[];
  onSave: (saldoTipo: SaldoKey, dias: number, techs: string[], motivo: string) => void;
  onClose: () => void;
}) {
  const [saldoTipo, setSaldoTipo] = useState<SaldoKey>("vacaciones");
  const [dias, setDias] = useState(1);
  const [sel, setSel] = useState<string[]>([...tecnicos]);
  const [motivo, setMotivo] = useState("");

  const todos = sel.length === tecnicos.length;
  const toggleTodos = () => setSel(todos ? [] : [...tecnicos]);
  const toggle = (t: string) => setSel(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t]);
  const valid = dias !== 0 && sel.length > 0;

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 460 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="plus" s={16} c="var(--em)" />
            <span className="mt">Sumar días a saldos</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>
        <div className="mb" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">Saldo</label>
              <select className="inp" value={saldoTipo} onChange={e => setSaldoTipo(e.target.value as SaldoKey)}>
                {SALDO_KEYS.map(k => <option key={k} value={k}>{SALDO_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="fg" style={{ width: 110 }}>
              <label className="fl">Días (± )</label>
              <input className="inp" type="number" step="0.5" value={dias} onChange={e => setDias(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className="fg">
            <label className="fl">Motivo</label>
            <input className="inp" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: Renovación anual, acumulación de francos…" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span className="fl" style={{ margin: 0 }}>Técnicos ({sel.length})</span>
              <button type="button" className="btn btns" style={{ padding: "3px 9px", fontSize: 11 }} onClick={toggleTodos}>
                {todos ? "Quitar todos" : "Seleccionar todos"}
              </button>
            </div>
            <div className="tgrid" style={{ maxHeight: 180, overflowY: "auto" }}>
              {tecnicos.map(t => {
                const on = sel.includes(t);
                const col = aColor(t);
                return (
                  <button key={t} type="button" onClick={() => toggle(t)} className="tc"
                    style={{ borderColor: on ? col : "var(--bo)", background: on ? `${col}20` : "var(--bg3)" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: on ? col : "var(--bg4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: on ? "#fff" : "var(--t3)" }}>{inits(t)}</div>
                    <span style={{ color: on ? col : "var(--t2)" }}>{t}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mf">
          <button className="btn btng" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" disabled={!valid} onClick={() => valid && onSave(saldoTipo, round1(dias), sel, motivo.trim())}>
            Aplicar a {sel.length}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────
export default function App() {
  const queryClient = useQueryClient();
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [gpvList, setGpvList] = useState<GPVEntry[]>([]);
  const [tecnicos, setTecnicos] = useState<string[]>(DEFAULT_TECNICOS);
  const [layout, setLayout] = useState<LayoutState>({});
  const [licencias, setLicencias] = useState<LicenciasState>({ saldos: {}, registros: [] });
  const [licDel, setLicDel] = useState<LicMov | null>(null);
  const [licModal, setLicModal] = useState<null | "registrar" | "sumar">(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [collapsed, setCol] = useState(false);
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const [modal, setModal] = useState<{ type: string; item: Equipo | GPVEntry | null; canEdit?: boolean } | null>(null);
  const [modalE, setModalE] = useState<Equipo | null>(null);
  const [confirmState, setConfirm] = useState<{ source: string; item: Equipo | GPVEntry; msg: string } | null>(null);
  const [showTecModal, setShowTecModal] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedAtRef = useRef<string | null>(null);

  // ── Session / auth ──
  const { data: session, isLoading: sessionLoading } = useQuery({
    ...getGetCurrentUserQueryOptions(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const auth = !!session;
  const currentUser = (session as AuthSession | undefined)?.user;
  const { mutate: logout } = useLogout();

  const toast = useCallback((msg: string, type = "ok") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  const can = useCallback((module: ModuleId, action: PermAction): boolean => {
    const perms = (session as AuthSession | undefined)?.role?.permissions?.[module];
    return !!perms?.[action];
  }, [session]);

  const { data: apiState, isLoading: apiLoading, isFetching } = useQuery({
    ...getGetTallerStateQueryOptions(),
    enabled: auth,
    refetchInterval: auth ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
  const { mutate: saveToApi } = useSaveTallerState();

  const applyApiState = useCallback((s: TallerState | undefined) => {
    if (!s) return;
    setEquipos((s.equipos as Equipo[]).map(normalizeEquipo));
    setGpvList(s.gpvList as GPVEntry[]);
    setTecnicos((s.tecnicos as string[]).length > 0 ? s.tecnicos as string[] : DEFAULT_TECNICOS);
    setLayout((s.layout as unknown as LayoutState) ?? {});
    setLicencias(normLicencias(s.licencias as unknown as LicenciasState));
    lastAppliedAtRef.current = s.updatedAt ?? null;
  }, []);

  // Initial load
  useEffect(() => {
    if (!auth || !apiState || loaded) return;
    applyApiState(apiState);
    setLoaded(true);
  }, [auth, apiState, loaded, applyApiState]);

  // Background sync — only apply if server has newer data and no local edit is pending
  useEffect(() => {
    if (!auth || !apiState || !loaded) return;
    const newAt = apiState.updatedAt ?? null;
    if (!newAt || newAt === lastAppliedAtRef.current) return;
    if (saveTimerRef.current) return; // local edit pending — skip this cycle
    applyApiState(apiState);
  }, [auth, apiState, loaded, applyApiState]);

  useEffect(() => {
    if (!auth) setLoaded(false);
  }, [auth]);

  const loading = auth && (apiLoading || !loaded);

  const handleSaveError = useCallback((err: unknown) => {
    const status = (err as { status?: number })?.status;
    if (status === 401) {
      toast("Tu sesión expiró. Iniciá sesión nuevamente.", "err");
      queryClient.clear();
      return;
    }
    if (status === 409) {
      const conflict = (err as { data?: { current?: TallerState } })?.data;
      if (conflict?.current) {
        applyApiState(conflict.current);
        toast("Otro usuario guardó cambios. Se recargó la última versión.", "err");
      } else {
        toast("Conflicto al guardar. Recargá la página.", "err");
      }
      return;
    }
    toast("No se pudieron guardar los cambios. Reintentá.", "err");
  }, [toast, queryClient, applyApiState]);

  const save = useCallback((eq: Equipo[], gv: GPVEntry[], tecs?: string[], lay?: LayoutState, lic?: LicenciasState) => {
    const techList = tecs ?? tecnicos;
    const licData = lic ?? licencias;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      setLayout(cur => {
        const layoutToSave = lay ?? cur;
        saveToApi(
          { data: { equipos: eq as never[], gpvList: gv as never[], tecnicos: techList, layout: layoutToSave as never, licencias: licData as never, expectedUpdatedAt: lastAppliedAtRef.current } },
          {
            onSuccess: (res) => { lastAppliedAtRef.current = (res as TallerState)?.updatedAt ?? null; },
            onError: handleSaveError,
          },
        );
        return cur;
      });
    }, 600);
  }, [tecnicos, licencias, saveToApi, handleSaveError]);

  const upEq = (fn: ((p: Equipo[]) => Equipo[]) | Equipo[]) => {
    setEquipos(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      setGpvList(gv => { save(next, gv); return gv; });
      return next;
    });
  };
  const upGpv = (fn: ((p: GPVEntry[]) => GPVEntry[]) | GPVEntry[]) => {
    setGpvList(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      setEquipos(eq => { save(eq, next); return eq; });
      return next;
    });
  };

  const disp = equipos.filter(e => e.estado === ESTADO_DISP);
  const enTallerCnt = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado)).length;
  const gpvAlertaCnt = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) >= 0 && dGPV(g.fechaEntrega) <= 15).length;

  const saveTaller = (form: Partial<Equipo>) => {
    if (!(modal?.canEdit ?? false)) { toast("No tenés permiso para esta acción", "err"); return; }
    if ((modal as any)?.item) {
      upEq(p => p.map(e => e.id === (modal as any).item.id ? { ...(modal as any).item, ...form } : e));
      toast("Actualizado", "inf");
    } else {
      upEq(p => [{ ...form, id: Date.now() } as Equipo, ...p]);
      toast("Ingreso registrado");
    }
    setModal(null);
  };

  const handleListo = (eq: Equipo) => {
    if (!can("taller", "edit")) { toast("No tenés permiso para esta acción", "err"); return; }
    if (eq.destino === "venta") {
      upEq(p => p.map(e => e.id === eq.id ? { ...e, estado: ESTADO_DISP, enVentaDesde: new Date().toISOString().slice(0, 10) } : e));
      toast(`${eq.modelo} → disponibles`);
    } else if (window.confirm(`¿Confirmar entrega de ${eq.modelo}?`)) {
      upEq(p => p.filter(e => e.id !== eq.id));
      toast(`${eq.modelo} entregado`, "inf");
    }
  };

  const confirmarEntrega = (fecha: string, cliente: string) => {
    if (!can("venta", "edit")) { toast("No tenés permiso para esta acción", "err"); return; }
    const eq = modalE!;
    const nE = equipos.filter(e => e.id !== eq.id);
    const nG: GPVEntry[] = [{ id: Date.now(), modelo: eq.modelo, interno: eq.interno, cliente, fechaEntrega: fecha, observacion: eq.observacion, estado: ESTADO_VEND }, ...gpvList];
    setEquipos(nE); setGpvList(nG); save(nE, nG);
    toast(`${eq.modelo} — GPV iniciada`);
    setModalE(null);
  };

  const saveGPV = (form: Partial<GPVEntry>) => {
    if (!(modal?.canEdit ?? false)) { toast("No tenés permiso para esta acción", "err"); return; }
    if ((modal as any)?.item) {
      upGpv(g => g.map(x => x.id === (modal as any).item.id ? { ...(modal as any).item, ...form } : x));
      toast("GPV actualizada", "inf");
    } else {
      upGpv(g => [{ ...form, id: Date.now() } as GPVEntry, ...g]);
      toast("Venta registrada");
    }
    setModal(null);
  };

  const doDelete = () => {
    const { source, item } = confirmState!;
    const allowed = source === "eq" ? can("taller", "delete") : can("venta", "delete");
    if (!allowed) { toast("No tenés permiso para esta acción", "err"); setConfirm(null); return; }
    if (source === "eq") upEq(p => p.filter(e => e.id !== (item as Equipo).id));
    else upGpv(g => g.filter(x => x.id !== (item as GPVEntry).id));
    toast(`"${item.modelo}" eliminado`, "err");
    setConfirm(null);
  };

  const saveTecnicos = (newTecs: string[]) => {
    setTecnicos(newTecs);
    setEquipos(prev => {
      setGpvList(gv => { save(prev, gv, newTecs); return gv; });
      return prev;
    });
    toast("Lista de técnicos actualizada", "inf");
  };

  // ── Licencias handlers ──
  const licUser = currentUser?.nombre || currentUser?.username || "—";
  const enLicenciaHoy = new Set(tecnicos.filter(t => licenciaHoy(licencias.registros, t)));

  const saveLicencias = (newLic: LicenciasState) => {
    setLicencias(newLic);
    setEquipos(eq => { setGpvList(gv => { save(eq, gv, undefined, undefined, newLic); return gv; }); return eq; });
  };

  const registrarLicencia = (mov: Omit<LicMov, "id" | "createdAt" | "createdBy">) => {
    if (!can("licencias", "create")) { toast("No tenés permiso para esta acción", "err"); return; }
    const full: LicMov = { ...mov, id: newLicId(), createdAt: new Date().toISOString(), createdBy: licUser };
    const saldos = { ...licencias.saldos };
    const info = LIC_TIPO_MAP[mov.tipo];
    if (info?.saldo) {
      const cur = saldos[mov.tecnico] ?? emptySaldo();
      saldos[mov.tecnico] = { ...cur, [info.saldo]: round1((cur[info.saldo] ?? 0) - mov.dias) };
    }
    saveLicencias({ saldos, registros: [full, ...licencias.registros] });
    toast("Licencia registrada");
  };

  const sumarDias = (saldoTipo: SaldoKey, dias: number, techs: string[], motivo: string) => {
    if (!can("licencias", "edit")) { toast("No tenés permiso para esta acción", "err"); return; }
    const saldos = { ...licencias.saldos };
    const nuevos: LicMov[] = [];
    const now = new Date().toISOString();
    techs.forEach((t, i) => {
      const cur = saldos[t] ?? emptySaldo();
      saldos[t] = { ...cur, [saldoTipo]: round1((cur[saldoTipo] ?? 0) + dias) };
      nuevos.push({ id: newLicId() + i, tecnico: t, tipo: "ajuste", saldoTipo, dias, observacion: motivo || `Ajuste de ${SALDO_LABELS[saldoTipo]}`, createdAt: now, createdBy: licUser });
    });
    saveLicencias({ saldos, registros: [...nuevos, ...licencias.registros] });
    toast(`${dias > 0 ? "+" : ""}${dias} día(s) de ${SALDO_LABELS[saldoTipo]} · ${techs.length} técnico(s)`);
  };

  const setSaldoDirecto = (tecnico: string, key: SaldoKey, value: number) => {
    if (!can("licencias", "edit")) { toast("No tenés permiso para esta acción", "err"); return; }
    const saldos = { ...licencias.saldos };
    const cur = saldos[tecnico] ?? emptySaldo();
    const prev = cur[key] ?? 0;
    if (prev === value) return;
    saldos[tecnico] = { ...cur, [key]: value };
    const mov: LicMov = { id: newLicId(), tecnico, tipo: "ajuste", saldoTipo: key, dias: round1(value - prev), observacion: "Ajuste manual de saldo", createdAt: new Date().toISOString(), createdBy: licUser };
    saveLicencias({ saldos, registros: [mov, ...licencias.registros] });
  };

  const deleteLicencia = (mov: LicMov) => {
    if (!can("licencias", "delete")) { toast("No tenés permiso para esta acción", "err"); return; }
    const saldos = { ...licencias.saldos };
    const cur = saldos[mov.tecnico] ?? emptySaldo();
    if (mov.tipo === "ajuste" && mov.saldoTipo) {
      saldos[mov.tecnico] = { ...cur, [mov.saldoTipo]: round1((cur[mov.saldoTipo as SaldoKey] ?? 0) - mov.dias) };
    } else {
      const info = LIC_TIPO_MAP[mov.tipo];
      if (info?.saldo) saldos[mov.tecnico] = { ...cur, [info.saldo]: round1((cur[info.saldo] ?? 0) + mov.dias) };
    }
    saveLicencias({ saldos, registros: licencias.registros.filter(r => r.id !== mov.id) });
    setLicDel(null);
    toast("Registro eliminado", "inf");
  };

  const allNavItems = [
    { id: "dashboard", label: "Dashboard",  icon: "dashboard" },
    { id: "taller",    label: "Taller",     icon: "wrench",   count: enTallerCnt },
    { id: "venta",     label: "Venta/GPV",  icon: "tag",      alert: gpvAlertaCnt, count: gpvList.length + disp.length },
    { id: "kpis",      label: "KPIs",       icon: "kpi" },
    { id: "layout",    label: "Layout",     icon: "bar" },
    { id: "tecnicos",  label: "Técnicos",   icon: "users",    count: tecnicos.length },
    { id: "licencias", label: "Licencias",  icon: "calendar", count: enLicenciaHoy.size || undefined },
    { id: "admin",     label: "Administración", icon: "shield" },
  ];
  const navItems = allNavItems.filter(n => can(n.id as ModuleId, "view"));
  const titles: Record<string, [string, string]> = {
    dashboard: ["Dashboard", "Resumen general"],
    licencias: ["Licencias", "Saldos y disponibilidad del personal"],
    taller:    ["Taller", "Equipos en reparación"],
    venta:     ["Venta / GPV", "Disponibles · Garantía por venta"],
    kpis:      ["KPIs — Equipos", "Indicadores de rendimiento operativo"],
    layout:    ["Layout del Taller", "Mapa visual de posiciones"],
    tecnicos:  ["Técnicos", "Gestión del equipo"],
    admin:     ["Administración", "Usuarios, roles y permisos"],
  };

  // Keep the active tab valid for the current user's permissions
  useEffect(() => {
    if (!auth) return;
    const viewable = allNavItems.filter(n => n.id !== "tecnicos" && can(n.id as ModuleId, "view")).map(n => n.id);
    if (viewable.length && !viewable.includes(tab)) setTab(viewable[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, session, tab]);

  const handleLogin = () => {
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryOptions().queryKey });
  };

  const handleLogout = () => {
    logout(undefined, {
      onSettled: () => {
        setLoaded(false);
        queryClient.clear();
      },
    });
  };

  return (
    <div className="app">
      <style>{CSS}</style>

      {!auth && sessionLoading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 10, color: "var(--t3)", fontSize: 14 }}>
          <Ico n="wrench" s={18} c="var(--t3)" />Verificando sesión…
        </div>
      )}

      {!auth && !sessionLoading && <Login onLogin={handleLogin} />}

      {auth && loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", gap: 10, color: "var(--t3)", fontSize: 14 }}>
          <Ico n="wrench" s={18} c="var(--t3)" />Cargando datos…
        </div>
      )}

      {auth && !loading && (
        <div className="shell">
          <aside className={`sidebar ${collapsed ? "col" : ""}`}>
            <div className="sbhd">
              {!collapsed && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t)" }}>Gestión de activos</div>
                  <div style={{ fontSize: 10, color: "var(--t3)" }}>Movimiento de Suelo</div>
                </div>
              )}
              <button className="btni" style={{ marginLeft: "auto" }} onClick={() => setCol(c => !c)}>
                <Ico n={collapsed ? "chevR" : "chevL"} s={15} />
              </button>
            </div>

            <nav className="sbnav">
              {!collapsed && <div className="sblbl">Módulos</div>}
              {navItems.map(n => (
                <div key={n.id} className={`ni ${tab === n.id ? "act" : ""}`} onClick={() => {
                  if (n.id === "tecnicos") setShowTecModal(true);
                  else setTab(n.id);
                }}>
                  <Ico n={n.icon} s={17} c={tab === n.id ? "var(--em)" : "var(--t3)"} />
                  {!collapsed && <span className="nilbl">{n.label}</span>}
                  {!collapsed && (n as any).alert > 0 && <span className="na">{(n as any).alert}</span>}
                  {!collapsed && !((n as any).alert) && n.count !== undefined && <span className="nb">{n.count}</span>}
                </div>
              ))}
            </nav>

            <div className="sbft">
              {!collapsed ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser?.nombre || currentUser?.username || "Usuario"}</div>
                    <div style={{ fontSize: 10, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser?.roleName || "—"}</div>
                  </div>
                  <button className="btni" title="Cerrar sesión" onClick={handleLogout}><Ico n="logout" s={15} /></button>
                </div>
              ) : (
                <button className="btni" title="Cerrar sesión" onClick={handleLogout}><Ico n="logout" s={15} /></button>
              )}
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t)" }}>{titles[tab]?.[0] ?? ""}</div>
                <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 1 }}>{titles[tab]?.[1] ?? ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isFetching && !apiLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }} title="Sincronizando con el servidor…">
                    <div className="sync-dot" />
                    <span style={{ fontSize: 10, color: "var(--t3)" }}>sync</span>
                  </div>
                )}
                <GlobalSearch
                  equipos={equipos}
                  onOpen={m => setModal({ type: "taller", item: m, canEdit: can("taller", "edit") })}
                />
              </div>
            </header>

            <main className="content">
              {tab === "dashboard" && <Dashboard equipos={equipos} gpvList={gpvList} tecnicos={tecnicos} enLicencia={enLicenciaHoy} />}
              {tab === "kpis" && <KPIsPage equipos={equipos} gpvList={gpvList} tecnicos={tecnicos} onOpenEquipo={m => setModal({ type: "taller", item: m, canEdit: can("taller", "edit") })} />}
              {tab === "layout" && (
                <LayoutPage
                  equipos={equipos}
                  layout={layout}
                  canEdit={can("layout", "edit")}
                  onUpdateLayout={nl => { setLayout(nl); setEquipos(eq => { setGpvList(gv => { save(eq, gv, undefined, nl); return gv; }); return eq; }); }}
                  onOpenEquipo={m => setModal({ type: "taller", item: m, canEdit: can("taller", "edit") })}
                />
              )}
              {tab === "taller" && (
                <TallerPage
                  equipos={equipos}
                  search={search}
                  tecnicos={tecnicos}
                  canCreate={can("taller", "create")}
                  canEdit={can("taller", "edit")}
                  canDelete={can("taller", "delete")}
                  onAdd={() => setModal({ type: "taller", item: null, canEdit: can("taller", "create") })}
                  onEdit={m => setModal({ type: "taller", item: m, canEdit: can("taller", "edit") })}
                  onDelete={m => setConfirm({ source: "eq", item: m, msg: `Eliminará "${m.modelo}" del taller.` })}
                  onListo={handleListo}
                />
              )}
              {tab === "venta" && (
                <VentaPage
                  disponibles={disp}
                  gpvList={gpvList}
                  search={search}
                  canCreate={can("venta", "create")}
                  canEdit={can("venta", "edit")}
                  canDelete={can("venta", "delete")}
                  onEntrega={m => setModalE(m)}
                  onEditDisp={m => setModal({ type: "taller", item: m, canEdit: can("venta", "edit") })}
                  onEditGPV={g => setModal({ type: "gpv", item: g, canEdit: can("venta", "edit") })}
                  onDeleteGPV={g => setConfirm({ source: "gpv", item: g, msg: `Eliminará "${g.modelo}" del registro GPV.` })}
                  onAddGPV={() => setModal({ type: "gpv", item: null, canEdit: can("venta", "create") })}
                />
              )}
              {tab === "licencias" && (
                <LicenciasPage
                  tecnicos={tecnicos}
                  licencias={licencias}
                  canCreate={can("licencias", "create")}
                  canEdit={can("licencias", "edit")}
                  canDelete={can("licencias", "delete")}
                  onRegistrar={() => setLicModal("registrar")}
                  onSumar={() => setLicModal("sumar")}
                  onSetSaldo={setSaldoDirecto}
                  onDelete={m => setLicDel(m)}
                />
              )}
              {tab === "admin" && <AdminPage can={can} toast={toast} currentUserId={currentUser?.id ?? null} />}
              <Toasts toasts={toasts} />
            </main>

            {modal?.type === "taller" && (
              <TallerModal
                item={modal.item as Equipo | null}
                allEquipos={equipos}
                onSave={saveTaller}
                onClose={() => setModal(null)}
                tecnicos={tecnicos}
                canEdit={modal.canEdit ?? false}
                enLicencia={enLicenciaHoy}
              />
            )}
            {modal?.type === "gpv" && <ModalGPV item={modal.item as GPVEntry | null} onSave={saveGPV} onClose={() => setModal(null)} canEdit={modal.canEdit ?? false} />}
            {modalE && <ModalEntrega equipo={modalE} onConfirm={confirmarEntrega} onClose={() => setModalE(null)} />}
            {confirmState && <Confirm msg={confirmState.msg} onOk={doDelete} onCancel={() => setConfirm(null)} />}
            {showTecModal && <TecnicosModal tecnicos={tecnicos} onSave={saveTecnicos} onClose={() => setShowTecModal(false)} canEdit={can("tecnicos", "edit")} />}
            {licModal === "registrar" && (
              <RegistrarLicenciaModal
                tecnicos={tecnicos}
                saldos={licencias.saldos}
                onSave={mov => { registrarLicencia(mov); setLicModal(null); }}
                onClose={() => setLicModal(null)}
              />
            )}
            {licModal === "sumar" && (
              <SumarDiasModal
                tecnicos={tecnicos}
                onSave={(st, d, ts, m) => { sumarDias(st, d, ts, m); setLicModal(null); }}
                onClose={() => setLicModal(null)}
              />
            )}
            {licDel && (
              <Confirm
                msg={`Se eliminará el registro de ${licTipoLabel(licDel)} de ${licDel.tecnico}. Si afectaba un saldo, se revertirá.`}
                onOk={() => deleteLicencia(licDel)}
                onCancel={() => setLicDel(null)}
              />
            )}
          </div>

          <nav className="mobnav">
            {navItems.filter(n => n.id !== "tecnicos" && n.id !== "admin").map(n => (
              <button
                key={n.id}
                className={`mobnav-item${tab === n.id ? " act" : ""}`}
                onClick={() => setTab(n.id)}
              >
                <Ico n={n.icon} s={20} c={tab === n.id ? "var(--em)" : "var(--t3)"} />
                <span>{n.label.split("/")[0].trim()}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
