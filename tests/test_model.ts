import { fitAll, predict, Row } from "../supabase/functions/engine/model.ts";
// synthetic league: 3 leagues x 12 teams, a cup linking them
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pois = (l: number) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const leagues = ["eng.1", "bel.1", "esp.1"]; const lgStr: Record<string, number> = { "eng.1": 0.25, "bel.1": -0.25, "esp.1": 0.1 };
const teams: { id: string; lg: string; a: number; d: number }[] = [];
for (const lg of leagues) for (let i = 0; i < 12; i++) teams.push({ id: `${lg}-${i}`, lg, a: lgStr[lg] + (rnd() - 0.5) * 0.6, d: -lgStr[lg] + (rnd() - 0.5) * 0.6 });
const rows: Row[] = []; const teamLg: Record<string, string> = {};
teams.forEach((t) => teamLg[t.id] = t.lg);
const feat = { lrA: 0, lc: 0, gk: 0, sr: 0, ok: false };
let day = 400;
const add = (comp: string, h: typeof teams[0], a: typeof teams[0]) => {
  const lh = Math.exp(0.2 + 0.25 + h.a + a.d), la = Math.exp(0.2 + a.a + h.d);
  const gH = pois(lh), gA = pois(la);
  rows.push({ id: String(rows.length), comp, age: day, neutral: false, home: h.id, away: a.id, gH, gA, xH: lh / 0.3 * 0.3, xA: la, cH: pois(5.5), cA: pois(4.5), sH: pois(13), sA: pois(11), oH: pois(4.5), oA: pois(3.8), kH: pois(2), kA: pois(2.2), htH: Math.min(gH, pois(lh * 0.45)), htA: Math.min(gA, pois(la * 0.45)), fh: feat, fa: feat });
};
for (let rep = 0; rep < 2; rep++) for (const lg of leagues) { const T = teams.filter((t) => t.lg === lg); for (const h of T) for (const a of T) if (h !== a) { add(lg, h, a); day -= 0.05; } }
for (let k = 0; k < 150; k++) { const h = teams[Math.floor(rnd() * teams.length)], a = teams[Math.floor(rnd() * teams.length)]; if (h.lg !== a.lg) add("uefa.champions", h, a); }
const prof = new Array(90).fill(1 / 90);
const pri = { G: { g: 0, x: 0, a: 0, sh: 0.05, sot: 0, c: 0.05, min: 0 }, D: { g: 0.05, x: 0.06, a: 0.05, sh: 0.6, sot: 0.2, c: 0.2, min: 0 }, M: { g: 0.1, x: 0.12, a: 0.12, sh: 1.2, sot: 0.4, c: 0.2, min: 0 }, F: { g: 0.35, x: 0.38, a: 0.12, sh: 2.4, sot: 1, c: 0.1, min: 0 } };
const t0 = performance.now();
const p = fitAll(rows, teamLg, { prof, phi: 0.45, priors: pri });
console.log("fit ms", (performance.now() - t0).toFixed(0), "rows", rows.length, "rho", p.rho, "corners r", p.corners.r);
// correlation of recovered attack with truth
const est = teams.map((t) => (p.goals.lg[t.lg].A + p.goals.team[t.id][0]));
const tru = teams.map((t) => t.a);
const corr = (x: number[], y: number[]) => { const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
console.log("attack corr", corr(est, tru).toFixed(3), "league A", JSON.stringify(Object.fromEntries(Object.entries(p.goals.lg).map(([k, v]) => [k, v.A.toFixed(2)]))));
const t1 = performance.now();
const out = predict(p, { comp: "eng.1", neutral: false, home_id: "eng.1-0", away_id: "bel.1-3", home_name: "H", away_name: "A" }, feat, feat, null);
console.log("predict ms", (performance.now() - t1).toFixed(1), "lam", out.lh.toFixed(2), out.la.toFixed(2), "1X2", out.pH.toFixed(3), out.pD.toFixed(3), out.pA.toFixed(3), "sum", (out.pH + out.pD + out.pA).toFixed(4));
for (const m of out.markets) {
  const s = m.sels.reduce((a, b) => a + b.p + (b.push ?? 0), 0);
  if (["1x2", "btts", "ht1x2", "htft", "half_most", "corners_1x2", "margin"].includes(m.key)) console.log(m.key.padEnd(12), "sum", s.toFixed(4));
}
const up = out.markets.find((m) => m.key === "2up")!; console.log("2UP", up.sels.map((s) => s.p.toFixed(3)).join(" "), ">= win?", up.sels[0].p >= out.pH, up.sels[1].p >= out.pA);
const ou = out.markets.find((m) => m.key === "goals_ou")!; console.log("O2.5", ou.sels.find((s) => s.k === "o2.5")!.p.toFixed(3), "summary", out.summary.p_o25.toFixed(3));
console.log("corners exp", out.summary.exp_corners.toFixed(2), "cards exp", out.summary.exp_cards.toFixed(2), "shots", out.summary.exp_shots.toFixed(1));
