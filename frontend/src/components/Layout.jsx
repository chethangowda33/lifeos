import React, { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Dumbbell, Activity, Apple, ListChecks,
  Sparkles, Moon, TrendingUp, FileText, Medal, Flag, LogOut, Sun, MoonStar, Palette, Check, Shield, Watch, Menu, CloudOff,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import ColorWheel from "@/components/ColorWheel";
import { NAV } from "@/constants/testIds";
import useTrainReminder from "@/hooks/useTrainReminder";
import useOfflineQueue from "@/hooks/useOfflineQueue";
import { QUEUE_SYNCED } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testId: NAV.itemDashboard },
  { to: "/workout", label: "Workout", icon: Dumbbell, testId: NAV.itemWorkout },
  { to: "/body-metrics", label: "Body Metrics", icon: Activity, testId: NAV.itemBodyMetrics },
  { to: "/intake", label: "Intake", icon: Apple, testId: NAV.itemNutrition },
  { to: "/habits", label: "Habits", icon: ListChecks, testId: NAV.itemHabits },
  { to: "/coach", label: "AI Coach", icon: Sparkles, testId: NAV.itemCoach },
  { to: "/sleep", label: "Sleep", icon: Moon, testId: NAV.itemSleep },
  { to: "/progress", label: "Progress", icon: TrendingUp, testId: NAV.itemProgress },
  { to: "/reports", label: "Reports", icon: FileText, testId: NAV.itemReports },
  { to: "/achievements", label: "Achievements", icon: Medal, testId: NAV.itemAchievements },
  { to: "/challenges", label: "Challenges", icon: Flag, testId: NAV.itemChallenges },
  { to: "/connections", label: "Connections", icon: Watch },
];

// Shown in the sidebar only for admin accounts.
const ADMIN_ITEM = { to: "/admin", label: "Admin", icon: Shield };

/* Sidebar body — shared by the desktop rail and the mobile slide-in drawer. */
function SidebarBody({ isAdmin, user, initials, onNavigate, onLogout }) {
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-7">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-maroon flex items-center justify-center text-white">
            <Dumbbell className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-base">LifeOS</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Personal OS</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {items.map(({ to, label, icon: Icon, testId }) => (
          <NavLink
            key={to}
            to={to}
            data-testid={testId}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-[hsl(var(--sidebar-border))]">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-maroon text-white flex items-center justify-center text-sm font-semibold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user?.name || "User"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{user?.email}</div>
          </div>
        </div>
        <Button
          data-testid={NAV.logoutButton}
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1 text-muted-foreground hover:text-foreground"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle, accent, accentId, setAccentId, accents, customHsl, setCustomColor } = useTheme();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pendingSync = useOfflineQueue(); // count of workouts waiting to sync
  useTrainReminder(); // in-app train reminder notification

  // Toast when queued offline writes flush on reconnect.
  useEffect(() => {
    const onSynced = (e) => {
      const n = e.detail?.synced || 0;
      if (n > 0) toast({ title: "Back online", description: `Synced ${n} pending ${n === 1 ? "item" : "items"}.` });
    };
    window.addEventListener(QUEUE_SYNCED, onSynced);
    return () => window.removeEventListener(QUEUE_SYNCED, onSynced);
  }, [toast]);

  const initials = (user?.name || user?.email || "U").slice(0, 1).toUpperCase();
  const isAdmin = user?.role === "admin";
  const handleLogout = async () => { await logout(); navigate("/login"); };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        data-testid={NAV.sidebar}
        className="hidden md:flex md:w-64 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))]"
      >
        <SidebarBody isAdmin={isAdmin} user={user} initials={initials} onLogout={handleLogout} />
      </aside>

      {/* Mobile slide-in nav */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="p-0 w-72 bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]">
          <SidebarBody
            isAdmin={isAdmin}
            user={user}
            initials={initials}
            onNavigate={() => setMobileNavOpen(false)}
            onLogout={() => { setMobileNavOpen(false); handleLogout(); }}
          />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid={NAV.mobileNavToggle}
              aria-label="Open menu"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden h-9 w-9 -ml-1 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="md:hidden font-semibold text-lg">LifeOS</div>
            <div className="hidden md:block text-sm text-muted-foreground">
              Welcome back, <span className="text-foreground font-medium">{user?.name || "Athlete"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
          {pendingSync > 0 && (
            <span
              data-testid="offline-pending"
              title="Waiting for a connection to sync"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <CloudOff className="h-3.5 w-3.5 text-amber-500" />
              {pendingSync} to sync
            </span>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                data-testid={NAV.themeToggle}
                aria-label="Appearance"
                className="h-9 w-9 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <Palette className="h-4 w-4" style={{ color: `hsl(${accent.base})` }} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-3">
              {/* Mode */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Mode</div>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
                  <button
                    data-testid={NAV.themeLightButton}
                    onClick={() => theme === "dark" && toggle()}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
                      theme === "light" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" /> Light
                  </button>
                  <button
                    data-testid={NAV.themeDarkButton}
                    onClick={() => theme === "light" && toggle()}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
                      theme === "dark" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MoonStar className="h-3.5 w-3.5" /> Dark
                  </button>
                </div>
              </div>

              {/* Quick swatches */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Quick presets</div>
                <div className="grid grid-cols-6 gap-2">
                  {accents.map((a) => {
                    const active = a.id === accentId;
                    return (
                      <button
                        key={a.id}
                        data-testid={NAV.accentSwatch}
                        data-accent={a.id}
                        onClick={() => setAccentId(a.id)}
                        aria-label={a.label}
                        title={a.label}
                        className={`h-8 w-8 rounded-full flex items-center justify-center transition ring-offset-2 ring-offset-background ${
                          active ? "ring-2 ring-foreground/60 scale-105" : "hover:scale-110"
                        }`}
                        style={{ background: `hsl(${theme === "dark" ? a.dark : a.base})` }}
                      >
                        {active && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom color wheel — full HSL freedom */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Custom</div>
                  <div className="text-[10px] text-muted-foreground">
                    {accentId === "custom" ? "In use" : accent.label}
                  </div>
                </div>
                <ColorWheel
                  hsl={customHsl}
                  onChange={(next) => setCustomColor(next)}
                  size={140}
                />
              </div>
            </PopoverContent>
          </Popover>
          </div>
        </header>
        <div className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
