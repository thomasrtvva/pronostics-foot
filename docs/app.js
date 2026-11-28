{
const SB = "https://bdxdcknotvlfiqomyvvy.supabase.co";
const KEY = "sb_publishable_BjzisgypdvgDKE5S-WWc5A_GObEriwK";
const TZ = "Europe/Brussels";
const app = document.getElementById("app");
const HDR = { apikey: KEY, Accept: "application/json" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (p, d = 0) => (p == null || !isFinite(p) ? "–" : (100 * p).toFixed(d).replace(".", ",") + " %");
const dec = (x, d = 2) => (x == null || !isFinite(x) ? "–" : Number(x).toFixed(d).replace(".", ","));
const fmtTime = (iso) => new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDay = (iso) => new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
const fmtShort = (iso) => new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(iso));
const dayKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const logo = (t, cls = "") => t?.logo ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="crest ${cls}"></span>`;

async function api(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: HDR });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}
async function rpc(fn, args = {}) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`RPC ${r.status}`);
  return r.json();
}

let COMPS = [];
const compName = (slug) => COMPS.find((c) => c.slug === slug)?.name ?? slug;
const state = { comp: (() => { try { return localStorage.getItem("am-comp") || "all"; } catch { return "all"; } })(), timer: null };

function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => { if (a.dataset.nav === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}

const MSEL = "id,comp,kickoff,state,status_detail,home_score,away_score,ft_home,ft_away,lineups_at,home:teams!matches_home_id_fkey(name,short_name,logo),away:teams!matches_away_id_fkey(name,short_name,logo),predictions(mode,p_home,p_draw,p_away,lineup_source,created_at)";

function pickPred(m) {
  const ps = m.predictions || [];
  return ps.find((p) => p.mode === "live") || ps.find((p) => p.mode === "backtest") || null;
}
function outcome(m) {
  const h = m.ft_home ?? m.home_score, a = m.ft_away ?? m.away_score;
  if (h == null || a == null) return null;
  return h > a ? 0 : h === a ? 1 : 2;
}
function pbar(p, big = false) {
  const v = [p.p_home, p.p_draw, p.p_away];
  const lab = (x) => (x >= 0.09 ? pct(x) : "");
  return `<div class="pbar${big ? " big" : ""}" role="img" aria-label="Victoire domicile ${pct(v[0])}, nul ${pct(v[1])}, victoire extérieur ${pct(v[2])}">
    <span class="h" style="width:${(v[0] * 100).toFixed(1)}%">${lab(v[0])}</span><span class="d" style="width:${(v[1] * 100).toFixed(1)}%">${lab(v[1])}</span><span class="a" style="width:${(v[2] * 100).toFixed(1)}%">${lab(v[2])}</span></div>`;
}

function matchRow(m) {
  const p = pickPred(m);
  const score = (s) => (m.state === "pre" ? "" : `<span class="sc">${s ?? ""}</span>`);
  let right = "";
  if (m.state === "in") right = `<span class="pill live">En cours · ${esc(m.status_detail || "")}</span>`;
  if (p) {
    const o = outcome(m), fav = [p.p_home, p.p_draw, p.p_away].indexOf(Math.max(p.p_home, p.p_draw, p.p_away));
    const tag = p.mode === "live" ? (p.lineup_source === "official" ? "Pronostic (compos officielles)" : "Pronostic") : "Test sur match passé";
    const res = m.state === "post" && o != null ? (o === fav ? `<span class="pill ok">Favori du modèle : bon</span>` : `<span class="pill ko">Favori du modèle : raté</span>`) : "";
    right = `${pbar(p)}<div class="plegend"><span>${esc(tag)}</span>${res}</div>` + (m.state === "in" ? right : "");
  } else if (m.state === "pre") {
    const eta = new Date(new Date(m.kickoff).getTime() - 60 * 60000).toISOString();
    right = `<span class="pill">Pronostic à l'annonce des compos · vers ${fmtTime(eta)}</span>`;
  } else if (m.state === "post") right = `<span class="status">Terminé</span>`;
  return `<a class="row" href="#m-${esc(m.id)}">
    <div class="time">${fmtTime(m.kickoff)}<small>${esc(compName(m.comp))}</small></div>
    <div class="teams">
      <div class="team">${logo(m.home)}<span>${esc(m.home?.name)}</span>${score(m.ft_home ?? m.home_score)}</div>
      <div class="team">${logo(m.away)}<span>${esc(m.away?.name)}</span>${score(m.ft_away ?? m.away_score)}</div>
    </div>
    <div class="right">${right}</div></a>`;
}

function chipsHTML(light = false) {
  const all = [{ slug: "all", name: "Toutes" }, ...COMPS];
  return `<div class="chips${light ? " light" : ""}" role="group" aria-label="Compétition">${all.map((c) => `<button class="chip" data-comp="${esc(c.slug)}" aria-pressed="${state.comp === c.slug}">${esc(c.name)}</button>`).join("")}</div>`;
}

async function viewHome() {
  setNav("home");
  const now = Date.now();
  const from = new Date(now - 4 * 86400000).toISOString(), to = new Date(now + 8 * 86400000).toISOString();
  app.innerHTML = `<section class="hero band"><div class="wrap">
      <h1>Le match analysé avant le coup d'envoi</h1>
      <p>Pour chaque match, le modèle calcule les probabilités de tous les marchés : résultat, buts, score, mi-temps, handicaps, 2UP, corners, cartons, tirs, buteurs. Le pronostic est publié dès l'annonce des compositions officielles, environ une heure avant le match.</p>
      ${chipsHTML()}
    </div></section>
    <div class="wrap" id="list"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  bindChips(viewHome);
  let rows;
  try {
    rows = await api(`matches?select=${MSEL}&kickoff=gte.${from}&kickoff=lte.${to}&order=kickoff.asc&limit=900`);
  } catch (e) { document.getElementById("list").innerHTML = `<p class="notice">Impossible de charger les matchs pour l'instant. Réessaie dans un moment.</p>`; return; }
  if (state.comp !== "all") rows = rows.filter((m) => m.comp === state.comp);
  const up = rows.filter((m) => m.state !== "post" || new Date(m.kickoff).getTime() > now - 3 * 3600000);
  const past = rows.filter((m) => !up.includes(m)).reverse();
  const group = (list) => {
    const g = new Map();
    for (const m of list) { const k = dayKey(m.kickoff); if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
    return [...g.values()].map((ms) => `<div class="day"><h2>${esc(fmtDay(ms[0].kickoff))}</h2><span class="muted small">${ms.length} match${ms.length > 1 ? "s" : ""}</span></div>${ms.map(matchRow).join("")}`).join("");
  };
  const nPred = rows.filter((m) => (m.predictions || []).some((p) => p.mode === "live")).length;
  document.getElementById("list").innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${up.filter((m) => m.state === "pre").length}</b><span>matchs à venir sur 8 jours</span></div>
      <div class="kpi"><b>${nPred}</b><span>pronostics publiés sur la période</span></div>
      <div class="kpi"><b>${COMPS.length}</b><span>compétitions suivies</span></div>
    </div>
    ${up.length ? group(up) : `<p class="notice">Aucun match à venir dans les 8 prochains jours pour cette compétition (trêve ?).</p>`}
    ${past.length ? `<h2 style="margin-top:40px">Résultats récents</h2>${group(past)}` : ""}`;
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (!location.hash || location.hash === "#") viewHome(); }, 180000);
}

function bindChips(rerender) {
  document.querySelectorAll(".chip[data-comp]").forEach((b) => b.addEventListener("click", () => {
    state.comp = b.dataset.comp; try { localStorage.setItem("am-comp", state.comp); } catch { /* */ }
    rerender();
  }));
}

/* ---------- match page ---------- */
function depth(ab) {
  ab = String(ab || "").toUpperCase();
  if (/^(LB|RB|CD|CB|LWB|RWB|SW|D)/.test(ab)) return 1;
  if (/^(DM|CDM)/.test(ab)) return 2;
  if (/^(AM|LW|RW|LF|RF|SS)/.test(ab)) return 4;
  if (/^(F|CF|ST)/.test(ab)) return 5;
  return 3;
}
function lateral(ab) {
  ab = String(ab || "").toUpperCase();
  if (/-L$/.test(ab) || /^L/.test(ab)) return -1;
  if (/-R$/.test(ab) || /^R/.test(ab)) return 1;
  return 0;
}
function layout(starters, formation) {
  const gk = starters.find((p) => p.pos_abbr === "G") || starters[0];
  const rest = starters.filter((p) => p !== gk).sort((a, b) => depth(a.pos_abbr) - depth(b.pos_abbr) || (a.formation_place ?? 0) - (b.formation_place ?? 0));
  let rows = String(formation || "").split("-").map(Number).filter((n) => n > 0);
  if (rows.reduce((a, b) => a + b, 0) !== rest.length) {
    const c = [1, 2, 3, 4, 5].map((d) => rest.filter((p) => { const x = depth(p.pos_abbr); return d === 1 ? x === 1 : d === 2 ? x === 2 || x === 3 : d === 3 ? x === 4 : x === 5; }).length);
    rows = c.filter((n) => n > 0);
  }
  const out = [{ p: gk, r: -1, i: 0, n: 1 }];
  let k = 0;
  rows.forEach((n, r) => {
    const line = rest.slice(k, k + n).sort((a, b) => lateral(a.pos_abbr) - lateral(b.pos_abbr));
    line.forEach((p, i) => out.push({ p, r, i, n }));
    k += n;
  });
  return { out, nRows: rows.length };
}
function pitchSVG(home, away, fh, fa, probs) {
  const W = 68, Hh = 105;
  const lines = `<rect x="0" y="0" width="${W}" height="${Hh}" fill="var(--pitch)"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="0" y="${i * 15}" width="${W}" height="7.5" fill="rgba(255,255,255,.035)"/>`).join("")}
    <g fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".35">
      <rect x="2" y="2" width="${W - 4}" height="${Hh - 4}"/><line x1="2" y1="${Hh / 2}" x2="${W - 2}" y2="${Hh / 2}"/>
      <circle cx="${W / 2}" cy="${Hh / 2}" r="9.15"/><rect x="${W / 2 - 20.16}" y="2" width="40.32" height="16.5"/><rect x="${W / 2 - 20.16}" y="${Hh - 18.5}" width="40.32" height="16.5"/>
      <rect x="${W / 2 - 9.16}" y="2" width="18.32" height="5.5"/><rect x="${W / 2 - 9.16}" y="${Hh - 7.5}" width="18.32" height="5.5"/></g>`;
  const team = (sts, formation, bottom, fill, ink) => {
    if (!sts.length) return "";
    const { out, nRows } = layout(sts, formation);
    return out.map(({ p, r, i, n }) => {
      let y = r < 0 ? 98.5 : 89 - (r * (29 / Math.max(1, nRows - 1)));
      if (nRows === 1 && r >= 0) y = 74;
      if (!bottom) y = Hh - y;
      let x = ((i + 1) / (n + 1)) * W;
      if (!bottom) x = W - x;
      const pr = probs[p.player_id];
      const nm = (p.short_name || p.name || "").split(" ").slice(-1)[0];
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.7" fill="${fill}" stroke="${ink}" stroke-width=".5"/>
        <text x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" text-anchor="middle" font-size="2.4" fill="${ink}">${esc(p.jersey || "")}</text>
        ${r < 0 ? `<text x="${(x + 4).toFixed(1)}" y="${(y + 0.9).toFixed(1)}" text-anchor="start" font-size="2.5" fill="#fff">${esc(nm.slice(0, 12))}</text>`
          : `<text x="${x.toFixed(1)}" y="${(y + 5.6).toFixed(1)}" text-anchor="middle" font-size="2.5" fill="#fff">${esc(nm.slice(0, 12))}</text>`}
        ${pr != null && p.pos_abbr !== "G" ? `<text x="${x.toFixed(1)}" y="${(y - 3.6).toFixed(1)}" text-anchor="middle" font-size="2.3" fill="#ffd8c7">${pct(pr)}</text>` : ""}</g>`;
    }).join("");
  };
  return `<svg class="pitch" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Compositions officielles sur le terrain">${lines}
    ${team(away, fa, false, "#10201a", "#ffffff")}${team(home, fh, true, "#ffffff", "#0f6b3f")}</svg>`;
}

const EFFECT_LABEL = {
  compo_attaque: "Force offensive du onze aligné", stabilite_compo_att: "Onze habituel (attaque)", stabilite_compo_def: "Onze habituel adverse (défense)",
  gardien_remplacant: "Gardien titulaire absent en face", fatigue_att: "Fatigue (moins de 4 jours de repos)", fatigue_def: "Fatigue adverse",
};

function factorBar(label, mult, better = "up") {
  const d = Math.log(mult);
  const w = Math.min(50, Math.abs(d) * 120);
  const good = better === "up" ? d > 0 : d < 0;
  const col = Math.abs(d) < 0.005 ? "var(--muted)" : good ? "var(--good)" : "var(--bad)";
  const left = d >= 0 ? 50 : 50 - w;
  return `<div class="factor"><span class="lbl">${esc(label)}</span><span class="val">×${dec(mult, 2)}</span><div class="track"><i style="left:${left}%;width:${w}%;background:${col}"></i></div></div>`;
}

function fair(s) { const lose = 1 - s.p - (s.push || 0); return s.p > 0 ? 1 + lose / s.p : null; }

function marketTable(m, bookOdds) {
  return `<div class="mtitle">${esc(m.title)}</div><div class="scroll"><table class="stack"><thead><tr><th>Pari</th><th class="n">Probabilité</th><th class="n">Cote juste</th><th class="n">Cote bookmaker</th><th class="n">Ta cote</th><th class="n">Gain moyen / 10 €</th><th class="n">Gagné · perdu</th></tr></thead><tbody>
    ${m.sels.map((s, i) => {
      const bo = bookOdds?.[s.k];
      const id = `${m.key}-${i}`;
      return `<tr data-p="${s.p}" data-push="${s.push || 0}">
        <td data-l="Pari">${esc(s.label)}</td>
        <td class="n" data-l="Probabilité"><span class="probcell"><i style="width:${Math.round(s.p * 60)}px"></i>${pct(s.p, 1)}</span></td>
        <td class="n" data-l="Cote juste">${fair(s) ? dec(fair(s)) : "–"}</td>
        <td class="n" data-l="Cote bookmaker">${bo ? `<button class="link" data-fill="${bo}" data-for="${id}" title="Utiliser cette cote">${dec(bo)}</button>` : "–"}</td>
        <td class="n" data-l="Ta cote"><input class="oddin" id="${id}" inputmode="decimal" placeholder="ex. 2,10" aria-label="Ta cote pour ${esc(s.label)}"></td>
        <td class="n" data-l="Gain moyen"><span class="ev" data-ev></span></td>
        <td class="n small muted" data-l="Gagné · perdu">${pct(s.p)} · ${pct(1 - s.p - (s.push || 0))}${s.push ? ` <br>remboursé ${pct(s.push)}` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function bindCalc(root) {
  const upd = (inp) => {
    const tr = inp.closest("tr"); const p = Number(tr.dataset.p), push = Number(tr.dataset.push);
    const o = Number(String(inp.value).replace(",", "."));
    const out = tr.querySelector("[data-ev]");
    if (!o || o <= 1) { out.textContent = ""; out.className = "ev"; return; }
    const ev = 10 * (p * (o - 1) - (1 - p - push));
    out.textContent = (ev >= 0 ? "+" : "") + dec(ev) + " €";
    out.className = "ev " + (ev >= 0 ? "pos" : "neg");
  };
  root.querySelectorAll(".oddin").forEach((inp) => inp.addEventListener("input", () => upd(inp)));
  root.querySelectorAll("[data-fill]").forEach((b) => b.addEventListener("click", () => {
    const inp = document.getElementById(b.dataset.for); inp.value = String(b.dataset.fill).replace(".", ","); upd(inp);
  }));
}

function playerMarkets(players, names) {
  if (!players?.length) return [];
  const tn = (id) => names[id] || "";
  const mk = (key, title, f) => ({ key, title, group: "Joueurs", sels: [...players].sort((a, b) => f(b) - f(a)).filter((p) => f(p) > 0.004).slice(0, 22).map((p) => ({ k: p.id, label: `${p.name} (${tn(p.team)})`, p: f(p) })) });
  return [
    mk("pl_goal", "Buteur (à tout moment)", (p) => p.p_goal), mk("pl_assist", "Passeur décisif", (p) => p.p_assist),
    mk("pl_ga", "Buteur ou passeur", (p) => p.p_ga), mk("pl_shot1", "Au moins 1 tir", (p) => p.p_shot1),
    mk("pl_shot2", "Au moins 2 tirs", (p) => p.p_shot2), mk("pl_sot1", "Au moins 1 tir cadré", (p) => p.p_sot1),
    mk("pl_card", "Reçoit un carton", (p) => p.p_card),
  ];
}

function formList(list, tid) {
  if (!list.length) return `<p class="muted small">Pas encore de match récent.</p>`;
  return `<table><tbody>${list.map((m) => {
    const home = m.home_id === tid; const gf = home ? m.ft_home : m.ft_away, ga = home ? m.ft_away : m.ft_home;
    const r = gf > ga ? "V" : gf === ga ? "N" : "D"; const col = r === "V" ? "var(--good)" : r === "D" ? "var(--bad)" : "var(--muted)";
    const opp = home ? m.away : m.home;
    return `<tr><td class="small muted">${fmtShort(m.kickoff)}</td><td><b style="color:${col}">${r}</b></td><td>${home ? "vs" : "à"} ${esc(opp?.short_name || opp?.name)}</td><td class="n"><b>${gf}-${ga}</b></td><td class="small muted hide-sm">${esc(compName(m.comp))}</td></tr>`;
  }).join("")}</tbody></table>`;
}
function averages(list, tid) {
  const n = list.length; if (!n) return null;
  const s = { gf: 0, ga: 0, sh: 0, sot: 0, c: 0, k: 0 };
  for (const m of list) {
    const me = m.home_id === tid ? "home" : "away", op = me === "home" ? "away" : "home";
    s.gf += me === "home" ? m.ft_home : m.ft_away; s.ga += me === "home" ? m.ft_away : m.ft_home;
    s.sh += Number(m.stats?.[me]?.shots || 0); s.sot += Number(m.stats?.[me]?.sot || 0); s.c += Number(m.stats?.[me]?.corners || 0);
    s.k += Number(m.stats?.[me]?.yellow || 0) + Number(m.stats?.[me]?.red || 0);
    void op;
  }
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v / n]));
}

async function viewMatch(id) {
  setNav("home");
  clearInterval(state.timer);
  app.innerHTML = `<div class="wrap"><div class="skeleton"></div><div class="skeleton"></div></div>`;
  let m;
  try {
    [m] = await api(`matches?id=eq.${encodeURIComponent(id)}&select=*,home:teams!matches_home_id_fkey(*),away:teams!matches_away_id_fkey(*),predictions(*)`);
  } catch { app.innerHTML = `<div class="wrap band"><p class="notice">Match introuvable.</p></div>`; return; }
  if (!m) { app.innerHTML = `<div class="wrap band"><p class="notice">Match introuvable.</p></div>`; return; }
  const before = encodeURIComponent(new Date(m.kickoff).toISOString());
  const sel = "id,comp,kickoff,home_id,away_id,ft_home,ft_away,stats,home:teams!matches_home_id_fkey(short_name,name),away:teams!matches_away_id_fkey(short_name,name)";
  const [lineup, formH, formA, h2h, feats] = await Promise.all([
    api(`match_players?match_id=eq.${id}&select=player_id,team_id,starter,pos_abbr,formation_place,jersey,goals,assists,yellow,red,minutes,players(name,short_name)`).catch(() => []),
    api(`matches?or=(home_id.eq.${m.home_id},away_id.eq.${m.home_id})&state=eq.post&ft_home=not.is.null&kickoff=lt.${before}&order=kickoff.desc&limit=10&select=${sel}`).catch(() => []),
    api(`matches?or=(home_id.eq.${m.away_id},away_id.eq.${m.away_id})&state=eq.post&ft_home=not.is.null&kickoff=lt.${before}&order=kickoff.desc&limit=10&select=${sel}`).catch(() => []),
    api(`matches?or=(and(home_id.eq.${m.home_id},away_id.eq.${m.away_id}),and(home_id.eq.${m.away_id},away_id.eq.${m.home_id}))&state=eq.post&kickoff=lt.${before}&order=kickoff.desc&limit=6&select=${sel}`).catch(() => []),
    api(`match_features?match_id=eq.${id}`).catch(() => []),
  ]);
  const pred = (m.predictions || []).find((p) => p.mode === "live") || null;
  const test = (m.predictions || []).find((p) => p.mode === "backtest") || null;
  const H = m.home?.name, A = m.away?.name;
  const scoreTxt = m.state === "pre" ? fmtTime(m.kickoff) : `${m.ft_home ?? m.home_score ?? 0} - ${m.ft_away ?? m.away_score ?? 0}`;
  const sub = m.state === "pre" ? fmtDay(m.kickoff) : m.state === "in" ? `En cours · ${m.status_detail || ""}` : `Terminé · ${fmtDay(m.kickoff)}`;
  const starters = lineup.filter((p) => p.starter).map((p) => ({ ...p, name: p.players?.name, short_name: p.players?.short_name }));
  const sh = starters.filter((p) => p.team_id === m.home_id), sa = starters.filter((p) => p.team_id === m.away_id);
  const probs = {}; (pred?.players || []).forEach((p) => (probs[p.id] = p.p_goal));
  const rest = (side) => feats.find((f) => f.side === side)?.rest_days;

  let predHTML = "";
  if (pred) {
    const cs = pred.markets?.find((x) => x.key === "cs")?.sels?.[0];
    const S = pred.factors?.summary || {};
    const when = new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "numeric", month: "long" }).format(new Date(pred.created_at));
    predHTML = `<div class="card">
      <h2>Pronostic</h2>
      <p class="muted small">Publié le ${esc(when)} ${pred.lineup_source === "official" ? "avec les compositions officielles." : "sans composition officielle (non communiquée par la source) : équipe type."}</p>
      ${pbar(pred, true)}
      <div class="plegend"><span>${esc(H)}</span><span>Nul</span><span>${esc(A)}</span></div>
      <div class="kpis">
        <div class="kpi"><b>${dec(pred.lam_home, 2)} – ${dec(pred.lam_away, 2)}</b><span>buts attendus</span></div>
        <div class="kpi"><b>${esc(cs?.label || "–")}</b><span>score le plus probable (${pct(cs?.p, 1)})</span></div>
        <div class="kpi"><b>${pct(pred.p_o25)}</b><span>plus de 2,5 buts</span></div>
        <div class="kpi"><b>${pct(pred.p_btts)}</b><span>les deux équipes marquent</span></div>
        <div class="kpi"><b>${dec(S.exp_corners, 1)}</b><span>corners attendus</span></div>
        <div class="kpi"><b>${dec(S.exp_cards, 1)}</b><span>cartons attendus</span></div>
      </div>
    </div>`;
    const oc = pred.odds_snapshot?.close || m.odds?.close || {};
    const xx = { pH: pred.p_home, pD: pred.p_draw, pA: pred.p_away, o25: pred.p_o25 ?? NaN, btts: pred.p_btts ?? NaN, c95: pred.p_corners_o95 ?? NaN, k45: pred.p_cards_o45 ?? NaN,
      oH: oc.h, oD: oc.d, oA: oc.a, line: oc.line, over: oc.over, under: oc.under, ftH: m.state === "post" ? m.ft_home : null, ftA: m.state === "post" ? m.ft_away : null,
      corners: m.stats ? (Number(m.stats.home?.corners) + Number(m.stats.away?.corners)) : null, cards: m.stats ? (Number(m.stats.home?.yellow || 0) + Number(m.stats.away?.yellow || 0) + Number(m.stats.home?.red || 0) + Number(m.stats.away?.red || 0)) : null };
    const pk = picksFor(xx, m.home?.short_name || H, m.away?.short_name || A);
    predHTML += `<div class="card"><h2>Les paris du site</h2><p class="muted small">Mise fictive de ${STAKE} € par pari. Détails et résultats cumulés dans <a href="#paris">Paris du site</a>.</p>
      <div class="picks">${STRATS.filter((st) => st.id !== "selection").map((st) => pickChip(st, pk[st.id], m.state === "post" ? xx : null)).join("")}</div></div>`;
  } else if (m.state === "pre") {
    const eta = new Date(new Date(m.kickoff).getTime() - 60 * 60000).toISOString();
    predHTML = `<div class="card"><h2>Pronostic</h2><p class="notice">Le pronostic sera publié dès l'annonce des compositions officielles, en général vers <b>${fmtTime(eta)}</b>. La page se met à jour toute seule.</p></div>`;
    clearInterval(state.timer); state.timer = setInterval(() => { if (location.hash === `#m-${id}`) viewMatch(id); }, 120000);
  } else if (test) {
    predHTML = `<div class="card"><h2>Test sur match passé</h2><p class="muted small">Ce match a eu lieu avant la mise en ligne du site. Voici ce que le modèle aurait prédit avec les seules données disponibles avant le match (simulation).</p>${pbar(test, true)}<div class="plegend"><span>${esc(H)}</span><span>Nul</span><span>${esc(A)}</span></div>
      <div class="kpis"><div class="kpi"><b>${dec(test.lam_home)} – ${dec(test.lam_away)}</b><span>buts attendus</span></div><div class="kpi"><b>${pct(test.p_o25)}</b><span>plus de 2,5 buts</span></div><div class="kpi"><b>${pct(test.p_btts)}</b><span>les deux marquent</span></div></div></div>`;
  }

  let whyHTML = "";
  if (pred?.factors) {
    const f = pred.factors;
    const side = (s, nm) => `<h3>${esc(nm)}</h3>
      ${factorBar("Force offensive (1,00 = moyenne)", f[s].attack, "up")}
      ${factorBar("Buts encaissés vs moyenne (plus bas = mieux)", f[s].defence, "down")}
      ${(f[s].effects || []).filter((e) => Math.abs(Math.log(e.mult)) > 0.003).map((e) => factorBar(EFFECT_LABEL[e.name] || e.name, e.mult, "up")).join("")}
      <p class="small muted">Jours de repos : ${f[s].rest_days != null ? dec(f[s].rest_days, 0) : "–"}${f[s].lineup?.ok ? "" : " · compo non prise en compte"}</p>`;
    whyHTML = `<div class="card"><h2>Pourquoi ce pronostic</h2>
      <p class="small muted">Buts attendus = moyenne de la compétition (${dec(f.base, 2)}) × avantage du terrain (×${dec(f.home_adv, 2)} pour l'équipe à domicile) × force offensive × faiblesse défensive adverse × effets de la compo et de la fatigue${f.sharpen > 1 ? `, puis l'écart entre les deux équipes est accentué (facteur de calibration ${dec(f.sharpen, 2)}, voir Méthode)` : ""}.</p>
      ${side("home", H)}${side("away", A)}
      ${f.market_weight > 0.01 ? `<p class="notice small">Une des deux équipes a peu de matchs dans les données (${dec(Math.min(f.n_eff?.home ?? 0, f.n_eff?.away ?? 0), 0)} matchs pondérés, souvent une équipe d'un championnat non suivi). Le modèle s'appuie donc à ${pct(f.market_weight)} sur les cotes du marché. Sans elles, il aurait prévu ${dec(f.model_lambdas?.lh)} – ${dec(f.model_lambdas?.la)} buts.</p>` : ""}</div>`;
  }

  // markets
  let marketsHTML = "";
  if (pred?.markets) {
    const o = pred.odds_snapshot?.close || m.odds?.close || null;
    const book = {};
    if (o) { book["1x2"] = { 1: o.h, x: o.d, 2: o.a }; if (o.line) book.goals_ou = { [`o${o.line}`]: o.over, [`u${o.line}`]: o.under }; }
    const names = { [m.home_id]: m.home?.short_name || H, [m.away_id]: m.away?.short_name || A };
    const all = [...pred.markets, ...playerMarkets(pred.players, names)];
    const groups = [...new Set(all.map((x) => x.group))];
    marketsHTML = `<section class="band"><div class="wrap">
      <h2>Tous les marchés</h2>
      <p class="muted">Pour chaque pari : la probabilité du modèle, la cote « juste » (sans marge du bookmaker) et, si tu entres la cote que tu vois chez ton bookmaker, le gain moyen attendu pour 10 € misés. Un gain moyen négatif veut dire que, sur le long terme, ce pari fait perdre de l'argent.</p>
      ${o ? `<p class="small muted">Cotes bookmaker disponibles : ${esc(pred.odds_snapshot?.provider || m.odds?.provider || "DraftKings")} via ESPN (résultat et nombre de buts), relevées au moment du pronostic.</p>` : ""}
      <div class="tabs" role="tablist">${groups.map((g, i) => `<button role="tab" aria-selected="${i === 0}" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
      <div id="mk"></div></div></section>`;
    setTimeout(() => {
      const box = document.getElementById("mk"); if (!box) return;
      const show = (g) => { box.innerHTML = all.filter((x) => x.group === g).map((x) => marketTable(x, book[x.key])).join(""); bindCalc(box); };
      document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b)); show(b.dataset.g);
      }));
      show(groups[0]);
    });
  }

  const avH = averages(formH, m.home_id), avA = averages(formA, m.away_id);
  const avRow = (lab, k, d = 1) => `<tr><td>${lab}</td><td class="n">${avH ? dec(avH[k], d) : "–"}</td><td class="n">${avA ? dec(avA[k], d) : "–"}</td></tr>`;

  app.innerHTML = `<section class="hero band"><div class="wrap">
      <a href="#" class="small" style="color:var(--chalk)">← Tous les matchs</a>
      <p class="small" style="margin-top:12px">${esc(compName(m.comp))}${m.venue ? ` · ${esc(m.venue)}` : ""}</p>
      <div class="mhead">
        <div class="mteam">${logo(m.home)}<span class="nm">${esc(H)}</span></div>
        <div class="mscore">${esc(scoreTxt)}<small>${esc(sub)}</small></div>
        <div class="mteam">${logo(m.away)}<span class="nm">${esc(A)}</span></div>
      </div></div></section>
    <div class="wrap band"><div class="grid2">
      <div>${predHTML}${whyHTML}</div>
      <div>
        <div class="card"><h2>Compositions</h2>
          ${starters.length >= 18 ? `<div class="fig">${pitchSVG(sh, sa, m.formation_home, m.formation_away, probs)}</div>
            <p class="small muted">En bas : ${esc(H)}${m.formation_home ? ` (${esc(m.formation_home)})` : ""}. En haut : ${esc(A)}${m.formation_away ? ` (${esc(m.formation_away)})` : ""}.${pred?.players?.length ? " Au-dessus de chaque joueur : sa probabilité de marquer." : ""}</p>`
            : `<p class="muted">Les compositions officielles ne sont pas encore connues.</p>`}
        </div>
        <div class="card"><h2>Forme récente</h2>
          <h3>${esc(H)}</h3>${formList(formH.slice(0, 5), m.home_id)}
          <h3 style="margin-top:14px">${esc(A)}</h3>${formList(formA.slice(0, 5), m.away_id)}</div>
        <div class="card"><h2>Moyennes (10 derniers matchs)</h2>
          <table><thead><tr><th></th><th class="n">${esc(m.home?.short_name || H)}</th><th class="n">${esc(m.away?.short_name || A)}</th></tr></thead><tbody>
          ${avRow("Buts marqués", "gf")}${avRow("Buts encaissés", "ga")}${avRow("Tirs", "sh")}${avRow("Tirs cadrés", "sot")}${avRow("Corners", "c")}${avRow("Cartons", "k")}
          <tr><td>Jours de repos avant ce match</td><td class="n">${rest("home") != null ? dec(rest("home"), 0) : "–"}</td><td class="n">${rest("away") != null ? dec(rest("away"), 0) : "–"}</td></tr>
          </tbody></table></div>
        <div class="card"><h2>Confrontations directes</h2>${h2h.length ? `<table><tbody>${h2h.map((x) => `<tr><td class="small muted">${fmtShort(x.kickoff)}</td><td>${esc(x.home?.short_name)} - ${esc(x.away?.short_name)}</td><td class="n"><b>${x.ft_home}-${x.ft_away}</b></td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Aucune confrontation dans les données (depuis l'été 2025).</p>`}</div>
        ${m.stats && m.state === "post" ? `<div class="card"><h2>Statistiques du match</h2><table><thead><tr><th></th><th class="n">${esc(m.home?.short_name || H)}</th><th class="n">${esc(m.away?.short_name || A)}</th></tr></thead><tbody>
          ${[["Tirs", "shots"], ["Tirs cadrés", "sot"], ["Corners", "corners"], ["Cartons jaunes", "yellow"], ["Cartons rouges", "red"], ["Possession (%)", "poss"]].map(([l, k]) => `<tr><td>${l}</td><td class="n">${esc(m.stats.home?.[k] ?? "–")}</td><td class="n">${esc(m.stats.away?.[k] ?? "–")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </div></div></div>
    ${marketsHTML}`;
  window.scrollTo(0, 0);
}


/* ---------- the site's own bets ---------- */
const MARGIN = 0.05, STAKE = 10, BANK = 1000;
const STRATS = [
  { id: "valeur", name: "Valeur", color: "var(--accent)", desc: "Mise seulement quand la vraie cote du bookmaker est plus haute que ce que vaut le pari selon le modèle (gain attendu d'au moins 5 %, probabilité d'au moins 30 %)." },
  { id: "confiance", name: "Confiance", color: "var(--home)", desc: "Le pari le plus probable du match parmi ceux qui rapportent au moins 1,40." },
  { id: "favori", name: "Favori", color: "var(--away)", desc: "Toujours le favori du modèle sur le résultat (1N2)." },
  { id: "selection", name: "Sélection du jour", color: "#c026d3", desc: "Au maximum 10 paris par jour : le favori, seulement quand le modèle et le bookmaker sont d'accord et que la vraie cote est entre 1,50 et 3,00. Les paris sont ajoutés au fil de la journée, dans l'ordre des matchs, jusqu'à 10." },
];
const MAX_PER_DAY = 10;
function assignSelection(rows) {
  const perDay = {};
  for (const r of rows) {
    const f = r.picks.favori;
    const real = r.oH > 1 && r.oD > 1 && r.oA > 1;
    let ok = false;
    if (f && real && f.src === "real" && f.odds >= 1.5 && f.odds <= 3) {
      const bk = [r.oH, r.oD, r.oA]; const bf = ["1", "x", "2"][bk.indexOf(Math.min(...bk))];
      ok = bf === f.key;
    }
    const day = dayKey(new Date(r.ko * 1000).toISOString()) + "|" + r.mode;
    if (ok && (perDay[day] ?? 0) < MAX_PER_DAY) { perDay[day] = (perDay[day] ?? 0) + 1; r.picks.selection = f; }
    else r.picks.selection = null;
  }
}
const siteOdds = (p) => Math.max(1.01, Math.floor(100 / (p * (1 + MARGIN))) / 100);
function candidates(x, H, A) {
  const real = x.oH > 1 && x.oD > 1 && x.oA > 1;
  const dk25 = Number(x.line) === 2.5 && x.over > 1 && x.under > 1;
  const c = [];
  const add = (key, label, p, odds, direct = true) => {
    if (!(p > 0.001 && p < 0.999)) return;
    c.push({ key, label, p, odds: odds ? Math.round(odds * 100) / 100 : siteOdds(p), src: odds ? (direct ? "real" : "derived") : "site" });
  };
  add("1", `Victoire ${H}`, x.pH, real && x.oH); add("x", "Match nul", x.pD, real && x.oD); add("2", `Victoire ${A}`, x.pA, real && x.oA);
  add("1x", `${H} ou nul`, x.pH + x.pD, real && 1 / (1 / x.oH + 1 / x.oD), false);
  add("x2", `Nul ou ${A}`, x.pD + x.pA, real && 1 / (1 / x.oD + 1 / x.oA), false);
  add("12", `${H} ou ${A}`, x.pH + x.pA, real && 1 / (1 / x.oH + 1 / x.oA), false);
  if (isFinite(x.o25)) { add("o25", "Plus de 2,5 buts", x.o25, dk25 && x.over); add("u25", "Moins de 2,5 buts", 1 - x.o25, dk25 && x.under); }
  if (isFinite(x.btts)) { add("by", "Les deux équipes marquent", x.btts, null); add("bn", "Une équipe au moins ne marque pas", 1 - x.btts, null); }
  if (isFinite(x.c95)) { add("co", "Plus de 9,5 corners", x.c95, null); add("cu", "Moins de 9,5 corners", 1 - x.c95, null); }
  if (isFinite(x.k45)) { add("ko", "Plus de 4,5 cartons", x.k45, null); add("ku", "Moins de 4,5 cartons", 1 - x.k45, null); }
  return c;
}
function picksFor(x, H, A) {
  const c = candidates(x, H, A);
  const out = {};
  const val = c.filter((s) => s.src === "real" && s.p >= 0.3).map((s) => ({ ...s, ev: s.p * s.odds - 1 })).filter((s) => s.ev >= 0.05).sort((a, b) => b.ev - a.ev)[0];
  out.valeur = val || null;
  out.confiance = c.filter((s) => s.odds >= 1.4).sort((a, b) => b.p - a.p)[0] || null;
  out.favori = c.filter((s) => ["1", "x", "2"].includes(s.key)).sort((a, b) => b.p - a.p)[0] || null;
  for (const k in out) if (out[k]) out[k].ev = out[k].p * out[k].odds - 1;
  return out;
}
function settle(key, x) {
  if (x.ftH == null || x.ftA == null) return null;
  const h = x.ftH, a = x.ftA, g = h + a;
  switch (key) {
    case "1": return h > a; case "x": return h === a; case "2": return h < a;
    case "1x": return h >= a; case "x2": return h <= a; case "12": return h !== a;
    case "o25": return g > 2.5; case "u25": return g < 2.5;
    case "by": return h > 0 && a > 0; case "bn": return !(h > 0 && a > 0);
    case "co": return x.corners == null ? "void" : x.corners > 9.5; case "cu": return x.corners == null ? "void" : x.corners < 9.5;
    case "ko": return x.cards == null ? "void" : x.cards > 4.5; case "ku": return x.cards == null ? "void" : x.cards < 4.5;
  }
  return null;
}
const srcLabel = (s) => (s === "real" ? "cote DraftKings" : s === "derived" ? "cote déduite de DraftKings" : `cote Avant-Match (marge ${Math.round(MARGIN * 100)} %)`);
function pickChip(st, pk, x) {
  if (!pk) return `<div class="pick none"><b>${esc(st.name)}</b><span class="muted small">Pas de pari sur ce match</span></div>`;
  const r = x ? settle(pk.key, x) : null;
  const res = r === true ? `<span class="pill ok">Gagné +${dec(STAKE * (pk.odds - 1))} €</span>` : r === false ? `<span class="pill ko">Perdu −${STAKE} €</span>` : r === "void" ? `<span class="pill">Annulé</span>` : "";
  return `<div class="pick" style="--c:${st.color}"><b>${esc(st.name)}</b><span>${esc(pk.label)}</span>
    <span class="num">@ ${dec(pk.odds)}</span><span class="muted small">${esc(srcLabel(pk.src))} · proba ${pct(pk.p)} · gain attendu ${pk.ev >= 0 ? "+" : ""}${pct(pk.ev, 1)}</span>${res}</div>`;
}
function runBank(rows, sid) {
  let bank = BANK, peak = BANK, dd = 0, n = 0, won = 0, staked = 0, bust = null;
  const pts = [];
  const hist = [];
  for (const r of rows) {
    if (bank < STAKE) { bust = bust ?? r.ko; break; }
    const pk = r.picks[sid]; if (!pk) continue;
    const res = settle(pk.key, r); if (res === null || res === "void") continue;
    n++; staked += STAKE;
    const gain = res ? STAKE * (pk.odds - 1) : -STAKE; if (res) won++;
    bank += gain; peak = Math.max(peak, bank); dd = Math.max(dd, peak - bank);
    pts.push([r.ko, bank]); hist.push({ r, pk, res, gain });
  }
  if (bank < STAKE && bust == null && pts.length) bust = pts[pts.length - 1][0];
  return { n, won, staked, profit: bank - BANK, bank, dd, pts, hist, bust };
}
function bankChart(el, series) {
  const draw = () => {
    const W = el.clientWidth, Hh = el.clientHeight, padL = W < 520 ? 44 : 56, padB = 26;
    const all = series.flatMap((s) => s.pts);
    if (!all.length || !W) { el.innerHTML = ""; return; }
    const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]));
    const ys = all.map((p) => p[1]).concat([BANK]);
    let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = Math.max(20, (y1 - y0) * 0.08); y0 -= padY; y1 += padY;
    const X = (v) => padL + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - padL - 12);
    const Y = (v) => 10 + (1 - (v - y0) / (y1 - y0)) * (Hh - 10 - padB);
    const step = Math.pow(10, Math.floor(Math.log10((y1 - y0) / 4))); const tk = []; for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) tk.push(v);
    const ticks = tk.length > 7 ? tk.filter((_, i) => i % 2 === 0) : tk;
    const dfmt = (t) => new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, month: "short", year: "2-digit" }).format(new Date(t * 1000));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Évolution de la cagnotte">
      ${ticks.map((t) => `<line x1="${padL}" x2="${W - 12}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${padL - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${Math.round(t)} €</text>`).join("")}
      <line x1="${padL}" x2="${W - 12}" y1="${Y(BANK)}" y2="${Y(BANK)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <text x="${padL}" y="${Hh - 6}" font-size="12" fill="var(--muted)">${dfmt(x0)}</text><text x="${W - 12}" y="${Hh - 6}" text-anchor="end" font-size="12" fill="var(--muted)">${dfmt(x1)}</text>
      ${series.map((s) => s.pts.length ? `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${[[x0, BANK], ...s.pts].map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>` : "").join("")}
    </svg>`;
  };
  draw();
  new ResizeObserver(draw).observe(el);
}
function stratBlock(rows, title, note, idp) {
  const res = STRATS.map((st) => ({ st, ...runBank(rows, st.id) }));
  if (!res.some((r) => r.n)) return `<div class="card"><h2>${title}</h2><p class="muted">${note}</p><p class="notice">Pas encore de pari terminé dans cette série. Les premiers résultats arrivent après les matchs de ce soir.</p></div>`;
  const last = res.flatMap((r) => r.hist.map((h) => ({ ...h, st: r.st }))).sort((a, b) => b.r.ko - a.r.ko).slice(0, 25);
  return `<div class="card"><h2>${title}</h2><p class="muted small">${note} Quand la cagnotte n'a plus de quoi miser ${STAKE} €, le style s'arrête.</p>
    <div class="scroll"><table class="stack"><thead><tr><th>Style</th><th class="n">Paris</th><th class="n">Gagnés</th><th class="n">Résultat</th><th class="n">Rendement</th><th class="n">Cagnotte</th><th class="n">Pire baisse</th></tr></thead><tbody>
    ${res.map((r) => `<tr><td data-l="Style"><b style="color:${r.st.color}">●</b> ${esc(r.st.name)}</td><td class="n" data-l="Paris">${r.n}</td><td class="n" data-l="Gagnés">${r.n ? pct(r.won / r.n, 1) : "–"}</td>
      <td class="n" data-l="Résultat"><span class="ev ${r.profit >= 0 ? "pos" : "neg"}">${r.profit >= 0 ? "+" : ""}${dec(r.profit, 0)} €</span></td><td class="n" data-l="Rendement">${r.staked ? pct(r.profit / r.staked, 1) : "–"}</td>
      <td class="n" data-l="Cagnotte">${r.bust ? `<span class="ev neg">vide le ${fmtShort(new Date(r.bust * 1000).toISOString())}</span>` : `${dec(r.bank, 0)} €`}</td><td class="n" data-l="Pire baisse">−${dec(r.dd, 0)} €</td></tr>`).join("")}
    </tbody></table></div>
    <div class="chart" id="${idp}-chart" style="margin-top:14px"></div>
    <div class="legend">${STRATS.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}<span><i style="background:var(--muted)"></i>Cagnotte de départ (${BANK} €)</span></div>
    <details style="margin-top:12px"><summary>Les 25 derniers paris terminés</summary><div class="scroll"><table class="stack"><thead><tr><th>Date</th><th>Match</th><th>Style</th><th>Pari</th><th class="n">Cote</th><th class="n">Résultat</th></tr></thead><tbody>
      ${last.map((h) => `<tr><td data-l="Date" class="small muted">${fmtShort(new Date(h.r.ko * 1000).toISOString())}</td><td data-l="Match"><a href="#m-${esc(h.r.id)}">${esc(h.r.h)} - ${esc(h.r.a)}</a> <b>${h.r.ftH}-${h.r.ftA}</b></td><td data-l="Style">${esc(h.st.name)}</td><td data-l="Pari">${esc(h.pk.label)}</td><td class="n" data-l="Cote">${dec(h.pk.odds)}</td><td class="n" data-l="Résultat"><span class="ev ${h.res ? "pos" : "neg"}">${h.gain >= 0 ? "+" : ""}${dec(h.gain)} €</span></td></tr>`).join("")}
    </tbody></table></div></details></div>`;
}

async function viewBets() {
  setNav("paris"); clearInterval(state.timer);
  app.innerHTML = `<section class="hero band"><div class="wrap"><h1>Les paris du site</h1>
    <p>Pour chaque match pronostiqué, le site choisit lui-même ses paris selon plusieurs styles, dont une sélection de 10 paris maximum par jour,, avec une mise fictive de ${STAKE} € et une cagnotte de départ de ${BANK} €. Il utilise les vraies cotes DraftKings quand elles existent (résultat, plus/moins 2,5 buts), sinon sa propre cote : la cote juste moins une marge de ${Math.round(MARGIN * 100)} %, comme un bookmaker.</p>
    ${chipsHTML()}</div></section>
    <div class="wrap band" id="bets"><div class="skeleton"></div></div>`;
  bindChips(viewBets);
  let raw;
  try { raw = await rpc("sim_data"); } catch { document.getElementById("bets").innerHTML = `<p class="notice">Données indisponibles pour l'instant.</p>`; return; }
  const n = (v) => (v == null ? null : Number(v));
  const rows = raw.map((r) => ({ id: r[0], mode: r[1], ko: Number(r[2]), comp: r[3], h: r[4], a: r[5], pH: n(r[6]), pD: n(r[7]), pA: n(r[8]), o25: n(r[9]) ?? NaN, btts: n(r[10]) ?? NaN, c95: n(r[11]) ?? NaN, k45: n(r[12]) ?? NaN,
    oH: n(r[13]), oD: n(r[14]), oA: n(r[15]), line: n(r[16]), over: n(r[17]), under: n(r[18]), ftH: r[19], ftA: r[20], corners: r[21], cards: r[22], state: r[23] }))
    .filter((r) => state.comp === "all" || r.comp === state.comp);
  rows.forEach((r) => (r.picks = picksFor(r, r.h, r.a)));
  assignSelection(rows);
  const today = dayKey(new Date().toISOString());
  const todaySel = rows.filter((r) => r.mode === "live" && r.picks.selection && dayKey(new Date(r.ko * 1000).toISOString()) === today);
  const open = rows.filter((r) => r.mode === "live" && r.state !== "post");
  const live = rows.filter((r) => r.mode === "live" && r.state === "post");
  const bt = rows.filter((r) => r.mode === "backtest" && r.state === "post");
  document.getElementById("bets").innerHTML = `
    <div class="card"><h2>Sélection du jour · ${todaySel.length}/${MAX_PER_DAY}</h2>
      <p class="muted small">Ta liste de paris à suivre aujourd'hui, ${MAX_PER_DAY} maximum. Elle se remplit au fil de la journée : chaque pari apparaît environ une heure avant son match, quand les compositions sont annoncées. Reviens avant chaque créneau de matchs.</p>
      ${todaySel.length ? `<div class="scroll"><table class="stack"><thead><tr><th>Heure</th><th>Match</th><th>Pari</th><th class="n">Cote</th><th class="n">Proba</th><th class="n">Résultat</th></tr></thead><tbody>
        ${todaySel.map((r) => { const pk = r.picks.selection; const res = r.state === "post" ? settle(pk.key, r) : null;
          return `<tr><td data-l="Heure">${fmtTime(new Date(r.ko * 1000).toISOString())}</td><td data-l="Match"><a href="#m-${esc(r.id)}">${esc(r.h)} - ${esc(r.a)}</a>${r.state === "post" ? ` <b>${r.ftH}-${r.ftA}</b>` : r.state === "in" ? " <span class=\"pill live\">en cours</span>" : ""}</td>
          <td data-l="Pari">${esc(pk.label)}</td><td class="n" data-l="Cote">${dec(pk.odds)}</td><td class="n" data-l="Proba">${pct(pk.p)}</td>
          <td class="n" data-l="Résultat">${res === true ? `<span class="ev pos">+${dec(STAKE * (pk.odds - 1))} €</span>` : res === false ? `<span class="ev neg">−${STAKE} €</span>` : "à venir"}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="notice">Pas encore de pari aujourd'hui. Les paris apparaissent dès que les compositions d'un match qualifié sont annoncées.</p>`}
    </div>
    <div class="card"><h2>Les styles</h2>${STRATS.map((s) => `<p><b style="color:${s.color}">● ${esc(s.name)}</b> : ${esc(s.desc)}</p>`).join("")}</div>
    <div class="card"><h2>Paris en cours</h2>
      ${open.length ? open.map((r) => `<div class="openm"><a href="#m-${esc(r.id)}"><b>${esc(r.h)} - ${esc(r.a)}</b></a> <span class="muted small">${fmtShort(new Date(r.ko * 1000).toISOString())} à ${fmtTime(new Date(r.ko * 1000).toISOString())}${r.state === "in" ? " · en cours" : ""}</span>
        <div class="picks">${STRATS.map((s) => pickChip(s, r.picks[s.id], null)).join("")}</div></div>`).join("")
        : `<p class="muted">Aucun pari en cours. Les paris du site sont choisis en même temps que le pronostic, dès l'annonce des compositions.</p>`}
    </div>
    ${stratBlock(live, "En direct depuis la mise en ligne", "Paris choisis au moment de la publication du pronostic, avant le coup d'envoi, avec les cotes relevées à ce moment-là.", "live")}
    ${stratBlock(bt, "Simulation sur les matchs passés", "Les mêmes règles appliquées aux pronostics du test sur les matchs passés (modèle réentraîné semaine par semaine), avec les cotes de clôture. C'est une simulation : aucun pari n'a été placé.", "bt")}
    <p class="notice small">Ces paris sont fictifs et servent à mesurer le modèle. Un rendement négatif est le résultat normal face à la marge des bookmakers. Si tu paries pour de vrai, fixe-toi un budget ; aide gratuite en Belgique : joueurs.aide-en-ligne.be.</p>`;
  const series = (rs) => STRATS.map((st) => ({ color: st.color, pts: runBank(rs, st.id).pts }));
  const lc = document.getElementById("live-chart"); if (lc) bankChart(lc, series(live));
  const bc = document.getElementById("bt-chart"); if (bc) bankChart(bc, series(bt));
}

/* ---------- reliability ---------- */
function brier(p, o) { return p.reduce((s, x, i) => s + (x - (i === o ? 1 : 0)) ** 2, 0); }

async function viewEval() {
  setNav("fiabilite"); clearInterval(state.timer);
  app.innerHTML = `<section class="hero band"><div class="wrap"><h1>Le modèle tient-il la route ?</h1>
    <p>Chaque pronostic est comparé au résultat réel. Deux séries : les pronostics publiés en direct sur le site, et un test sur les matchs passés, où le modèle n'utilise que les données disponibles avant chaque match.</p>${chipsHTML()}</div></section>
    <div class="wrap band" id="ev"><div class="skeleton"></div></div>`;
  bindChips(viewEval);
  let rows;
  try { rows = await rpc("eval_data"); } catch { document.getElementById("ev").innerHTML = `<p class="notice">Données indisponibles pour l'instant.</p>`; return; }
  const R = rows.map((r) => ({ mode: r[0], comp: r[1], ko: r[2], p: [r[3], r[4], r[5]].map(Number), o25: Number(r[6]), btts: Number(r[7]), c95: Number(r[8]), k45: Number(r[9]), fh: r[10], fa: r[11], corners: r[12], cards: r[13], odds: [r[14], r[15], r[16]].map((x) => (x == null ? null : Number(x))), src: r[17] }))
    .filter((r) => state.comp === "all" || r.comp === state.comp);
  const box = document.getElementById("ev");
  if (!R.length) { box.innerHTML = `<p class="notice">Pas encore de match évalué pour cette sélection.</p>`; return; }
  const live = R.filter((r) => r.mode === "live"), bt = R.filter((r) => r.mode === "backtest");
  const stats = (S) => {
    let acc = 0, br = 0, ll = 0, nb = 0, accB = 0, brB = 0, brM2 = 0, o25 = 0, o25n = 0, bt2 = 0, bt2n = 0, c = 0, cn = 0, k = 0, kn = 0;
    for (const r of S) {
      const o = r.fh > r.fa ? 0 : r.fh === r.fa ? 1 : 2;
      if (r.p.indexOf(Math.max(...r.p)) === o) acc++;
      br += brier(r.p, o); ll += -Math.log(Math.max(1e-6, r.p[o]));
      if (r.odds.every((x) => x > 1)) {
        const inv = r.odds.map((x) => 1 / x), s = inv.reduce((a, b) => a + b, 0), q = inv.map((x) => x / s);
        nb++; brB += brier(q, o); brM2 += brier(r.p, o); if (q.indexOf(Math.max(...q)) === o) accB++;
      }
      if (isFinite(r.o25)) { o25n++; o25 += ((r.fh + r.fa > 2.5) === (r.o25 > 0.5)) ? 1 : 0; }
      if (isFinite(r.btts)) { bt2n++; bt2 += ((r.fh > 0 && r.fa > 0) === (r.btts > 0.5)) ? 1 : 0; }
      if (isFinite(r.c95) && r.corners != null) { cn++; c += ((r.corners > 9.5) === (r.c95 > 0.5)) ? 1 : 0; }
      if (isFinite(r.k45) && r.cards != null) { kn++; k += ((r.cards > 4.5) === (r.k45 > 0.5)) ? 1 : 0; }
    }
    const n = S.length;
    return { n, acc: acc / n, br: br / n, ll: ll / n, nb, accB: nb ? accB / nb : null, brB: nb ? brB / nb : null, brM2: nb ? brM2 / nb : null, o25: o25 / o25n, btts: bt2 / bt2n, c: cn ? c / cn : null, k: kn ? k / kn : null };
  };
  const block = (S, title, note) => {
    if (!S.length) return `<div class="card"><h2>${title}</h2><p class="muted">${note} Pas encore de match terminé dans cette série.</p></div>`;
    const s = stats(S);
    return `<div class="card"><h2>${title}</h2><p class="muted small">${note}</p>
      <div class="kpis">
        <div class="kpi"><b>${s.n}</b><span>matchs évalués</span></div>
        <div class="kpi"><b>${pct(s.acc, 1)}</b><span>favori du modèle qui gagne (1N2)</span></div>
        <div class="kpi"><b>${s.accB != null ? pct(s.accB, 1) : "–"}</b><span>favori du bookmaker qui gagne (${s.nb} matchs avec cotes)</span></div>
        <div class="kpi"><b>${dec(s.brM2 ?? s.br, 3)}</b><span>score de Brier du modèle${s.nb ? " (matchs avec cotes)" : ""} — plus bas = mieux</span></div>
        <div class="kpi"><b>${s.brB != null ? dec(s.brB, 3) : "–"}</b><span>score de Brier du bookmaker (mêmes matchs)</span></div>
        <div class="kpi"><b>${pct(s.o25, 1)}</b><span>bon côté sur plus/moins 2,5 buts</span></div>
        <div class="kpi"><b>${pct(s.btts, 1)}</b><span>bon côté sur « les deux marquent »</span></div>
        <div class="kpi"><b>${s.c != null ? pct(s.c, 1) : "–"}</b><span>bon côté sur plus/moins 9,5 corners</span></div>
        <div class="kpi"><b>${s.k != null ? pct(s.k, 1) : "–"}</b><span>bon côté sur plus/moins 4,5 cartons</span></div>
      </div></div>`;
  };
  // calibration
  const calib = (S) => {
    const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
    for (const r of S) { const o = r.fh > r.fa ? 0 : r.fh === r.fa ? 1 : 2; r.p.forEach((x, i) => { const b = Math.min(9, Math.floor(x * 10)); bins[b].n++; bins[b].p += x; bins[b].y += i === o ? 1 : 0; }); }
    return bins.filter((b) => b.n >= 15).map((b) => ({ x: b.p / b.n, y: b.y / b.n, n: b.n }));
  };
  const all = [...bt, ...live];
  // betting simulation on 1X2 with bookmaker odds
  const sim = (S, thr) => {
    let n = 0, staked = 0, profit = 0;
    for (const r of S) {
      if (!r.odds.every((x) => x > 1)) continue;
      const o = r.fh > r.fa ? 0 : r.fh === r.fa ? 1 : 2;
      r.p.forEach((p, i) => { const ev = p * r.odds[i] - 1; if (ev > thr) { n++; staked += 10; profit += i === o ? 10 * (r.odds[i] - 1) : -10; } });
    }
    return { n, staked, profit, roi: staked ? profit / staked : null };
  };
  const sims = [0, 0.05, 0.1, 0.2].map((t) => ({ t, ...sim(all, t) }));
  const favSim = (() => { let n = 0, pr = 0; for (const r of all) { if (!r.odds.every((x) => x > 1)) continue; const o = r.fh > r.fa ? 0 : r.fh === r.fa ? 1 : 2; const i = r.p.indexOf(Math.max(...r.p)); n++; pr += i === o ? 10 * (r.odds[i] - 1) : -10; } return { n, pr }; })();
  // per competition
  const comps = [...new Set(all.map((r) => r.comp))];
  const perComp = comps.map((slug) => ({ ...stats(all.filter((r) => r.comp === slug)), slug })).sort((a, b) => b.n - a.n);

  box.innerHTML = `${block(live, "Pronostics publiés en direct", "Pronostics figés au moment de l'annonce des compos, avant le coup d'envoi.")}
    ${block(bt, "Test sur les matchs passés", "Simulation semaine par semaine : le modèle est réentraîné uniquement sur les matchs joués avant la semaine testée, avec les compos réellement alignées.")}
    <div class="card"><h2>Calibration : quand le modèle dit X %, ça arrive-t-il X % du temps ?</h2>
      <p class="muted small">Chaque point regroupe les issues (victoire domicile, nul, victoire extérieur) selon la probabilité annoncée. Plus les points sont proches de la diagonale, plus les probabilités sont fiables.</p>
      <div class="chart" id="cal"></div>
      <div class="legend"><span><i style="background:var(--home)"></i>Modèle</span><span><i style="background:var(--muted)"></i>Calibration parfaite</span></div></div>
    <div class="card"><h2>Et si on avait parié ? (cotes DraftKings via ESPN)</h2>
      <p class="muted small">Mise fictive de 10 € sur chaque issue du 1N2 où le modèle voit un gain attendu supérieur au seuil, sur tous les matchs évalués qui ont des cotes. Les bookmakers prennent une marge : il est normal que le résultat soit négatif.</p>
      <div class="scroll"><table><thead><tr><th>Règle</th><th class="n">Paris</th><th class="n">Misé</th><th class="n">Résultat</th><th class="n">Rendement</th></tr></thead><tbody>
      ${sims.map((s) => `<tr><td>Gain attendu &gt; ${pct(s.t)}</td><td class="n">${s.n}</td><td class="n">${s.staked} €</td><td class="n"><span class="ev ${s.profit >= 0 ? "pos" : "neg"}">${s.profit >= 0 ? "+" : ""}${dec(s.profit, 0)} €</span></td><td class="n">${s.roi != null ? pct(s.roi, 1) : "–"}</td></tr>`).join("")}
      <tr><td>Toujours le favori du modèle</td><td class="n">${favSim.n}</td><td class="n">${favSim.n * 10} €</td><td class="n"><span class="ev ${favSim.pr >= 0 ? "pos" : "neg"}">${favSim.pr >= 0 ? "+" : ""}${dec(favSim.pr, 0)} €</span></td><td class="n">${favSim.n ? pct(favSim.pr / (favSim.n * 10), 1) : "–"}</td></tr>
      </tbody></table></div></div>
    <div class="card"><h2>Par compétition</h2><div class="scroll"><table class="stack"><thead><tr><th>Compétition</th><th class="n">Matchs</th><th class="n">Favori qui gagne</th><th class="n">Brier modèle</th><th class="n">Brier bookmaker</th><th class="n">Plus/moins 2,5</th></tr></thead><tbody>
      ${perComp.map((s) => `<tr><td data-l="Compétition">${esc(compName(s.slug))}</td><td class="n" data-l="Matchs">${s.n}</td><td class="n" data-l="Favori qui gagne">${pct(s.acc, 1)}</td><td class="n" data-l="Brier modèle">${dec(s.brM2 ?? s.br, 3)}</td><td class="n" data-l="Brier bookmaker">${s.brB != null ? dec(s.brB, 3) : "–"}</td><td class="n" data-l="Plus/moins 2,5">${pct(s.o25, 1)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  const pts = calib(all);
  const el = document.getElementById("cal");
  const draw = () => {
    const W = el.clientWidth, Hh = el.clientHeight, pad = W < 520 ? 34 : 44;
    const X = (v) => pad + v * (W - pad - 12), Y = (v) => Hh - pad + -v * (Hh - pad - 12);
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Calibration du modèle">
      ${ticks.map((t) => `<line x1="${X(0)}" x2="${X(1)}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${pad - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="12" fill="var(--muted)">${t * 100}%</text><text x="${X(t)}" y="${Hh - pad + 18}" text-anchor="middle" font-size="12" fill="var(--muted)">${t * 100}%</text>`).join("")}
      <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <polyline fill="none" stroke="var(--home)" stroke-width="2.5" points="${pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}"/>
      ${pts.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${Math.min(9, 3 + Math.sqrt(p.n) / 6)}" fill="var(--home)" fill-opacity=".85"><title>Annoncé ${pct(p.x)} · observé ${pct(p.y)} · ${p.n} issues</title></circle>`).join("")}
      <text x="${X(0.5)}" y="${Hh - 4}" text-anchor="middle" font-size="12" fill="var(--muted)">probabilité annoncée</text>
    </svg>`;
  };
  draw();
  const ro = new ResizeObserver(draw); ro.observe(el);
}

/* ---------- method ---------- */
async function viewMethod() {
  setNav("methode"); clearInterval(state.timer);
  let info = null; try { info = await rpc("model_info"); } catch { /* optional */ }
  const b = info?.beta || {};
  app.innerHTML = `<section class="hero band"><div class="wrap"><h1>Comment le modèle calcule</h1>
    <p>Un modèle statistique de buts (famille Dixon-Coles), entraîné sur tous les matchs des 9 compétitions depuis l'été 2025, mis à jour chaque nuit et ajusté avec les compositions officielles.</p></div></section>
    <div class="wrap band prose">
      <h2>1. Les données</h2>
      <p>Toutes les données viennent de l'API publique d'ESPN : calendrier, résultats, statistiques d'équipe (tirs, tirs cadrés, corners, fautes, cartons), compositions officielles et statistiques de chaque joueur, cotes DraftKings pour le résultat et le nombre de buts. Une tâche automatique les récupère toutes les heures, et toutes les 5 minutes dans l'heure qui précède chaque match.${info ? ` Le modèle actuel est entraîné sur ${info.n_matches} matchs.` : ""}</p>
      <h2>2. Les buts attendus de chaque équipe</h2>
      <p>Pour chaque équipe, le modèle estime une force offensive et une faiblesse défensive, plus un niveau par championnat (pour comparer une équipe belge et une équipe anglaise en Coupe d'Europe) et un avantage du terrain par compétition. Les buts attendus de l'équipe à domicile valent : moyenne de la compétition × avantage du terrain × attaque de l'équipe × défense adverse × effets de la compo et de la fatigue.</p>
      <p>Pour moins dépendre de la chance, le modèle apprend à moitié sur les buts réels et à moitié sur des « buts attendus » estimés à partir des tirs et des tirs cadrés. Les matchs récents comptent plus : un match d'il y a 5 mois pèse deux fois moins qu'un match d'hier.</p>
      <h2>3. La composition officielle</h2>
      <p>Dès que les onze sont annoncés, le modèle compare chaque onze à l'équipe habituelle :</p>
      <ul>
        <li><b>Force offensive du onze</b> : somme des contributions offensives des titulaires (tirs et tirs cadrés par 90 minutes), comparée à celle des onze alignés d'habitude.${b.compo_attaque != null ? ` Effet estimé : un onze 10 % moins offensif que d'habitude réduit les buts attendus d'environ ${dec(100 * (1 - Math.pow(0.9, b.compo_attaque)), 1)} %.` : ""}</li>
        <li><b>Onze habituel</b> : part des minutes récentes jouées par les titulaires du jour (rotation, blessés, suspendus).</li>
        <li><b>Gardien</b> : le gardien n°1 est-il absent ?</li>
        <li><b>Fatigue</b> : moins de 4 jours depuis le dernier match.</li>
      </ul>
      <p>L'importance de chacun de ces effets n'est pas choisie à la main : elle est estimée sur l'historique des matchs.</p>
      <h2>3 bis. La calibration</h2>
      <p>Pour ne pas surréagir à quelques résultats, les forces des équipes sont « tirées » vers la moyenne. Le test sur les matchs passés a montré que le modèle était alors trop prudent : quand il annonçait 54 %, l'équipe gagnait 62 % du temps. L'écart de force entre les deux équipes est donc accentué d'un facteur 1,35 (en échelle logarithmique), la valeur qui minimise l'erreur sur ce test.</p>
      <h2>3 ter. Les équipes peu connues</h2>
      <p>En Coupe d'Europe, beaucoup d'adversaires viennent de championnats non suivis (Pays-Bas, Portugal, Autriche…) et n'ont que quelques matchs dans les données. Pour ces équipes seulement, le modèle mélange son estimation avec les buts attendus déduits des cotes du marché : plus l'équipe a peu de matchs, plus les cotes pèsent (au maximum 75 %). Les matchs entre équipes bien connues restent 100 % modèle.</p>
      <h2>4. Des buts attendus à tous les marchés</h2>
      <p>Le modèle en déduit la probabilité de chaque score (de 0-0 à 10-10), avec la correction de Dixon-Coles pour les petits scores. Tous les marchés liés aux buts en découlent : 1N2, double chance, plus/moins, les deux marquent, score exact, handicaps, mi-temps (environ ${info?.phi ? dec(100 * info.phi, 0) : "45"} % des buts tombent en 1re mi-temps).</p>
      <p><b>2UP</b> : le match est simulé minute par minute (avec la répartition réelle des buts dans le temps) pour calculer la probabilité qu'une équipe mène de 2 buts à un moment, ou gagne. Cette probabilité est toujours au moins égale à celle de gagner.</p>
      <p><b>Corners, cartons, tirs</b> : même principe avec leurs propres forces par équipe, et une loi binomiale négative pour tenir compte de leur forte variabilité. <b>Joueurs</b> : la part de chaque titulaire dans les tirs, buts, passes et cartons de son équipe (lissée vers la moyenne de son poste quand il a peu joué), multipliée par ce que le modèle attend de l'équipe.</p>
      <h2>5. Probabilité de gain et de perte</h2>
      <p>Pour un pari de probabilité p à la cote c, la cote « juste » vaut 1/p, et le gain moyen pour 10 € misés vaut 10 × (p × (c − 1) − (1 − p)). Les paris « remboursés » (handicaps entiers, remboursé si nul) sont traités à part.</p>
      <h2>6. Les limites</h2>
      <ul>
        <li>ESPN ne publie ni les arbitres, ni les blessés annoncés, ni les xG officiels ; les absences sont captées par la composition officielle.</li>
        <li>Seules 9 compétitions sont suivies : les matchs de coupes nationales manquent pour calculer la fatigue.</li>
        <li>Les meilleurs modèles publiés devinent le bon résultat (1N2) dans environ 55 % des cas. Les bookmakers ont la même information et prennent une marge : un modèle comme celui-ci n'est pas une méthode pour gagner de l'argent.</li>
      </ul>
      ${info?.top ? `<h2>Classement de puissance actuel</h2><p class="muted">Écart de buts attendu contre une équipe moyenne des 9 compétitions, sur terrain neutre.</p>
        <div class="scroll"><table class="stack"><thead><tr><th>#</th><th>Équipe</th><th>Championnat</th><th class="n">Attaque</th><th class="n">Défense</th><th class="n">Écart attendu</th></tr></thead><tbody>
        ${info.top.map((t, i) => `<tr><td data-l="#">${i + 1}</td><td data-l="Équipe">${esc(t.name)}</td><td data-l="Championnat">${esc(compName(t.lg))}</td><td class="n" data-l="Attaque">×${dec(t.att)}</td><td class="n" data-l="Défense">×${dec(t.def)}</td><td class="n" data-l="Écart attendu">${t.gd >= 0 ? "+" : ""}${dec(t.gd)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
    </div>`;
}

async function route() {
  const h = location.hash.replace(/^#/, "");
  try {
    if (h.startsWith("m-")) await viewMatch(h.slice(2));
    else if (h === "fiabilite") await viewEval();
    else if (h === "methode") await viewMethod();
    else if (h === "paris") await viewBets();
    else await viewHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="wrap band"><p class="notice">Une erreur est survenue. Recharge la page.</p></div>`;
  }
}

(async () => {
  try { COMPS = await api("competitions?select=slug,name,sort&active=is.true&order=sort"); } catch { COMPS = []; }
  window.addEventListener("hashchange", route);
  route();
})();
}
