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
  return API_BASE_EVENTS + "/img/tournaments/" + id + ".png";
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

  return { homeSets: (homeSets == null ? 0 : homeSets), awaySets: (awaySets == null ? 0 : awaySets), sets };
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
function normalizeEvent(raw){
  const startTs = raw.start_ts ?? raw.startTimestamp ?? null;
  return {
    raw,
    startTs,
    eventId: raw.event_id ?? raw.id ?? null,
    homeId: raw.home_team_id ?? raw.homeTeam?.id ?? null,
    awayId: raw.away_team_id ?? raw.awayTeam?.id ?? null,
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
   Match card (Hub)
   =========================== */
/**
 * På hub:
 * - I listevisning: ingen sett-bokser, bare totalscore (Sett).
 * - Når et kort er "i fokus" (isFocused=true): vis sett-bokser og Tilbake-knapp.
 * - Ingen event.html – alt skjer lokalt.
 * - Fremtidige kamper uten score viser ".. - .." i stedet for "0 - 0".
 */
function MatchCard({ e, statusLabel, isFocused, onToggleFocus }){
  const hs = e.score?.homeSets ?? 0;
  const as = e.score?.awaySets ?? 0;
  const setsArr = safeArray(e.score?.sets);
  const tourLogo = tournamentLogoUrl(e.tournamentId);

  // Hvis kampen åpenbart ikke har startet: vis ".. - .."
  const hasAnySetPoints = setsArr.length > 0;
  const hasScore = (hs !== 0 || as !== 0 || hasAnySetPoints);
  const displayHomeSets = hasScore ? hs : "..";
  const displayAwaySets = hasScore ? as : "..";

  const handleClick = () => {
    onToggleFocus();
  };

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
        <div className="compTitle" title={compHeaderText(e)}>
          <MiniLogo src={tourLogo} />
          <span style={{ minWidth:0 }}>{compHeaderText(e)}</span>
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

      {/* Sett-bokser kun når kortet er i fokus */}
      {isFocused && (
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
      )}

      {/* Bunn-knapp: "Detaljert →" / "Tilbake" */}
      <div style={{ marginTop: 10, fontSize:12, fontWeight:700, display:"flex", justifyContent:"flex-end" }}>
        <button
          type="button"
          className="btn"
          style={{ padding:"4px 8px", fontSize:11 }}
          onClick={(ev) => { ev.stopPropagation(); onToggleFocus(); }}
        >
          {isFocused ? "Tilbake" : "Detaljert →"}
        </button>
      </div>
    </div>
  );
}

/* ===========================
   App
   =========================== */
function App(){
  const [tab, setTab] = useState("teams"); // "teams" | "players"
  const [qTeams, setQTeams] = useState("");
  const [qPlayers, setQPlayers] = useState("");

  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);

  // global matches (for meta)
  const [live, setLive] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [finished, setFinished] = useState([]);

  // team view matches
  const [liveTeam, setLiveTeam] = useState([]);
  const [nextTeam, setNextTeam] = useState([]);
  const [prevTeam, setPrevTeam] = useState([]);

  // fokus på enkeltkamp (hub)
  const [focusedEventKey, setFocusedEventKey] = useState(null);

  // HUB-spesifikke filtre for lag (abroad / mizuno / all)
  const [teamFilter, setTeamFilter] = useState("all");

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
    const res = await fetch(base + path, { headers:{ "Accept":"application/json" }, signal, cache:"no-store" });
    if(!res.ok) throw new Error(String(res.status) + " " + String(res.statusText));
    return res.json();
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

    const teamsArr = Array.isArray(teamsData) ? teamsData : safeArray(teamsData?.items);
    const playersArr = Array.isArray(playersData) ? playersData : safeArray(playersData?.items);

    setTeams(teamsArr.map(normalizeTeam).filter(t => t && t.id));
    setPlayers(playersArr.map(normalizePlayer).filter(p => p && p.id));
  }

  async function loadGlobalMatches(){
    const now = Math.floor(Date.now()/1000);
    const toNext = now + LOOKAHEAD_DAYS*24*3600;
    const fromPrev = now - LOOKBACK_DAYS*24*3600;

    const [liveData, nextData, prevData] = await Promise.all([
      fetchJson(API_BASE_EVENTS, "/live", new AbortController().signal),
      fetchJson(API_BASE_EVENTS, `/events?from_ts=${now}&to_ts=${toNext}&limit=1000&offset=0`, new AbortController().signal),
      fetchJson(API_BASE_EVENTS, `/events?from_ts=${fromPrev}&to_ts=${now}&limit=1000&offset=0`, new AbortController().signal),
    ]);

    const liveArr = safeArray(liveData).map(normalizeEvent);
    const nextArr = safeArray(nextData).map(normalizeEvent).filter(e => !isFinished(e.raw)).sort((a,b)=>(a.startTs??0)-(b.startTs??0));
    const prevArr = safeArray(prevData).map(normalizeEvent).filter(e => isFinished(e.raw)).sort((a,b)=>(b.startTs??0)-(a.startTs??0));

    setLive(liveArr);
    setUpcoming(nextArr);
    setFinished(prevArr);
  }

  async function loadTeamMatches(team){
    if (!team || team.sofascoreTeamId == null) {
      setLiveTeam([]); setNextTeam([]); setPrevTeam([]);
      setFocusedEventKey(null);
      return;
    }
    const teamSofa = team.sofascoreTeamId;

    const now = Math.floor(Date.now()/1000);
    const toNext = now + LOOKAHEAD_DAYS*24*3600;
    const fromPrev = now - LOOKBACK_DAYS*24*3600;

    try{
      const [liveData, nextData, prevData] = await Promise.all([
        fetchJson(API_BASE_EVENTS, "/live", new AbortController().signal),
        fetchJson(API_BASE_EVENTS, `/events?from_ts=${now}&to_ts=${toNext}&limit=1000&offset=0`, new AbortController().signal),
        fetchJson(API_BASE_EVENTS, `/events?from_ts=${fromPrev}&to_ts=${now}&limit=1000&offset=0`, new AbortController().signal),
      ]);

      const liveArr = safeArray(liveData)
        .map(normalizeEvent)
        .filter(e => e.homeId===teamSofa || e.awayId===teamSofa);

      const nextArr = safeArray(nextData)
        .map(normalizeEvent)
        .filter(e => (e.homeId===teamSofa || e.awayId===teamSofa) && !isFinished(e.raw))
        .sort((a,b)=>(a.startTs??0)-(b.startTs??0));

      const prevArr = safeArray(prevData)
        .map(normalizeEvent)
        .filter(e => (e.homeId===teamSofa || e.awayId===teamSofa) && isFinished(e.raw))
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try{
        await loadCore();
        await loadGlobalMatches();
        if (cancelled) return;

        pollRef.current = setInterval(async () => {
          await loadCore();
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

  useEffect(() => {
    if (!selectedTeam) return;
    loadTeamMatches(selectedTeam);
  }, [selectedTeam]);

  /* ===========
     Build "best" tournament/season per team (based on events)
     =========== */
  const teamEventMeta = useMemo(() => {
    const allEvents = [...live, ...upcoming, ...finished];
    const agg = new Map(); // sofaId -> { tournaments: Map(name->count), seasons: Map(name->count) }

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
  // Lag: filtrer på groupType (abroad / mizuno / all) + søk
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

  // Gruppér lag på liga
  const leagueGroups = useMemo(() => {
    const groups = new Map(); // leagueLabel -> [teams]
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

  // Spillere – søk + alfabetisk
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
    return players.filter(p => p.teamId === selectedTeam.id).sort((a,b)=>a.name.localeCompare(b.name,"nb"));
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
      if (playerTeam) {
        setSelectedTeam(playerTeam);
        setTab("teams");
        setFocusedEventKey(null);
      }
    };

    return (
      <div className="card" style={{ cursor: playerTeam ? "pointer" : "default" }} onClick={handleClick}>
        <div className="row">
          <div className="left">
            <span className="logoBox" aria-hidden="true" style={{ width:72, height:72, borderRadius:16 }}>
              {(!photo || status !== "ok")
                ? <span style={{ fontWeight:900, fontSize:18 }}>{initials(p.name)}</span>
                : <img src={photo} alt="" loading="lazy" />}
            </span>
            <div className="nameBlock">
              <div className="name">{p.name}</div>
              <div className="sub">{line2 || "—"}</div>
              {playerTeam && (
                <div className="sub">
                  Lag: <strong>{playerTeam.name}</strong> {playerTeam.league ? ("· " + playerTeam.league) : ""}
                </div>
              )}
            </div>
          </div>
          <div className="meta">
            {p.externalUrl && (
              <a className="btn" href={p.externalUrl} target="_blank" rel="noreferrer">Volleybox →</a>
            )}
            {igUrl && (
              <a className="btn" href={igUrl} target="_blank" rel="noreferrer">Instagram →</a>
            )}
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
      {/* Topp: tabs + søk */}
      <div className="nav" style={{ justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button
            className={"btn " + (tab==="teams" ? "primary" : "")}
            onClick={() => { setTab("teams"); setSelectedTeam(null); setFocusedEventKey(null); }}
          >
            Lag
          </button>
          <button
            className={"btn " + (tab==="players" ? "primary" : "")}
            onClick={() => { setTab("players"); setSelectedTeam(null); setFocusedEventKey(null); }}
          >
            Spillere
          </button>

          {selectedTeam && tab==="teams" && (
            <button className="btn" onClick={() => { setSelectedTeam(null); setFocusedEventKey(null); }}>
              ← Tilbake
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

      {/* HUB-filtere for lag: Norske spillere ute / Norge Mizuno / Alle */}
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

      {/* TEAMS LIST – gruppert på liga */}
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

      {/* TEAM VIEW */}
      {tab === "teams" && selectedTeam && (
        <>
          {/* Lag-header */}
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

          {/* Spillere for laget – norske først */}
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

          {/* Kamper – alle listet, sett-bokser kun på fokusert kamp */}
          <div className="grid">
            {liveTeam.map(e => {
              const k = eventKey(e);
              return (
                <MatchCard
                  key={k}
                  e={e}
                  statusLabel="LIVE"
                  isFocused={focusedEventKey === k}
                  onToggleFocus={() => setFocusedEventKey(prev => prev === k ? null : k)}
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
                  onToggleFocus={() => setFocusedEventKey(prev => prev === k ? null : k)}
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
                  onToggleFocus={() => setFocusedEventKey(prev => prev === k ? null : k)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* PLAYERS TAB */}
      {tab === "players" && (
        <div className="grid">
          {visiblePlayers.map(p => <PlayerCardLarge key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("hub-root")).render(<App />);