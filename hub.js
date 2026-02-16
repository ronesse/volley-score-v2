const { useEffect, useMemo, useRef, useState } = React;

/* ===========================
   API base
   =========================== */
const API_BASE_TEAMS   = "https://volleyball.ronesse.no";
const API_BASE_PLAYERS = "https://volleyball.ronesse.no";
const API_BASE_EVENTS  = "https://volleyball.ronesse.no";

/* ===========================
   Settings
   =========================== */
const POLL_MS = 15000;
const CORE_REFRESH_MS = 10 * 60 * 1000; // 10 minutter (teams/players sjeldnere)
const LOOKAHEAD_DAYS = 14;
const LOOKBACK_DAYS = 30;

/* ===========================
   Helpers
   =========================== */
function safeArray(x){ return Array.isArray(x) ? x : []; }
function asStr(v){ return (v == null) ? "" : String(v).trim(); }
function nonEmpty(v){ const s = asStr(v); return s ? s : null; }
function asNum(v){
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function initials(name){
  const s = asStr(name);
  if (!s) return "—";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "").toUpperCase();
  const b = (parts[1]?.[0] || "").toUpperCase();
  return (a+b) || s.slice(0,2).toUpperCase();
}
function normalizeGroupType(v){
  const s = asStr(v).toLowerCase();
  if (!s) return null;
  if (s === "mizuno" || s.includes("mizuno")) return "mizuno";
  if (
    s === "abroad" ||
    s.includes("utland") ||
    s.includes("utlandet") ||
    s.includes("norske spillere i utlandet")
  ) return "abroad";
  return "other";
}
function formatTs(tsSeconds){
  if(!tsSeconds) return "—";
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleString("nb-NO", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
}

/* ===========================
   Image cache (avoid reloading)
   =========================== */
const imgStatusCache = new Map(); // src -> "ok" | "fail"
function useImageStatus(src){
  const [status, setStatus] = useState(src ? (imgStatusCache.get(src) || "loading") : "none");
  useEffect(() => {
    if (!src) { setStatus("none"); return; }
    const cached = imgStatusCache.get(src);
    if (cached) { setStatus(cached); return; }

    setStatus("loading");
    const img = new Image();
    img.onload = () => { imgStatusCache.set(src, "ok"); setStatus("ok"); };
    img.onerror = () => { imgStatusCache.set(src, "fail"); setStatus("fail"); };
    img.src = src;
  }, [src]);
  return status;
}

function LogoBox({ src, label }){
  const status = useImageStatus(src);
  if (!src || status !== "ok") return <span className="logoBox" aria-hidden="true">{label}</span>;
  return <span className="logoBox" aria-hidden="true"><img src={src} alt="" loading="lazy" /></span>;
}
function MiniLogo({ src }){
  const status = useImageStatus(src);
  if (!src || status !== "ok") return <span className="miniLogo" aria-hidden="true"></span>;
  return <span className="miniLogo" aria-hidden="true"><img src={src} alt="" loading="lazy" /></span>;
}

/* ===========================
   Image URL rules
   =========================== */
function teamLogoUrl(sofaTeamId){
  const id = nonEmpty(sofaTeamId);
  if (!id) return null;
  return API_BASE_EVENTS + "/img/teams/" + id + ".png";
}
function tournamentLogoUrl(tournamentId){
  const id = nonEmpty(tournamentId);
  if (!id) return null;
  return API_BASE_EVENTS + "/img/tournaments/" + String(id).trim() + ".png";
}
function playerPhotoUrl(playerId){
  const id = nonEmpty(playerId);
  if (!id) return null;
  return API_BASE_PLAYERS + "/img/players/" + id + ".jpg";
}

/* ===========================
   Events helpers
   =========================== */
function pickNumber(){
  for (let i=0;i<arguments.length;i++){
    const v = arguments[i];
    if (v === 0) return 0;
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}
function extractScore(raw){
  const homeSets = pickNumber(raw.home_sets, raw.homeScore?.current);
  const awaySets = pickNumber(raw.away_sets, raw.awayScore?.current);

  const sets = [];
  for (let i=1;i<=5;i++){
    const hp = pickNumber(raw["home_p"+i], raw.homeScore?.["period"+i]);
    const ap = pickNumber(raw["away_p"+i], raw.awayScore?.["period"+i]);
    if (hp != null || ap != null) sets.push({ no:i, home: hp, away: ap });
  }

  return {
    homeSets: (homeSets == null ? 0 : homeSets),
    awaySets: (awaySets == null ? 0 : awaySets),
    sets
  };
}
function isFinished(raw){
  const t = String(
    raw.status_type ??
    raw.statusType ??
    raw.status ??
    raw.status?.type ??
    raw.status?.description ??
    ""
  ).toLowerCase();
  if (t.includes("finished") || t.includes("ended") || t.includes("complete") || t === "ft") return true;
  if (raw.winnerCode != null) return true;
  if (raw.home_sets != null || raw.away_sets != null) return true;
  if (raw.homeScore?.current != null || raw.awayScore?.current != null) return true;
  return false;
}

/**
 * normalizeEvent:
 * - Mange API'er kan sende home_team_id / away_team_id som enten:
 *   (A) sofascore team id (typisk store tall)
 *   (B) din DB team.id (små tall / strings)
 * Denne funksjonen mapper DB-team-id -> sofascoreTeamId via sofaTeamIdByDbTeamId.
 */
function normalizeEvent(raw, sofaTeamIdByDbTeamId){
  const startTs = raw.start_ts ?? raw.startTimestamp ?? null;

  const rawHome = raw.home_team_id ?? raw.homeTeam?.id ?? null;
  const rawAway = raw.away_team_id ?? raw.awayTeam?.id ?? null;

  function toSofaId(x){
    if (x == null) return null;

    const n = Number(x);

    // Ser ut som SofaScore-id (typisk store tall)
    if (Number.isFinite(n) && n > 1000) return n;

    // Hvis x matcher DB-team-id i /teams -> map til sofascoreTeamId
    const key = String(x);
    if (sofaTeamIdByDbTeamId && typeof sofaTeamIdByDbTeamId.get === "function") {
      if (sofaTeamIdByDbTeamId.has(key)) return sofaTeamIdByDbTeamId.get(key);
    }

    // fallback: bruk tallet hvis mulig
    return Number.isFinite(n) ? n : null;
  }

  return {
    raw,
    startTs,
    eventId: raw.event_id ?? raw.id ?? null,
    homeId: toSofaId(rawHome),
    awayId: toSofaId(rawAway),
    homeName: raw.home_team_name ?? raw.homeTeam?.name ?? "Home",
    awayName: raw.away_team_name ?? raw.awayTeam?.name ?? "Away",
    tournamentId: raw.tournament_id ?? raw.tournament?.id ?? null,
    tournamentName: raw.tournament_name ?? raw.tournament?.name ?? "",
    seasonName: raw.season_name ?? raw.season?.name ?? "",
    groupType: normalizeGroupType(raw.group_type ?? raw.groupType ?? null),
    score: extractScore(raw),
  };
}

function compHeaderText(e){
  const t = asStr(e.tournamentName);
  const s = asStr(e.seasonName);
  if (t && s) return t + " · " + s;
  return t || s || "—";
}

/* key for focus/identity */
function eventKey(e){
  return e.eventId ?? (e.homeName + "|" + e.awayName + "|" + (e.startTs ?? ""));
}

/* ===========================
   News helpers (frontend)
   =========================== */
function nbDateTime(tsSeconds){
  if(!tsSeconds) return "";
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleString("nb-NO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function titleCaseSafe(s){
  const x = asStr(s);
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function buildHeadline(e){
  // Ikke si vinner – bare “duell” / “thriller” etc.
  const hs = e.score?.homeSets ?? 0;
  const as = e.score?.awaySets ?? 0;
  const hasScore = (hs !== 0 || as !== 0 || safeArray(e.score?.sets).length > 0);

  const tag = (() => {
    if (!hasScore) return "Kamp i vente";
    if (hs === as && hs !== 0) return "Helt jevnt";
    if (Math.abs(hs-as) >= 2) return "Kontrollert oppgjør";
    if (Math.abs(hs-as) === 1 && (hs+as) >= 4) return "Femsett-thriller";
    return "Tett batalje";
  })();

  return `${tag}: ${e.homeName} – ${e.awayName}`;
}

/* ===========================
   Match card (Hub)
   =========================== */
function MatchCard({
  e,
  statusLabel,
  isFocused,
  onToggleFocus,
  summaryObj, // { status, summary, image_url } | "__loading__" | null
}){
  const hs = e.score?.homeSets ?? 0;
  const as = e.score?.awaySets ?? 0;
  const setsArr = safeArray(e.score?.sets);
  const tourLogo = tournamentLogoUrl(e.tournamentId);

  const hasAnySetPoints = setsArr.length > 0;
  const hasScore = (hs !== 0 || as !== 0 || hasAnySetPoints);
  const displayHomeSets = hasScore ? hs : "..";
  const displayAwaySets = hasScore ? as : "..";

  const headline = build