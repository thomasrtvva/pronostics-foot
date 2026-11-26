import { BASE, getJSON, isFinalStatus, parseScoreboardEvent, parseSummary } from "./espn.ts";
import { dedupe, pool, sql, upsertMatches, upsertTeams } from "./db.ts";

export const COMPS = ["bel.1", "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "uefa.champions", "uefa.europa", "uefa.europa.conf"];

export async function syncMonth(comp: string, yyyymm: string) {
  let js = await getJSON(`${BASE}/${comp}/scoreboard?dates=${yyyymm}&limit=400`);
  if (!js) js = await getJSON(`${BASE}/${comp}/scoreboard?dates=${yyyymm}`);
  if (!js) return { comp, yyyymm, events: 0, error: "no data" };
  const parsed = (js.events ?? []).map((e: any) => parseScoreboardEvent(e, comp)).filter(Boolean);
  await upsertTeams(parsed.flatMap((p: any) => p.teams));
  await upsertMatches(parsed.map((p: any) => p.match));
  return { comp, yyyymm, events: parsed.length };
}

export function monthsBetween(from: string, to: string): string[] {
  // from/to as YYYYMM
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const ty = Number(to.slice(0, 4)), tm = Number(to.slice(4, 6));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function syncRecent() {
  const now = new Date();
  const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = new Set<string>([ym(now)]);
  const ahead = new Date(now.getTime() + 12 * 86400000); months.add(ym(ahead));
  const back = new Date(now.getTime() - 3 * 86400000); months.add(ym(back));
  const jobs = COMPS.flatMap((c) => [...months].map((m) => [c, m] as const));
  return await pool(jobs, 6, ([c, m]) => syncMonth(c, m));
}

export async function writeSummary(matchId: string, p: ReturnType<typeof parseSummary>, final: boolean) {
  if (p.players.length) {
    const pl = dedupe(p.players, (x) => x.id);
    await sql`insert into players ${sql(pl, "id", "name", "short_name")}
      on conflict (id) do update set name = excluded.name, short_name = coalesce(excluded.short_name, players.short_name), updated_at = now()`;
  }
  if (p.mp.length) {
    const rows = dedupe(p.mp, (x) => x.player_id);
    await sql.begin(async (tx: any) => {
      await tx`delete from match_players where match_id = ${matchId}`;
      for (let i = 0; i < rows.length; i += 100) await tx`insert into match_players ${tx(rows.slice(i, i + 100))}`;
    });
  }
  await sql`update matches set
      stats = coalesce(${p.stats ? sql.json(p.stats) : null}::jsonb, stats),
      goals = case when ${final} then ${sql.json(p.goals)}::jsonb else goals end,
      cards = case when ${final} then ${sql.json(p.cards)}::jsonb else cards end,
      ft_home = case when ${final} then ${p.ftH} else ft_home end,
      ft_away = case when ${final} then ${p.ftA} else ft_away end,
      ht_home = coalesce(${final ? p.htH : null}, ht_home),
      ht_away = coalesce(${final ? p.htA : null}, ht_away),
      referee = coalesce(${p.referee}, referee),
      formation_home = coalesce(${p.formations.home ?? null}, formation_home),
      formation_away = coalesce(${p.formations.away ?? null}, formation_away),
      attendance = coalesce(${p.attendance}, attendance),
      odds = case when odds is null then ${p.odds ? sql.json(p.odds) : null}::jsonb
                  when state = 'pre' and ${p.odds ? sql.json(p.odds) : null}::jsonb is not null then ${p.odds ? sql.json(p.odds) : null}::jsonb
                  else odds end,
      lineups_at = case when lineups_at is null and ${p.lineupsReady} then now() else lineups_at end,
      details_at = case when ${final} then now() else details_at end,
      summary_checked_at = now(),
      updated_at = now()
    where id = ${matchId}`;
}

export async function fetchSummary(comp: string, id: string) {
  const js = await getJSON(`${BASE}/${comp}/summary?event=${id}`);
  if (!js) return null;
  return parseSummary(js, id);
}

export async function syncDetails(limit = 40) {
  const rows = await sql`select id, comp, status_name from matches
    where state = 'post' and details_at is null and kickoff < now() - interval '150 minutes'
      and (summary_checked_at is null or summary_checked_at < now() - interval '6 hours')
    order by kickoff desc limit ${limit}`;
  let ok = 0, skipped = 0, failed = 0;
  await pool(rows as any[], 8, async (r: any) => {
    try {
      if (!isFinalStatus(r.status_name)) {
        await sql`update matches set details_at = now() where id = ${r.id}`; skipped++; return;
      }
      const p = await fetchSummary(r.comp, r.id);
      if (!p) { failed++; await sql`update matches set summary_checked_at = now() where id = ${r.id}`; return; }
      await writeSummary(r.id, p, true); ok++;
    } catch (e) { failed++; console.error("details", r.id, String(e)); }
  });
  const remaining = await sql`select count(*)::int n from matches where state = 'post' and details_at is null and kickoff < now() - interval '150 minutes'`;
  return { ok, skipped, failed, remaining: remaining[0].n };
}
