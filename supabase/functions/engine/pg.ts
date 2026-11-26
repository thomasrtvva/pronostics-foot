// Supplies the Postgres client to the bundled engine (dist/engine.js), which is imported from the GitHub repo.
import postgres from "npm:postgres@3.4.5";
(globalThis as any).__postgres = postgres;
