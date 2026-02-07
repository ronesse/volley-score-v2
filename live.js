
const { useCallback, useEffect, useMemo, useRef, useState, memo } = React;

const API_BASE = "https://volleyball.ronesse.no";
const POLL_MS = 5000;

function safeArray(x) { return Array.isArray(x) ? x : []; }

function formatTs(tsSeconds) {
  if (!tsSeconds) return "";
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleString("nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

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

// Denne brukes ikke lenger til gruppering, men lar vi stå for bakoverkomp. om du trenger den andre steder
function normalizeGroupType(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
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

// Nye filter-knapper med ønskede navn
const FILTERS = [
  { key: "mizuno", label: "Mizuno Norge", empty: "Det er ingen pågående kamper for lag fra Norge nå." },
  { key: "abroad", label: "Norske spillere i utlandet", empty: "Det er ingen norske spillere i utlandet i aksjon nå." },
  { key: "other",  label: "Andre", empty: "Det er ingen andre livekamper for øyeblikket." },
];

const SetBox = memo(function SetBox(props) {
  const style = props.highlight ? { borderColor: "#c7d2fe", background: "#eef2ff" } : null;
  return (
    <div className="setbox" style={style}>
      <div className="label">{props.label}</div>
      <div className="val">{props.home ?? "—"} - {props.away ?? "—"}</div>
    </div>
  );
});

// logo-caching
const imgStatusCache = new Map();

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

  if (!src || status === "fail" || status === "none" || status === "loading") {
    return <span className="logoBox" aria-hidden="true"></span>;
  }

  return (
    <span className="logoBox" aria-hidden="true">
      <img src={src} alt="" loading="lazy" />
    </span>
  );
}

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

function getHomeId(ev) { return ev.home_team_id ?? ev.home_teams_id ?? null; }
function getAwayId(ev) { return ev.away_team_id ?? ev.away_teams_id ?? null; }

function getTournamentId(ev) {
  if (ev.tournament_id != null) return ev.tournament_id;
  if (ev.tournamentId != null) return ev.tournamentId;
  if (ev.tournament && ev.tournament.id != null) return ev.tournament.id;
  if (typeof ev.tournament === "number" || typeof ev.tournament === "string") return ev.tournament;
  return null;
}

function teamLogoUrl(teamId) {
  if (teamId == null) return null;
  return API_BASE + "/img/teams/" + String(teamId) + ".png";
}

function tournamentLogoUrl(tournamentId) {
  if (tournamentId == null) return null;
  return API_BASE + "/img/tournaments/" + String(tournamentId) + ".png";
}

function compHeaderText(ev) {
  const t = ev.tournament_name ? String(ev.tournament_name) : "";
  const s = ev.season_name ? String(ev.season_name) : "";
  if (t && s) return t + " · " + s;
  return t || s || "—";
}

/**
 * Stabil ID for kamp – brukt til fokuslogikk
 */
function eventId(ev) {
  return ev.event_id ?? ev.custom_id ?? null;
}

/**
 * React key – kan falle tilbake til streng hvis eventId mangler,
 * men fokus bruker KUN event_id/custom_id.
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

/**
 * Ny: klassifiser kamp i en av tre grupper basert på lag i teams-tabellen:
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

function EventCard(props) {
  const { ev, flashInfo, serveInfo, playLabelInfo, isFocused, onClick } = props;

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

  return (
    <div className={cls} onClick={onClick} role="button">
      <div className="cardHeader">
        <div>
          <div className="compTitle">
            <LogoBox src={tourLogo} />
            <span>{compHeaderText(ev)}</span>
          </div>
          <div className="sub">{ev.group_type ? String(ev.group_type) : ""}</div>
        </div>

        <div className="status" title={ev.status_desc || ""}>
          <span className={statusDot(ev.status_type)}></span>
          {label + (ev.status_desc ? " · " + String(ev.status_desc) : "")}
        </div>
      </div>

      <div className="scoreRow">
        <div className="team">
          <LogoBox src={homeLogo} />
          <span className="teamName">{ev.home_team_name}</span>
        </div>

        <div className="bigScore">
          <div className="pointsMain">
            {/* Hjemme: ikon overlay til venstre for poeng */}
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

            {/* Borte: ikon overlay til høyre for poeng */}
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
                <div className={
                  "playLabel " +
                  (playLabelInfo.type === "break-point" ? "break-point" : "side-out")
                }>
                  {playText}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="team right">
          <LogoBox src={awayLogo} />
          <span className="teamName">{ev.away_team_name}</span>
        </div>
      </div>

      {/* Meta – kun starttid, ingen Event ID */}
      <div className="meta">
        <span>Start: {formatTs(ev.start_ts)}</span>
      </div>
    </div>
  );
}

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("other");  // "abroad" | "mizuno" | "other"
  const [flash, setFlash] = useState({});
  const [serve, setServe] = useState({});
  const [playLabel, setPlayLabel] = useState({});
  const [focusedId, setFocusedId] = useState(null);  // fokus basert på event_id/custom_id

  // NYTT: teams-data
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

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

  // Hent teams én gang for gruppering
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const data = await fetchJson("/teams?limit=200&offset=0", controller.signal);
        if (!cancelled) {
          setTeams(safeArray(data));
        }
      } catch (e) {
        if (String(e && e.name) === "AbortError") return;
        console.warn("Feil ved henting av teams:", e);
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fetchJson]);

  // Map: sofascore_team_id (number) -> team-objekt
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
              // poeng på egen serve -> break-point
              currentServe = { side: sideScored, hot: true };
              label = { side: sideScored, type: "break-point" };
            } else if (prevServe && prevServe.side && prevServe.side !== sideScored) {
              // serve bytter lag -> side-out
              currentServe = { side: sideScored, hot: false };
              label = { side: sideScored, type: "side-out" };
            } else {
              // første registrerte serve
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

  // Wake Lock helpers
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

  // Poll / cleanup
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

  // tell opp per gruppe med NY logikk (teams + country)
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

  // velg "smart" standardfilter når counts endrer seg
  useEffect(() => {
    if (counts.mizuno > 0) {
      setFilter("mizuno");
    } else if (counts.abroad > 0) {
      setFilter("abroad");
    } else {
      setFilter("other");
    }
  }, [counts.abroad, counts.mizuno, counts.other]);

  const filtered = useMemo(() => {
    const arr = liveEvents.slice();
    arr.sort((a, b) => (a.start_ts ?? 0) - (b.start_ts ?? 0));

    return arr.filter(ev => classifyEventGroup(ev, teamsBySofaId) === filter);
  }, [liveEvents, filter, teamsBySofaId]);

  // Fokuslogikk – basert på event_id/custom_id
  const visible = useMemo(() => {
    if (!focusedId) return filtered;

    const found =
      filtered.find(ev => eventId(ev) === focusedId) ||
      liveEvents.find(ev => eventId(ev) === focusedId) ||
      null;

    return found ? [found] : filtered;
  }, [filtered, focusedId, liveEvents]);

  const currentFilterObj = FILTERS.find(x => x.key === filter);

  // Wake Lock: hold skjerm våken når en live kamp OG aktivt sett er i fokus
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
          const flashInfo = flash[keyStr] || {};
          const serveInfo = serve[keyStr] || {};
          const playLabelInfo = playLabel[keyStr] || null;
          const isFocused = focusedId != null && eventId(ev) === focusedId;

          const id = eventId(ev);

          return (
            <EventCard
              key={keyStr}
              ev={ev}
              flashInfo={flashInfo}
              serveInfo={serveInfo}
              playLabelInfo={playLabelInfo}
              isFocused={isFocused}
              onClick={() => {
                if (id == null) {
                  // fall-back: hvis ingen event_id, bruk "ingen fokus"
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
