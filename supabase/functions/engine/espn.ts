// ESPN public JSON API helpers (site.api.espn.com) — undocumented, so every field is read defensively.
export const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export async function getJSON(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; pronostics-foot/1.0)", Accept: "application/json" },
      });
      if (r.status === 200) return await r.json();
      if (r.status === 400 || r.status === 404) { await r.body?.cancel(); return null; }
      await r.body?.cancel();
    } catch (_e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  return null;
}

export const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function americanToDecimal(s: any): number | null {
  if (s === null || s === undefined || s === "" || s === "EVEN" || s === "even") return s ? 2 : null;
  const v = typeof s === "number" ? s : Number(String(s).replace("+", ""));
  if (!Number.isFinite(v) || v === 0) return null;
  const d = v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v);
  return Math.round(d * 1000) / 1000;
}

export function parseOdds(o: any): any {
  if (!o) return null;
  const res: any = { provider: o.provider?.name ?? null, fetched_at: new Date().toISOString() };
  for (const k of ["open", "close"] as const) {
    const ml = o.moneyline;
    const ov = o.total?.over?.[k];
    const un = o.total?.under?.[k];
    const line = ov?.line ? num(String(ov.line).replace(/^[ou]/i, "")) : null;
    res[k] = {
      h: americanToDecimal(ml?.home?.[k]?.odds),
      d: americanToDecimal(ml?.draw?.[k]?.odds),
      a: americanToDecimal(ml?.away?.[k]?.odds),
      line,
      over: americanToDecimal(ov?.odds),
      under: americanToDecimal(un?.odds),
    };
  }
  if (!res.close.h) {
    res.close.h = americanToDecimal(o.homeTeamOdds?.moneyLine);
    res.close.a = americanToDecimal(o.awayTeamOdds?.moneyLine);
    res.close.d = americanToDecimal(o.drawOdds?.moneyLine);
  }
  if (res.close.line == null && o.overUnder != null) {
    res.close.line = num(o.overUnder);
    res.close.over = americanToDecimal(o.overOdds);
    res.close.under = americanToDecimal(o.underOdds);
  }
  if (!res.close.h && res.close.line == null) return null;
  return res;
}

const FINAL_RE = /FULL_TIME|FINAL/;
export const isFinalStatus = (name: string | null | undefined) => !!name && FINAL_RE.test(name);

function teamRow(t: any) {
  if (!t?.id) return null;
  return {
    id: String(t.id),
    name: t.displayName ?? t.name ?? String(t.id),
    short_name: t.shortDisplayName ?? t.name ?? null,
    abbr: t.abbreviation ?? null,
    logo: t.logo ?? t.logos?.[0]?.href ?? null,
    color: t.color ?? null,
  };
}

function periodScores(comp: any) {
  // linescores per half when ESPN provides them
  const out: Record<string, number[]> = {};
  for (const c of comp?.competitors ?? []) {
    const ls = (c.linescores ?? []).map((l: any) => num(l.value ?? l.displayValue) ?? 0);
    out[c.homeAway] = ls;
  }
  return out;
}

export function parseScoreboardEvent(ev: any, compSlug: string) {
  const c = ev.competitions?.[0];
  if (!c) return null;
  const home = c.competitors?.find((x: any) => x.homeAway === "home");
  const away = c.competitors?.find((x: any) => x.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return null;
  const st = ev.status?.type ?? c.status?.type ?? {};
  const state = st.state ?? "pre";
  const ps = periodScores(c);
  const htH = ps.home?.length >= 1 ? ps.home[0] : null;
  const htA = ps.away?.length >= 1 ? ps.away[0] : null;
  const match = {
    id: String(ev.id),
    comp: compSlug,
    season: num(ev.season?.year),
    kickoff: ev.date,
    state,
    status_name: st.name ?? null,
    status_detail: st.detail ?? null,
    home_id: String(home.team.id),
    away_id: String(away.team.id),
    home_score: state === "pre" ? null : num(home.score),
    away_score: state === "pre" ? null : num(away.score),
    ht_home: state === "post" ? htH : null,
    ht_away: state === "post" ? htA : null,
    neutral: !!c.neutralSite,
    venue: c.venue?.fullName ?? null,
    city: c.venue?.address?.city ?? null,
    attendance: num(c.attendance),
    odds: parseOdds(c.odds?.[0]),
  };
  return { match, teams: [teamRow(home.team), teamRow(away.team)].filter(Boolean) };
}

const STAT_MAP: Record<string, string> = {
  totalShots: "shots", shotsOnTarget: "sot", wonCorners: "corners", foulsCommitted: "fouls",
  yellowCards: "yellow", redCards: "red", offsides: "offsides", saves: "saves",
  possessionPct: "poss", penaltyKickGoals: "pen_goals", penaltyKickShots: "pen_shots",
  blockedShots: "blocked", totalPasses: "passes", accuratePasses: "acc_passes",
  totalCrosses: "crosses", effectiveTackles: "tackles_won", interceptions: "interceptions",
};

const PSTAT: Record<string, string> = {
  totalGoals: "goals", goalAssists: "assists", totalShots: "shots", shotsOnTarget: "sot",
  yellowCards: "yellow", redCards: "red", foulsCommitted: "fouls", foulsSuffered: "fouled",
  saves: "saves", offsides: "offsides",
};

export function parseSummary(js: any, matchId: string) {
  const comp = js?.header?.competitions?.[0];
  const homeTeamId = String(comp?.competitors?.find((x: any) => x.homeAway === "home")?.team?.id ?? "");
  const awayTeamId = String(comp?.competitors?.find((x: any) => x.homeAway === "away")?.team?.id ?? "");
  const side = (tid: string) => (tid === homeTeamId ? "home" : tid === awayTeamId ? "away" : null);

  // team stats
  const stats: any = {};
  for (const t of js?.boxscore?.teams ?? []) {
    const s = side(String(t.team?.id));
    if (!s) continue;
    const o: any = {};
    for (const x of t.statistics ?? []) {
      const k = STAT_MAP[x.name];
      if (k) o[k] = num(x.displayValue ?? x.value);
    }
    stats[s] = o;
  }
  const hasStats = !!(stats.home && stats.away && stats.home.shots != null);

  // key events
  const ke: any[] = js?.keyEvents ?? [];
  let maxPeriod = 2;
  const subs: { inP: string; outP: string; min: number }[] = [];
  const reds: Record<string, number> = {};
  const goals: any[] = [];
  const cards: any[] = [];
  for (const k of ke) {
    const type = String(k.type?.type ?? k.type?.text ?? "").toLowerCase();
    const period = num(k.period?.number) ?? 1;
    if (period > maxPeriod && period <= 4) maxPeriod = period;
    const min = Math.round((num(k.clock?.value) ?? 0) / 60);
    const parts = (k.participants ?? []).map((p: any) => String(p.athlete?.id ?? ""));
    const tid = k.team?.id ? String(k.team.id) : null;
    if (type === "substitution" && parts.length >= 2) subs.push({ inP: parts[0], outP: parts[1], min });
    if (type.includes("red-card") || type.includes("red card")) { if (parts[0]) reds[parts[0]] = min; }
    if (type.includes("card")) cards.push({ t: tid ? side(tid) : null, m: min, p: period, pl: parts[0] ?? null, red: type.includes("red") });
    const scoring = k.scoringPlay === true || k.scoringPlay === "true";
    if (scoring && period <= 4) {
      goals.push({ t: tid ? side(tid) : null, m: min, p: period, s: parts[0] ?? null, a: parts[1] ?? null, og: type.includes("own"), pen: type.includes("penalty") });
    }
  }
  const endMin = maxPeriod >= 3 ? 120 : 90;

  // period scores: prefer linescores
  let ftH: number | null = null, ftA: number | null = null, htH: number | null = null, htA: number | null = null;
  const ps = periodScores(comp);
  if (ps.home?.length >= 2 && ps.away?.length >= 2) {
    htH = ps.home[0]; htA = ps.away[0];
    ftH = ps.home[0] + ps.home[1]; ftA = ps.away[0] + ps.away[1];
  } else if (goals.length || hasStats) {
    const g = (s: string, maxP: number) => goals.filter((x) => x.t === s && x.p <= maxP).length;
    htH = g("home", 1); htA = g("away", 1); ftH = g("home", 2); ftA = g("away", 2);
  }

  // players
  const players: any[] = [];
  const mp: any[] = [];
  const formations: any = {};
  let starters = { home: 0, away: 0 };
  for (const r of js?.rosters ?? []) {
    const tid = String(r.team?.id ?? "");
    const s = side(tid);
    if (!s) continue;
    formations[s] = r.formation ?? null;
    for (const p of r.roster ?? []) {
      const pid = String(p.athlete?.id ?? "");
      if (!pid) continue;
      players.push({ id: pid, name: p.athlete?.displayName ?? pid, short_name: p.athlete?.shortName ?? null });
      const st: any = {};
      for (const x of p.stats ?? []) { const k = PSTAT[x.name]; if (k) st[k] = num(x.value) ?? 0; }
      const starter = !!p.starter;
      if (starter) starters[s as "home" | "away"]++;
      // minutes
      let start: number | null = starter ? 0 : null;
      const subIn = subs.find((x) => x.inP === pid);
      const subOut = subs.find((x) => x.outP === pid);
      if (!starter && subIn) start = Math.min(subIn.min, endMin);
      let minutes: number | null = null;
      if (start !== null) {
        let end = endMin;
        if (subOut) end = Math.min(end, subOut.min);
        if (reds[pid] !== undefined) end = Math.min(end, reds[pid]);
        minutes = Math.max(0, end - start);
        if (!ke.length) minutes = starter ? (p.subbedOut ? 70 : endMin) : (p.subbedIn ? 20 : 0);
      } else if (p.subbedIn) {
        minutes = 20;
      } else minutes = 0;
      mp.push({
        match_id: matchId, player_id: pid, team_id: tid, starter,
        position: p.position?.name ?? null, pos_abbr: p.position?.abbreviation ?? null,
        formation_place: num(p.formationPlace), jersey: p.jersey ?? null,
        subbed_in: !!p.subbedIn, subbed_out: !!p.subbedOut, minutes,
        goals: st.goals ?? 0, assists: st.assists ?? 0, shots: st.shots ?? 0, sot: st.sot ?? 0,
        yellow: st.yellow ?? 0, red: st.red ?? 0, fouls: st.fouls ?? 0, fouled: st.fouled ?? 0,
        saves: st.saves ?? 0, offsides: st.offsides ?? 0,
      });
    }
  }
  const lineupsReady = starters.home >= 11 && starters.away >= 11;

  let referee: string | null = null;
  for (const o of js?.gameInfo?.officials ?? []) {
    const pos = String(o.position?.name ?? o.position?.displayName ?? "").toLowerCase();
    if (pos === "referee" || (!referee && pos.includes("referee") && !pos.includes("assist") && !pos.includes("video"))) {
      referee = o.displayName ?? o.fullName ?? null;
    }
  }
  const odds = parseOdds(js?.pickcenter?.[0] ?? js?.odds?.[0]);
  const st = comp?.status?.type ?? {};
  return {
    homeTeamId, awayTeamId, state: st.state ?? null, status_name: st.name ?? null,
    stats: hasStats ? stats : null, goals, cards, ftH, ftA, htH, htA, players, mp, formations,
    lineupsReady, starters, referee, odds, attendance: num(js?.gameInfo?.attendance),
  };
}
