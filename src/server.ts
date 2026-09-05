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
// explicit. FRONTEND_URL should be set in production; without it, this
// falls back to allowing any origin, which is fine for early testing but
// should be tightened before real launch.
app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? true,
    exposedHeaders: ["x-iv", "x-original-format"],
  })
);

// NOTE: express.json() applies to routes that don't register their own
// body parser. vault.ts and media.ts register express.raw() directly on
// their upload routes instead, since those bodies are binary file bytes,
// not JSON — Express applies whichever parser is registered on the
// specific route.
app.use(express.json());

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

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Yorubania API listening on port ${port}`);
});
