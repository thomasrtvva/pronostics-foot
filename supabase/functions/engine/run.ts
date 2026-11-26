import { sql } from "./db.ts";
import { blendLambdas, explain, Feat, fitAll, lambdas, marketFromOdds, MODEL_VERSION, Params, PlayerRate, predict, Row, tau } from "./model.ts";
import { fetchSummary, writeSummary } from "./sync.ts";

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const nz = (v: any) => (v === null || v === undefined ? null : Number(v));

export function toFeat(f: any): Feat {
  if (!f) return { lrA: 0, lc: 0, gk: 0, sr: 0, ok: false };
  const sr = f.rest_days != null && Number(f.rest_days) < 3.6 ? 1 : 0;
  const ok = Number(f.n_starters) >= 11 && Number(f.n_prior) >= 3 && Number(f.att_idx) > 0 && Number(f.att_typ) > 0;
  if (!ok) return { lrA: 0, lc: 0, gk: 0, sr, ok: false };
  const lrA = clamp(Math.log(Number(f.att_idx) / Number(f.att_typ)), -0.7, 0.7);
  const lc = f.cont != null && f.cont_typ != null ? clamp(Math.log((Number(f.cont) + 0.05) / (Number(f.cont_typ) + 0.05)), -1.5, 1) : 0;
  return { lrA, lc, gk: Number(f.gk_change) ? 1 : 0, sr, ok: true };
}

async function loadDoneRows(): Promise<(Row & { ko: number; mq: any })[]> {
  const rs = await sql`
    select m.id, m.comp, m.neutral, m.home_id, m.away_id, m.ft_home, m.ft_away, m.ht_home, m.ht_away,
      extract(epoch from m.kickoff) as ko,
      (m.stats->'home'->>'shots')::float8 as sh, (m.stats->'away'->>'shots')::float8 as sa,
      (m.stats->'home'->>'sot')::float8 as oh, (m.stats->'away'->>'sot')::float8 as oa,
      (m.stats->'home'->>'corners')::float8 as ch, (m.stats->'away'->>'corners')::float8 as ca,
      (m.stats->'home'->>'yellow')::float8 + coalesce((m.stats->'home'->>'red')::float8, 0) as kh,
      (m.stats->'away'->>'yellow')::float8 + coalesce((m.stats->'away'->>'red')::float8, 0) as ka,
      row_to_json(fh) as fh, row_to_json(fa) as fa, m.odds
    from matches m
    left join match_features fh on fh.match_id = m.id and fh.side = 'home'
    left join match_features fa on fa.match_id = m.id and fa.side = 'away'
    where m.state = 'post' and m.details_at is not null and m.stats is not null and m.ft_home is not null and m.kickoff > now() - interval '620 days'
    order by m.kickoff`;
  return rs.map((r: any) => {
    const xg = (s: number | null, o: number | null) => (s == null || o == null ? 0 : 0.30 * o + 0.06 * Math.max(0, s - o));
    const sh = nz(r.sh), sa = nz(r.sa), oh = nz(r.oh), oa = nz(r.oa);
    const hasShots = sh != null && oh != null && sa != null && oa != null;
    return {
      id: r.id, comp: r.comp, age: 0, ko: Number(r.ko), neutral: !!r.neutral, home: r.home_id, away: r.away_id,
      gH: r.ft_home, gA: r.ft_away,
      xH: hasShots ? xg(sh, oh) : r.ft_home / 1, xA: hasShots ? xg(sa, oa) : r.ft_away / 1,
      cH: nz(r.ch), cA: nz(r.ca), sH: sh, sA: sa, oH: oh, oA: oa, kH: nz(r.kh), kA: nz(r.ka),
      htH: nz(r.ht_home), htA: nz(r.ht_away),
      fh: toFeat(r.fh), fa: toFeat(r.fa), mq: marketFromOdds(r.odds),
    } as Row & { ko: number; mq: any };
  });
}

function teamLeagues(rows: Row[]) {
  const cnt: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!["bel.1", "eng.1", "esp.1", "ita.1", "ger.1", "fra.1"].includes(r.comp)) continue;
    for (const t of [r.home, r.away]) { cnt[t] ??= {}; cnt[t][r.comp] = (cnt[t][r.comp] ?? 0) + 1; }
  }
  const out: Record<string, string> = {};
  for (const [t, c] of Object.entries(cnt)) out[t] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  return out;
}

async function loadExtras(rows: Row[]) {
  const prof0 = await sql`select least(90, greatest(1, (g->>'m')::int)) as minute, count(*)::int n
    from matches m, jsonb_array_elements(m.goals) g
    where m.details_at is not null and (g->>'p')::int <= 2 group by 1`;
  const counts = new Array(90).fill(1);
  for (const r of prof0) counts[Number(r.minute) - 1] += Number(r.n);
  const sm = counts.map((c, i) => (i === 44 || i === 89 || i === 0 || i === 45 || i === 88 || i === 43) ? c : (counts[i - 1] + c + counts[i + 1]) / 3);
  const tot = sm.reduce((a, b) => a + b, 0);
  const prof = sm.map((c) => c / tot);
  let hg = 0, fg = 0; for (const r of rows) if (r.htH != null && r.htA != null) { hg += r.htH + r.htA; fg += r.gH + r.gA; }
  const phi = fg > 0 ? hg / fg : 0.45;
  const pr = await sql`select public.pos_group(mp.pos_abbr) as grp, sum(mp.minutes)::float8 as m, sum(mp.goals)::float8 as g,
      sum(0.30 * mp.sot + 0.06 * greatest(mp.shots - mp.sot, 0))::float8 as x, sum(mp.assists)::float8 as a, sum(mp.shots)::float8 as sh,
      sum(mp.sot)::float8 as sot, sum(mp.yellow + mp.red)::float8 as c
    from match_players mp join matches mm on mm.id = mp.match_id
    where mp.starter and mm.state = 'post' and mm.details_at is not null and mp.minutes > 0 group by 1`;
  const priors: Params["priors"] = {};
  for (const r of pr) {
    const k = 90 / Math.max(1, Number(r.m));
    priors[r.grp] = { g: r.g * k, x: r.x * k, a: r.a * k, sh: r.sh * k, sot: r.sot * k, c: r.c * k, min: 0 };
  }
  for (const g of ["G", "D", "M", "F"]) priors[g] ??= { g: 0.1, x: 0.1, a: 0.08, sh: 1, sot: 0.35, c: 0.15, min: 0 };
  return { prof, phi, priors };
}

export async function taskFit() {
  await sql`select public.rebuild_features()`;
  const all = await loadDoneRows();
  const now = Date.now() / 1000;
  for (const r of all) r.age = (now - r.ko) / 86400;
  const rows = all.filter((r) => r.age < 540);
  const teamLg = teamLeagues(all);
  const extra = await loadExtras(rows);
  const prev = await sql`select params from model_params where kind = 'live' order by id desc limit 1`;
  const params = fitAll(rows, teamLg, extra, prev[0]?.params, prev.length ? 25 : 45);
  params.stats = { rows: rows.length, phi: extra.phi };
  await sql`insert into model_params (kind, params) values ('live', ${sql.json(params)})`;
  await sql`delete from model_params where kind = 'live' and id not in (select id from model_params where kind = 'live' order by id desc limit 5)`;
  return { rows: rows.length, rho: params.rho, phi: params.phi, beta: params.goals.beta, r: { corners: params.corners.r, shots: params.shots.r, cards: params.cards.r }, teams: Object.keys(params.goals.team).length };
}

async function latestParams(): Promise<Params | null> {
  const r = await sql`select params from model_params where kind = 'live' order by id desc limit 1`;
  return r[0]?.params ?? null;
}

function implied(odds: any) {
  const c = odds?.close; if (!c?.h || !c?.d || !c?.a) return null;
  const s = 1 / c.h + 1 / c.d + 1 / c.a;
  return { h: 1 / c.h / s, d: 1 / c.d / s, a: 1 / c.a / s, margin: s - 1 };
}

export async function predictAndStore(matchId: string, lineupSource: string) {
  const p = await latestParams(); if (!p) return { error: "no params" };
  const [m] = await sql`select m.*, th.name as home_name, ta.name as away_name from matches m
    join teams th on th.id = m.home_id join teams ta on ta.id = m.away_id where m.id = ${matchId}`;
  if (!m) return { error: "no match" };
  const fr = await sql`select * from match_features where match_id = ${matchId}`;
  const fH = fr.find((x: any) => x.side === "home"), fA = fr.find((x: any) => x.side === "away");
  const fh = toFeat(fH), fa = toFeat(fA);
  const players: PlayerRate[] = lineupSource === "official" ? (await sql`select * from public.player_rates(${matchId})`).map((r: any) => ({ ...r,
    wm: Number(r.wm), wg: Number(r.wg), wx: Number(r.wx), wa: Number(r.wa), wsh: Number(r.wsh), wsot: Number(r.wsot), wc: Number(r.wc),
    avg_start_min: r.avg_start_min == null ? null : Number(r.avg_start_min) })) : [];
  const ctx = { comp: m.comp, neutral: m.neutral, home_id: m.home_id, away_id: m.away_id, home_name: m.home_name, away_name: m.away_name };
  const out = predict(p, ctx, fh, fa, players, marketFromOdds(m.odds));
  const factors = { ...explain(p, ctx, fh, fa, nz(fH?.rest_days), nz(fA?.rest_days)), raw: { home: fH ?? null, away: fA ?? null }, summary: out.summary,
    model_lambdas: out.model, market_weight: out.market_weight, n_eff: { home: p.nEff?.[m.home_id] ?? 0, away: p.nEff?.[m.away_id] ?? 0 } };
  const odds = m.odds ? { ...m.odds, implied: implied(m.odds) } : null;
  await sql`insert into predictions (match_id, mode, model_version, lineup_source, lam_home, lam_away, p_home, p_draw, p_away, markets, players, factors, odds_snapshot,
      p_o25, p_btts, exp_corners, p_corners_o95, exp_cards, p_cards_o45)
    values (${matchId}, 'live', ${MODEL_VERSION}, ${lineupSource}, ${out.lh}, ${out.la}, ${out.pH}, ${out.pD}, ${out.pA},
      ${sql.json(out.markets)}, ${sql.json(out.players)}, ${sql.json(factors)}, ${odds ? sql.json(odds) : null},
      ${out.summary.p_o25}, ${out.summary.p_btts}, ${out.summary.exp_corners}, ${out.summary.p_corners_o95}, ${out.summary.exp_cards}, ${out.summary.p_cards_o45})
    on conflict (match_id, mode) do nothing`;
  return { match: matchId, lh: out.lh, la: out.la, pH: out.pH, pD: out.pD, pA: out.pA, players: out.players.length };
}

export async function taskPrematch() {
  const rows = await sql`select m.id, m.comp, m.kickoff, m.lineups_at,
      extract(epoch from (m.kickoff - now())) / 60 as mins_to_ko
    from matches m
    where m.state = 'pre' and m.kickoff between now() - interval '15 minutes' and now() + interval '80 minutes'
      and not exists (select 1 from predictions p where p.match_id = m.id and p.mode = 'live')
    order by m.kickoff limit 30`;
  const ready: { id: string; src: string }[] = [];
  for (const r of rows) {
    try {
      const s = await fetchSummary(r.comp, r.id);
      if (s) await writeSummary(r.id, s, false);
      if (s?.lineupsReady) ready.push({ id: r.id, src: "official" });
      else if (Number(r.mins_to_ko) <= 6) ready.push({ id: r.id, src: "none" });
    } catch (e) { console.error("prematch", r.id, String(e)); }
  }
  const out: any[] = [];
  if (ready.length) {
    await sql`select public.rebuild_features()`;
    for (const x of ready) out.push(await predictAndStore(x.id, x.src));
  }
  return { checked: rows.length, published: out };
}

// walk-forward backtest: refit each week on data strictly before it, predict that week
export async function taskBacktest(fromISO: string, weeks: number) {
  const all = await loadDoneRows();
  const teamLg = teamLeagues(all);
  const extraAll = await loadExtras(all);
  let start = new Date(fromISO).getTime() / 1000;
  const nowS = Date.now() / 1000;
  let warm: Params | undefined;
  const prev = await sql`select params from model_params where kind = 'backtest_warm' order by id desc limit 1`;
  if (prev.length && prev[0].params?.ref === fromISO) warm = prev[0].params.model;
  let stored = 0, done = 0;
  for (let w = 0; w < weeks && start < nowS; w++) {
    const end = start + 7 * 86400;
    const train = all.filter((r) => r.ko < start).map((r) => ({ ...r, age: (start - r.ko) / 86400 })).filter((r) => r.age < 540);
    const test = all.filter((r) => r.ko >= start && r.ko < end);
    if (train.length > 300 && test.length) {
      const params = fitAll(train, teamLg, extraAll, warm, warm ? 12 : 40);
      warm = params;
      const recs = [];
      for (const r of test) {
        const lam = predictLite(params, r, (r as any).mq);
        recs.push({ match_id: r.id, mode: "backtest", model_version: MODEL_VERSION, lineup_source: r.fh.ok && r.fa.ok ? "official" : "none", ...lam });
      }
      if (recs.length) {
        await sql`insert into predictions ${sql(recs, "match_id", "mode", "model_version", "lineup_source", "lam_home", "lam_away", "p_home", "p_draw", "p_away", "p_o25", "p_btts", "exp_corners", "p_corners_o95", "exp_cards", "p_cards_o45")}
          on conflict (match_id, mode) do update set lam_home = excluded.lam_home, lam_away = excluded.lam_away, p_home = excluded.p_home, p_draw = excluded.p_draw, p_away = excluded.p_away,
            p_o25 = excluded.p_o25, p_btts = excluded.p_btts, exp_corners = excluded.exp_corners, p_corners_o95 = excluded.p_corners_o95, exp_cards = excluded.exp_cards, p_cards_o45 = excluded.p_cards_o45,
            lineup_source = excluded.lineup_source, created_at = now()`;
        stored += recs.length;
      }
    }
    start = end; done++;
  }
  const next = new Date(start * 1000).toISOString();
  if (warm) await sql`insert into model_params (kind, params) values ('backtest_warm', ${sql.json({ ref: next, model: warm })})`;
  await sql`delete from model_params where kind = 'backtest_warm' and id not in (select id from model_params where kind = 'backtest_warm' order by id desc limit 2)`;
  return { weeks: done, stored, next, finished: start >= nowS };
}

function predictLite(p: Params, r: Row, mq: any) {
  const L0 = lambdas(p, "goals", r.comp, r.neutral, r.home, r.away, r.fh, r.fa);
  const { lh, la } = blendLambdas(p, r.home, r.away, L0.lh, L0.la, mq);
  const N = 10; const ph = [Math.exp(-lh)], pa = [Math.exp(-la)];
  for (let k = 1; k <= N; k++) { ph[k] = ph[k - 1] * lh / k; pa[k] = pa[k - 1] * la / k; }
  let H = 0, D = 0, A = 0, o25 = 0, btts = 0, tot = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const v = Math.max(0, ph[i] * pa[j] * tau(i, j, lh, la, p.rho)); tot += v;
    if (i > j) H += v; else if (i === j) D += v; else A += v;
    if (i + j >= 3) o25 += v; if (i > 0 && j > 0) btts += v;
  }
  const nb = (mu: number, rr: number | null, n: number) => { const out = new Float64Array(n + 1);
    if (!rr) { out[0] = Math.exp(-mu); for (let k = 1; k <= n; k++) out[k] = out[k - 1] * mu / k; return out; }
    const q = rr / (rr + mu); out[0] = Math.pow(q, rr); for (let k = 1; k <= n; k++) out[k] = out[k - 1] * ((k - 1 + rr) / k) * (1 - q); return out; };
  const totOver = (which: "corners" | "cards", line: number) => {
    const L = lambdas(p, which, r.comp, r.neutral, r.home, r.away, r.fh, r.fa); const a = nb(L.lh, p[which].r, 25), b = nb(L.la, p[which].r, 25);
    let under = 0; for (let i = 0; i <= 25; i++) for (let j = 0; j <= 25 && i + j <= line; j++) under += a[i] * b[j];
    return { exp: L.lh + L.la, over: 1 - under };
  };
  const c = totOver("corners", 9), k = totOver("cards", 4);
  return { lam_home: lh, lam_away: la, p_home: H / tot, p_draw: D / tot, p_away: A / tot, p_o25: o25 / tot, p_btts: btts / tot,
    exp_corners: c.exp, p_corners_o95: c.over, exp_cards: k.exp, p_cards_o45: k.over };
}
