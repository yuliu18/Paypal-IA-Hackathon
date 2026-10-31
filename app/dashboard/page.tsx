import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled, aiModels } from "@/lib/ai";
import { latestDashboardData } from "@/lib/dashboard-data";
import { readGuardDashboardRows } from "@/lib/guard/dashboard-rows";
import { auditLog } from "@/lib/guard/runtime";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

// How many of the guard's newest decisions the report reads; older ones stay in the log and on /guard.
const GUARD_ROWS = 5000;

export default async function DashboardPage() {
  // Live PayPal data: render per request, not at build time.
  await connection();
  // The guard's newest decisions, read fresh on every visit, sit beside the last PayPal snapshot.
  const data = { ...(await latestDashboardData()), ...readGuardDashboardRows((limit) => auditLog().list(limit), GUARD_ROWS) };

  // Only the model ids reach the client; the OpenAI key stays on the server (lib/ai.ts).
  return (
    <Dashboard
      data={data}
      licenseKey={process.env.AG_STUDIO}
      aiModels={aiEnabled() ? aiModels() : undefined}
    />
  );
}
