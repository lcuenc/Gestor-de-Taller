import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGetTallerStateQueryOptions, useSaveTallerState } from "@workspace/api-client-react";

const PASSWORD = "Movimiento2026*";

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
  sortAsc:   "M3 6h18M7 12h10M11 18h4",
  sortDesc:  "M3 18h18M7 12h10M11 6h4",
  sort:      "M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4",
  pencil:    "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
  bar:       "M18 20V10M12 20V4M6 20v-6",
  sync:      "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  kpi:       "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
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
function TecSelector({ selected, onChange, ocupados, tecnicos }: {
  selected: string[];
  onChange: (v: string[]) => void;
  ocupados: Record<string, number>;
  tecnicos: string[];
}) {
  const disp = tecnicos.filter(t => !ocupados[t]);
  const ocup = tecnicos.filter(t => ocupados[t]);
  const toggle = (t: string) => onChange(selected.includes(t) ? selected.filter(x => x !== t) : [...selected, t]);

  function Chip({ t }: { t: string }) {
    const sel = selected.includes(t);
    const jobs = ocupados[t] || 0;
    const busy = jobs > 0;
    const col = aColor(t);
    return (
      <button type="button" onClick={() => toggle(t)} className="tc"
        style={{
          borderColor: sel ? col : busy ? "rgba(245,158,11,.3)" : "var(--bo)",
          background:  sel ? `${col}20` : busy ? "rgba(245,158,11,.06)" : "var(--bg3)",
        }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: sel ? col : "var(--bg4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: sel ? "#fff" : "var(--t3)", flexShrink: 0 }}>{inits(t)}</div>
        <span style={{ color: sel ? col : busy ? "var(--am)" : "var(--t2)" }}>{t}</span>
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
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  const tryLogin = () => {
    if (pw === PASSWORD) { setErr(false); onLogin(); }
    else { setErr(true); setPw(""); }
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
              <Ico n="lock" s={11} c="var(--t3)" />Contraseña de acceso
            </label>
            <input
              className="fi" type="password" value={pw} placeholder="••••••••••••"
              onChange={e => { setPw(e.target.value); setErr(false); }}
              onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            />
            {err && (
              <div className="lerr">
                <Ico n="alert" s={13} c="var(--ro)" />Contraseña incorrecta
              </div>
            )}
          </div>
          <button className="btn btnp" style={{ justifyContent: "center", marginTop: 4 }} onClick={tryLogin}>
            <Ico n="arrowR" s={15} c="#fff" />Ingresar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TallerModal ───────────────────────────────────────────────
function TallerModal({ item, allEquipos, onSave, onClose, tecnicos }: {
  item: Equipo | null;
  allEquipos: Equipo[];
  onSave: (f: Partial<Equipo>) => void;
  onClose: () => void;
  tecnicos: string[];
}) {
  const [form, setForm] = useState<Partial<Equipo>>(item || {
    destino: "alquiler", modelo: "", interno: "", accesorio: "", cliente: "",
    fechaIngreso: new Date().toISOString().slice(0, 10),
    falla: "", estado: "A inspeccionar", tecnicos: [], observacion: "", prioridad: "ninguna",
  });
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const ocup = buildOcup(allEquipos, item?.id ?? null);
  const estados = form.destino === "venta" ? [...ESTADOS_TALLER, ESTADO_LISTO] : ESTADOS_TALLER;

  return (
    <div className="overlay">
      <div className="modal">
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="wrench" s={15} c="var(--em)" />
            <span className="mt">{item ? "Editar equipo" : "Registrar ingreso"}</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>

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
            <TecSelector selected={form.tecnicos || []} onChange={v => set("tecnicos", v)} ocupados={ocup} tecnicos={tecnicos} />
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

        <div className="mf">
          <button className="btn btns" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={() => { if (!form.modelo?.trim()) return; onSave(form); }}>
            <Ico n="save" s={14} c="#fff" />{item ? "Guardar" : "Registrar"}
          </button>
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
function ModalGPV({ item, onSave, onClose }: { item: GPVEntry | null; onSave: (f: Partial<GPVEntry>) => void; onClose: () => void }) {
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
          <button className="btn btns" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={() => { if (!form.modelo?.trim()) return; onSave({ ...form, estado: ESTADO_VEND }); }}>
            <Ico n="save" s={14} c="#fff" />{item ? "Guardar" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TecnicosModal ─────────────────────────────────────────────
function TecnicosModal({ tecnicos, onSave, onClose }: {
  tecnicos: string[];
  onSave: (t: string[]) => void;
  onClose: () => void;
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
      <div className="modal" style={{ width: 500 }}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Ico n="users" s={15} c="var(--te)" />
            <span className="mt">Gestión de técnicos</span>
          </div>
          <button className="btni" onClick={onClose}><Ico n="x" s={15} /></button>
        </div>

        <div className="mb">
          <div style={{ background: "var(--bg3)", border: "1px solid var(--bo)", borderRadius: "var(--r)", padding: "10px 12px" }}>
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

          <div className="tw" style={{ marginTop: 4 }}>
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
                  <button className="btni" onClick={() => startEdit(i)} title="Editar"><Ico n="edit" s={14} /></button>
                  <button className="btni" onClick={() => setConfirmDel(i)} title="Eliminar"><Ico n="trash" s={14} c="var(--ro)" /></button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mf">
          <button className="btn btns" onClick={onClose}>Cancelar</button>
          <button className="btn btnp" onClick={() => { onSave(list); onClose(); }}>
            <Ico n="save" s={14} c="#fff" />Guardar lista
          </button>
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
function Dashboard({ equipos, gpvList, tecnicos }: { equipos: Equipo[]; gpvList: GPVEntry[]; tecnicos: string[] }) {
  const enT = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado));
  const disp = equipos.filter(e => e.estado === ESTADO_DISP);
  const gpvV = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0);
  const gpvA = gpvV.filter(g => dGPV(g.fechaEntrega) <= 15);
  const gpvVn = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) <= 0);
  const cE = (s: string) => equipos.filter(e => e.estado === s).length;
  const ocup = buildOcup(equipos);
  const topT = tecnicos.map(t => ({ t, j: ocup[t] || 0 })).filter(x => x.j > 0).sort((a, b) => b.j - a.j).slice(0, 5);
  const libres = tecnicos.filter(t => !ocup[t]);

  const stats = [
    { l: "En taller",         v: enT.length,                               c: "var(--bl)" },
    { l: "Disponibles venta", v: disp.length,                              c: "var(--pu)" },
    { l: "GPV vigentes",      v: gpvV.length,                              c: "var(--em)" },
    { l: "GPV por vencer",    v: gpvA.length,                              c: "var(--am)" },
    { l: "GPV vencidas",      v: gpvVn.length,                             c: "var(--ro)" },
    { l: "Técnicos libres",   v: tecnicos.length - Object.keys(ocup).length, c: "var(--te)" },
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
function TallerPage({ equipos, onAdd, onEdit, onDelete, onListo, search, tecnicos }: {
  equipos: Equipo[];
  onAdd: () => void;
  onEdit: (m: Equipo) => void;
  onDelete: (m: Equipo) => void;
  onListo: (m: Equipo) => void;
  search: string;
  tecnicos: string[];
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

  return (
    <div>
      <div className="sh">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t)" }}>Taller de reparaciones</div>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 1 }}>{sorted.length} equipo{sorted.length !== 1 ? "s" : ""}</div>
        </div>
        <button className="btn btnp" onClick={onAdd}><Ico n="plus" s={14} c="#fff" />Registrar ingreso</button>
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
                <th {...thProps("prioridad")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>Prior. <SortIcon col="prioridad" sortCol={sortCol} sortDir={sortDir} /></div>
                </th>
                <th>Obs.</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!sorted.length ? (
                <tr><td colSpan={11}><div className="empty">No hay equipos</div></td></tr>
              ) : sorted.map(m => {
                const dias = dDesde(m.fechaIngreso);
                const largo = ESTADOS_ACTIVOS.has(m.estado) && dias > 14;
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
                    <td><span style={{ fontSize: 13, fontWeight: 700, color: largo ? "var(--am)" : "var(--t3)" }}>{dias}d</span></td>
                    <td>
                      {m.prioridad === "rojo" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "rgba(239,68,68,.12)", color: "var(--ro)", border: "1px solid rgba(239,68,68,.2)", fontWeight: 700 }}>Alta</span>}
                      {m.prioridad === "amarillo" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 99, background: "rgba(245,158,11,.12)", color: "var(--am)", border: "1px solid rgba(245,158,11,.2)", fontWeight: 700 }}>Media</span>}
                      {m.prioridad === "ninguna" && <span style={{ color: "var(--t3)", fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ maxWidth: 140, fontSize: 11, color: "var(--t3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.observacion || "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}>
                        <button className="btni" onClick={() => onEdit(m)}><Ico n="edit" s={14} /></button>
                        {m.estado === ESTADO_LISTO && m.destino === "venta" && (
                          <button className="btn btnb" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onListo(m)}>
                            <Ico n="arrowR" s={12} c="var(--bl)" />Disp.
                          </button>
                        )}
                        {m.estado === ESTADO_LISTO && m.destino === "alquiler" && (
                          <button className="btn btnp" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => onListo(m)}>
                            <Ico n="check" s={12} c="#fff" />Entrega
                          </button>
                        )}
                        <button className="btni" onClick={() => onDelete(m)}><Ico n="trash" s={14} c="var(--ro)" /></button>
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
function VentaPage({ disponibles, gpvList, onEntrega, onEditGPV, onDeleteGPV, onAddGPV, search }: {
  disponibles: Equipo[];
  gpvList: GPVEntry[];
  onEntrega: (m: Equipo) => void;
  onEditGPV: (g: GPVEntry) => void;
  onDeleteGPV: (g: GPVEntry) => void;
  onAddGPV: () => void;
  search: string;
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
      <div className="sh">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t)" }}>Venta / GPV</div>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 1 }}>Disponibles · Garantía por venta</div>
        </div>
        <button className="btn btnp" onClick={onAddGPV}><Ico n="plus" s={14} c="#fff" />Registrar venta</button>
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
                  <th>Equipo</th><th>Accesorio</th><th>Falla/Trabajo</th><th>Obs.</th><th style={{ textAlign: "right" }}>Acciones</th>
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
                    <td style={{ fontSize: 12, color: "var(--t2)" }}>{m.falla || "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--t3)", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.observacion || "—"}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 3 }}>
                        <button className="btn btnp" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => onEntrega(m)}>
                          <Ico n="truck" s={12} c="#fff" />Entregar
                        </button>
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
                        <button className="btni" onClick={() => onEditGPV(g)}><Ico n="edit" s={14} /></button>
                        <button className="btni" onClick={() => onDeleteGPV(g)}><Ico n="trash" s={14} c="var(--ro)" /></button>
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

function KPIsPage({ equipos, gpvList }: { equipos: Equipo[]; gpvList: GPVEntry[] }) {
  const activos = equipos.filter(e => ESTADOS_ACTIVOS.has(e.estado));
  const total = equipos.length;

  const byEstado = [...ESTADOS_TALLER, ESTADO_LISTO].map(s => ({
    s, count: equipos.filter(e => e.estado === s).length,
    color: ST[s]?.color || "var(--t3)",
  }));
  const maxByEstado = Math.max(1, ...byEstado.map(x => x.count));

  const alquiler = activos.filter(e => e.destino === "alquiler").length;
  const venta    = activos.filter(e => e.destino === "venta").length;
  const totalA   = alquiler + venta || 1;

  const prioRojo     = activos.filter(e => e.prioridad === "rojo").length;
  const prioAmarillo = activos.filter(e => e.prioridad === "amarillo").length;
  const prioNinguna  = activos.filter(e => e.prioridad === "ninguna" || !e.prioridad).length;

  const ageBuckets = [
    { label: "0-7 días",   count: activos.filter(e => dDesde(e.fechaIngreso) < 7).length,                                              color: "#10b981" },
    { label: "7-14 días",  count: activos.filter(e => dDesde(e.fechaIngreso) >= 7  && dDesde(e.fechaIngreso) < 14).length,             color: "#3b82f6" },
    { label: "14-30 días", count: activos.filter(e => dDesde(e.fechaIngreso) >= 14 && dDesde(e.fechaIngreso) < 30).length,             color: "#f59e0b" },
    { label: "+30 días",   count: activos.filter(e => dDesde(e.fechaIngreso) >= 30).length,                                            color: "#ef4444" },
  ];
  const maxAge = Math.max(1, ...ageBuckets.map(b => b.count));

  const avgTotal = activos.length
    ? Math.round(activos.reduce((a, e) => a + dDesde(e.fechaIngreso), 0) / activos.length)
    : 0;

  const bottlenecks = [...activos]
    .sort((a, b) => dDesde(b.fechaIngreso) - dDesde(a.fechaIngreso))
    .slice(0, 6);

  const modelMap: Record<string, number> = {};
  activos.forEach(e => { modelMap[e.modelo] = (modelMap[e.modelo] || 0) + 1; });
  const topModels = Object.entries(modelMap).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxModel = Math.max(1, ...topModels.map(([, c]) => c));

  const gpvVigentes   = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0).length;
  const gpvPorVencer  = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) > 0 && dGPV(g.fechaEntrega) <= 15).length;
  const gpvVencidas   = gpvList.filter(g => g.fechaEntrega && dGPV(g.fechaEntrega) <= 0).length;
  const gpvTotal      = gpvList.length;

  const avgByEstado = [...ESTADOS_TALLER, ESTADO_LISTO].map(s => {
    const items = equipos.filter(e => e.estado === s && e.fechaIngreso);
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

  return (
    <div>
      <div className="sh">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--t)" }}>KPIs — Equipos</div>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 1 }}>Indicadores de rendimiento operativo · {total} equipo{total !== 1 ? "s" : ""} registrados</div>
        </div>
      </div>

      <div className="kpi-grid">
        <Card val={activos.length} lbl="En proceso de reparación" color="var(--bl)" />
        <Card val={avgTotal + "d"} lbl="Promedio de días en taller" color={avgTotal > 20 ? "var(--ro)" : avgTotal > 10 ? "var(--am)" : "var(--em)"} />
        <Card val={prioRojo} lbl="Prioridad alta (urgentes)" color="var(--ro)" sub={prioRojo > 0 ? "Requieren atención" : "Sin urgentes ✓"} />
        <Card val={gpvPorVencer} lbl="GPV próximas a vencer" color={gpvPorVencer > 0 ? "var(--am)" : "var(--em)"} sub={`de ${gpvTotal} en cartera`} />
        <Card val={gpvVencidas} lbl="GPV vencidas" color={gpvVencidas > 0 ? "var(--ro)" : "var(--t3)"} />
        <Card val={`${alquiler}/${venta}`} lbl="Alquiler / Venta activos" color="var(--pu)" sub={venta > 0 ? `${Math.round(venta/totalA*100)}% venta` : "100% alquiler"} />
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
                <span style={{ fontSize: 12, color: "var(--t2)", width: 90, flexShrink: 0 }}>{label}</span>
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
              { label: "Alta", count: prioRojo, color: "var(--ro)", bg: "rgba(239,68,68,.1)" },
              { label: "Media", count: prioAmarillo, color: "var(--am)", bg: "rgba(245,158,11,.1)" },
              { label: "Sin prioridad", count: prioNinguna, color: "var(--t3)", bg: "var(--bg3)" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: "var(--r)", background: bg }}>
                <span style={{ fontSize: 12, color: "var(--t2)" }}>{label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tw">
          <div className="th"><Ico n="shield" s={14} c="var(--em)" /><span className="tt">GPV / Garantías</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Vigentes", count: gpvVigentes - gpvPorVencer, color: "var(--em)", bg: "rgba(16,185,129,.08)" },
              { label: "Por vencer ≤15d", count: gpvPorVencer, color: "var(--am)", bg: "rgba(245,158,11,.08)" },
              { label: "Vencidas", count: gpvVencidas, color: "var(--ro)", bg: "rgba(239,68,68,.08)" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: "var(--r)", background: bg }}>
                <span style={{ fontSize: 12, color: "var(--t2)" }}>{label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color }}>{count}</span>
              </div>
            ))}
            {gpvTotal === 0 && <div className="empty" style={{ padding: 8 }}>Sin registros GPV</div>}
          </div>
        </div>

        <div className="tw">
          <div className="th"><Ico n="truck" s={14} c="var(--pu)" /><span className="tt">Destino activos</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Alquiler / Flota", count: alquiler, color: "var(--bl)", pct: Math.round(alquiler / totalA * 100) },
              { label: "Venta de usado",   count: venta,    color: "var(--pu)", pct: Math.round(venta    / totalA * 100) },
            ].map(({ label, count, color, pct }) => (
              <div key={label} style={{ background: "var(--bg3)", borderRadius: "var(--r)", padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--t2)" }}>{label}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color }}>{count}</span>
                </div>
                <div style={{ height: 5, background: "var(--bo)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99 }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 4 }}>{pct}% del total activo</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid22">
        <div className="tw">
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

        <div className="tw">
          <div className="th"><Ico n="kpi" s={14} c="var(--am)" /><span className="tt">Cuellos de botella</span><span style={{ marginLeft: "auto", fontSize: 10, color: "var(--t3)" }}>más tiempo en taller</span></div>
          {bottlenecks.length === 0 ? <div className="empty">Sin equipos activos</div> : bottlenecks.map((m, i) => {
            const dias = dDesde(m.fechaIngreso);
            const col = dias > 30 ? "var(--ro)" : dias > 14 ? "var(--am)" : "var(--t2)";
            const st = ST[m.estado] || {};
            return (
              <div key={m.id} className="ri">
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

      {topModels.length > 0 && (
        <div className="tw" style={{ marginTop: 14 }}>
          <div className="th"><Ico n="tag" s={14} c="var(--bl)" /><span className="tt">Modelos con mayor presencia</span><span style={{ marginLeft: "auto", fontSize: 10, color: "var(--t3)" }}>equipos activos en taller</span></div>
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

// ── Root App ──────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return sessionStorage.getItem("mds_auth") === "1"; } catch { return false; }
  });
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [gpvList, setGpvList] = useState<GPVEntry[]>([]);
  const [tecnicos, setTecnicos] = useState<string[]>(DEFAULT_TECNICOS);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [collapsed, setCol] = useState(false);
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const [modal, setModal] = useState<{ type: string; item: Equipo | GPVEntry | null } | null>(null);
  const [modalE, setModalE] = useState<Equipo | null>(null);
  const [confirmState, setConfirm] = useState<{ source: string; item: Equipo | GPVEntry; msg: string } | null>(null);
  const [showTecModal, setShowTecModal] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedAtRef = useRef<string | null>(null);

  const { data: apiState, isLoading: apiLoading, isFetching } = useQuery({
    ...getGetTallerStateQueryOptions(),
    enabled: auth,
    refetchInterval: auth ? 20_000 : false,
    refetchIntervalInBackground: false,
  });
  const { mutate: saveToApi } = useSaveTallerState();

  const applyApiState = useCallback((s: typeof apiState) => {
    if (!s) return;
    setEquipos((s.equipos as Equipo[]).map(normalizeEquipo));
    setGpvList(s.gpvList as GPVEntry[]);
    setTecnicos((s.tecnicos as string[]).length > 0 ? s.tecnicos as string[] : DEFAULT_TECNICOS);
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

  const save = useCallback((eq: Equipo[], gv: GPVEntry[], tecs?: string[]) => {
    const techList = tecs ?? tecnicos;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToApi({ data: { equipos: eq as never[], gpvList: gv as never[], tecnicos: techList } });
    }, 600);
  }, [tecnicos, saveToApi]);

  const toast = useCallback((msg: string, type = "ok") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

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
    if (eq.destino === "venta") {
      upEq(p => p.map(e => e.id === eq.id ? { ...e, estado: ESTADO_DISP, enVentaDesde: new Date().toISOString().slice(0, 10) } : e));
      toast(`${eq.modelo} → disponibles`);
    } else if (window.confirm(`¿Confirmar entrega de ${eq.modelo}?`)) {
      upEq(p => p.filter(e => e.id !== eq.id));
      toast(`${eq.modelo} entregado`, "inf");
    }
  };

  const confirmarEntrega = (fecha: string, cliente: string) => {
    const eq = modalE!;
    const nE = equipos.filter(e => e.id !== eq.id);
    const nG: GPVEntry[] = [{ id: Date.now(), modelo: eq.modelo, interno: eq.interno, cliente, fechaEntrega: fecha, observacion: eq.observacion, estado: ESTADO_VEND }, ...gpvList];
    setEquipos(nE); setGpvList(nG); save(nE, nG);
    toast(`${eq.modelo} — GPV iniciada`);
    setModalE(null);
  };

  const saveGPV = (form: Partial<GPVEntry>) => {
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

  const navItems = [
    { id: "dashboard", label: "Dashboard",  icon: "dashboard" },
    { id: "taller",    label: "Taller",     icon: "wrench",   count: enTallerCnt },
    { id: "venta",     label: "Venta/GPV",  icon: "tag",      alert: gpvAlertaCnt, count: gpvList.length + disp.length },
    { id: "kpis",      label: "KPIs",       icon: "kpi" },
    { id: "tecnicos",  label: "Técnicos",   icon: "users",    count: tecnicos.length },
  ];
  const titles: Record<string, [string, string]> = {
    dashboard: ["Dashboard", "Resumen general"],
    taller:    ["Taller", "Equipos en reparación"],
    venta:     ["Venta / GPV", "Disponibles · Garantía por venta"],
    kpis:      ["KPIs — Equipos", "Indicadores de rendimiento operativo"],
    tecnicos:  ["Técnicos", "Gestión del equipo"],
  };

  const handleLogin = () => {
    setAuth(true);
    try { sessionStorage.setItem("mds_auth", "1"); } catch { /* ignore */ }
  };

  const handleLogout = () => {
    setAuth(false);
    try { sessionStorage.removeItem("mds_auth"); } catch { /* ignore */ }
  };

  return (
    <div className="app">
      <style>{CSS}</style>

      {!auth && <Login onLogin={handleLogin} />}

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
                  <span style={{ fontSize: 11, color: "var(--t3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>admin@taller.com</span>
                  <button className="btni" onClick={handleLogout}><Ico n="logout" s={15} /></button>
                </div>
              ) : (
                <button className="btni" onClick={handleLogout}><Ico n="logout" s={15} /></button>
              )}
            </div>
          </aside>

          <div className="main">
            <header className="topbar">
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t)" }}>{titles[tab]?.[0] ?? ""}</div>
                <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 1 }}>{titles[tab]?.[1] ?? ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {isFetching && !apiLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }} title="Sincronizando con el servidor…">
                    <div className="sync-dot" />
                    <span style={{ fontSize: 10, color: "var(--t3)" }}>sync</span>
                  </div>
                )}
                {tab !== "kpis" && (
                  <div className="srch">
                    <Ico n="filter" s={14} c="var(--t3)" />
                    <input placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                )}
              </div>
            </header>

            <main className="content">
              {tab === "dashboard" && <Dashboard equipos={equipos} gpvList={gpvList} tecnicos={tecnicos} />}
              {tab === "kpis" && <KPIsPage equipos={equipos} gpvList={gpvList} />}
              {tab === "taller" && (
                <TallerPage
                  equipos={equipos}
                  search={search}
                  tecnicos={tecnicos}
                  onAdd={() => setModal({ type: "taller", item: null })}
                  onEdit={m => setModal({ type: "taller", item: m })}
                  onDelete={m => setConfirm({ source: "eq", item: m, msg: `Eliminará "${m.modelo}" del taller.` })}
                  onListo={handleListo}
                />
              )}
              {tab === "venta" && (
                <VentaPage
                  disponibles={disp}
                  gpvList={gpvList}
                  search={search}
                  onEntrega={m => setModalE(m)}
                  onEditGPV={g => setModal({ type: "gpv", item: g })}
                  onDeleteGPV={g => setConfirm({ source: "gpv", item: g, msg: `Eliminará "${g.modelo}" del registro GPV.` })}
                  onAddGPV={() => setModal({ type: "gpv", item: null })}
                />
              )}
              <Toasts toasts={toasts} />
            </main>

            {modal?.type === "taller" && (
              <TallerModal
                item={modal.item as Equipo | null}
                allEquipos={equipos}
                onSave={saveTaller}
                onClose={() => setModal(null)}
                tecnicos={tecnicos}
              />
            )}
            {modal?.type === "gpv" && <ModalGPV item={modal.item as GPVEntry | null} onSave={saveGPV} onClose={() => setModal(null)} />}
            {modalE && <ModalEntrega equipo={modalE} onConfirm={confirmarEntrega} onClose={() => setModalE(null)} />}
            {confirmState && <Confirm msg={confirmState.msg} onOk={doDelete} onCancel={() => setConfirm(null)} />}
            {showTecModal && <TecnicosModal tecnicos={tecnicos} onSave={saveTecnicos} onClose={() => setShowTecModal(false)} />}
          </div>
        </div>
      )}
    </div>
  );
}
