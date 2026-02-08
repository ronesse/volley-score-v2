const { useCallback, useEffect, useMemo, useRef, useState, memo } = React;

const API_BASE = "https://volleyball.ronesse.no";
const POLL_MS = 5000;

/* ========== Shared helpers ========== */
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

/* ========== Status-tekst ========== */

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

/* ========== Grupperingstyper ========== */
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

/* ========== Sett / poeng ========== */
/**
 * Alltid bruk siste sett som faktisk har poeng (siste pN som ikke er null).
 * Da matcher stor-score og set-bokser.
 */
function currentPoints(ev) {
  let setNo = null;

  for (let i = 7; i >= 1; i--) {
    const h = ev["home_p" + i];
    const a = ev["away_p" + i];
    if (h != null || a != null) {
      setNo = i;
      break;
    }
  }

  return {
    setNo,
    home: setNo ? ev["home_p" + setNo] : null,
    away: setNo ? ev["away_p" + setNo] : null,
  };
}

/* ========== Filter-knapper ========== */

const FILTERS = [
  { key: "mizuno", label: "Mizuno Norge", empty: "Det er ingen pågående kamper for lag fra Norge nå." },
  { key: "abroad", label: "Norske spillere i utlandet", empty: "Det er ingen norske spillere i utlandet i aksjon nå." },
  { key: "other",  label: "Andre", empty: "Det er ingen andre livekamper for øyeblikket." },
];

/* ========== Image cache ========== */

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

/* ========== URL-regler ========== */

function teamLogoUrl(sofaTeamId) {
  const id = nonEmpty(sofaTeamId);
  if (!id) return null;
  return API_BASE + "/img/teams/" + id + ".png";
}

function tournamentLogoUrl(tournamentId) {
  const id = nonEmpty(tournamentId);
  if (!id) return null;
  return API_BASE + "/img/tournaments/" + id + ".png";
}

function playerPhotoUrl(playerId) {
  const id = nonEmpty(playerId);
  if (!id) return null;
  return API_BASE + "/img/players/" + id + ".jpg";
}

/* ========== Land / flagg ========== */

const COUNTRY_FLAGS = {
  // Norden
  "norway": "🇳🇴", "norge": "🇳🇴",
  "sweden": "🇸🇪", "sverige": "🇸🇪",
  "denmark": "🇩🇰", "danmark": "🇩🇰",
  "finland": "🇫🇮",
  "iceland": "🇮🇸", "island": "🇮🇸",
  // Vest-/Sentral-Europa
  "germany": "🇩🇪", "deutschland": "🇩🇪", "tyskland": "🇩🇪",
  "france": "🇫🇷", "frankrike": "🇫🇷",
  "netherlands": "🇳🇱", "holland": "🇳🇱", "nederland": "🇳🇱",
  "belgium": "🇧🇪", "belgia": "🇧🇪",
  "switzerland": "🇨🇭", "sveits": "🇨🇭",
  "austria": "🇦🇹", "østerrike": "🇦🇹",
  "luxembourg": "🇱🇺",
  "liechtenstein": "🇱🇮",
  // Sør-Europa
  "spain": "🇪🇸", "españa": "🇪🇸", "spania": "🇪🇸",
  "portugal": "🇵🇹",
  "italy": "🇮🇹", "italia": "🇮🇹",
  "greece": "🇬🇷", "hellas": "🇬🇷",
  "andorra": "🇦🇩",
  "san marino": "🇸🇲",
  "vatican": "🇻🇦",
  "malta": "🇲🇹",
  // Øst-Europa / Balkan
  "poland": "🇵🇱", "polen": "🇵🇱",
  "czechia": "🇨🇿", "czech republic": "🇨🇿",
  "slovakia": "🇸🇰",
  "hungary": "🇭🇺",
  "romania": "🇷🇴",
  "bulgaria": "🇧🇬",
  "slovenia": "🇸🇮",
  "croatia": "🇭🇷",
  "bosnia": "🇧🇦", "bosnia & herzegovina": "🇧🇦", "bosnia and herzegovina": "🇧🇦",
  "serbia": "🇷🇸",
  "montenegro": "🇲🇪",
  "kosovo": "🇽🇰",
  "north macedonia": "🇲🇰", "macedonia": "🇲🇰",
  "albania": "🇦🇱",
  // Baltikum / øst
  "lithuania": "🇱🇹",
  "latvia": "🇱🇻",
  "estonia": "🇪🇪",
  "ukraine": "🇺🇦",
  "belarus": "🇧🇾",
  "moldova": "🇲🇩",
  "russia": "🇷🇺",
  // UK & Irland
  "england": "🇬🇧",
  "scotland": "🏴",
  "wales": "🏴",
  "uk": "🇬🇧", "united kingdom": "🇬🇧", "great britain": "🇬🇧", "britain": "🇬🇧",
  "ireland": "🇮🇪",
  // Sør-Amerika
  "brazil": "🇧🇷", "brasil": "🇧🇷",
  "argentina": "🇦🇷",
  "chile": "🇨🇱",
  "uruguay": "🇺🇾",
  "paraguay": "🇵🇾",
  "bolivia": "🇧🇴",
  "peru": "🇵🇪",
  "colombia": "🇨🇴",
  "ecuador": "🇪🇨",
  "venezuela": "🇻🇪",
  "guyana": "🇬🇾",
  "suriname": "🇸🇷",
  // Afrika (utvalg)
  "egypt": "🇪🇬",
  "tunisia": "🇹🇳",
  "morocco": "🇲🇦",
  "algeria": "🇩🇿",
  "cameroon": "🇨🇲",
  "nigeria": "🇳🇬",
  "kenya": "🇰🇪",
  "ethiopia": "🇪🇹",
  "ghana": "🇬🇭",
  "senegal": "🇸🇳",
  "south africa": "🇿🇦",
  "rwanda": "🇷🇼",
  "uganda": "🇺🇬",
  "tanzania": "🇹🇿",
  "mozambique": "🇲🇿",
  "angola": "🇦🇴",
  "congo": "🇨🇩",
  "dr congo": "🇨🇩",
  "ivory coast": "🇨🇮", "cote d'ivoire": "🇨🇮",
  "zambia": "🇿🇲",
  "zimbabwe": "🇿🇼",
  // Asia / annet (noen få)
  "japan": "🇯🇵",
  "china": "🇨🇳",
  "philippines": "🇵🇭",
  "indonesia": "🇮🇩",
  "thailand": "🇹🇭",
  "turkey": "🇹🇷", "türkiye": "🇹🇷",
  "usa": "🇺🇸", "united states": "🇺🇸", "united states of america": "🇺🇸",
  "canada": "🇨🇦",
};

function guessCountryFromText(tournamentName, seasonName) {
  const text = (asStr(tournamentName) + " " + asStr(seasonName)).toLowerCase();
  for (const key in COUNTRY_FLAGS) {
    if (text.includes(key)) {
      return { name: key.replace(/\b\w/g, c => c.toUpperCase()), flag: COUNTRY_FLAGS[key] };
    }
  }
  return null;
}

/* ========== SetBox ========== */

const SetBox = memo(function SetBox(props) {
  const style = props.highlight ? { borderColor: "#c7d2fe", background: "#eef2ff" } : null;
  return (
    <div className="setbox" style={style}>
      <div className="label">{props.label}</div>
      <div className="val">{props.home ?? "—"} - {props.away ?? "—"}</div>
    </div>
  );
});

/* ========== ID helpers ========== */

function getHomeId(ev) { return ev.home_team_id ?? ev.home_teams_id ?? null; }
function getAwayId(ev) { return ev.away_team_id ?? ev.away_teams_id ?? null; }

function getTournamentId(ev) {
  if (ev.tournament_id != null) return ev.tournament_id;
  if (ev.tournamentId != null) return ev.tournamentId;
  if (ev.tournament && ev.tournament.id != null) return ev.tournament.id;
  if (typeof ev.tournament === "number" || typeof ev.tournament === "string") return ev.tournament;
  return null;
}

/**
 * Stabil ID for kamp – brukt til fokuslogikk
 */
function eventId(ev) {
  return ev.event_id ?? ev.custom_id ?? null;
}

/**
 * React key – kan falle tilbake til streng hvis eventId mangler.
 */
function eventKey(ev) {
  const id = eventId(ev);
  if (id != null) return String(id);
  return (
    String(ev.start_ts ?? "") + "-" +
    String(ev.home_team_name ?? "") + "-" +
    String(ev.away_team_name ?? "")
  );
}

/* ========== Player avatar (norske spillere) ========== */

const PlayerAvatar = memo(function PlayerAvatar({ player }) {
  const src = playerPhotoUrl(player.id);
  const status = useImageStatus(src);
  const name = player.name || "–";

  if (!src || status === "fail" || status === "none" || status === "loading") {
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

/* ========== EventCard – REN LIVESCORE, ingen ball/flamming ========== */

function EventCard(props) {
  const {
    ev,
    isFocused,
    onClick,
    isAbroadGroup,
    norPlayersHome = [],
    norPlayersAway = [],
    countryInfo,
  } = props;

  const label = liveLabel(ev.status_type);
  const p = currentPoints(ev);

  const setsHome = (ev.home_sets ?? 0);
  const setsAway = (ev.away_sets ?? 0);

  const currentSetText = p.setNo ? (String(p.setNo) + ". sett") : (ev.status_desc || "Pågår");

  const homeId = getHomeId(ev);
  const awayId = getAwayId(ev);
  const tournamentId = getTournamentId(ev);

  const homeLogo = teamLogoUrl(homeId);
  const awayLogo = teamLogoUrl(awayId);
  const tourLogo = tournamentLogoUrl(tournamentId);

  const cls = "card" + (isFocused ? " focused" : "");

  // headertekst (alltid fra /live)
  const headerMain = asStr(ev.tournament_name) || "—";
  const headerSub = asStr(ev.season_name) || "";

  const countryFlag = countryInfo?.flag || "";
  const countryName = countryInfo?.name || "";

  // Sett-bokser
  const setBoxes = [];
  for (let i = 1; i <= 7; i++) {
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
            <LogoBox src={tourLogo} />
            <span>{headerMain}</span>
          </div>
          {headerSub && (
            <div className="sub">
              {headerSub}
            </div>
          )}
          {(countryFlag || countryName) && (
            <div className="sub">
              {countryFlag && <span style={{ marginRight: 4 }}>{countryFlag}</span>}
              {countryName && <span>{countryName}</span>}
            </div>
          )}
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
            <span className="pointVal">
              <span className="pointWrap home">
                <span className="pointNumber">{p.home ?? "—"}</span>
              </span>
            </span>

            <span className="pointSep">-</span>

            <span className="pointVal">
              <span className="pointWrap away">
                <span className="pointNumber">{p.away ?? "—"}</span>
              </span>
            </span>
          </div>

          <div className="points">
            {setsHome} - {setsAway} i sett
            {p.setNo ? (" · " + currentSetText) : ""}
          </div>
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

      {/* Sett-bokser kun når kortet er i fokus */}
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
    </div>
  );
}

/* ========== App ========== */

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("other");
  const [focusedId, setFocusedId] = useState(null);

  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  const pollRef = useRef(null);
  const abortLiveRef = useRef(null);
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
        if (!cancelled) setTeams(safeArray(data));
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
      if (!Number.isNaN(key)) map.set(key, t);
    }
    return map;
  }, [teams]);

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

  /* ---- Country-info per event ---- */

  function getCountryInfo(ev) {
    const homeTeam = teamsBySofaId.get(getHomeId(ev));
    const awayTeam = teamsBySofaId.get(getAwayId(ev));

    const teamCountry = asStr(homeTeam?.country || awayTeam?.country);
    if (teamCountry) {
      const norm = teamCountry.toLowerCase();
      for (const key in COUNTRY_FLAGS) {
        if (norm === key) {
          return { name: teamCountry, flag: COUNTRY_FLAGS[key] };
        }
      }
      return { name: teamCountry, flag: "" };
    }

    const guess = guessCountryFromText(ev.tournament_name, ev.season_name);
    if (guess) return guess;

    return null;
  }

  /* ---- Norske spillere pr lag ---- */

  function getNorPlayersForTeam(teamId) {
    if (teamId == null) return [];
    const key = Number(teamId);
    if (Number.isNaN(key)) return [];
    return playersByTeamSofaId.get(key) || [];
  }

  /* ---- Hent live (REN, ingen serve/bink) ---- */

  const loadLive = useCallback(async () => {
    if (abortLiveRef.current) abortLiveRef.current.abort();
    const controller = new AbortController();
    abortLiveRef.current = controller;

    try {
      setError("");
      const data = await fetchJson("/live", controller.signal);
      setEvents(safeArray(data));
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

  /* ---- counts per gruppe ---- */

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
          Viser én kamp i fokus. Skjermen holdes våken bare mens et sett faktisk pågår (der det støttes av nettleseren).
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
          const isFocused = focusedId != null && eventId(ev) === focusedId;
          const id = eventId(ev);

          const group = classifyEventGroup(ev, teamsBySofaId);
          const isAbroadGroup = group === "abroad";

          const norPlayersHome = isAbroadGroup ? getNorPlayersForTeam(getHomeId(ev)) : [];
          const norPlayersAway = isAbroadGroup ? getNorPlayersForTeam(getAwayId(ev)) : [];

          const countryInfo = getCountryInfo(ev);

          return (
            <EventCard
              key={keyStr}
              ev={ev}
              isFocused={isFocused}
              isAbroadGroup={isAbroadGroup}
              norPlayersHome={norPlayersHome}
              norPlayersAway={norPlayersAway}
              countryInfo={countryInfo}
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