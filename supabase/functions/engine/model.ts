// Prediction model: hierarchical log-linear Poisson / negative-binomial ratings (Maher / Dixon-Coles family)
// with league-level effects, time decay and lineup-based covariates.

export const LEAGUES = ["bel.1", "eng.1", "esp.1", "ita.1", "ger.1", "fra.1"];
export const MODEL_VERSION = "v1.0";

export interface Feat { lrA: number; lc: number; gk: number; sr: number; ok: boolean }
export interface Row {
  id: string; comp: string; age: number; neutral: boolean; home: string; away: string;
  gH: number; gA: number; xH: number; xA: number;
  cH: number | null; cA: number | null; sH: number | null; sA: number | null;
  oH: number | null; oA: number | null; kH: number | null; kA: number | null;
  htH: number | null; htA: number | null;
  fh: Feat; fa: Feat;
}

// covariates per observation: [attack lineup idx, attack continuity, defence continuity (opponent), defence GK change (opponent),
//   attacking team short rest, defending team short rest]
const NB = 6;
export const BETA_NAMES = ["compo_attaque", "stabilite_compo_att", "stabilite_compo_def", "gardien_remplacant", "fatigue_att", "fatigue_def"];

export function covs(att: Feat, def: Feat): number[] {
  return [att.ok ? att.lrA : 0, att.ok ? att.lc : 0, def.ok ? def.lc : 0, def.ok ? def.gk : 0, att.sr, def.sr];
}

export interface SubModel {
  mu0: number;
  comp: Record<string, { mu: number; h: number }>;
  lg: Record<string, { A: number; D: number }>;
  team: Record<string, [number, number]>;
  beta: number[];
  r: number | null; // NB size (null = Poisson)
  n: number;
}

export interface Params {
  version: string; created_at: string; ref: string; n_matches: number;
  teamLg: Record<string, string>;
  goals: SubModel; corners: SubModel; shots: SubModel; sot: SubModel; cards: SubModel;
  rho: number; phi: number; prof: number[]; xgScale: number; blend: number; nEff: Record<string, number>;
  priors: Record<string, { g: number; x: number; a: number; sh: number; sot: number; c: number; min: number }>;
  stats: Record<string, number>;
}

interface Obs { y: number; w: number; comp: string; home: boolean; att: string; def: string; x: number[] }

function fitSub(obs: Obs[], teamLg: Record<string, string>, opts: { useCov: boolean; sdTeam: number; sdLg: number; iters: number; warm?: SubModel }): SubModel {
  const n = obs.length;
  const tIdx = new Map<string, number>(), cIdx = new Map<string, number>(), lIdx = new Map<string, number>();
  const id = (m: Map<string, number>, k: string) => { let v = m.get(k); if (v === undefined) { v = m.size; m.set(k, v); } return v; };
  const y = new Float64Array(n), w = new Float64Array(n), hm = new Uint8Array(n);
  const ci = new Int32Array(n), at = new Int32Array(n), df = new Int32Array(n), la = new Int32Array(n), ld = new Int32Array(n);
  const X = new Float64Array(n * NB);
  let W = 0, Y = 0;
  for (let k = 0; k < n; k++) {
    const o = obs[k]; y[k] = o.y; w[k] = o.w; hm[k] = o.home ? 1 : 0;
    ci[k] = id(cIdx, o.comp); at[k] = id(tIdx, o.att); df[k] = id(tIdx, o.def);
    la[k] = id(lIdx, teamLg[o.att] ?? "other"); ld[k] = id(lIdx, teamLg[o.def] ?? "other");
    if (opts.useCov) for (let j = 0; j < NB; j++) X[k * NB + j] = o.x[j];
    W += o.w; Y += o.w * o.y;
  }
  const T = tIdx.size, C = cIdx.size, LG = lIdx.size;
  const TA = new Float64Array(T), TD = new Float64Array(T), cmu = new Float64Array(C), ch = new Float64Array(C).fill(0.1);
  const LA = new Float64Array(LG), LD = new Float64Array(LG), beta = new Float64Array(NB);
  let mu0 = Math.log(Math.max(Y / W, 0.05));
  const wm = opts.warm;
  if (wm) {
    mu0 = wm.mu0;
    for (const [k, v] of tIdx) { const t = wm.team[k]; if (t) { TA[v] = t[0]; TD[v] = t[1]; } }
    for (const [k, v] of cIdx) { const c = wm.comp[k]; if (c) { cmu[v] = c.mu; ch[v] = c.h; } }
    for (const [k, v] of lIdx) { const l = wm.lg[k]; if (l) { LA[v] = l.A; LD[v] = l.D; } }
    if (opts.useCov) for (let j = 0; j < NB; j++) beta[j] = wm.beta[j] ?? 0;
  }
  const isCup = new Uint8Array(C); for (const [k, v] of cIdx) isCup[v] = LEAGUES.includes(k) ? 0 : 1;
  const pTeam = 1 / (opts.sdTeam * opts.sdTeam), pLg = 1 / (opts.sdLg * opts.sdLg), pCup = 1 / (0.3 * 0.3), pBeta = 4;
  const eta = new Float64Array(n), lam = new Float64Array(n);
  const full = () => {
    for (let k = 0; k < n; k++) {
      let e = mu0 + cmu[ci[k]] + (hm[k] ? ch[ci[k]] : 0) + LA[la[k]] + TA[at[k]] + LD[ld[k]] + TD[df[k]];
      if (opts.useCov) for (let j = 0; j < NB; j++) e += beta[j] * X[k * NB + j];
      eta[k] = e; lam[k] = Math.exp(Math.max(-6, Math.min(4, e)));
    }
  };
  const bump = (k: number, d: number) => { if (d) { eta[k] += d; lam[k] = Math.exp(Math.max(-6, Math.min(4, eta[k]))); } };
  const step = (g: number, h: number, cap = 0.5) => Math.max(-cap, Math.min(cap, g / h));
  const gA = new Float64Array(Math.max(T, C, LG)), hA = new Float64Array(Math.max(T, C, LG));
  const gB = new Float64Array(C), hB = new Float64Array(C);
  const dA = new Float64Array(Math.max(T, C, LG)), dB = new Float64Array(C);
  full();
  for (let it = 0; it < opts.iters; it++) {
    { let g = 0, h = 0; for (let k = 0; k < n; k++) { g += w[k] * (y[k] - lam[k]); h += w[k] * lam[k]; } const d = step(g, h); mu0 += d; for (let k = 0; k < n; k++) bump(k, d); }
    // competitions
    gA.fill(0, 0, C); hA.fill(0, 0, C); gB.fill(0); hB.fill(0);
    for (let k = 0; k < n; k++) { const r = w[k] * (y[k] - lam[k]), hh = w[k] * lam[k], c = ci[k]; gA[c] += r; hA[c] += hh; if (hm[k]) { gB[c] += r; hB[c] += hh; } }
    for (let c = 0; c < C; c++) {
      dA[c] = isCup[c] ? step(gA[c] - pCup * cmu[c], hA[c] + pCup) : 0; cmu[c] += dA[c];
      dB[c] = step(gB[c] - (ch[c] - 0.1), hB[c] + 1); ch[c] += dB[c];
    }
    for (let k = 0; k < n; k++) bump(k, dA[ci[k]] + (hm[k] ? dB[ci[k]] : 0));
    // league attack
    gA.fill(0, 0, LG); hA.fill(0, 0, LG);
    for (let k = 0; k < n; k++) { gA[la[k]] += w[k] * (y[k] - lam[k]); hA[la[k]] += w[k] * lam[k]; }
    for (let l = 0; l < LG; l++) { dA[l] = step(gA[l] - pLg * LA[l], hA[l] + pLg); LA[l] += dA[l]; }
    for (let k = 0; k < n; k++) bump(k, dA[la[k]]);
    // league defence
    gA.fill(0, 0, LG); hA.fill(0, 0, LG);
    for (let k = 0; k < n; k++) { gA[ld[k]] += w[k] * (y[k] - lam[k]); hA[ld[k]] += w[k] * lam[k]; }
    for (let l = 0; l < LG; l++) { dA[l] = step(gA[l] - pLg * LD[l], hA[l] + pLg); LD[l] += dA[l]; }
    for (let k = 0; k < n; k++) bump(k, dA[ld[k]]);
    // team attack
    gA.fill(0, 0, T); hA.fill(0, 0, T);
    for (let k = 0; k < n; k++) { gA[at[k]] += w[k] * (y[k] - lam[k]); hA[at[k]] += w[k] * lam[k]; }
    for (let t = 0; t < T; t++) { dA[t] = step(gA[t] - pTeam * TA[t], hA[t] + pTeam); TA[t] += dA[t]; }
    for (let k = 0; k < n; k++) bump(k, dA[at[k]]);
    // team defence
    gA.fill(0, 0, T); hA.fill(0, 0, T);
    for (let k = 0; k < n; k++) { gA[df[k]] += w[k] * (y[k] - lam[k]); hA[df[k]] += w[k] * lam[k]; }
    for (let t = 0; t < T; t++) { dA[t] = step(gA[t] - pTeam * TD[t], hA[t] + pTeam); TD[t] += dA[t]; }
    for (let k = 0; k < n; k++) bump(k, dA[df[k]]);
    // covariates
    if (opts.useCov) for (let j = 0; j < NB; j++) {
      let g = 0, h = 0;
      for (let k = 0; k < n; k++) { const x = X[k * NB + j]; if (!x) continue; g += w[k] * x * (y[k] - lam[k]); h += w[k] * x * x * lam[k]; }
      const d = step(g - pBeta * beta[j], h + pBeta, 0.3); beta[j] += d;
      if (d) for (let k = 0; k < n; k++) { const x = X[k * NB + j]; if (x) bump(k, d * x); }
    }
  }
  full();
  let s2 = 0, s1 = 0, sq = 0;
  for (let k = 0; k < n; k++) { s2 += w[k] * (y[k] - lam[k]) ** 2; s1 += w[k] * lam[k]; sq += w[k] * lam[k] * lam[k]; }
  const excess = s2 - s1;
  const m: SubModel = { mu0, comp: {}, lg: {}, team: {}, beta: Array.from(beta), r: excess > 0.02 * s1 ? Math.max(2, Math.min(300, sq / excess)) : null, n };
  const r4 = (x: number) => Math.round(x * 10000) / 10000;
  for (const [k, v] of tIdx) m.team[k] = [r4(TA[v]), r4(TD[v])];
  for (const [k, v] of cIdx) m.comp[k] = { mu: r4(cmu[v]), h: r4(ch[v]) };
  for (const [k, v] of lIdx) m.lg[k] = { A: r4(LA[v]), D: r4(LD[v]) };
  return m;
}

export function fitAll(rows: Row[], teamLg: Record<string, string>, extra: { prof: number[]; phi: number; priors: Params["priors"] }, warm?: Params, iters = 40): Params {
  const HL = 150;
  const wOf = (age: number) => Math.pow(0.5, age / HL);
  // xG proxy scaling so that its mean equals the mean of goals
  let sg = 0, sx = 0; for (const r of rows) { sg += r.gH + r.gA; sx += r.xH + r.xA; }
  const xgScale = sx > 0 ? sg / sx : 1;
  const blend = 0.5;
  const mk = (pick: (r: Row, side: "h" | "a") => number | null, cov: boolean) => {
    const obs: Obs[] = [];
    for (const r of rows) {
      const w = wOf(r.age);
      const yh = pick(r, "h"), ya = pick(r, "a");
      if (yh !== null && Number.isFinite(yh)) obs.push({ y: yh, w, comp: r.comp, home: !r.neutral, att: r.home, def: r.away, x: covs(r.fh, r.fa) });
      if (ya !== null && Number.isFinite(ya)) obs.push({ y: ya, w, comp: r.comp, home: false, att: r.away, def: r.home, x: covs(r.fa, r.fh) });
    }
    return obs;
  };
  const goalsObs = mk((r, s) => s === "h" ? (1 - blend) * r.gH + blend * r.xH * xgScale : (1 - blend) * r.gA + blend * r.xA * xgScale, true);
  const goals = fitSub(goalsObs, teamLg, { useCov: true, sdTeam: 0.28, sdLg: 0.5, iters, warm: warm?.goals });
  const corners = fitSub(mk((r, s) => s === "h" ? r.cH : r.cA, false), teamLg, { useCov: false, sdTeam: 0.2, sdLg: 0.3, iters, warm: warm?.corners });
  const shots = fitSub(mk((r, s) => s === "h" ? r.sH : r.sA, true), teamLg, { useCov: true, sdTeam: 0.22, sdLg: 0.3, iters, warm: warm?.shots });
  const sot = fitSub(mk((r, s) => s === "h" ? r.oH : r.oA, true), teamLg, { useCov: true, sdTeam: 0.25, sdLg: 0.3, iters, warm: warm?.sot });
  const cards = fitSub(mk((r, s) => s === "h" ? r.kH : r.kA, false), teamLg, { useCov: false, sdTeam: 0.2, sdLg: 0.3, iters, warm: warm?.cards });

  // Dixon-Coles rho by grid search on actual 90-min scores
  const base: Params = {
    version: MODEL_VERSION, created_at: new Date().toISOString(), ref: new Date().toISOString(), n_matches: rows.length, teamLg,
    goals, corners, shots, sot, cards, rho: 0, phi: extra.phi, prof: extra.prof, xgScale, blend, priors: extra.priors, stats: {}, nEff: {},
  };
  for (const r of rows) { const w = wOf(r.age); base.nEff[r.home] = (base.nEff[r.home] ?? 0) + w; base.nEff[r.away] = (base.nEff[r.away] ?? 0) + w; }
  for (const k in base.nEff) base.nEff[k] = Math.round(base.nEff[k] * 10) / 10;
  const lamPre = rows.map((r) => lambdas(base, "goals", r.comp, r.neutral, r.home, r.away, r.fh, r.fa));
  let best = 0, bestLL = -Infinity;
  for (let rho = -0.2; rho <= 0.1001; rho += 0.01) {
    let ll = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; if (r.gH > 1 || r.gA > 1) continue;
      const t = tau(r.gH, r.gA, lamPre[i].lh, lamPre[i].la, rho);
      if (t <= 0) { ll = -Infinity; break; }
      ll += wOf(r.age) * Math.log(t);
    }
    if (ll > bestLL) { bestLL = ll; best = Math.round(rho * 100) / 100; }
  }
  base.rho = best;
  return base;
}

export function lambdas(p: Params, which: "goals" | "corners" | "shots" | "sot" | "cards", comp: string, neutral: boolean, home: string, away: string, fh: Feat, fa: Feat) {
  const m = p[which];
  const c = m.comp[comp] ?? { mu: 0, h: 0.1 };
  const lgH = m.lg[p.teamLg[home] ?? "other"] ?? { A: 0, D: 0 };
  const lgA = m.lg[p.teamLg[away] ?? "other"] ?? { A: 0, D: 0 };
  const tH = m.team[home] ?? [0, 0], tA = m.team[away] ?? [0, 0];
  const xh = covs(fh, fa), xa = covs(fa, fh);
  let eh = m.mu0 + c.mu + (neutral ? 0 : c.h) + lgH.A + tH[0] + lgA.D + tA[1];
  let ea = m.mu0 + c.mu + lgA.A + tA[0] + lgH.D + tH[1];
  for (let j = 0; j < NB; j++) { eh += m.beta[j] * xh[j]; ea += m.beta[j] * xa[j]; }
  return { lh: Math.exp(eh), la: Math.exp(ea), xh, xa };
}

export function tau(x: number, y: number, lh: number, la: number, rho: number) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

// ---------- distributions ----------
function poisPmf(l: number, n: number) { const out = new Float64Array(n + 1); out[0] = Math.exp(-l); for (let k = 1; k <= n; k++) out[k] = out[k - 1] * l / k; return out; }
function nbPmf(mu: number, r: number | null, n: number) {
  if (!r) return poisPmf(mu, n);
  const out = new Float64Array(n + 1); const p = r / (r + mu);
  out[0] = Math.pow(p, r);
  for (let k = 1; k <= n; k++) out[k] = out[k - 1] * ((k - 1 + r) / k) * (1 - p);
  return out;
}
function conv(a: Float64Array, b: Float64Array) { const out = new Float64Array(a.length + b.length - 1); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]; return out; }
const tailGE = (pmf: Float64Array, k: number) => { let s = 0; for (let i = Math.max(0, k); i < pmf.length; i++) s += pmf[i]; return Math.min(1, s); };
const mean = (pmf: Float64Array) => { let s = 0; for (let i = 0; i < pmf.length; i++) s += i * pmf[i]; return s; };


// ---------- market information (used only for teams with little data) ----------
export interface MarketQ { qH: number; qD: number; qA: number; line: number | null; qOver: number | null }
export function marketFromOdds(o: any): MarketQ | null {
  const c = o?.close; if (!c?.h || !c?.d || !c?.a || c.h <= 1 || c.d <= 1 || c.a <= 1) return null;
  const s = 1 / c.h + 1 / c.d + 1 / c.a;
  let qOver: number | null = null;
  if (c.line != null && c.over > 1 && c.under > 1) { const t = 1 / c.over + 1 / c.under; qOver = (1 / c.over) / t; }
  return { qH: 1 / c.h / s, qD: 1 / c.d / s, qA: 1 / c.a / s, line: c.line ?? null, qOver };
}
function poisCdf(mu: number, k: number) { let p = Math.exp(-mu), s = p; for (let i = 1; i <= k; i++) { p *= mu / i; s += p; } return s; }
function hda(lh: number, la: number) {
  const N = 12; const a = poisPmf(lh, N), b = poisPmf(la, N); let H = 0, A = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { if (i > j) H += a[i] * b[j]; else if (j > i) A += a[i] * b[j]; }
  return { H, A };
}
export function impliedLambdas(q: MarketQ, totalModel: number) {
  let mu = totalModel;
  if (q.line != null && q.qOver != null) {
    const k = Math.floor(q.line); let lo = 0.3, hi = 7;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (1 - poisCdf(mid, k) < q.qOver) lo = mid; else hi = mid; }
    mu = (lo + hi) / 2;
  }
  const target = q.qH - q.qA; let lo = 0.02, hi = 0.98;
  for (let it = 0; it < 40; it++) { const s = (lo + hi) / 2; const r = hda(s * mu, (1 - s) * mu); if (r.H - r.A < target) lo = s; else hi = s; }
  const s = (lo + hi) / 2;
  return { lh: s * mu, la: (1 - s) * mu };
}
export function marketWeight(p: Params, home: string, away: string) {
  const n = Math.min(p.nEff?.[home] ?? 0, p.nEff?.[away] ?? 0);
  return Math.max(0, Math.min(0.75, (18 - n) / 18));
}
export function blendLambdas(p: Params, home: string, away: string, lh: number, la: number, q: MarketQ | null) {
  if (!q) return { lh, la, w: 0 };
  const w = marketWeight(p, home, away);
  if (w <= 0) return { lh, la, w: 0 };
  const m = impliedLambdas(q, lh + la);
  return { lh: Math.exp((1 - w) * Math.log(lh) + w * Math.log(m.lh)), la: Math.exp((1 - w) * Math.log(la) + w * Math.log(m.la)), w, mkt: m };
}

export interface Sel { k: string; label: string; p: number; push?: number }
export interface Market { key: string; title: string; group: string; sels: Sel[] }

const fmt = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");

function ouMarkets(key: string, title: string, group: string, pmf: Float64Array, lines: number[]): Market {
  const sels: Sel[] = [];
  for (const L of lines) { const over = tailGE(pmf, Math.floor(L) + 1); sels.push({ k: `o${L}`, label: `Plus de ${fmt(L)}`, p: over }, { k: `u${L}`, label: `Moins de ${fmt(L)}`, p: 1 - over }); }
  return { key, title, group, sels };
}
function linesAround(mu: number, n = 3) { const c = Math.floor(mu) + 0.5; const out: number[] = []; for (let i = -n; i <= n; i++) { const L = c + i; if (L > 0) out.push(L); } return out; }

// exact 2UP / 1UP via dynamic programming on the goal difference, minute by minute
function earlyPayout(lh: number, la: number, prof: number[], lead: number) {
  const N = 21, off = 10;
  // state: diff, everHome, everAway
  let P = new Float64Array(N * 4); P[off * 4] = 1;
  for (let t = 0; t < prof.length; t++) {
    const ph = 1 - Math.exp(-lh * prof[t]), pa = 1 - Math.exp(-la * prof[t]);
    const pH = ph * (1 - pa), pA = pa * (1 - ph), p0 = 1 - pH - pA;
    const Q = new Float64Array(N * 4);
    for (let d = 0; d < N; d++) for (let f = 0; f < 4; f++) {
      const v = P[d * 4 + f]; if (!v) continue;
      const put = (nd: number, pr: number) => {
        nd = Math.max(0, Math.min(N - 1, nd));
        let nf = f; const diff = nd - off;
        if (diff >= lead) nf |= 1; if (diff <= -lead) nf |= 2;
        Q[nd * 4 + nf] += v * pr;
      };
      put(d, p0); put(d + 1, pH); put(d - 1, pA);
    }
    P = Q;
  }
  let home = 0, away = 0, everH = 0, everA = 0;
  for (let d = 0; d < N; d++) for (let f = 0; f < 4; f++) {
    const v = P[d * 4 + f]; const diff = d - off;
    if (f & 1) everH += v; if (f & 2) everA += v;
    if ((f & 1) || diff > 0) home += v;
    if ((f & 2) || diff < 0) away += v;
  }
  return { home, away, everH, everA };
}

export interface PlayerRate { player_id: string; team_id: string; name: string; short_name: string | null; grp: string; starter: boolean; pos: string | null; jersey: string | null;
  wm: number; apps: number; starts: number; avg_start_min: number | null; wg: number; wx: number; wa: number; wsh: number; wsot: number; wc: number }

export function predict(p: Params, m: { comp: string; neutral: boolean; home_id: string; away_id: string; home_name: string; away_name: string },
  fh: Feat, fa: Feat, players: PlayerRate[] | null, market: MarketQ | null = null) {
  const G = lambdas(p, "goals", m.comp, m.neutral, m.home_id, m.away_id, fh, fa);
  const B = blendLambdas(p, m.home_id, m.away_id, G.lh, G.la, market);
  const lh = B.lh, la = B.la;
  const N = 10;
  const ph = poisPmf(lh, N), pa = poisPmf(la, N);
  const S: number[][] = []; let tot = 0;
  for (let i = 0; i <= N; i++) { S[i] = []; for (let j = 0; j <= N; j++) { const v = ph[i] * pa[j] * tau(i, j, lh, la, p.rho); S[i][j] = Math.max(0, v); tot += S[i][j]; } }
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) S[i][j] /= tot;
  const sum = (f: (i: number, j: number) => boolean) => { let s = 0; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) if (f(i, j)) s += S[i][j]; return s; };
  const pH = sum((i, j) => i > j), pD = sum((i, j) => i === j), pA = sum((i, j) => i < j);
  const H = m.home_name, A = m.away_name;
  const mk: Market[] = [];
  mk.push({ key: "1x2", title: "Résultat du match (1N2)", group: "Résultat", sels: [{ k: "1", label: H, p: pH }, { k: "x", label: "Match nul", p: pD }, { k: "2", label: A, p: pA }] });
  mk.push({ key: "dc", title: "Double chance", group: "Résultat", sels: [{ k: "1x", label: `${H} ou nul`, p: pH + pD }, { k: "12", label: `${H} ou ${A}`, p: pH + pA }, { k: "x2", label: `Nul ou ${A}`, p: pD + pA }] });
  mk.push({ key: "dnb", title: "Remboursé si match nul", group: "Résultat", sels: [{ k: "1", label: H, p: pH, push: pD }, { k: "2", label: A, p: pA, push: pD }] });
  // totals
  const totPmf = new Float64Array(2 * N + 1); for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) totPmf[i + j] += S[i][j];
  mk.push(ouMarkets("goals_ou", "Nombre de buts", "Buts", totPmf, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]));
  const btts = sum((i, j) => i > 0 && j > 0);
  mk.push({ key: "btts", title: "Les deux équipes marquent", group: "Buts", sels: [{ k: "y", label: "Oui", p: btts }, { k: "n", label: "Non", p: 1 - btts }] });
  const hPmf = new Float64Array(N + 1), aPmf = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { hPmf[i] += S[i][j]; aPmf[j] += S[i][j]; }
  mk.push(ouMarkets("home_goals", `Buts de ${H}`, "Buts", hPmf, [0.5, 1.5, 2.5]));
  mk.push(ouMarkets("away_goals", `Buts de ${A}`, "Buts", aPmf, [0.5, 1.5, 2.5]));
  mk.push({ key: "btts_res", title: "Résultat et les deux équipes marquent", group: "Buts", sels: [
    { k: "1y", label: `${H} gagne et les deux marquent`, p: sum((i, j) => i > j && j > 0) },
    { k: "xy", label: "Nul et les deux marquent", p: sum((i, j) => i === j && i > 0) },
    { k: "2y", label: `${A} gagne et les deux marquent`, p: sum((i, j) => i < j && i > 0) }] });
  mk.push({ key: "res_ou", title: "Résultat et plus/moins de 2,5 buts", group: "Buts", sels: [
    { k: "1o", label: `${H} et plus de 2,5`, p: sum((i, j) => i > j && i + j >= 3) }, { k: "1u", label: `${H} et moins de 2,5`, p: sum((i, j) => i > j && i + j <= 2) },
    { k: "xo", label: "Nul et plus de 2,5", p: sum((i, j) => i === j && i + j >= 3) }, { k: "xu", label: "Nul et moins de 2,5", p: sum((i, j) => i === j && i + j <= 2) },
    { k: "2o", label: `${A} et plus de 2,5`, p: sum((i, j) => i < j && i + j >= 3) }, { k: "2u", label: `${A} et moins de 2,5`, p: sum((i, j) => i < j && i + j <= 2) }] });
  // correct score
  const cs: Sel[] = []; for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) cs.push({ k: `${i}-${j}`, label: `${i} - ${j}`, p: S[i][j] });
  cs.sort((a, b) => b.p - a.p);
  mk.push({ key: "cs", title: "Score exact", group: "Score", sels: cs.slice(0, 12) });
  // handicaps
  const ah: Sel[] = [];
  const diffP = (f: (d: number) => boolean) => sum((i, j) => f(i - j));
  for (const L of [-2.5, -2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2]) {
    // home with handicap L: home wins bet if (i - j + L) > 0, push if == 0
    const win = diffP((d) => d + L > 0), push = Number.isInteger(L) ? diffP((d) => d + L === 0) : 0;
    ah.push({ k: `h${L}`, label: `${H} ${L > 0 ? "+" : ""}${fmt(L)}`, p: win, push: push || undefined });
    const winA = diffP((d) => -d + L > 0), pushA = Number.isInteger(L) ? diffP((d) => -d + L === 0) : 0;
    ah.push({ k: `a${L}`, label: `${A} ${L > 0 ? "+" : ""}${fmt(L)}`, p: winA, push: pushA || undefined });
  }
  mk.push({ key: "ah", title: "Handicap asiatique", group: "Handicaps", sels: ah });
  mk.push({ key: "eh_h1", title: `Handicap européen ${H} -1`, group: "Handicaps", sels: [
    { k: "1", label: `${H} gagne par 2 buts ou plus`, p: diffP((d) => d >= 2) }, { k: "x", label: `${H} gagne par 1 but exactement`, p: diffP((d) => d === 1) }, { k: "2", label: `${A} ne perd pas`, p: diffP((d) => d <= 0) }] });
  mk.push({ key: "eh_a1", title: `Handicap européen ${A} -1`, group: "Handicaps", sels: [
    { k: "1", label: `${A} gagne par 2 buts ou plus`, p: diffP((d) => d <= -2) }, { k: "x", label: `${A} gagne par 1 but exactement`, p: diffP((d) => d === -1) }, { k: "2", label: `${H} ne perd pas`, p: diffP((d) => d >= 0) }] });
  mk.push({ key: "margin", title: "Écart de buts", group: "Handicaps", sels: [
    { k: "h3", label: `${H} par 3 buts ou plus`, p: diffP((d) => d >= 3) }, { k: "h2", label: `${H} par 2 buts`, p: diffP((d) => d === 2) }, { k: "h1", label: `${H} par 1 but`, p: diffP((d) => d === 1) },
    { k: "x", label: "Match nul", p: pD }, { k: "a1", label: `${A} par 1 but`, p: diffP((d) => d === -1) }, { k: "a2", label: `${A} par 2 buts`, p: diffP((d) => d === -2) }, { k: "a3", label: `${A} par 3 buts ou plus`, p: diffP((d) => d <= -3) }] });
  // half time (independent halves)
  const phi = p.phi;
  const h1 = poisPmf(lh * phi, N), a1 = poisPmf(la * phi, N), h2 = poisPmf(lh * (1 - phi), N), a2 = poisPmf(la * (1 - phi), N);
  let ht1 = 0, htx = 0, ht2 = 0; const htft: Record<string, number> = {};
  const res = (x: number, y: number) => (x > y ? "1" : x === y ? "x" : "2");
  let more1 = 0, more2 = 0, eqh = 0;
  const ht05 = 1 - h1[0] * a1[0];
  const htTot = conv(h1, a1);
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const q1 = h1[i] * a1[j]; if (q1 < 1e-9) continue;
    const r1 = res(i, j); if (r1 === "1") ht1 += q1; else if (r1 === "x") htx += q1; else ht2 += q1;
    for (let k = 0; k <= 6; k++) for (let l = 0; l <= 6; l++) {
      const q = q1 * h2[k] * a2[l]; if (q < 1e-10) continue;
      const key = r1 + "/" + res(i + k, j + l); htft[key] = (htft[key] ?? 0) + q;
      const g1 = i + j, g2 = k + l; if (g1 > g2) more1 += q; else if (g2 > g1) more2 += q; else eqh += q;
    }
  }
  mk.push({ key: "ht1x2", title: "Résultat à la mi-temps", group: "Mi-temps", sels: [{ k: "1", label: H, p: ht1 }, { k: "x", label: "Nul", p: htx }, { k: "2", label: A, p: ht2 }] });
  mk.push(ouMarkets("ht_ou", "Buts en 1re mi-temps", "Mi-temps", htTot, [0.5, 1.5, 2.5]));
  const lab = (r: string) => (r === "1" ? H : r === "x" ? "Nul" : A);
  mk.push({ key: "htft", title: "Mi-temps / fin de match", group: "Mi-temps", sels: ["1/1", "x/1", "2/1", "1/x", "x/x", "2/x", "1/2", "x/2", "2/2"].map((k) => ({ k, label: `${lab(k[0])} / ${lab(k[2])}`, p: htft[k] ?? 0 })) });
  mk.push({ key: "half_most", title: "Mi-temps avec le plus de buts", group: "Mi-temps", sels: [{ k: "1", label: "1re mi-temps", p: more1 }, { k: "2", label: "2e mi-temps", p: more2 }, { k: "x", label: "Autant", p: eqh }] });
  void ht05;
  // early payout
  const up2 = earlyPayout(lh, la, p.prof, 2);
  const up1 = earlyPayout(lh, la, p.prof, 1);
  mk.push({ key: "2up", title: "2UP (payé si 2 buts d'avance)", group: "2UP", sels: [
    { k: "1", label: `${H} (2UP)`, p: up2.home }, { k: "2", label: `${A} (2UP)`, p: up2.away }] });
  mk.push({ key: "1up", title: "1UP (payé si 1 but d'avance)", group: "2UP", sels: [
    { k: "1", label: `${H} (1UP)`, p: up1.home }, { k: "2", label: `${A} (1UP)`, p: up1.away }] });

  // other stats
  const side = (w: "corners" | "shots" | "sot" | "cards") => {
    const L = lambdas(p, w, m.comp, m.neutral, m.home_id, m.away_id, fh, fa);
    const r = p[w].r; const n = w === "shots" ? 45 : 25;
    const a = nbPmf(L.lh, r, n), b = nbPmf(L.la, r, n);
    return { lh: L.lh, la: L.la, a, b, t: conv(a, b) };
  };
  const C = side("corners"), SH = side("shots"), SO = side("sot"), K = side("cards");
  mk.push(ouMarkets("corners_ou", "Nombre de corners", "Corners", C.t, [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]));
  mk.push(ouMarkets("home_corners", `Corners de ${H}`, "Corners", C.a, linesAround(C.lh, 2)));
  mk.push(ouMarkets("away_corners", `Corners de ${A}`, "Corners", C.b, linesAround(C.la, 2)));
  { let w1 = 0, wx = 0; for (let i = 0; i < C.a.length; i++) for (let j = 0; j < C.b.length; j++) { const q = C.a[i] * C.b[j]; if (i > j) w1 += q; else if (i === j) wx += q; }
    mk.push({ key: "corners_1x2", title: "Équipe avec le plus de corners", group: "Corners", sels: [{ k: "1", label: H, p: w1 }, { k: "x", label: "Autant", p: wx }, { k: "2", label: A, p: 1 - w1 - wx }] }); }
  mk.push(ouMarkets("cards_ou", "Nombre de cartons (jaunes + rouges)", "Cartons", K.t, [2.5, 3.5, 4.5, 5.5, 6.5]));
  mk.push(ouMarkets("home_cards", `Cartons de ${H}`, "Cartons", K.a, [0.5, 1.5, 2.5, 3.5]));
  mk.push(ouMarkets("away_cards", `Cartons de ${A}`, "Cartons", K.b, [0.5, 1.5, 2.5, 3.5]));
  mk.push(ouMarkets("shots_ou", "Nombre de tirs", "Tirs", SH.t, linesAround(SH.lh + SH.la, 3)));
  mk.push(ouMarkets("home_shots", `Tirs de ${H}`, "Tirs", SH.a, linesAround(SH.lh, 2)));
  mk.push(ouMarkets("away_shots", `Tirs de ${A}`, "Tirs", SH.b, linesAround(SH.la, 2)));
  mk.push(ouMarkets("sot_ou", "Nombre de tirs cadrés", "Tirs", SO.t, linesAround(SO.lh + SO.la, 2)));
  mk.push(ouMarkets("home_sot", `Tirs cadrés de ${H}`, "Tirs", SO.a, linesAround(SO.lh, 1)));
  mk.push(ouMarkets("away_sot", `Tirs cadrés de ${A}`, "Tirs", SO.b, linesAround(SO.la, 1)));

  // players (starters only)
  let pl: any[] = [];
  if (players && players.length) {
    const teamCtx: Record<string, { g: number; s: number; o: number; k: number }> = {
      [m.home_id]: { g: lh, s: SH.lh, o: SO.lh, k: K.lh }, [m.away_id]: { g: la, s: SH.la, o: SO.la, k: K.la },
    };
    const K0 = 360;
    const defMin: Record<string, number> = { G: 90, D: 86, M: 78, F: 72 };
    const rate = (x: number, wm: number, prior: number) => 90 * (x + prior * K0 / 90) / (wm + K0);
    for (const tid of [m.home_id, m.away_id]) {
      const st = players.filter((q) => q.team_id === tid && q.starter);
      if (st.length < 9) continue;
      const rows = st.map((q) => {
        const pr = p.priors[q.grp] ?? p.priors.M;
        const min = q.avg_start_min && q.starts >= 3 ? (q.avg_start_min * q.starts + defMin[q.grp] * 3) / (q.starts + 3) : defMin[q.grp] ?? 80;
        return { q, min: Math.min(90, min),
          g: 0.5 * rate(q.wg, q.wm, pr.g) + 0.5 * rate(q.wx, q.wm, pr.x) * p.xgScale,
          a: rate(q.wa, q.wm, pr.a), sh: rate(q.wsh, q.wm, pr.sh), so: rate(q.wsot, q.wm, pr.sot), c: rate(q.wc, q.wm, pr.c) };
      });
      const subShare = 0.12;
      const norm = (f: (r: any) => number) => { const s = rows.reduce((t, r) => t + f(r) * r.min / 90, 0); return s > 0 ? (1 - subShare) / s : 0; };
      const nG = norm((r) => r.g), nA = norm((r) => r.a), nS = norm((r) => r.sh), nO = norm((r) => r.so), nC = norm((r) => r.c);
      const ctx = teamCtx[tid];
      for (const r of rows) {
        const f = r.min / 90;
        const lg = ctx.g * 0.97 * r.g * f * nG, la_ = ctx.g * 0.72 * r.a * f * nA, ls = ctx.s * r.sh * f * nS, lo = ctx.o * r.so * f * nO, lc = ctx.k * 0.9 * r.c * f * nC;
        pl.push({ id: r.q.player_id, team: tid, name: r.q.name, short: r.q.short_name, pos: r.q.pos, grp: r.q.grp, jersey: r.q.jersey, min: Math.round(r.min),
          xg: lg, xa: la_, p_goal: 1 - Math.exp(-lg), p_assist: 1 - Math.exp(-la_), p_ga: 1 - Math.exp(-(lg + la_)),
          p_shot1: 1 - Math.exp(-ls), p_shot2: 1 - Math.exp(-ls) * (1 + ls), p_sot1: 1 - Math.exp(-lo), p_card: 1 - Math.exp(-lc), apps: r.q.apps });
      }
    }
    pl = pl.sort((x, y) => y.p_goal - x.p_goal);
  }

  const cornersO95 = tailGE(C.t, 10), cardsO45 = tailGE(K.t, 5);
  return {
    lh, la, pH, pD, pA, markets: mk, players: pl,
    summary: { p_o25: tailGE(totPmf, 3), p_btts: btts, exp_corners: mean(C.t), p_corners_o95: cornersO95, exp_cards: mean(K.t), p_cards_o45: cardsO45,
      exp_shots: SH.lh + SH.la, exp_sot: SO.lh + SO.la, corners: [C.lh, C.la], cards: [K.lh, K.la], shots: [SH.lh, SH.la], sot: [SO.lh, SO.la], up2: up2 },
    cov: { home: G.xh, away: G.xa }, model: { lh: G.lh, la: G.la }, market_weight: B.w,
  };
}

// explanation of the expected-goals for each side
export function explain(p: Params, m: { comp: string; neutral: boolean; home_id: string; away_id: string }, fh: Feat, fa: Feat, restH: number | null, restA: number | null) {
  const g = p.goals;
  const lgH = p.teamLg[m.home_id] ?? "other", lgA = p.teamLg[m.away_id] ?? "other";
  const tH = g.team[m.home_id] ?? [0, 0], tA = g.team[m.away_id] ?? [0, 0];
  const att = (lg: string, t: number[]) => Math.exp((g.lg[lg]?.A ?? 0) + t[0]);
  const def = (lg: string, t: number[]) => Math.exp((g.lg[lg]?.D ?? 0) + t[1]);
  const c = g.comp[m.comp] ?? { mu: 0, h: 0.1 };
  const xh = covs(fh, fa), xa = covs(fa, fh);
  const mult = (x: number[]) => BETA_NAMES.map((n, j) => ({ name: n, x: x[j], mult: Math.exp(g.beta[j] * x[j]) }));
  return {
    base: Math.exp(g.mu0 + c.mu), home_adv: m.neutral ? 1 : Math.exp(c.h),
    home: { attack: att(lgH, tH), defence: def(lgH, tH), league: lgH, rest_days: restH, lineup: fh, effects: mult(xh) },
    away: { attack: att(lgA, tA), defence: def(lgA, tA), league: lgA, rest_days: restA, lineup: fa, effects: mult(xa) },
    beta: Object.fromEntries(BETA_NAMES.map((n, j) => [n, g.beta[j]])),
  };
}
