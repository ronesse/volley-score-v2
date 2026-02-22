// hub2.js
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

// hvor langt tilbake / frem vi henter KAMPER for GLOBAL oversikt
const GLOBAL_LOOKAHEAD_DAYS = 14;
const GLOBAL_LOOKBACK_DAYS  = 30;

// hvor langt tilbake / frem vi henter KAMPER for LAG/SPILLER-visning
// (større vindu for å komme nær "alle kamper")
const TEAM_LOOKAHEAD_DAYS = 365 * 2;   // ca 2 år frem
const TEAM_LOOKBACK_DAYS  = 365 * 10;  // ca 10 år tilbake

const CORE_REFRESH_MS = 10 * 60 * 1000; // 10 minutter

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
  return d.toLocaleString("nb-NO", {
    day:"2-digit",
    month:"short",
    hour:"2-digit",
    minute:"2-digit"
  });
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

function normalizeEvent(raw, sofaTeamIdByDbTeamId){
  const startTs = raw.start_ts ?? raw.startTimestamp ?? null;

  const rawHome = raw.home_team_id ?? raw.homeTeam?.id ?? null;
  const rawAway = raw.away_team_id ?? raw.awayTeam?.id ?? null;

  function toSofaId(x){
    if (x == null) return null;
    const n = Number(x);

    // Ser ut som SofaScore-id (typisk store tall)
    if (Number.isFinite(n) && n > 1000) return n;

    const key = String(x);
    if (sofaTeamIdByDbTeamId && typeof sofaTeamIdByDbTeamId.get === "function") {
      if (sofaTeamIdByDbTeamId.has(key)) return sofaTeamIdByDbTeamId.get(key);
    }

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

/* ===========================
   Match card (Hub)
   =========================== */
function MatchCard({
  e,
  statusLabel,
  isFocused,
  onToggleFocus,
  summaryObj, // { status, summary, summary_html, image_url, headline, subheadline, shock } | "__loading__" | null
}){
  const hs = e.score?.homeSets ?? 0;
  const as = e.score?.awaySets ?? 0;
  const setsArr = safeArray(e.score?.sets);
  const tourLogo = tournamentLogoUrl(e.tournamentId);

  const hasAnySetPoints = setsArr.length > 0;
  const hasScore = (hs !== 0 || as !== 0 || hasAnySetPoints);
  const displayHomeSets = hasScore ? hs : "..";
  const displayAwaySets = hasScore ? as : "..";

  const whenTxt = nbDateTime(e.startTs);
  const compTxt = compHeaderText(e);

  const obj = (summaryObj && typeof summaryObj === "object") ? summaryObj : null;

  // støtt både gammel ("__loading__") og ny ({status:"loading"})
  const loading = (summaryObj === "__loading__") ||
                  (obj?.status === "loading") ||
                  (obj?.summary === "__loading__");

  const headlineFromApi   = (!loading && obj) ? nonEmpty(obj.headline)     : null;
  const subheadlineFromApi= (!loading && obj) ? nonEmpty(obj.subheadline)  : null;
  const shock             = (!loading && obj) ? !!obj.shock                : false;

  const fallbackHeadline = `${(statusLabel || "KAMP")}: ${e.homeName} – ${e.awayName}`;
  const headline = headlineFromApi || fallbackHeadline;

  const summaryText = (!loading && obj) ? asStr(obj.summary) : "";
  const summaryHtml = (!loading && obj) ? nonEmpty(obj.summary_html) : null;

  const imageUrlRaw = (!loading && obj) ? nonEmpty(obj.image_url) : null;
  const imageUrl = imageUrlRaw
    ? (imageUrlRaw.startsWith("http") ? imageUrlRaw : (API_BASE_EVENTS + imageUrlRaw))
    : null;

  const handleClick = () => onToggleFocus();

  return (
    <div
      className={"card matchCard" + (isFocused ? " focused" : "")}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(ev)=>{ if(ev.key==="Enter" || ev.key===" ") handleClick(); }}
      style={{ cursor:"pointer" }}
    >
      <div className="matchHeader">
        <div className="compTitle" title={compTxt}>
          <MiniLogo src={tourLogo} />
          <span style={{ minWidth:0 }}>{compTxt}</span>
        </div>
        <span className="badge">
          <span className="dot gray"></span>
          {statusLabel} · {formatTs(e.startTs)}
        </span>
      </div>

      <div className="scoreRow">
        <div className="team">
          <MiniLogo src={teamLogoUrl(e.homeId)} />
          <span className="teamName">{e.homeName}</span>
        </div>

        <div className="bigScore">
          <div className="sets">{displayHomeSets} - {displayAwaySets}</div>
          <div className="points">Sett</div>
        </div>

        <div className="team right">
          <MiniLogo src={teamLogoUrl(e.awayId)} />
          <span className="teamName">{e.awayName}</span>
        </div>
      </div>

      {/* Fokus: sett + NYHETSSAK */}
      {isFocused && (
        <>
          <div className="setline">
            {[1,2,3,4,5].map(n => {
              const s = setsArr.find(x => x.no === n);
              return (
                <div className="setbox" key={n}>
                  <div className="label">{n}</div>
                  <div className="val">{s?.home ?? "—"} - {s?.away ?? "—"}</div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 12,
              border: "1px solid var(--border)",
              background: "var(--card)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {/* Bilde */}
            {imageUrl ? (
              <div style={{ width:"100%", height: 220, background:"#e5e7eb", borderBottom:"1px solid var(--border)" }}>
                <img
                  src={imageUrl}
                  alt=""
                  loading="lazy"
                  style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
                />
              </div>
            ) : (
              <div
                style={{
                  width:"100%",
                  height: 120,
                  background:"#f3f4f6",
                  borderBottom:"1px solid var(--border)",
                  display:"flex",
                  alignItems:"center",
                  justifyContent:"center",
                  fontWeight:900,
                  color:"#6b7280",
                  letterSpacing:"0.02em",
                  padding:"0 10px",
                  textAlign:"center",
                }}
              >
                {titleCaseSafe(statusLabel)} · {whenTxt || "—"}
              </div>
            )}

            {/* Tekst/HTML */}
            <div style={{ padding: "12px 14px", display:"grid", gap:10 }}>
              {/* VG headline + sjokkbadge */}
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ fontSize: 18, fontWeight: 950, lineHeight: 1.15 }}>
                  {headline}
                </div>
                {shock && (
                  <span
                    className="pill"
                    style={{
                      background:"#111827",
                      color:"#fff",
                      borderColor:"#111827",
                      fontWeight:900
                    }}
                  >
                    SJOKKTAP
                  </span>
                )}
              </div>

              {/* Undertittel fra API */}
              {subheadlineFromApi && (
                <div style={{ fontSize: 13.5, fontWeight: 800, color:"#111827", lineHeight: 1.35 }}>
                  {subheadlineFromApi}
                </div>
              )}

              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", color:"var(--muted)", fontSize:12 }}>
                <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                  <span aria-hidden="true">🕒</span>
                  <span>{whenTxt || "Tid ukjent"}</span>
                </span>
                <span>•</span>
                <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                  <span aria-hidden="true">🏟️</span>
                  <span>{compTxt}</span>
                </span>
              </div>

              {/* Render HTML hvis vi har, ellers tekst */}
              <div style={{ fontSize: 13.5, lineHeight: 1.45, color:"#374151" }}>
                {loading ? (
                  "Laster kampreferat…"
                ) : (summaryHtml ? (
                  <div
                    className="matchStory"
                    dangerouslySetInnerHTML={{ __html: summaryHtml }}
                  />
                ) : (summaryText ? (
                  <pre style={{ whiteSpace:"pre-wrap", margin:0, fontFamily:"inherit" }}>{summaryText}</pre>
                ) : (
                  "Det finnes ikke kampreferat fra denne kampen"
                )))}
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: 10, fontSize:12, fontWeight:700, display:"flex", justifyContent:"flex-end" }}>
        <button
          type="button"
          className="btn"
          style={{ padding:"4px 8px", fontSize:11 }}
          onClick={(ev) => { ev.stopPropagation(); onToggleFocus(); }}
        >
          {isFocused ? "Skjul detaljer" : "Detaljert →"}
        </button>
      </div>
    </div>
  );
}

/* ===========================
   App
   =========================== */
function App(){
  const [tab, setTab] = useState("players"); // "players" | "teams"
  const [qTeams, setQTeams] = useState("");
  const [qPlayers, setQPlayers] = useState("");

  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  // Map: DB team.id (string) -> sofascoreTeamId (number)
  const sofaTeamIdByDbTeamId = useMemo(() => {
    const m = new Map();
    for (const t of teams) {
      if (!t || !t.id) continue;
      if (t.sofascoreTeamId == null) continue;
      m.set(String(t.id), t.sofascoreTeamId);
    }
    return m;
  }, [teams]);

  // Map: sofascoreTeamId (number) -> team object
  const teamBySofaId = useMemo(() => {
    const m = new Map();
    for (const t of teams) {
      if (!t || t.sofascoreTeamId == null) continue;
      m.set(Number(t.sofascoreTeamId), t);
    }
    return m;
  }, [teams]);

  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const [live, setLive] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [finished, setFinished] = useState([]);

  const [liveTeam, setLiveTeam] = useState([]);
  const [nextTeam, setNextTeam] = useState([]);
  const [prevTeam, setPrevTeam] = useState([]);

  const [focusedEventKey, setFocusedEventKey] = useState(null);
  const [teamFilter, setTeamFilter] = useState("all");

  // eventId -> { status:"loading"|"done", summary, summary_html, image_url, headline, subheadline, shock, has_rally }
  const [summaryByEvent, setSummaryByEvent] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const pollRef = useRef(null);
  const abortRef = useRef(null);

  function normalizeTeam(t){
    return {
      id: nonEmpty(t.id) ?? (t.id === 0 ? "0" : null),
      name: asStr(t.name) || "—",
      country: nonEmpty(t.country),
      league: nonEmpty(t.league),
      groupType: normalizeGroupType(t.group_type),
      sofascoreTeamId: asNum(t.sofascore_team_id),
      tournamentId: nonEmpty(t.tournament_id),
      widgetName: nonEmpty(t.widget_name),
      homepageUrl: nonEmpty(t.homepage_url),
      streamUrl: nonEmpty(t.stream_url),
    };
  }
  function normalizePlayer(p){
    return {
      id: nonEmpty(p.id),
      name: asStr(p.name) || "—",
      position: nonEmpty(p.position),
      jersey: nonEmpty(p.jersey_number),
      nationality: nonEmpty(p.nationality),
      externalUrl: nonEmpty(p.external_url),
      instagram: nonEmpty(p.instagram),
      heightCm: nonEmpty(p.height_cm),
      birthYear: nonEmpty(p.birth_year),
      teamId: nonEmpty(p.team_id),
      sofascoreTeamId: asNum(p.sofascore_team_id),
    };
  }

  async function fetchJson(base, path, signal){
    const res = await fetch(base + path, {
      headers:{ "Accept":"application/json" },
      signal,
      cache:"no-store"
    });
    if(!res.ok) throw new Error(String(res.status) + " " + String(res.statusText));
    return res.json();
  }

  /* ===========================
     Summary loader
     =========================== */
  async function loadSummary(eventId){
    if (!eventId) return;

    const existing = summaryByEvent[eventId];
    if (existing && existing.status === "done") return;
    if (existing && existing.status === "loading") return;

    setSummaryByEvent(prev => ({
      ...prev,
      [eventId]: {
        status:"loading",
        summary:"",
        summary_html:null,
        image_url:null,
        headline:null,
        subheadline:null,
        shock:false,
        has_rally:false
      }
    }));

    try{
      const qsParts = [];
      if (selectedTeam?.sofascoreTeamId != null) {
        qsParts.push("sofa_team_id=" + encodeURIComponent(selectedTeam.sofascoreTeamId));
      }
      if (selectedPlayer?.id) {
        // Dette query-parametret kan backend velge å bruke eller ignorere
        qsParts.push("player_id=" + encodeURIComponent(selectedPlayer.id));
      }
      const qs = qsParts.length ? ("?" + qsParts.join("&")) : "";

      const res = await fetch(
        API_BASE_EVENTS + `/events/${eventId}/summary` + qs,
        { headers:{ "Accept":"application/json" }, cache:"no-store" }
      );

      if (res.status === 404) {
        setSummaryByEvent(prev => ({
          ...prev,
          [eventId]: {
            status:"done",
            summary:"",
            summary_html:null,
            image_url:null,
            headline:null,
            subheadline:null,
            shock:false,
            has_rally:false
          }
        }));
        return;
      }
      if (!res.ok) throw new Error(String(res.status) + " " + String(res.statusText));

      const data = await res.json();

      setSummaryByEvent(prev => ({
        ...prev,
        [eventId]: {
          status: "done",
          summary: asStr(data?.summary),
          summary_html: nonEmpty(data?.summary_html),
          image_url: nonEmpty(data?.image_url),
          headline: nonEmpty(data?.headline),
          subheadline: nonEmpty(data?.subheadline),
          shock: !!data?.shock,
          has_rally: !!data?.has_rally
        }
      }));
    } catch (e) {
      console.warn("Summary failed", eventId, e);
      setSummaryByEvent(prev => ({
        ...prev,
        [eventId]: {
          status:"done",
          summary:"",
          summary_html:null,
          image_url:null,
          headline:null,
          subheadline:null,
          shock:false,
          has_rally:false
        }
      }));
    }
  }

  async function loadCore(){
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");

    const [teamsData, playersData] = await Promise.all([
      fetchJson(API_BASE_TEAMS, "/teams?limit=1000&offset=0", controller.signal),
      fetchJson(API_BASE_PLAYERS, "/players?limit=1000&offset=0", controller.signal),
    ]);

    const teamsArr   = Array.isArray(teamsData)   ? teamsData   : safeArray(teamsData?.items);
    const playersArr = Array.isArray(playersData) ? playersData : safeArray(playersData?.items);

    setTeams(teamsArr.map(normalizeTeam).filter(t => t && t.id));
    setPlayers(playersArr.map(normalizePlayer).filter(p => p && p.id));
  }

  async function loadGlobalMatches(){
    const now = Math.floor(Date.now()/1000);
    const toNext   = now + GLOBAL_LOOKAHEAD_DAYS*24*3600;
    const fromPrev = now - GLOBAL_LOOKBACK_DAYS*24*3600;

    const [liveRes, nextRes, prevRes] = await Promise.allSettled([
      fetchJson(API_BASE_EVENTS, "/live", new AbortController().signal),
      fetchJson(API_BASE_EVENTS, `/events?from_ts=${fromPrev}&to_ts=${toNext}&limit=1000&offset=0`, new AbortController().signal),
      fetchJson(API_BASE_EVENTS, `/events?from_ts=${fromPrev}&to_ts=${toNext}&limit=1000&offset=0`, new AbortController().signal),
    ]);

    const liveData = (liveRes.status === "fulfilled") ? liveRes.value : [];
    const nextData = (nextRes.status === "fulfilled") ? nextRes.value : [];
    const prevData = (prevRes.status === "fulfilled") ? prevRes.value : [];

    if (liveRes.status === "rejected") console.warn("LIVE global failed:", liveRes.reason);
    if (nextRes.status === "rejected") console.warn("NEXT global failed:", nextRes.reason);
    if (prevRes.status === "rejected") console.warn("PREV global failed:", prevRes.reason);

    const liveArr = safeArray(liveData)
      .map(r => normalizeEvent(r, sofaTeamIdByDbTeamId));

    const allEventsArr = safeArray(nextData)
      .concat(safeArray(prevData))
      .map(r => normalizeEvent(r, sofaTeamIdByDbTeamId));

    const upcomingArr = allEventsArr
      .filter(e => !isFinished(e.raw))
      .sort((a,b)=>(a.startTs??0)-(b.startTs??0));

    const finishedArr = allEventsArr
      .filter(e => isFinished(e.raw))
      .sort((a,b)=>(b.startTs??0)-(a.startTs??0));

    setLive(liveArr);
    setUpcoming(upcomingArr);
    setFinished(finishedArr);

    const allFailed = (liveRes.status==="rejected" && nextRes.status==="rejected" && prevRes.status==="rejected");
    if (allFailed) setError("Kunne ikke hente live/evt data fra API.");
  }

  async function loadTeamMatches(team){
    if (!team || team.sofascoreTeamId == null) {
      setLiveTeam([]); setNextTeam([]); setPrevTeam([]);
      setFocusedEventKey(null);
      return;
    }
    const teamSofa = Number(team.sofascoreTeamId);

    const now = Math.floor(Date.now()/1000);
    const toNext   = now + TEAM_LOOKAHEAD_DAYS*24*3600;
    const fromPrev = now - TEAM_LOOKBACK_DAYS*24*3600;

    try{
      const [liveRes, eventsRes] = await Promise.allSettled([
        fetchJson(API_BASE_EVENTS, "/live", new AbortController().signal),
        fetchJson(API_BASE_EVENTS, `/events?from_ts=${fromPrev}&to_ts=${toNext}&limit=1000&offset=0`, new AbortController().signal),
      ]);

      const liveData   = (liveRes.status   === "fulfilled") ? liveRes.value   : [];
      const eventsData = (eventsRes.status === "fulfilled") ? eventsRes.value : [];

      if (liveRes.status === "rejected")   console.warn("LIVE(team) failed:",   liveRes.reason);
      if (eventsRes.status === "rejected") console.warn("EVENTS(team) failed:", eventsRes.reason);

      const liveArr = safeArray(liveData)
        .map(r => normalizeEvent(r, sofaTeamIdByDbTeamId))
        .filter(e => e.homeId===teamSofa || e.awayId===teamSofa);

      const allTeamEvents = safeArray(eventsData)
        .map(r => normalizeEvent(r, sofaTeamIdByDbTeamId))
        .filter(e => e.homeId===teamSofa || e.awayId===teamSofa);

      const nextArr = allTeamEvents
        .filter(e => !isFinished(e.raw))
        .sort((a,b)=>(a.startTs??0)-(b.startTs??0));

      const prevArr = allTeamEvents
        .filter(e => isFinished(e.raw))
        .sort((a,b)=>(b.startTs??0)-(a.startTs??0));

      setLiveTeam(liveArr);
      setNextTeam(nextArr);
      setPrevTeam(prevArr);
      setFocusedEventKey(null);
    } catch(e){
      setError(String(e?.message ?? e));
      setLiveTeam([]); setNextTeam([]); setPrevTeam([]);
      setFocusedEventKey(null);
    }
  }

  // Init: hent core + global matches og poll
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try{
        await loadCore();
        let lastCoreAt = Date.now();
        await loadGlobalMatches();
        if (cancelled) return;

        pollRef.current = setInterval(async () => {
          const nowMs = Date.now();

          if (nowMs - lastCoreAt > CORE_REFRESH_MS) {
            await loadCore();
            lastCoreAt = nowMs;
          }

          await loadGlobalMatches();
          if (selectedTeam) {
            await loadTeamMatches(selectedTeam);
          }
        }, POLL_MS);
      } catch(e){
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Hver gang selectedTeam endres (enten via lag-klikk eller spiller-klikk), hent kamper for det laget
  useEffect(() => {
    if (!selectedTeam) return;
    loadTeamMatches(selectedTeam);
    setSummaryByEvent({});
    setFocusedEventKey(null);
  }, [selectedTeam]);

  /* ===========
     Build "best" tournament/season per team (based on events)
     =========== */
  const teamEventMeta = useMemo(() => {
    const allEvents = [...live, ...upcoming, ...finished];
    const agg = new Map();

    for (const e of allEvents) {
      const ids = [e.homeId, e.awayId];
      for (const id of ids) {
        if (id == null) continue;

        let entry = agg.get(id);
        if (!entry) {
          entry = { tournaments: new Map(), seasons: new Map() };
          agg.set(id, entry);
        }

        const tName = asStr(e.tournamentName);
        const sName = asStr(e.seasonName);

        if (tName) entry.tournaments.set(tName, (entry.tournaments.get(tName) || 0) + 1);
        if (sName) entry.seasons.set(sName, (entry.seasons.get(sName) || 0) + 1);
      }
    }

    const pickTop = (m) => {
      let bestName = null;
      let bestCount = -1;
      for (const [name, count] of m.entries()) {
        if (count > bestCount) { bestCount = count; bestName = name; }
      }
      return bestName;
    };

    const out = new Map();
    for (const [id, entry] of agg.entries()) {
      out.set(id, {
        tournamentName: pickTop(entry.tournaments),
        seasonName: pickTop(entry.seasons),
      });
    }
    return out;
  }, [live, upcoming, finished]);

  /* ===========
     Derived lists
     =========== */
  const filteredTeams = useMemo(() => {
    let base = teams;
    if (teamFilter === "abroad") {
      base = base.filter(t => t.groupType === "abroad");
    } else if (teamFilter === "mizuno") {
      base = base.filter(t => t.groupType === "mizuno");
    }
    const qq = qTeams.trim().toLowerCase();
    if (qq){
      base = base.filter(t =>
        t.name.toLowerCase().includes(qq) ||
        String(t.country||"").toLowerCase().includes(qq) ||
        String(t.league||"").toLowerCase().includes(qq) ||
        String(t.widgetName||"").toLowerCase().includes(qq)
      );
    }
    return base;
  }, [teams, teamFilter, qTeams]);

  const leagueGroups = useMemo(() => {
    const groups = new Map();
    for (const t of filteredTeams) {
      const key = t.league || "Uten liga";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const result = [];
    for (const [league, arr] of groups.entries()) {
      arr.sort((a,b)=>a.name.localeCompare(b.name, "nb"));
      result.push({ league, teams: arr });
    }
    result.sort((a,b)=>a.league.localeCompare(b.league, "nb"));
    return result;
  }, [filteredTeams]);

  const visiblePlayers = useMemo(() => {
    let base = players;
    const qq = qPlayers.trim().toLowerCase();
    if (qq){
      base = base.filter(p =>
        p.name.toLowerCase().includes(qq) ||
        String(p.nationality||"").toLowerCase().includes(qq) ||
        String(p.teamId||"").toLowerCase().includes(qq)
      );
    }
    return [...base].sort((a,b)=>a.name.localeCompare(b.name,"nb"));
  }, [players, qPlayers]);

  const selectedTeamPlayers = useMemo(() => {
    if (!selectedTeam || !selectedTeam.id) return [];
    return players
      .filter(p => p.teamId === selectedTeam.id)
      .sort((a,b)=>a.name.localeCompare(b.name,"nb"));
  }, [players, selectedTeam]);

  const selectedMeta = useMemo(() => {
    if (!selectedTeam || selectedTeam.sofascoreTeamId == null) return null;
    return teamEventMeta.get(selectedTeam.sofascoreTeamId) || null;
  }, [selectedTeam, teamEventMeta]);

  /* ===========================
     UI subcomponents
     =========================== */
  function TeamCard({ t }){
    const meta = (t.sofascoreTeamId != null) ? teamEventMeta.get(t.sofascoreTeamId) : null;

    const line2 = [
      meta?.tournamentName,
      meta?.seasonName,
      t.league,
      t.country,
      t.widgetName ? ("Widget: " + t.widgetName) : null,
    ].filter(Boolean).join(" · ");

    return (
      <div
        className="card"
        onClick={() => {
          setSelectedTeam(t);
          setSelectedPlayer(null);
          setTab("teams");
          setFocusedEventKey(null);
        }}
        style={{ cursor:"pointer" }}
      >
        <div className="row">
          <div className="left">
            <LogoBox src={teamLogoUrl(t.sofascoreTeamId)} label={initials(t.name)} />
            <div className="nameBlock">
              <div className="name">{t.name}</div>
              <div className="sub">{line2 || "—"}</div>
            </div>
          </div>
          <div className="meta">
            {t.groupType && <span className="pill">{t.groupType}</span>}
            {t.sofascoreTeamId != null && <span className="pill">SofaTeam: {t.sofascoreTeamId}</span>}
          </div>
        </div>
      </div>
    );
  }

  function PlayerCardLarge({ p }){
    const photo = playerPhotoUrl(p.id);
    const status = useImageStatus(photo);
    const ig = nonEmpty(p.instagram);
    const igHandle = ig ? (ig.startsWith("@") ? ig.slice(1) : ig) : null;
    const igUrl = igHandle ? ("https://instagram.com/" + igHandle) : null;

    const line2 = [
      p.position,
      p.jersey ? ("#" + p.jersey) : null,
      p.nationality,
      p.heightCm ? (p.heightCm + " cm") : null,
      p.birthYear ? ("Født " + p.birthYear) : null
    ].filter(Boolean).join(" · ");

    const playerTeam = p.teamId ? teams.find(t => t.id === p.teamId) : null;

    const handleClick = () => {
      // Klikk på spiller skal åpne spillervisning med alle kamper (via laget hans/hennes)
      if (playerTeam) {
        setSelectedTeam(playerTeam);
      } else {
        setSelectedTeam(null);
      }
      setSelectedPlayer(p);
      setTab("players");
      setFocusedEventKey(null);
      setSummaryByEvent({});
    };

    return (
      <div
        className="card playerCard"
        style={{ cursor:"pointer" }}
        onClick={handleClick}
      >
        <div className="playerCardInner" style={{ display:"flex", flexWrap:"wrap", gap:12 }}>
          <div
            className="playerImageCol"
            style={{
              flex:"1 1 280px",
              minWidth:200,
              maxWidth:"50%",
              display:"flex",
              alignItems:"stretch"
            }}
          >
            <span
              className="logoBox playerPhotoBox"
              aria-hidden="true"
              style={{
                width:"100%",
                height:"100%",
                maxHeight:240,
                borderRadius:16,
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                fontWeight:900,
                fontSize:18,
              }}
            >
              {(!photo || status !== "ok")
                ? <span>{initials(p.name)}</span>
                : <img src={photo} alt="" loading="lazy" style={{ width:"100%", height:"100%", objectFit:"cover" }} />}
            </span>
          </div>

          <div
            className="playerInfoCol"
            style={{
              flex:"1 1 260px",
              minWidth:200,
              maxWidth:"50%",
              display:"flex",
              flexDirection:"column",
              gap:8,
              minHeight: "100%"
            }}
          >
            <div className="nameBlock">
              <div className="name">{p.name}</div>
              <div className="sub">{line2 || "—"}</div>

              {playerTeam && (
                <div
                  className="sub playerTeamLine"
                  style={{
                    display:"flex",
                    alignItems:"center",
                    gap:6,
                    flexWrap:"wrap",
                    marginTop:4
                  }}
                >
                  <MiniLogo src={teamLogoUrl(playerTeam.sofascoreTeamId)} />
                  <span>
                    {playerTeam.name}
                    {playerTeam.league ? (" · " + playerTeam.league) : ""}
                  </span>
                </div>
              )}
            </div>

            <div className="meta" style={{ marginTop:"auto", justifyContent:"flex-start" }}>
              {p.externalUrl && (
                <a className="btn" href={p.externalUrl} target="_blank" rel="noreferrer">
                  Volleybox →
                </a>
              )}
              {igUrl && (
                <a className="btn" href={igUrl} target="_blank" rel="noreferrer">
                  Instagram →
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ===========================
     Render
     =========================== */
  return (
    <div className="wrap">
      <div className="nav" style={{ justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button
            className={"btn " + (tab==="players" ? "primary" : "")}
            onClick={() => {
              setTab("players");
              setSelectedTeam(null);
              setSelectedPlayer(null);
              setFocusedEventKey(null);
              setSummaryByEvent({});
            }}
          >
            Spillere
          </button>
          <button
            className={"btn " + (tab==="teams" ? "primary" : "")}
            onClick={() => {
              setTab("teams");
              setSelectedTeam(null);
              setSelectedPlayer(null);
              setFocusedEventKey(null);
              setSummaryByEvent({});
            }}
          >
            Lag
          </button>

          {(selectedTeam || selectedPlayer) && (
            <button
              className="btn"
              onClick={() => {
                setSelectedTeam(null);
                setSelectedPlayer(null);
                setFocusedEventKey(null);
                setSummaryByEvent({});
              }}
            >
              ← Tilbake til oversikt
            </button>
          )}
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {tab === "teams" && (
            <input
              value={qTeams}
              onChange={(e)=>setQTeams(e.target.value)}
              placeholder="Søk lag eller liga…"
              style={{ minWidth:200 }}
            />
          )}
          {tab === "players" && (
            <input
              value={qPlayers}
              onChange={(e)=>setQPlayers(e.target.value)}
              placeholder="Søk spiller…"
              style={{ minWidth:200 }}
            />
          )}
        </div>
      </div>

      {error && <div className="alert">Feil: {error}</div>}
      {loading && <div style={{ marginTop: 10, color: "#6b7280" }}>Laster…</div>}

      {/* HUB-filtere for lag-liste */}
      {tab === "teams" && !selectedTeam && (
        <div className="focusBar" style={{ marginTop: 4, marginBottom: 4 }}>
          <div className="badges" style={{ marginBottom: 4 }}>
            <button
              className="badge filterBtn"
              style={{
                background: teamFilter==="abroad" ? "#111827" : "#fafafa",
                color:      teamFilter==="abroad" ? "#ffffff" : "#111827",
                borderColor:teamFilter==="abroad" ? "#111827" : "var(--border)",
              }}
              onClick={() => setTeamFilter("abroad")}
            >
              Norske spillere ute
            </button>
            <button
              className="badge filterBtn"
              style={{
                background: teamFilter==="mizuno" ? "#111827" : "#fafafa",
                color:      teamFilter==="mizuno" ? "#ffffff" : "#111827",
                borderColor:teamFilter==="mizuno" ? "#111827" : "var(--border)",
              }}
              onClick={() => setTeamFilter("mizuno")}
            >
              Norge Mizuno
            </button>
            <button
              className="badge filterBtn"
              style={{
                background: teamFilter==="all" ? "#111827" : "#fafafa",
                color:      teamFilter==="all" ? "#ffffff" : "#111827",
                borderColor:teamFilter==="all" ? "#111827" : "var(--border)",
              }}
              onClick={() => setTeamFilter("all")}
            >
              Alle
            </button>
          </div>
        </div>
      )}

      {/* TEAMS LIST */}
      {tab === "teams" && !selectedTeam && (
        <div className="grid">
          {leagueGroups.map(group => (
            <div key={group.league}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: "8px 4px 4px",
                }}
              >
                {group.league}
              </div>
              {group.teams.map(t => <TeamCard key={t.id} t={t} />)}
            </div>
          ))}
        </div>
      )}

      {/* TEAM VIEW (viser alle kamper vi har for laget) */}
      {tab === "teams" && selectedTeam && (
        <>
          <div className="card">
            <div className="row">
              <div className="left">
                <LogoBox src={teamLogoUrl(selectedTeam.sofascoreTeamId)} label={initials(selectedTeam.name)} />
                <div className="nameBlock">
                  <div className="name">{selectedTeam.name}</div>
                  <div className="sub">
                    {[
                      selectedMeta?.tournamentName,
                      selectedMeta?.seasonName,
                      selectedTeam.league,
                      selectedTeam.country,
                      selectedTeam.widgetName
                    ].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              </div>
              <div className="meta">
                {selectedTeam.groupType && <span className="pill">{selectedTeam.groupType}</span>}
                {selectedTeam.sofascoreTeamId != null && <span className="pill">SofaTeam: {selectedTeam.sofascoreTeamId}</span>}
                {selectedTeam.homepageUrl && (
                  <a className="btn" href={selectedTeam.homepageUrl} target="_blank" rel="noreferrer">Nettside →</a>
                )}
                {selectedTeam.streamUrl && (
                  <a className="btn" href={selectedTeam.streamUrl} target="_blank" rel="noreferrer">Stream →</a>
                )}
              </div>
            </div>
          </div>

          {/* Spillere på laget */}
          {selectedTeamPlayers.length > 0 && (
            <div className="grid">
              {selectedTeamPlayers
                .filter(p => asStr(p.nationality).toLowerCase().includes("nor"))
                .map(p => <PlayerCardLarge key={p.id} p={p} />)}
              {selectedTeamPlayers
                .filter(p => !asStr(p.nationality).toLowerCase().includes("nor"))
                .map(p => <PlayerCardLarge key={p.id} p={p} />)}
            </div>
          )}

          {/* Kamper for laget: LIVE, KOMMENDE, FERDIGE */}
          <div style={{ marginTop:16, marginBottom:4, fontWeight:800, fontSize:13 }}>Kamper for {selectedTeam.name}</div>
          <div className="grid">
            {liveTeam.map(e => {
              const k = eventKey(e);
              return (
                <MatchCard
                  key={k}
                  e={e}
                  statusLabel="LIVE"
                  isFocused={focusedEventKey === k}
                  summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                  onToggleFocus={() => {
                    setFocusedEventKey(prev => {
                      const next = (prev === k) ? null : k;
                      if (next && e.eventId) loadSummary(e.eventId);
                      return next;
                    });
                  }}
                />
              );
            })}
            {nextTeam.map(e => {
              const k = eventKey(e);
              return (
                <MatchCard
                  key={k}
                  e={e}
                  statusLabel="NEXT"
                  isFocused={focusedEventKey === k}
                  summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                  onToggleFocus={() => {
                    setFocusedEventKey(prev => {
                      const next = (prev === k) ? null : k;
                      if (next && e.eventId) loadSummary(e.eventId);
                      return next;
                    });
                  }}
                />
              );
            })}
            {prevTeam.map(e => {
              const k = eventKey(e);
              return (
                <MatchCard
                  key={k}
                  e={e}
                  statusLabel="FINISHED"
                  isFocused={focusedEventKey === k}
                  summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                  onToggleFocus={() => {
                    setFocusedEventKey(prev => {
                      const next = (prev === k) ? null : k;
                      if (next && e.eventId) loadSummary(e.eventId);
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        </>
      )}

      {/* PLAYERS TAB - liste */}
      {tab === "players" && !selectedPlayer && (
        <div className="grid">
          {visiblePlayers.map(p => <PlayerCardLarge key={p.id} p={p} />)}
        </div>
      )}

      {/* PLAYER VIEW - alle kamper (via laget) + summaries */}
      {tab === "players" && selectedPlayer && (
        <>
          {/* Spiller-header */}
          <PlayerCardLarge p={selectedPlayer} />

          {/* Hvis vi har funnet laget, viser vi kampene (live + kommende + ferdige) */}
          {selectedTeam && (
            <>
              <div style={{ marginTop:16, marginBottom:4, fontWeight:800, fontSize:13 }}>
                Kamper for {selectedPlayer.name} ({selectedTeam.name})
              </div>
              <div className="grid">
                {liveTeam.map(e => {
                  const k = eventKey(e);
                  return (
                    <MatchCard
                      key={k}
                      e={e}
                      statusLabel="LIVE"
                      isFocused={focusedEventKey === k}
                      summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                      onToggleFocus={() => {
                        setFocusedEventKey(prev => {
                          const next = (prev === k) ? null : k;
                          if (next && e.eventId) loadSummary(e.eventId);
                          return next;
                        });
                      }}
                    />
                  );
                })}
                {nextTeam.map(e => {
                  const k = eventKey(e);
                  return (
                    <MatchCard
                      key={k}
                      e={e}
                      statusLabel="NEXT"
                      isFocused={focusedEventKey === k}
                      summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                      onToggleFocus={() => {
                        setFocusedEventKey(prev => {
                          const next = (prev === k) ? null : k;
                          if (next && e.eventId) loadSummary(e.eventId);
                          return next;
                        });
                      }}
                    />
                  );
                })}
                {prevTeam.map(e => {
                  const k = eventKey(e);
                  return (
                    <MatchCard
                      key={k}
                      e={e}
                      statusLabel="FINISHED"
                      isFocused={focusedEventKey === k}
                      summaryObj={e.eventId ? (summaryByEvent[e.eventId] ?? null) : null}
                      onToggleFocus={() => {
                        setFocusedEventKey(prev => {
                          const next = (prev === k) ? null : k;
                          if (next && e.eventId) loadSummary(e.eventId);
                          return next;
                        });
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}

          {!selectedTeam && (
            <div className="card" style={{ marginTop:10 }}>
              <div style={{ fontWeight:800, marginBottom:4 }}>Mangler laginformasjon</div>
              <div style={{ color:"#6b7280", fontSize:13 }}>
                Spilleren er ikke koblet til et lag i databasen, så kan ikke hente kampene.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("hub-root")).render(<App />);
