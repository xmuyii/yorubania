import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { inviteRoutes } from "./routes/invite";
import { tribeRoutes } from "./routes/tribe";
import { foundingNarrativeRoutes } from "./routes/founding-narrative";
import { councilRoutes } from "./routes/council";
import { leadershipRoutes } from "./routes/leadership";
import { profileRoutes } from "./routes/profile";
import { familyRoutes } from "./routes/families";
import { achievementsRoutes } from "./routes/achievements";
import { directoryRoutes } from "./routes/directory";
import { vaultRoutes } from "./routes/vault";
import { mediaRoutes } from "./routes/media";
import { backupRoutes } from "./routes/backup";
import { adminManagementRoutes } from "./routes/admin-management";
import { accountRoutes } from "./routes/accounts";
import { familyTreeRoutes } from "./routes/family-tree";
import { biographyRoutes } from "./routes/biography";
import { migrationRoutes } from "./routes/migration";
import { vaultDistributionRoutes } from "./routes/vault-distribution";
import { deathRoutes } from "./routes/death";
import { lifeGoalsRoutes } from "./routes/life-goals";
import { rulesRoutes } from "./routes/rules";
import { superadminRoutes } from "./routes/superadmin";
import { accountMonitoringRoutes } from "./routes/account-monitoring";
import { publicContactRoutes } from "./routes/public-contact";
import { pollsRoutes } from "./routes/polls";
import { accessGrantsRoutes } from "./routes/access-grants";
import { enforcementRoutes } from "./routes/enforcement";
import { relationshipStatusRoutes } from "./routes/relationship-status";
import { educationRoutes } from "./routes/education";
import { projectsRoutes } from "./routes/projects";
import { ifatarotRoutes } from "./routes/ifatarot";

// SUPABASE_SERVICE_ROLE_KEY must only ever exist in server-side environment
// variables (Railway config), never shipped to any client bundle.
//
// The `realtime.transport` option below is a belt-and-suspenders fix: newer
// supabase-js versions require a native WebSocket global (Node 22+) and
// otherwise crash the process on startup. Passing the `ws` package directly
// makes this work regardless of which Node version Railway's build ends up
// using — we don't even use realtime features, but supabase-js constructs
// that client unconditionally, so it has to be satisfied either way.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: WebSocket as any } }
);

const app = express();

// The frontend is hosted on a different origin from this API (a separate
// Railway service or a static host like Vercel/Netlify), so CORS must be
// explicit. FRONTEND_URL should be set in production — supports a
// comma-separated list if you ever have more than one frontend origin
// (e.g. a staging URL alongside production). Trailing slashes and
// whitespace are normalized away, since a mismatch there is a common,
// hard-to-spot cause of CORS failures. Falls back to allowing any origin
// if unset, which is fine for early testing but should be tightened
// before real launch.
const allowedOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // non-browser requests (curl, health checks)
      if (allowedOrigins.length === 0) return callback(null, true); // no restriction configured yet
      const normalized = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(normalized)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not in FRONTEND_URL`));
    },
    exposedHeaders: ["x-iv", "x-original-format"],
  })
);

// NOTE: express.json() applies to routes that don't register their own
// body parser. vault.ts and media.ts register express.raw() directly on
// their upload routes instead, since those bodies are binary file bytes,
// not JSON — Express applies whichever parser is registered on the
// specific route.
app.use(express.json());

// Simple health-check route. Railway (and you, sanity-checking in a
// browser) can hit the bare domain root and get a real response instead
// of a 404 — useful for confirming the container is actually reachable,
// separate from any specific /api endpoint.
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", service: "yorubania-backend" });
});

app.use("/api", inviteRoutes(supabaseAdmin));
app.use("/api", tribeRoutes(supabaseAdmin));
app.use("/api", foundingNarrativeRoutes(supabaseAdmin));
app.use("/api", councilRoutes(supabaseAdmin));
app.use("/api", leadershipRoutes(supabaseAdmin));
app.use("/api", profileRoutes(supabaseAdmin));
app.use("/api", familyRoutes(supabaseAdmin));
app.use("/api", achievementsRoutes(supabaseAdmin));
app.use("/api", directoryRoutes(supabaseAdmin));
app.use("/api", vaultRoutes(supabaseAdmin));
app.use("/api", mediaRoutes(supabaseAdmin));
app.use("/api", backupRoutes(supabaseAdmin));
app.use("/api", adminManagementRoutes(supabaseAdmin));
app.use("/api", accountRoutes(supabaseAdmin));
app.use("/api", familyTreeRoutes(supabaseAdmin));
app.use("/api", biographyRoutes(supabaseAdmin));
app.use("/api", migrationRoutes(supabaseAdmin));
app.use("/api", vaultDistributionRoutes(supabaseAdmin));
app.use("/api", deathRoutes(supabaseAdmin));
app.use("/api", lifeGoalsRoutes(supabaseAdmin));
app.use("/api", rulesRoutes(supabaseAdmin));
app.use("/api", superadminRoutes(supabaseAdmin));
app.use("/api", accountMonitoringRoutes(supabaseAdmin));
app.use("/api", publicContactRoutes(supabaseAdmin));
app.use("/api", pollsRoutes(supabaseAdmin));
app.use("/api", accessGrantsRoutes(supabaseAdmin));
app.use("/api", enforcementRoutes(supabaseAdmin));
app.use("/api", relationshipStatusRoutes(supabaseAdmin));
app.use("/api", educationRoutes(supabaseAdmin));
app.use("/api", projectsRoutes(supabaseAdmin));
app.use("/api", ifatarotRoutes(supabaseAdmin));

const port = process.env.PORT ?? 3000;
app.listen(Number(port), "0.0.0.0", () => {
  console.log(`Yorubania API listening on port ${port}`);
});
