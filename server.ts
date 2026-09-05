import express from "express";
import { createClient } from "@supabase/supabase-js";
import { inviteRoutes } from "./routes/invite";
import { tribeRoutes } from "./routes/tribe";
import { foundingNarrativeRoutes } from "./routes/founding-narrative";
import { councilRoutes } from "./routes/council";
import { leadershipRoutes } from "./routes/leadership";
import { profileRoutes } from "./routes/profile";

// SUPABASE_SERVICE_ROLE_KEY must only ever exist in server-side environment
// variables (Railway config), never shipped to any client bundle.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const app = express();
app.use(express.json());

app.use("/api", inviteRoutes(supabaseAdmin));
app.use("/api", tribeRoutes(supabaseAdmin));
app.use("/api", foundingNarrativeRoutes(supabaseAdmin));
app.use("/api", councilRoutes(supabaseAdmin));
app.use("/api", leadershipRoutes(supabaseAdmin));
app.use("/api", profileRoutes(supabaseAdmin));

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Yorubania API listening on port ${port}`);
});
