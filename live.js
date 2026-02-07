const { useCallback, useEffect, useMemo, useRef, useState, memo } = React;

const API_BASE = "https://volleyball.ronesse.no";
const POLL_MS = 5000;

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
function initials(name){
  const s = asStr(name);
  if (!s) return "—";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "").toUpperCase();
  const b = (parts[1]?.[0] || "").toUpperCase();
  return (a + b) || s.slice(0, 2).toUpperCase();
}

/* ===========================
   Status / LIVE
   =========================== */
function liveLabel(statusType) {
  const t = String(statusType || "").toLowerCase();
  if (t.includes("inprogress") || t.includes("live") || t.includes("inplay")) return "LIVE";
  if (t.includes("finished") || t.includes("ended")) return "SLUTT";
  if (t.includes("not") || t.includes("sched")) return "KOMMER";
  return statusType || "—";
}

function isLiveStatus(statusType) {
  const t = String(statusType || "").toLowerCase();
  return t.includes("inprogress") || t.includes("live") || t.includes("inplay");
}

function statusDot(statusType) {
  const t = String(statusType || "").toLowerCase();
  if (t.includes("inprogress") || t.includes("live") || t.includes("inplay")) return "dot";
  if (t.includes("finished") || t.includes("ended")) return "dot gray";
  return "dot gray";
}

/* ===========================
   Sett / poeng
   =========================== */

// finn pågående sett + poeng
function currentPoints(ev) {
  let setNo = null;
  const m = String(ev.status_desc || "").match(/(\d+)/);
  if (m) setNo = Number(m[1]);

  if (!setNo) {
    for (let i = 5; i >= 1; i--) {
      if (ev["home_p" + i] != null || ev["away_p" + i] != null) { setNo = i; break; }
    }
  }

  return {
    setNo: setNo,
    home: setNo ? ev["home_p" + setNo] : null,
    away: setNo ? ev["away_p" + setNo] : null,
  };
}

/* ===========================
   Filter-knapper
   =========================== */

const FILTERS = [
  { key: "mizuno", label: "Mizuno Norge", empty: "Det er ingen pågående kamper for lag fra Norge nå." },
  { key: "abroad", label: "Norske spillere i utlandet", empty: "Det er ingen norske spillere i utlandet i aksjon nå." },
  { key: "other",  label: "Andre", empty: "Det er ingen andre livekamper for øyeblikket." },
];

/* ===========================
   Image cache / logoer
   =========================== */

const imgStatusCache = new Map(); // src -> "ok" | "fail"

function useImageStatus(src) {
  const [status, setStatus] = useState(src ? (imgStatusCache.get(src) || "loading") : "none");

  useEffect(() => {
    if (!src) { setStatus("none"); return; }

    const cached = imgStatusCache.get(src);
    if (cached) { setStatus(cached); return; }

    setStatus("loading");
    const img = new Image();

    img.onload = function () {
      imgStatusCache.set(src, "ok");
      setStatus("ok");
    };

    img.onerror = function () {
      imgStatusCache.set(src, "fail");
      setStatus("fail");
    };

    img.src = src;
  }, [src]);

  return status;
}

function LogoBox(props) {
  const src = props.src;
  const status = useImageStatus(src);

  if (!src || status !== "ok") {
    return <span className="logoBox" aria-hidden="true"></span>;
  }

  return (
    <span className="logoBox" aria-hidden="true">
      <img src={src} alt="" loading="lazy" />
    </span>
  );
}

/* ===========================
   URL-regler
   =========================== */

function teamLogoUrl(sofaTeamId) {
  const id = nonEmpty(sofaTeamId);
  if (!id) return null;
  return API_BASE + "/img/teams/" + id + ".png";
}

function playerPhotoUrl(playerId) {
  const id = nonEmpty(playerId);
  if (!id) return null;
  return API_BASE + "/img/players/" + id + ".jpg";
}

/* ===========================
   SetBox
   =========================== */

const SetBox = memo(function SetBox(props) {
  const style = props.highlight ? { borderColor: "#c7d2fe", background: "#eef2ff" } : null;
  return (
    <div className="setbox" style={style}>
      <div className="label">{props.label}</div>
      <div className="val">{props.home ?? "—"} - {props.away ?? "—"}</div>
    </div>
  );
});

/* ===========================
   Serve-icon
   =========================== */

function ServeIcon({ side, hot }) {
  const className =
    "serveIcon " +
    (side === "home" ? "home" : "away") +
    (hot ? " hot" : "");

  const isHome = side === "home";

  return (
    <span
      className={className}
      title={
        hot
          ? "Break-point (poeng på egen serve)"
          : "Server"
      }
      aria-hidden="true"
    >
      <span className="serveIconInner">
        {hot && isHome && <span>🔥</span>}
        <span>🏐</span>
        {hot && !isHome && <span>🔥</span>}
      </span>
    </span>
  );
}

/* ===========================
   ID helpers
   =========================== */

function getHomeId(ev) { return ev.home_team_id ?? ev.home_teams_id ?? null; }
function getAwayId(ev) { return ev.away_team_id ?? ev.away_teams_id ?? null; }

function eventId(ev) {
  return ev.event_id ?? ev.custom_id ?? null;
}

function eventKey(ev) {
  const id = eventId(ev);
  if (id != null) return String(id);
  return (
    String(ev.start_ts ?? "") + "-" +
    String(ev.home_team_name ?? "") + "-" +
    String(ev.away_team_name ?? "")
  );
}

/* ===========================
   Gruppering via teams-tabellen
   =========================== */
/**
 *  - "mizuno"  : minst ett lag finnes i teams og har country === "Norge"
 *  - "abroad"  : minst ett lag finnes i teams, men ingen med country === "Norge"
 *  - "other"   : ingen av lagene finnes i teams
 */
function classifyEventGroup(ev, teamsBySofaId) {
  if (!teamsBySofaId || typeof teamsBySofaId.get !== "function") {
    return "other";
  }

  const homeTeam = teamsBySofaId.get(getHomeId(ev));
  const awayTeam = teamsBySofaId.get(getAwayId(ev));

  const hasHome = !!homeTeam;
  const hasAway = !!awayTeam;

  const hasNorwegian =
    (homeTeam && homeTeam.country === "Norge") ||
    (awayTeam && awayTeam.country === "Norge");

  const anyKnown = hasHome || hasAway;

  if (hasNorwegian) return "mizuno";
  if (anyKnown) return "abroad";
  return "other";
}

/* ===========================
   Country + flagg
   =========================== */

const FLAG_BY_COUNTRY = {
  // Norden
  "Norge": "🇳🇴",
  "Norway": "🇳🇴",
  "Sverige": "🇸🇪",
  "Sweden": "🇸🇪",
  "Danmark": "🇩🇰",
  "Denmark": "🇩🇰",
  "Finland": "🇫🇮",

  // Vest- og Sentral-Europa
  "Germany": "🇩🇪",
  "Tyskland": "🇩🇪",
  "France": "🇫🇷",
  "Frankrike": "🇫🇷",
  "Italy": "🇮🇹",
  "Italia": "🇮🇹",
  "Spain": "🇪🇸",
  "Spania": "🇪🇸",
  "Netherlands": "🇳🇱",
  "Nederland": "🇳🇱",
  "Belgium": "🇧🇪",
  "Belgia": "🇧🇪",
  "Switzerland": "🇨🇭",
  "Sveits": "🇨🇭",
  "Austria": "🇦🇹",
  "Østerrike": "🇦🇹",
  "Portugal": "🇵🇹",
  "Greece": "🇬🇷",

  // Øst-Europa / Balkan
  "Poland": "🇵🇱",
  "Polen": "🇵🇱",
  "Czechia": "🇨🇿",
  "Czech Republic": "🇨🇿",
  "Croatia": "🇭🇷",
  "Serbia": "🇷🇸",
  "Bosnia & Herzegovina": "🇧🇦",
  "Bosnia and Herzegovina": "🇧🇦",

  // Baltikum
  "Estonia": "🇪🇪",
  "Estland": "🇪🇪",
  "Lithuania": "🇱🇹",
  "Litauen": "🇱🇹",
  "Latvia": "🇱🇻",

  // Nord-Amerika
  "USA": "🇺🇸",
  "United States": "🇺🇸",
  "Canada": "🇨🇦",

  // Asia
  "Japan": "🇯🇵",
  "Japen": "🇯🇵", // som i teams-data
  "Turkey": "🇹🇷",
  "Tyrkia": "🇹🇷",
};

function countryWithFlag(name) {
  const c = asStr(name);
  if (!c) return null;
  const flag = FLAG_BY_COUNTRY[c] || "";
  return flag ? (flag + " " + c) : c;
}

/**
 * Prøv å finne country for en kamp:
 * 1. Fra teams-tabellen (home/away)
 * 2. Fra raw_json.tournament.category.country.name
 * 3. Fra tournament_name / season_name (tekst-søk på land)
 */
function deriveCountryLabel(ev, teamsBySofaId) {
  const homeTeam = teamsBySofaId.get(getHomeId(ev));
  const awayTeam = teamsBySofaId.get(getAwayId(ev));

  let country =
    homeTeam?.country ||
    awayTeam?.country ||
    null;

  // 2) Forsøk å lese fra raw_json (Swagger-json fra SofaScore)
  if (!country && ev.raw_json) {
    try {
      const raw = JSON.parse(ev.raw_json);
      country =
        raw?.tournament?.category?.country?.name ||
        raw?.tournament?.category?.name ||
        null;
    } catch (e) {
      // ignorer parse-feil
    }
  }

  // 3) Fallback: søk etter land i tournament_name / season_name
  if (!country) {
    const text = (asStr(ev.tournament_name) + " " + asStr(ev.season_name)).toLowerCase();

    const KEYWORD_COUNTRIES = [
      // Norden
      { canonical: "Norway",    keys: ["norway", "norge"] },
      { canonical: "Sweden",    keys: ["sweden", "sverige"] },
      { canonical: "Denmark",   keys: ["denmark", "danmark"] },
      { canonical: "Finland",   keys: ["finland", "lentopallo"] },

      // Vest- / Sentral-Europa
      { canonical: "Austria",   keys: ["austria", "österreich", "oesterreich", "østerrike"] },
      { canonical: "Germany",   keys: ["germany", "bundesliga", "tyskland"] },
      { canonical: "France",    keys: ["france", "ligue a", "frankrike"] },
      { canonical: "Italy",     keys: ["italy", "italia", "serie a", "superlega"] },
      { canonical: "Spain",     keys: ["spain", "superliga"] },
      { canonical: "Portugal",  keys: ["portugal"] },
      { canonical: "Greece",    keys: ["greece", "greek"] },
      { canonical: "Netherlands", keys: ["netherlands", "nederland", "eredivisie"] },
      { canonical: "Belgium",   keys: ["belgium", "liga heren"] },
      { canonical: "Switzerland", keys: ["switzerland", "sveits"] },

      // Øst-Europa / Balkan
      { canonical: "Poland",    keys: ["poland", "polen", "plusliga", "tauron", "1. liga"] },
      { canonical: "Czechia",   keys: ["czech", "extraliga"] },
      { canonical: "Croatia",   keys: ["croatia", "hrvatska"] },
      { canonical: "Serbia",    keys: ["serbia", "superliga srbije", "srbija"] },
      { canonical: "Bosnia & Herzegovina", keys: ["bosnia", "herzegovina"] },

      // Baltikum
      { canonical: "Estonia",   keys: ["estonia", "estland", "baltic league"] },
      { canonical: "Lithuania", keys: ["lithuania", "litauen"] },
      { canonical: "Latvia",    keys: ["latvia"] },

      // Nord-Amerika
      { canonical: "USA",       keys: ["usa", "united states", "ncaa", "big west", "eiva"] },
      { canonical: "Canada",    keys: ["canada", "canada west"] },

      // Asia
      { canonical: "Japan",     keys: ["japan", "v.league", "japen"] },
      { canonical: "Turkey",    keys: ["turkey", "sultanlar", "efeler"] },
    ];

    for (const cfg of KEYWORD_COUNTRIES) {
      if (cfg.keys.some(k => text.includes(k))) {
        country = cfg.canonical;
        break;
      }
    }
  }

  return countryWithFlag(country);
}

/* ===========================
   Player avatar (norske spillere)
   =========================== */

const PlayerAvatar = memo(function PlayerAvatar({ player }) {
  const src = playerPhotoUrl(player.id);
  const status = useImageStatus(src);
  const name = player.name || "–";

  if (!src || status === "fail" || status === "none" || status === "loading") {
    // fallback: sirkel med initialer
    return (
      <span
        className="playerAvatar"
        title={name}
        style={{
          width: 28,
          height: 28,
          borderRadius: "9999px",
          overflow: "hidden",
          border: "2px solid #e5e7eb",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafb",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <span
      className="playerAvatar"
      title={name}
      style={{
        width: 28,
        height: 28,
        borderRadius: "9999px",
        overflow: "hidden",
        border: "2px solid #e5e7eb",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9fafb",
      }}
    >
      <img
        src={src}
        alt={name}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </span>
  );
});

/* ===========================
   EventCard
   =========================== */

function EventCard(props) {
  const {
    ev,
    flashInfo,
    serveInfo,
    playLabelInfo,
    isFocused,
    onClick,
    isAbroadGroup,
    norPlayersHome = [],
    norPlayersAway = [],
    countryLabel,
  } = props;

  const label = liveLabel(ev.status_type);
  const p = currentPoints(ev);

  const setsHome = (ev.home_sets ?? 0);
  const setsAway = (ev.away_sets ?? 0);

  const currentSetText = p.setNo ? (String(p.setNo) + ". sett") : (ev.status_desc || "Pågår");

  const homeId = getHomeId(ev);
  const awayId = getAwayId(ev);

  const homeLogo = teamLogoUrl(homeId);
  const awayLogo = teamLogoUrl(awayId);

  const isServingHome = serveInfo && serveInfo.side === "home";
  const isServingAway = serveInfo && serveInfo.side === "away";
  const hotHome = isServingHome && serveInfo.hot;
  const hotAway = isServingAway && serveInfo.hot;

  const cls = "card" + (isFocused ? " focused" : "");

  let playText = null;
  if (playLabelInfo && playLabelInfo.type === "break-point") {
    playText = "Break-point";
  } else if (playLabelInfo && playLabelInfo.type === "side-out") {
    playText = "Side-out";
  }

  const headerTournament = asStr(ev.tournament_name) || "—";
  const subParts = [];
  if (countryLabel) subParts.push(countryLabel);
  if (ev.group_type) subParts.push(String(ev.group_type));
  const subText = subParts.join(" · ");

  // Sett-bokser
  const setBoxes = [];
  for (let i = 1; i <= 5; i++) {
    const h = ev["home_p" + i];
    const a = ev["away_p" + i];
    if (h == null && a == null) continue;
    setBoxes.push(
      <SetBox
        key={i}
        label={i + ". sett"}
        home={h}
        away={a}
        highlight={p.setNo === i}
      />
    );
  }

  const showNorwegians = isFocused && isAbroadGroup;

  return (
    <div className={cls} onClick={onClick} role="button">
      <div className="cardHeader">
        <div>
          <div className="compTitle">
            <span className="tournamentName">{headerTournament}</span>
          </div>
          {subText && <div className="sub">{subText}</div>}
        </div>

        <div className="status" title={ev.status_desc || ""}>
          <span className={statusDot(ev.status_type)}></span>
          {label + (ev.status_desc ? " · " + String(ev.status_desc) : "")}
        </div>
      </div>

      <div className="scoreRow">
        <div className="team">
          {showNorwegians && norPlayersHome.length > 0 && (
            <div
              className="norPlayersRow"
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 4,
                flexWrap: "wrap",
              }}
            >
              {norPlayersHome.map(p => (
                <PlayerAvatar
                  key={p.id}
                  player={p}
                />
              ))}
            </div>
          )}

          <LogoBox src={homeLogo} />
          <span className="teamName">{ev.home_team_name}</span>
        </div>

        <div className="bigScore">
          <div className="pointsMain">
            <span
              key={"ph-" + (flashInfo.home || 0)}
              className={"pointVal" + (flashInfo.home ? " blinkScore" : "")}
            >
              <span className="pointWrap home">
                <span className="pointNumber">{p.home ?? "—"}</span>
                {isServingHome && <ServeIcon side="home" hot={hotHome} />}
              </span>
            </span>

            <span className="pointSep">-</span>

            <span
              key={"pa-" + (flashInfo.away || 0)}
              className={"pointVal" + (flashInfo.away ? " blinkScore" : "")}
            >
              <span className="pointWrap away">
                <span className="pointNumber">{p.away ?? "—"}</span>
                {isServingAway && <ServeIcon side="away" hot={hotAway} />}
              </span>
            </span>
          </div>

          <div className="points">
            {setsHome} - {setsAway} i sett
            {p.setNo ? (" · " + currentSetText) : ""}
          </div>

          {isFocused && (isServingHome || isServingAway) && (
            <div className="serveInfoRow">
              <div>
                Serve · {isServingHome ? ev.home_team_name : ev.away_team_name}
              </div>
              {playText && (
                <div
                  className={
                    "playLabel " +
                    (playLabelInfo.type === "break-point" ? "break-point" : "side-out")
                  }
                >
                  {playText}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="team right">
          {showNorwegians && norPlayersAway.length > 0 && (
            <div
              className="norPlayersRow"
              style={{
                display: "flex",
                gap: 4,
                marginBottom: 4,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              {norPlayersAway.map(p => (
                <PlayerAvatar
                  key={p.id}
                  player={p}
                />
              ))}
            </div>
          )}

          <LogoBox src={awayLogo} />
          <span className="teamName">{ev.away_team_name}</span>
        </div>
      </div>

      {/* Sett-bokser kun når kortet er i fokus – på rad */}
      {isFocused && setBoxes.length > 0 && (
        <div
          className="setRow"
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          {setBoxes}
        </div>
      )}

      {/* Starttid bevisst fjernet */}
    </div>
  );
}

/* ===========================
   App
   =========================== */

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("other");
  const [flash, setFlash] = useState({});
  const [serve, setServe] = useState({});
  const [playLabel, setPlayLabel] = useState({});
  const [focusedId, setFocusedId] = useState(null);

  // teams + players
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  const pollRef = useRef(null);
  const abortLiveRef = useRef(null);
  const serveRef = useRef({});
  const wakeLockRef = useRef(null);

  const fetchJson = useCallback(async (path, signal) => {
    const res = await fetch(API_BASE + path, {
      headers: { "Accept": "application/json" },
      signal: signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status) + " " + String(res.statusText));
    return res.json();
  }, []);

  /* ---- Hent teams ---- */

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const data = await fetchJson("/teams?limit=1000&offset=0", controller.signal);
        if (!cancelled) {
          setTeams(safeArray(data));
        }
      } catch (e) {
        if (String(e && e.name) === "AbortError") return;
        console.warn("Feil ved henting av teams:", e);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchJson]);

  /* ---- Hent players ---- */

  function normalizePlayer(p) {
    return {
      id: nonEmpty(p.id),
      name: asStr(p.name) || "—",
      nationality: nonEmpty(p.nationality),
      sofascoreTeamId: asNum(p.sofascore_team_id),
    };
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const data = await fetchJson("/players?limit=1000&offset=0", controller.signal);
        if (!cancelled) {
          const arr = Array.isArray(data) ? data : safeArray(data?.items);
          setPlayers(
            arr.map(normalizePlayer).filter(p => p && p.id && p.sofascoreTeamId != null)
          );
        }
      } catch (e) {
        if (String(e && e.name) === "AbortError") return;
        console.warn("Feil ved henting av players:", e);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchJson]);

  /* ---- Map'er ---- */

  const teamsBySofaId = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < teams.length; i++) {
      const t = teams[i];
      if (!t) continue;
      const raw = t.sofascore_team_id;
      if (raw == null || raw === "") continue;
      const key = Number(raw);
      if (!Number.isNaN(key)) {
        map.set(key, t);
      }
    }
    return map;
  }, [teams]);

  // sofascore_team_id -> [norske spillere]
  const playersByTeamSofaId = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p) continue;

      const isNorwegian = asStr(p.nationality).toLowerCase().includes("nor");
      if (!isNorwegian) continue;

      const key = p.sofascoreTeamId;
      if (key == null || Number.isNaN(key)) continue;

      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return map;
  }, [players]);

  /* ---- Hent live og oppdater flash/serve ---- */

  const loadLive = useCallback(async () => {
    if (abortLiveRef.current) abortLiveRef.current.abort();
    const controller = new AbortController();
    abortLiveRef.current = controller;

    try {
      setError("");
      const data = await fetchJson("/live", controller.signal);

      const newServe = {};
      const newPlayLabel = {};

      setEvents(prevEvents => {
        const prevPointsMap = new Map();
        for (let i = 0; i < prevEvents.length; i++) {
          const ev = prevEvents[i];
          prevPointsMap.set(eventKey(ev), currentPoints(ev));
        }

        const prevServeMap = serveRef.current || {};
        const nextEvents = safeArray(data);
        const newFlash = {};
        const base = Date.now();

        for (let i = 0; i < nextEvents.length; i++) {
          const ev = nextEvents[i];
          const key = eventKey(ev);
          const p = currentPoints(ev);
          const prev = prevPointsMap.get(key) || {};
          const prevServe = prevServeMap[key] || null;

          let sideScored = null;

          if (p.home != null && prev.home != null && p.home > prev.home) {
            sideScored = "home";
            if (!newFlash[key]) newFlash[key] = {};
            newFlash[key].home = base + Math.random();
          }
          if (p.away != null && prev.away != null && p.away > prev.away) {
            sideScored = "away";
            if (!newFlash[key]) newFlash[key] = {};
            newFlash[key].away = base + Math.random();
          }

          let currentServe = prevServe;
          let label = null;

          if (sideScored) {
            if (prevServe && prevServe.side === sideScored) {
              currentServe = { side: sideScored, hot: true };
              label = { side: sideScored, type: "break-point" };
            } else if (prevServe && prevServe.side && prevServe.side !== sideScored) {
              currentServe = { side: sideScored, hot: false };
              label = { side: sideScored, type: "side-out" };
            } else {
              currentServe = { side: sideScored, hot: false };
            }
          }

          newServe[key] = currentServe || null;
          if (label) newPlayLabel[key] = label;
        }

        setFlash(newFlash);
        return nextEvents;
      });

      serveRef.current = newServe;
      setServe(newServe);
      setPlayLabel(newPlayLabel);
    } catch (e) {
      if (String(e && e.name) === "AbortError") return;
      setError(String((e && e.message) ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  /* ---- Wake Lock ---- */

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && navigator.wakeLock && navigator.wakeLock.request) {
        if (!wakeLockRef.current) {
          const lock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = lock;
          lock.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      }
    } catch (err) {
      console.warn("WakeLock request feilet:", err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (err) {
      console.warn("WakeLock release feilet:", err);
    }
  }, []);

  /* ---- Poll / cleanup ---- */

  useEffect(() => {
    loadLive();
    pollRef.current = setInterval(loadLive, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortLiveRef.current) abortLiveRef.current.abort();
      releaseWakeLock();
    };
  }, [loadLive, releaseWakeLock]);

  const liveEvents = useMemo(() => {
    return events.filter(ev => isLiveStatus(ev.status_type));
  }, [events]);

  /* ---- tell opp per gruppe ---- */

  const counts = useMemo(() => {
    let miz = 0, abr = 0, oth = 0;
    for (let i = 0; i < liveEvents.length; i++) {
      const ev = liveEvents[i];
      const group = classifyEventGroup(ev, teamsBySofaId);
      if (group === "mizuno") miz++;
      else if (group === "abroad") abr++;
      else oth++;
    }
    return { abroad: abr, mizuno: miz, other: oth, all: liveEvents.length };
  }, [liveEvents, teamsBySofaId]);

  /* ---- smart default-filter ---- */

  useEffect(() => {
    if (counts.mizuno > 0) {
      setFilter("mizuno");
    } else if (counts.abroad > 0) {
      setFilter("abroad");
    } else {
      setFilter("other");
    }
  }, [counts.abroad, counts.mizuno, counts.other]);

  /* ---- filtrerte events ---- */

  const filtered = useMemo(() => {
    const arr = liveEvents.slice();
    arr.sort((a, b) => (a.start_ts ?? 0) - (b.start_ts ?? 0));
    return arr.filter(ev => classifyEventGroup(ev, teamsBySofaId) === filter);
  }, [liveEvents, filter, teamsBySofaId]);

  /* ---- fokuslogikk ---- */

  const visible = useMemo(() => {
    if (!focusedId) return filtered;

    const found =
      filtered.find(ev => eventId(ev) === focusedId) ||
      liveEvents.find(ev => eventId(ev) === focusedId) ||
      null;

    return found ? [found] : filtered;
  }, [filtered, focusedId, liveEvents]);

  const currentFilterObj = FILTERS.find(x => x.key === filter);

  /* ---- Wake Lock vs fokus ---- */

  useEffect(() => {
    let focusedEvent = null;
    if (focusedId != null) {
      focusedEvent =
        filtered.find(ev => eventId(ev) === focusedId) ||
        liveEvents.find(ev => eventId(ev) === focusedId) ||
        null;
    }

    const cp = focusedEvent ? currentPoints(focusedEvent) : null;
    const hasActiveSet = !!(cp && cp.setNo != null);

    const shouldKeepAwake =
      !!focusedEvent &&
      isLiveStatus(focusedEvent.status_type) &&
      hasActiveSet;

    if (shouldKeepAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible" && shouldKeepAwake) {
        requestWakeLock();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [focusedId, filtered, liveEvents, requestWakeLock, releaseWakeLock]);

  /* ---- Hjelper: norske spillere for lag ---- */

  function getNorPlayersForTeam(teamId) {
    if (teamId == null) return [];
    const key = Number(teamId);
    if (Number.isNaN(key)) return [];
    return playersByTeamSofaId.get(key) || [];
  }

  /* ---- Render ---- */

  return (
    <div className="wrap">
      {/* Fokus-/filter-linje */}
      <div className="focusBar">
        <div className="badges" style={{ marginBottom: 4 }}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            const n =
              f.key === "abroad" ? counts.abroad :
              f.key === "mizuno" ? counts.mizuno :
              counts.other;

            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setFocusedId(null); }}
                className="badge filterBtn"
                style={{
                  background: active ? "#111827" : "#fafafa",
                  color: active ? "#ffffff" : "#111827",
                  borderColor: active ? "#111827" : "var(--border)",
                }}
                title={f.label}
              >
                {f.label} ({n})
              </button>
            );
          })}
        </div>

        {focusedId && (
          <button className="backBtn" onClick={() => setFocusedId(null)}>
            ← Tilbake til alle kamper
          </button>
        )}
      </div>

      {focusedId && (
        <div className="focusInfo">
          Viser én kamp i fokus. Skjermen holdes våken bare mens et sett faktisk pågår
          (der det støttes av nettleseren).
        </div>
      )}

      {error && <div className="alert">Feil: {error}</div>}
      {loading && <div style={{ marginTop: 10, color: "#6b7280" }}>Laster…</div>}

      {!loading && !error && visible.length === 0 && (
        <div className="card" style={{ marginTop: 10, cursor: "default" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Ingen livekamper</div>
          <div style={{ color: "#6b7280" }}>
            {currentFilterObj?.empty}
          </div>
        </div>
      )}

      <div className="grid">
        {visible.map(ev => {
          const keyStr = eventKey(ev);
          const flashInfo = flash[keyStr] || {};
          const serveInfo = serve[keyStr] || {};
          const playLabelInfo = playLabel[keyStr] || null;
          const isFocused = focusedId != null && eventId(ev) === focusedId;

          const id = eventId(ev);

          const group = classifyEventGroup(ev, teamsBySofaId);
          const isAbroadGroup = group === "abroad";

          const norPlayersHome = isAbroadGroup ? getNorPlayersForTeam(getHomeId(ev)) : [];
          const norPlayersAway = isAbroadGroup ? getNorPlayersForTeam(getAwayId(ev)) : [];

          const countryLabel = deriveCountryLabel(ev, teamsBySofaId);

          return (
            <EventCard
              key={keyStr}
              ev={ev}
              flashInfo={flashInfo}
              serveInfo={serveInfo}
              playLabelInfo={playLabelInfo}
              isFocused={isFocused}
              isAbroadGroup={isAbroadGroup}
              norPlayersHome={norPlayersHome}
              norPlayersAway={norPlayersAway}
              countryLabel={countryLabel}
              onClick={() => {
                if (id == null) {
                  setFocusedId(null);
                } else {
                  setFocusedId(prev => (prev === id ? null : id));
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("live-root")).render(<App />);