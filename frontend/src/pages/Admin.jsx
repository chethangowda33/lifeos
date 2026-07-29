import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Dumbbell, Activity, ShieldCheck } from "lucide-react";
import LoadError from "@/components/LoadError";

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

export default function Admin() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = React.useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/users"),
      ]);
      setStats(s.data);
      setUsers(u.data || []);
      setFailed(false);
    } catch {
      // Zeroed tiles and an empty member list would read as "nobody uses this".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    load();
  }, [user, load]);

  // Hard gate — regular members can't view this page even by URL.
  if (user && user.role !== "admin") return <Navigate to="/dashboard" replace />;

  const tiles = [
    { icon: Users, label: "Total users", value: stats?.total_users },
    { icon: ShieldCheck, label: "Members", value: stats?.members },
    { icon: Activity, label: "Active this week", value: stats?.active_users_this_week },
    { icon: Dumbbell, label: "Workouts logged", value: stats?.total_workouts },
  ];

  const header = (
    <div>
      <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Admin</div>
      <h1 className="text-4xl font-semibold tracking-tight mt-1">Overview</h1>
      <p className="text-muted-foreground text-sm mt-1">Only you can see this. Members and workout activity across LifeOS.</p>
    </div>
  );

  if (failed) {
    return (
      <div className="max-w-4xl space-y-6 animate-fade-up">
        {header}
        <LoadError what="admin data" onRetry={() => { setLoading(true); load(); }} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 animate-fade-up">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <t.icon className="h-4 w-4 text-maroon mb-2" />
            <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : (t.value ?? 0)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{t.label}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold tracking-tight">Accounts</h3>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {stats ? `${stats.workouts_this_week} workouts this week` : ""}
          </span>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (
            users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-3">
                <span className="h-9 w-9 rounded-full bg-[hsl(var(--maroon)/0.12)] text-maroon flex items-center justify-center text-sm font-medium shrink-0">
                  {(u.name || u.email || "?").slice(0, 1).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{u.email}</span>
                    {u.role === "admin" && <Badge className="bg-maroon text-white text-[9px]">admin</Badge>}
                  </div>
                  <span className="text-[11px] text-muted-foreground">Joined {fmtDate(u.created_at)}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">{u.workout_count ?? 0}</div>
                  <div className="text-[10px] text-muted-foreground">workouts</div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
