// follow2.js
const { useEffect, useMemo, useState } = React;

/**
 * Vi gjenbruker samme base-URL som live2.js
 * (API_BASE er definert der i global scope).
 * Hvis du vil ha egen base, kan du bytte til API_BASE_EVENTS.
 */

const FOLLOW_LOOKAHEAD_DAYS = 30; // hvor langt frem vi ser etter neste kamp

/* ===========================
   Generelle helpers
   =========================== */
function safeArray(x) { return Array.isArray(x) ? x : []; }
function asStr(v){ return (v == null) ? "" : String(v).trim(); }
function nonEmpty(v){ const s = asStr(v); return s ? s : null; }
function asNum(v){
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getHomeId(ev) { return ev.home_team_id ?? ev.home_teams_id ?? null; }
function getAwayId(ev) { return ev.away_team_id ?? ev.away_teams_id ?? null; }

/* ===========================
   Lagre fulgte lag i localStorage
   =========================== */

const LS_KEY = "volley_followed_teams_v1";

function loadFollowedIds(){
  try{
    const raw = window.localStorage.getItem(LS_KEY);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    if(!Array.isArray(arr)) return [];
    return arr.map(x => Number(x)).filter(n => Number.isFinite(n));
  } catch(e){
    return [];
  }
}

function saveFollowedIds(ids){
  try{
    const arr = Array.from(new Set(ids.map(x => Number(x)).filter(n => Number.isFinite(n))));
    window.localStorage.setItem(LS_KEY, JSON.stringify(arr));
  } catch(e){}
}

/* ===========================
   Countdown-komponent
   =========================== */

function formatCountdown(deltaMs){
  if(deltaMs <= 0) return "Kampstart!";

  let totalSec = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSec / 86400);
  totalSec -= days * 86400;

  const hours = Math.floor(totalSec / 3600);
  totalSec -= hours * 3600;

  const mins = Math.floor(totalSec / 60);
  const secs = totalSec - mins * 60;

  const pad = (n) => String(n).padStart(2, "0");

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function Countdown({ startTs }){
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if(!startTs) return <span>Ukjent tid</span>;

  const startMs = startTs * 1000;
  const diff = startMs - now;

  return (
    <span className="pointsMain">
      {formatCountdown(diff)}
    </span>
  );
}

/* ===========================
   Kampkort for "Mine lag"
   =========================== */

function MyTeamMatchCard({ ev, team, isHome }){
  // Vi gjenbruker helpers fra live2.js hvis de finnes
  const homeId = getHomeId(ev);
  const awayId = getAwayId(ev);

  const homeName = asStr(ev.home_team_name || ev.homeTeam?.name || "Home");
  const awayName = asStr(ev.away_team_name || ev.awayTeam?.name || "Away");

  const startTs = ev.start_ts ?? ev.startTimestamp ?? null;
  const startDate = startTs
    ? new Date(startTs * 1000).toLocaleString("nb-NO", {
        weekday:"short",
        day:"2-digit",
        month:"short",
        hour:"2-digit",
        minute:"2-digit"
      })
    : "Ukjent";

  // Hvis teamLogoUrl finnes fra live2.js, bruk den. Ellers fallback.
  let homeLogo = null;
  let awayLogo = null;

  try {
    if (typeof teamLogoUrl === "function") {
      homeLogo = teamLogoUrl(homeId);
      awayLogo = teamLogoUrl(awayId);
    }
  } catch(e){}

  const tournamentAndSeason = (function(){
    try {
      if (typeof getTournamentAndSeason === "function") {
        const ts = getTournamentAndSeason(ev);
        return ts.season ? `${ts.tournament} · ${ts.season}` : ts.tournament;
      }
    } catch(e){}
    return asStr(ev.tournament_name || ev.tournament?.name || "—");
  })();

  const metaLine = (function(){
    const parts = [];

    try {
      if (typeof deriveCountryLabel === "function") {
        const cl = deriveCountryLabel(ev, new Map()); // uten teamsBySofaId blir det ofte tomt uansett
        if (cl) parts.push(cl);
      }
    } catch(e){}

    try {
      if (typeof deriveStageLabel === "function") {
        const st = deriveStageLabel(ev);
        if (st) parts.push(st);
      }
    } catch(e){}

    if (!parts.length && ev.round_name) {
      parts.push(asStr(ev.round_name));
    }

    return parts.join(" · ");
  })();

  return (
    <div className="card matchCard">
      <div className="matchHeader">
        <div className="compTitle">
          <span className="miniLogo" aria-hidden="true"></span>
          <span style={{ minWidth:0 }}>
            {tournamentAndSeason || "—"}
          </span>
        </div>
        <span className="badge">
          <span className="dot gray"></span>
          Neste kamp · {startDate}
        </span>
      </div>

      <div className="scoreRow">
        <div className="team">
          {homeLogo && (
            <span className="miniLogo" aria-hidden="true">
              <img
                src={homeLogo}
                alt=""
                loading="lazy"
                style={{ width:"100%", height:"100%", objectFit:"contain" }}
              />
            </span>
          )}
          <span className="teamName">{homeName}</span>
        </div>

        <div className="bigScore">
          {/* NEDTELLING I STEDENFOR SCORE */}
          <Countdown startTs={startTs} />
          <div className="points">Kampstart</div>
        </div>

        <div className="team right">
          <span className="teamName">{awayName}</span>
          {awayLogo && (
            <span className="miniLogo" aria-hidden="true">
              <img
                src={awayLogo}
                alt=""
                loading="lazy"
                style={{ width:"100%", height:"100%", objectFit:"contain" }}
              />
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop:8, fontSize:12, color:"var(--muted)" }}>
        {metaLine || "Turnering"} · {startDate}
      </div>

      <div style={{ marginTop:10, fontSize:11, fontWeight:700, opacity:0.8 }}>
        {isHome ? "Hjemmekamp" : "Bortekamp"} for <strong>{team.name}</strong>
      </div>
    </div>
  );
}

/* ===========================
   Hoved-app "Mine lag"
   =========================== */

function FollowApp(){
  const [teams, setTeams] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [followedIds, setFollowedIds] = useState(() => loadFollowedIds());
  const [search, setSearch] = useState("");

  // Map sofascoreTeamId -> team
  const teamsBySofaId = useMemo(() => {
    const m = new Map();
    for (const t of teams) {
      const id = asNum(t.sofascore_team_id ?? t.sofascoreTeamId);
      if (!id) continue;
      m.set(id, {
        id: asNum(t.id),
        sofascoreId: id,
        name: asStr(t.name || t.widget_name || "—"),
        country: nonEmpty(t.country),
        league: nonEmpty(t.league),
      });
    }
    return m;
  }, [teams]);

  // Hent lag + upcoming kamper
  useEffect(() => {
    let cancelled = false;

    async function loadAll(){
      setLoading(true);
      setErr("");

      try{
        // 1) Teams
        const teamsRes = await fetch(API_BASE + "/teams", {
          headers:{ "Accept":"application/json" },
          cache:"no-store"
        });
        if (!teamsRes.ok) throw new Error("Feil ved henting av lag: " + teamsRes.status);
        const teamsJson = await teamsRes.json();
        if (!cancelled) setTeams(safeArray(teamsJson));

        // 2) Events (kommende x dager frem)
        const nowSec = Math.floor(Date.now()/1000);
        const toSec  = nowSec + FOLLOW_LOOKAHEAD_DAYS*86400;

        // Tilpass dette til ditt API hvis det er annerledes:
        const eventsRes = await fetch(
          API_BASE + `/events?from=${nowSec}&to=${toSec}`,
          { headers:{ "Accept":"application/json" }, cache:"no-store" }
        );
        if (!eventsRes.ok) throw new Error("Feil ved henting av kamper: " + eventsRes.status);
        const eventsJson = await eventsRes.json();

        if (!cancelled) {
          setEvents(safeArray(eventsJson));
        }
      }
      catch(e){
        if (!cancelled) {
          console.error(e);
          setErr(e.message || "Noe gikk galt");
        }
      }
      finally{
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => { cancelled = true; };
  }, []);

  // Toggle follow for et team
  function toggleFollow(sofaId){
    setFollowedIds(prev => {
      const id = Number(sofaId);
      let next;
      if (prev.includes(id)) {
        next = prev.filter(x => x !== id);
      } else {
        next = [...prev, id];
      }
      saveFollowedIds(next);
      return next;
    });
  }

  // Filtrer teams for venstresiden (valg-liste)
  const filteredTeams = useMemo(() => {
    const q = asStr(search).toLowerCase();
    const arr = [];
    for (const [sofaId, t] of teamsBySofaId.entries()) {
      if (!q || t.name.toLowerCase().includes(q) || (t.league || "").toLowerCase().includes(q)) {
        arr.push({ ...t, sofascoreId: sofaId });
      }
    }
    // sortér alfabetisk
    arr.sort((a,b) => a.name.localeCompare(b.name, "nb"));
    return arr;
  }, [teamsBySofaId, search]);

  // Finn neste kamp for hvert fulgt lag
  const nextByTeam = useMemo(() => {
    const nowSec = Math.floor(Date.now()/1000);
    const map = new Map(); // sofaId -> {team, event}

    function consider(sofaId, ev, isHome){
      const startTs = ev.start_ts ?? ev.startTimestamp ?? null;
      if (!startTs || startTs < nowSec) return;
      const current = map.get(sofaId);
      if (!current || startTs < (current.event.start_ts ?? current.event.startTimestamp ?? Infinity)) {
        const team = teamsBySofaId.get(sofaId);
        if (team) {
          map.set(sofaId, { team, event: ev, isHome });
        }
      }
    }

    for (const ev of events) {
      const homeId = asNum(getHomeId(ev));
      const awayId = asNum(getAwayId(ev));
      if (!homeId && !awayId) continue;

      if (homeId && followedIds.includes(homeId)) {
        consider(homeId, ev, true);
      }
      if (awayId && followedIds.includes(awayId)) {
        consider(awayId, ev, false);
      }
    }

    // til array
    const out = [];
    for (const [sofaId, obj] of map.entries()) {
      out.push({ sofascoreId: sofaId, ...obj });
    }
    // sorter på kampstart
    out.sort((a,b) => {
      const ta = a.event.start_ts ?? a.event.startTimestamp ?? Infinity;
      const tb = b.event.start_ts ?? b.event.startTimestamp ?? Infinity;
      return ta - tb;
    });
    return out;
  }, [events, followedIds, teamsBySofaId]);

  const hasFollowed = followedIds.length > 0;

  return (
    <div>
      <div className="topbar">
        <div className="badges">
          <div className="badge">
            <span className="dot gray"></span>
            Mine lag · neste kamp
          </div>
        </div>
        <div className="controls">
          <input
            type="text"
            placeholder="Søk etter lag for å følge…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth:220 }}
          />
        </div>
      </div>

      {err && (
        <div className="alert">
          {err}
        </div>
      )}

      {loading && (
        <div style={{ fontSize:14, color:"var(--muted)" }}>
          Laster lag og kommende kamper…
        </div>
      )}

      {!loading && (
        <div className="row" style={{ marginTop:10 }}>
          {/* Venstre: velge lag */}
          <div style={{ flex:"0 0 280px", maxWidth:280 }}>
            <div className="card">
              <div style={{ fontWeight:800, marginBottom:8, fontSize:14 }}>
                Lag du følger
              </div>
              <div style={{ fontSize:12, color:"var(--muted)", marginBottom:8 }}>
                Klikk på et lag for å følge/avfølge. Vi viser neste kamp for hvert lag du følger.
              </div>

              <div style={{
                maxHeight: 380,
                overflow:"auto",
                borderTop:"1px solid var(--border)",
                marginTop:8,
                paddingTop:8
              }}>
                {filteredTeams.map(t => {
                  const isOn = followedIds.includes(t.sofascoreId);
                  return (
                    <button
                      key={t.sofascoreId}
                      type="button"
                      className="btn"
                      style={{
                        width:"100%",
                        justifyContent:"space-between",
                        marginBottom:6,
                        background: isOn ? "#111827" : "#ffffff",
                        color: isOn ? "#ffffff" : "#111827",
                        borderColor: isOn ? "#111827" : "var(--border)"
                      }}
                      onClick={() => toggleFollow(t.sofascoreId)}
                    >
                      <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {t.name}
                      </span>
                      <span>
                        {isOn ? "✓ Følges" : "Følg"}
                      </span>
                    </button>
                  );
                })}

                {filteredTeams.length === 0 && (
                  <div style={{ fontSize:12, color:"var(--muted)" }}>
                    Ingen lag matcher søkeresultatet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Høyre: neste kamp per lag */}
          <div style={{ flex:"1 1 auto", minWidth:0 }}>
            {!hasFollowed && (
              <div className="card">
                <div style={{ fontWeight:800, marginBottom:6 }}>
                  Du følger ingen lag ennå
                </div>
                <div style={{ fontSize:13, color:"var(--muted)" }}>
                  Bruk listen til venstre for å markere lag du vil følge. Da viser vi neste registrerte kamp for hvert lag, med nedtelling til kampstart.
                </div>
              </div>
            )}

            {hasFollowed && nextByTeam.length === 0 && (
              <div className="card">
                <div style={{ fontWeight:800, marginBottom:6 }}>
                  Ingen kommende kamper
                </div>
                <div style={{ fontSize:13, color:"var(--muted)" }}>
                  Vi fant ingen kamper de neste {FOLLOW_LOOKAHEAD_DAYS} dagene for lagene du følger. Prøv å øke vinduet i follow2.js eller sjekk senere.
                </div>
              </div>
            )}

            {nextByTeam.length > 0 && (
              <div className="grid">
                {nextByTeam.map(({ team, event, isHome }) => (
                  <MyTeamMatchCard
                    key={String(team.sofascoreId) + "-" + String(event.event_id ?? event.custom_id ?? event.id ?? "")}
                    ev={event}
                    team={team}
                    isHome={isHome}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================
   Mount i follow-root
   =========================== */

(function mountFollow(){
  const rootEl = document.getElementById("follow-root");
  if (!rootEl) return;
  const root = ReactDOM.createRoot(rootEl);
  root.render(<FollowApp />);
})();
