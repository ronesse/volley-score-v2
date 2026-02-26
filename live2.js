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
   Filter-knapper (meta-tekst)
   =========================== */

const FILTERS = [
  { key: "followed", label: "Følger",        empty: "Du følger ingen livekamper." },
  { key: "mizuno",   label: "Mizuno Norge",  empty: "Det er ingen pågående kamper for lag fra Norge nå." },
  { key: "abroad",   label: "Norske spillere i utlandet", empty: "Det er ingen norske spillere i utlandet i aksjon nå." },
  { key: "other",    label: "Andre",         empty: "Det er ingen andre livekamper for øyeblikket." },
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
/*
  Regler:
  - run = 1: kun ball, ikke blink
  - run = 2: ball + flamme, ikke blink
  - run = 3: ball + flamme, blink (hotGlow)
  - run >= 4: ball + flamme + 🎉, blink (hotGlow)
*/

function ServeIcon({ side, run }) {
  const level = Number(run || 0);
  const hasFlame = level >= 2;
  const isHot = level >= 3;      // 3+ → blink
  const hasParty = level >= 4;   // 4+ → 🎉

  const className =
    "serveIcon " +
    (side === "home" ? "home" : "away") +
    (isHot ? " hot" : "");

  let title = "Server";
  if (level === 1) title = "Side-out (ny serve)";
  else if (level === 2) title = "Break-point";
  else if (level === 3) title = "Dbl break-ball";
  else if (level >= 4) title = "Party-run";

  const isHome = side === "home";

  return (
    <span
      className={className}
      title={title}
      aria-hidden="true"
    >
      <span className="serveIconInner">
        {isHome && hasFlame && <span>🔥</span>}
        <span>🏐</span>
        {!isHome && hasFlame && <span>🔥</span>}
        {hasParty && <span>🎉</span>}
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
   Grupplogikk (teams-tabellen)
   =========================== */

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
   Tournament + season fra /live
   =========================== */
function getTournamentAndSeason(ev) {
  let tournament = asStr(ev.tournament_name);
  let season = asStr(ev.season_name);

  if (!tournament && ev.tournament?.name) {
    tournament = asStr(ev.tournament.name);
  }
  if (!season && ev.season?.name) {
    season = asStr(ev.season.name);
  }
  if (!season && ev.tournament?.season?.name) {
    season = asStr(ev.tournament.season.name);
  }

  if (ev.raw_json && (!tournament || !season)) {
    try {
      const raw = JSON.parse(ev.raw_json);

      if (!tournament) {
        tournament =
          asStr(raw?.tournament?.name) ||
          asStr(raw?.uniqueTournament?.name);
      }

      if (!season) {
        season =
          asStr(raw?.season?.name) ||
          asStr(raw?.tournament?.season?.name);
      }
    } catch (e) {}
  }

  return {
    tournament: tournament || "—",
    season: season || null,
  };
}

/* ===========================
   Land + flagg
   =========================== */

const COUNTRY_ALIASES = {
  // Europa
  "norway": "NO", "norge": "NO",
  "sweden": "SE", "sverige": "SE",
  "denmark": "DK", "danmark": "DK",
  "finland": "FI",
  "iceland": "IS", "island": "IS",
  "germany": "DE", "tyskland": "DE",
  "france": "FR", "frankrike": "FR",
  "italy": "IT", "italia": "IT",
  "spain": "ES", "spania": "ES",
  "portugal": "PT",
  "netherlands": "NL", "nederland": "NL",
  "belgium": "BE", "belgia": "BE",
  "switzerland": "CH", "sveits": "CH",
  "austria": "AT", "østerrike": "AT", "oesterreich": "AT",
  "poland": "PL", "polen": "PL",
  "czechia": "CZ", "czech republic": "CZ",
  "slovakia": "SK",
  "hungary": "HU", "ungarn": "HU",
  "romania": "RO",
  "bulgaria": "BG",
  "slovenia": "SI",
  "croatia": "HR",
  "serbia": "RS",
  "bosnia": "BA", "bosnia and herzegovina": "BA",
  "montenegro": "ME",
  "north macedonia": "MK", "macedonia": "MK",
  "albania": "AL",
  "greece": "GR",
  "turkey": "TR", "tyrkia": "TR",
  "ukraine": "UA",
  "belarus": "BY",
  "moldova": "MD",
  "latvia": "LV",
  "lithuania": "LT", "litauen": "LT",
  "estonia": "EE", "estland": "EE",
  "ireland": "IE",
  "scotland": "GB",
  "england": "GB",
  "wales": "GB",
  "kosovo": "XK",
  "andorra": "AD",
  "monaco": "MC",
  "liechtenstein": "LI",
  "luxembourg": "LU",
  "san marino": "SM",
  "malta": "MT",
  "cyprus": "CY",

  // Sør-Amerika
  "brazil": "BR", "brasil": "BR",
  "argentina": "AR",
  "chile": "CL",
  "uruguay": "UY",
  "paraguay": "PY",
  "bolivia": "BO",
  "peru": "PE",
  "ecuador": "EC",
  "colombia": "CO",
  "venezuela": "VE",
  "suriname": "SR",
  "guyana": "GY",

  // Afrika
  "south africa": "ZA",
  "egypt": "EG",
  "tunisia": "TN",
  "morocco": "MA", "marokko": "MA",
  "algeria": "DZ",
  "nigeria": "NG",
  "ghana": "GH",
  "senegal": "SN",
  "ivory coast": "CI", "cote d'ivoire": "CI",
  "cameroon": "CM",
  "kenya": "KE",
  "uganda": "UG",
  "tanzania": "TZ",
  "ethiopia": "ET",
  "angola": "AO",
  "zambia": "ZM",
  "zimbabwe": "ZW",
  "mozambique": "MZ",
  "namibia": "NA",
  "botswana": "BW",
  "madagascar": "MG",
  "mali": "ML",
  "niger": "NE",
  "chad": "TD",
  "sudan": "SD",
  "south sudan": "SS",
  "somalia": "SO",
  "libya": "LY",
  "democratic republic of the congo": "CD",
  "congo": "CG",
  "rwanda": "RW",
  "burundi": "BI",
  "sierra leone": "SL",
  "liberia": "LR",
  "benin": "BJ",
  "togo": "TG",
  "gambia": "GM",
  "guinea": "GN",
  "guinea-bissau": "GW",
  "mauritania": "MR",
  "cape verde": "CV", "cabo verde": "CV",

  // bonus
  "usa": "US", "united states": "US",
  "canada": "CA",
  "japan": "JP", "japen": "JP",
};

const ISO_LABEL = {
  NO: "Norway",
  SE: "Sweden",
  DK: "Denmark",
  FI: "Finland",
  IS: "Iceland",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  PT: "Portugal",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  PL: "Poland",
  CZ: "Czechia",
  SK: "Slovakia",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  SI: "Slovenia",
  HR: "Croatia",
  RS: "Serbia",
  BA: "Bosnia & Herzegovina",
  ME: "Montenegro",
  MK: "North Macedonia",
  AL: "Albania",
  GR: "Greece",
  TR: "Turkey",
  UA: "Ukraine",
  BY: "Belarus",
  MD: "Moldova",
  LV: "Latvia",
  LT: "Lithuania",
  EE: "Estonia",
  IE: "Ireland",
  GB: "United Kingdom",
  XK: "Kosovo",
  AD: "Andorra",
  MC: "Monaco",
  LI: "Liechtenstein",
  LU: "Luxembourg",
  SM: "San Marino",
  MT: "Malta",
  CY: "Cyprus",

  BR: "Brazil",
  AR: "Argentina",
  CL: "Chile",
  UY: "Uruguay",
  PY: "Paraguay",
  BO: "Bolivia",
  PE: "Peru",
  EC: "Ecuador",
  CO: "Colombia",
  VE: "Venezuela",
  SR: "Suriname",
  GY: "Guyana",

  ZA: "South Africa",
  EG: "Egypt",
  TN: "Tunisia",
  MA: "Morocco",
  DZ: "Algeria",
  NG: "Nigeria",
  GH: "Ghana",
  SN: "Senegal",
  CI: "Ivory Coast",
  CM: "Cameroon",
  KE: "Kenya",
  UG: "Uganda",
  TZ: "Tanzania",
  ET: "Ethiopia",
  AO: "Angola",
  ZM: "Zambia",
  ZW: "Zimbabwe",
  MZ: "Mozambique",
  NA: "Namibia",
  BW: "Botswana",
  MG: "Madagascar",
  ML: "Mali",
  NE: "Niger",
  TD: "Chad",
  SD: "Sudan",
  SS: "South Sudan",
  SO: "Somalia",
  LY: "Libya",
  CD: "DR Congo",
  CG: "Congo",
  RW: "Rwanda",
  BI: "Burundi",
  SL: "Sierra Leone",
  LR: "Liberia",
  BJ: "Benin",
  TG: "Togo",
  GM: "Gambia",
  GN: "Guinea",
  GW: "Guinea-Bissau",
  MR: "Mauritania",
  CV: "Cabo Verde",

  US: "United States",
  CA: "Canada",
  JP: "Japan",
};

function isoToFlag(iso) {
  if (!iso || iso.length !== 2) return null;
  const codePoints = [...iso.toUpperCase()]
    .map(c => 0x1F1E6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

function deriveCountryLabel(ev, teamsBySofaId) {
  const home = teamsBySofaId.get(getHomeId(ev));
  const away = teamsBySofaId.get(getAwayId(ev));

  let raw =
    home?.country ||
    away?.country ||
    null;

  if (!raw && ev.raw_json) {
    try {
      const j = JSON.parse(ev.raw_json);
      raw =
        j?.tournament?.category?.country?.name ||
        j?.tournament?.category?.name ||
        null;
    } catch (e) {}
  }

  if (!raw) {
    const ts = getTournamentAndSeason(ev);
    raw = `${ts.tournament || ""} ${ts.season || ""}`;
  }

  const text = asStr(raw).toLowerCase();
  if (!text) return null;

  let iso = null;
  for (const key in COUNTRY_ALIASES) {
    if (text.includes(key)) {
      iso = COUNTRY_ALIASES[key];
      break;
    }
  }
  if (!iso) return null;

  const flag = isoToFlag(iso);
  const label = ISO_LABEL[iso] || iso;
  return flag ? `${flag} ${label}` : label;
}

/* ===========================
   Liga-nivå + playoff/finals
   =========================== */

function deriveLeagueLevel(ev, teamsBySofaId) {
  const { season, tournament } = getTournamentAndSeason(ev);

  const home = teamsBySofaId.get(getHomeId(ev));
  const away = teamsBySofaId.get(getAwayId(ev));

  const homeLeague = asStr(home?.league);
  const awayLeague = asStr(away?.league);

  const group = classifyEventGroup(ev, teamsBySofaId);

  if (group === "mizuno") {
    return season || tournament || homeLeague || awayLeague || null;
  }

  if (homeLeague && awayLeague && homeLeague === awayLeague) {
    return homeLeague;
  }
  if (homeLeague && !awayLeague) return homeLeague;
  if (awayLeague && !homeLeague) return awayLeague;

  return season || tournament || homeLeague || awayLeague || null;
}

function deriveStageLabel(ev) {
  let rawStage = null;

  if (ev.round_name) rawStage = asStr(ev.round_name);
  if (!rawStage && ev.roundInfo?.name) rawStage = asStr(ev.roundInfo.name);

  if (!rawStage && ev.raw_json) {
    try {
      const j = JSON.parse(ev.raw_json);
      rawStage = asStr(j?.roundInfo?.name);
    } catch (e) {}
  }

  if (!rawStage) return null;

  const s = rawStage.toLowerCase();

  if (s.includes("final") && !s.includes("semi") && !s.includes("quarter") && !s.includes("eighth")) {
    return "Finale";
  }
  if (s.includes("semi")) {
    return "Semifinale";
  }
  if (s.includes("quarter")) {
    return "Kvartfinale";
  }
  if (s.includes("eighth")) {
    return "Åttendedelsfinale";
  }
  if (s.includes("playoff") || s.includes("play-offs")) {
    return "Sluttspill";
  }
  if (s.includes("regular")) {
    return "Seriespill";
  }

  return rawStage;
}

/* ===========================
   Player avatar (norske spillere)
   =========================== */

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

/* ===========================
   EventCard
   =========================== */

function EventCard(props) {
  const {
    ev,
    flashInfo,
    serveInfo,
    playLabelInfo,
    isFollowed,
    isAbroadGroup,
    onToggleFollow,
    norPlayersHome = [],
    norPlayersAway = [],
    countryLabel,
    leagueLevel,
    stageLabel,
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

  // Hvilken side fikk poeng akkurat nå? (kun denne skal blinke på tall)
  const scoredSide =
    flashInfo && flashInfo.home ? "home" :
    (flashInfo && flashInfo.away ? "away" : null);

  // Bruk "focused"-klassens styling for fulgte kamper
  const cls = "card" + (isFollowed ? " focused" : "");

  let playText = null;
  if (playLabelInfo) {
    if (playLabelInfo.type === "side-out") {
      playText = "Side-out";
    } else if (playLabelInfo.type === "break-point") {
      playText = "Break-point";
    } else if (playLabelInfo.type === "dbl-break-ball") {
      playText = "Dbl break-ball";
    } else if (playLabelInfo.type === "party") {
      // Ingen ekstra tekst for party; kun ikoner
      playText = null;
    }
  }

  const { tournament, season } = getTournamentAndSeason(ev);

  const headerNode = (
    <>
      {tournament}
      {season && <span style={{ fontWeight: 500 }}> · {season}</span>}
    </>
  );

  const subParts = [];
  if (countryLabel) subParts.push(countryLabel);
  if (leagueLevel) subParts.push(leagueLevel);
  if (stageLabel) subParts.push(stageLabel);
  if (ev.group_type) subParts.push(String(ev.group_type));
  const subText = subParts.join(" · ");

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

  // Norske spillere vises når kampen er fulgt og er i "abroad"-gruppa
  const showNorwegians = isFollowed && isAbroadGroup;

  return (
    <div className={cls}>
      <div className="cardHeader">
        <div>
          <div className="compTitle">
            <span className="tournamentName">{headerNode}</span>
          </div>
          {subText && <div className="sub">{subText}</div>}
        </div>

        <div className="status" title={ev.status_desc || ""}>
          <span
            className={
              statusDot(ev.status_type) +
              (scoredSide ? " blinkScore" : "")
            }
          ></span>
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
                {isServingHome && (
                  <ServeIcon
                    side="home"
                    run={serveInfo.run}
                  />
                )}
              </span>
            </span>

            <span className="pointSep">-</span>

            <span
              key={"pa-" + (flashInfo.away || 0)}
              className={"pointVal" + (flashInfo.away ? " blinkScore" : "")}
            >
              <span className="pointWrap away">
                <span className="pointNumber">{p.away ?? "—"}</span>
                {isServingAway && (
                  <ServeIcon
                    side="away"
                    run={serveInfo.run}
                  />
                )}
              </span>
            </span>
          </div>

          <div className="points">
            {setsHome} - {setsAway} i sett
            {p.setNo ? (" · " + currentSetText) : ""}
          </div>

          {isFollowed && (isServingHome || isServingAway) && (
            <div className="serveInfoRow">
              <div>
                Serve · {isServingHome ? ev.home_team_name : ev.away_team_name}
              </div>
              {playText && (
                <div
                  className={
                    "playLabel " +
                    (playLabelInfo.type === "break-point"
                      ? "break-point"
                      : playLabelInfo.type === "side-out"
                      ? "side-out"
                      : "break-point")
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

      <div className="followRow">
        <button
          type="button"
          className={"followBtn" + (isFollowed ? " following" : "")}
          onClick={onToggleFollow}
        >
          {isFollowed ? "Slutt å følge" : "Følg"}
        </button>
      </div>

      {isFollowed && setBoxes.length > 0 && (
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

/* ===========================
   Drama-score (for Følger-siden)
   =========================== */

function dramaScore(ev) {
  const p = currentPoints(ev);
  const setNo = p.setNo || 0;
  const setsTotal = (ev.home_sets || 0) + (ev.away_sets || 0);
  const setDiff = Math.abs((ev.home_sets || 0) - (ev.away_sets || 0));
  const pointDiff = Math.abs((p.home ?? 0) - (p.away ?? 0));

  let score = 0;

  // 5. sett = mest dramatisk
  if (setNo === 5) score += 100;
  // 2–2 i sett
  if (ev.home_sets === 2 && ev.away_sets === 2) score += 80;
  // jevnt i sett totalt
  if (setDiff === 0 && setsTotal > 0) score += 40;
  // små marginer i poeng
  if (pointDiff <= 2 && p.home != null && p.away != null) score += 20;

  // flere spilte sett gir litt ekstra
  score += setsTotal * 5;

  return score;
}

/* ===========================
   App
   =========================== */

function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Start fortsatt på Mizuno (matcher eksisterende HTML-fane)
  const [filter, setFilter] = useState("mizuno");
  const [flash, setFlash] = useState({});
  const [playLabel, setPlayLabel] = useState({});
  const [followedIds, setFollowedIds] = useState([]);   // flere fulgte kamper

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

  /* ---- Oppdater Følger (X) i fanen hvis HTML har #followCount ---- */

  useEffect(() => {
    const el = document.getElementById("followCount");
    if (el) {
      el.textContent = `(${followedIds.length})`;
    }
  }, [followedIds]);

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

  /* ---- Hent live og scorer per kamp (bruker backend-run) ---- */

  const loadLive = useCallback(async () => {
    if (abortLiveRef.current) abortLiveRef.current.abort();
    const controller = new AbortController();
    abortLiveRef.current = controller;

    try {
      setError("");
      const data = await fetchJson("/live", controller.signal);
      const nextEvents = safeArray(data);

      const newFlash = {};
      const newPlayLabel = {};
      const now = Date.now();

      for (let i = 0; i < nextEvents.length; i++) {
        const ev = nextEvents[i];
        const key = eventKey(ev);

        const runHome = Number(ev.home_point_run ?? 0);
        const runAway = Number(ev.away_point_run ?? 0);
        const newScore = Number(ev.new_score ?? 0);

        let serveSide = null;
        let currentRun = 0;

        if (runHome > 0 && runAway === 0) {
          serveSide = "home";
          currentRun = runHome;
        } else if (runAway > 0 && runHome === 0) {
          serveSide = "away";
          currentRun = runAway;
        }

        if (newScore === 1 && serveSide && currentRun > 0) {
          // Blink kun når det faktisk er NYTT poeng
          newFlash[key] = {};
          newFlash[key][serveSide] = now + Math.random();

          let labelType = null;
          if (currentRun === 1) {
            labelType = "side-out";
          } else if (currentRun === 2) {
            labelType = "break-point";
          } else if (currentRun === 3) {
            labelType = "dbl-break-ball";
          } else if (currentRun >= 4) {
            labelType = "party";
          }

          if (labelType) {
            newPlayLabel[key] = {
              side: serveSide,
              type: labelType,
            };
          }
        }
      }

      setFlash(newFlash);
      setPlayLabel(newPlayLabel);
      setEvents(nextEvents);
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

  /* ---- Lytt til filter-event fra index2.html ---- */

  useEffect(() => {
    function handleFilterEvent(e) {
      const key = e.detail;
      if (FILTERS.some(f => f.key === key)) {
        setFilter(key);
      }
    }
    window.addEventListener("volley-filter", handleFilterEvent);
    return () => window.removeEventListener("volley-filter", handleFilterEvent);
  }, []);

  /* ---- filtrerte events (inkl. ny Følger-fane) ---- */

  const filtered = useMemo(() => {
    const arr = liveEvents.slice();
    arr.sort((a, b) => (a.start_ts ?? 0) - (b.start_ts ?? 0));

    if (filter === "followed") {
      const followed = arr.filter(ev => {
        const id = eventId(ev);
        return id != null && followedIds.includes(id);
      });
      // mest dramatisk øverst
      followed.sort((a, b) => dramaScore(b) - dramaScore(a));
      return followed;
    }

    // øvrige faner oppfører seg som før
    return arr.filter(ev => classifyEventGroup(ev, teamsBySofaId) === filter);
  }, [liveEvents, filter, teamsBySofaId, followedIds]);

  const currentFilterObj = useMemo(
    () => FILTERS.find(x => x.key === filter),
    [filter]
  );

  /* ---- Wake Lock basert på fulgte kamper ---- */

  useEffect(() => {
    // Finn alle fulgte kamper som fortsatt er live og der et sett faktisk pågår
    const followedLiveWithSet = liveEvents.filter(ev => {
      const id = eventId(ev);
      if (id == null || !followedIds.includes(id)) return false;
      const cp = currentPoints(ev);
      return cp && cp.setNo != null && isLiveStatus(ev.status_type);
    });

    const shouldKeepAwake = followedLiveWithSet.length > 0;

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
  }, [followedIds, liveEvents, requestWakeLock, releaseWakeLock]);

  /* ---- Rydd opp i fulgte kamper når de ikke er live lenger ---- */

  useEffect(() => {
    if (followedIds.length === 0) return;

    setFollowedIds(prev =>
      prev.filter(id => {
        const ev = events.find(e => eventId(e) === id);
        return ev && isLiveStatus(ev.status_type);
      })
    );
  }, [events, followedIds.length]);

  /* ---- Hjelper: norske spillere for lag ---- */

  function getNorPlayersForTeam(teamId) {
    if (teamId == null) return [];
    const key = Number(teamId);
    if (Number.isNaN(key)) return [];
    return playersByTeamSofaId.get(key) || [];
  }

  /* ---- Toggle follow ---- */

  function toggleFollow(ev) {
    const id = eventId(ev);
    if (id == null) return;
    setFollowedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  /* ---- Render ---- */

  return (
    <div className="wrap">
      {followedIds.length > 0 && (
        <div className="focusInfo">
          Du følger {followedIds.length} kamp{followedIds.length === 1 ? "" : "er"}.
          Skjermen holdes våken så lenge minst én av dem pågår (der det støttes av nettleseren).
        </div>
      )}

      {filter === "followed" && followedIds.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="followBtn"
            onClick={() => setFollowedIds([])}
          >
            Avfølg alle
          </button>
        </div>
      )}

      {error && <div className="alert">Feil: {error}</div>}
      {loading && <div style={{ marginTop: 10, color: "#6b7280" }}>Laster…</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="card" style={{ marginTop: 10, cursor: "default" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Ingen livekamper</div>
          <div style={{ color: "#6b7280" }}>
            {currentFilterObj?.empty}
          </div>
        </div>
      )}

      <div className="grid">
        {filtered.map(ev => {
          const keyStr = eventKey(ev);
          const flashInfo = flash[keyStr] || {};
          const playLabelInfo = playLabel[keyStr] || null;

          const id = eventId(ev);
          const isFollowed = id != null && followedIds.includes(id);

          const group = classifyEventGroup(ev, teamsBySofaId);
          const isAbroadGroup = group === "abroad";

          const norPlayersHome = isAbroadGroup ? getNorPlayersForTeam(getHomeId(ev)) : [];
          const norPlayersAway = isAbroadGroup ? getNorPlayersForTeam(getAwayId(ev)) : [];

          const countryLabel = deriveCountryLabel(ev, teamsBySofaId);
          const leagueLevel = deriveLeagueLevel(ev, teamsBySofaId);
          const stageLabel = deriveStageLabel(ev);

          const runHome = Number(ev.home_point_run ?? 0);
          const runAway = Number(ev.away_point_run ?? 0);

          let serveInfo = null;
          if (runHome > 0 && runAway === 0) {
            serveInfo = { side: "home", run: runHome };
          } else if (runAway > 0 && runHome === 0) {
            serveInfo = { side: "away", run: runAway };
          }

          return (
            <EventCard
              key={keyStr}
              ev={ev}
              flashInfo={flashInfo}
              serveInfo={serveInfo}
              playLabelInfo={playLabelInfo}
              isFollowed={isFollowed}
              isAbroadGroup={isAbroadGroup}
              norPlayersHome={norPlayersHome}
              norPlayersAway={norPlayersAway}
              countryLabel={countryLabel}
              leagueLevel={leagueLevel}
              stageLabel={stageLabel}
              onToggleFollow={() => toggleFollow(ev)}
            />
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("live-root")).render(<App />);
