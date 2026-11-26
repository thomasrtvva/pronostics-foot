import postgres from "npm:postgres@3.4.5";

export const sql: any = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 4, idle_timeout: 5, connect_timeout: 15 });

export function dedupe<T extends Record<string, any>>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

export async function upsertTeams(teams: any[]) {
  const rows = dedupe(teams.filter(Boolean), (t) => t.id);
  if (!rows.length) return;
  await sql`insert into teams ${sql(rows, "id", "name", "short_name", "abbr", "logo", "color")}
    on conflict (id) do update set name = excluded.name, short_name = excluded.short_name, abbr = excluded.abbr,
      logo = coalesce(excluded.logo, teams.logo), color = coalesce(excluded.color, teams.color), updated_at = now()`;
}

export async function upsertMatches(matches: any[]) {
  const rows = dedupe(matches.filter(Boolean), (m) => m.id).map((m) => ({ ...m, odds: m.odds ? sql.json(m.odds) : null }));
  if (!rows.length) return;
  const cols = ["id", "comp", "season", "kickoff", "state", "status_name", "status_detail", "home_id", "away_id",
    "home_score", "away_score", "ht_home", "ht_away", "neutral", "venue", "city", "attendance", "odds"];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await sql`insert into matches ${sql(chunk, ...cols)}
      on conflict (id) do update set comp = excluded.comp, season = excluded.season, kickoff = excluded.kickoff,
        state = excluded.state, status_name = excluded.status_name, status_detail = excluded.status_detail,
        home_id = excluded.home_id, away_id = excluded.away_id, home_score = excluded.home_score, away_score = excluded.away_score,
        ht_home = coalesce(excluded.ht_home, matches.ht_home), ht_away = coalesce(excluded.ht_away, matches.ht_away),
        neutral = excluded.neutral, venue = coalesce(excluded.venue, matches.venue), city = coalesce(excluded.city, matches.city),
        attendance = coalesce(excluded.attendance, matches.attendance),
        odds = case when excluded.odds is not null and matches.state = 'pre' then excluded.odds else coalesce(matches.odds, excluded.odds) end,
        details_at = case when matches.state <> 'post' and excluded.state = 'post' then null else matches.details_at end,
        updated_at = now()`;
  }
}

export async function logJob(task: string, ok: boolean, info: any) {
  try { await sql`insert into job_log (task, ok, info) values (${task}, ${ok}, ${sql.json(info)})`; } catch (_e) { /* ignore */ }
}

export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  });
  await Promise.all(workers);
  return out;
}
