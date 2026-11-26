import { logJob, sql } from "./db.ts";
import { COMPS, monthsBetween, syncDetails, syncMonth, syncRecent } from "./sync.ts";
import { predictAndStore, taskBacktest, taskFit, taskPrematch } from "./run.ts";

let cachedSecret: string | null = null;
async function authorized(req: Request) {
  if (!cachedSecret) {
    const r = await sql`select value from app_config where key = 'cron_secret'`;
    cachedSecret = r[0]?.value ?? null;
  }
  return !!cachedSecret && req.headers.get("x-cron-secret") === cachedSecret;
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (!(await authorized(req))) return json({ error: "forbidden" }, 403);
  const u = new URL(req.url);
  const q = (k: string, d = "") => u.searchParams.get(k) ?? d;
  const task = q("task");
  const t0 = Date.now();
  try {
    let out: unknown;
    switch (task) {
      case "sync_month": {
        const comps = q("comp") === "all" ? COMPS : [q("comp")];
        const res = [];
        for (const c of comps) for (const m of monthsBetween(q("from"), q("to", q("from")))) res.push(await syncMonth(c, m));
        out = res;
        break;
      }
      case "sync_recent": out = await syncRecent(); break;
      case "details": out = await syncDetails(Number(q("limit", "40"))); break;
      case "fit": out = await taskFit(); break;
      case "prematch": out = await taskPrematch(); break;
      case "predict": out = await predictAndStore(q("id"), q("src", "official")); break;
      case "backtest": out = await taskBacktest(q("from"), Number(q("weeks", "3"))); break;
      case "hourly": {
        const s = await syncRecent();
        const d = await syncDetails(60);
        out = { synced: s.reduce((a: number, b: any) => a + (b.events ?? 0), 0), details: d };
        break;
      }
      default:
        return json({ error: "unknown task" }, 400);
    }
    const info = { ms: Date.now() - t0, out };
    if (task !== "prematch" || (out as any)?.published?.length) await logJob(task, true, info);
    return json(info);
  } catch (e) {
    const info = { ms: Date.now() - t0, error: String(e), stack: (e as Error)?.stack?.slice(0, 800) };
    await logJob(task, false, info);
    return json(info, 500);
  }
});
