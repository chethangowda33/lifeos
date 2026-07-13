import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Dumbbell, Activity, Apple, ListChecks,
  Sparkles, BookOpen, Moon, TrendingUp, LogOut, Sun, MoonStar, Palette, Check, Shield,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ColorWheel from "@/components/ColorWheel";
import { NAV } from "@/constants/testIds";
import useTrainReminder from "@/hooks/useTrainReminder";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testId: NAV.itemDashboard },
  { to: "/workout", label: "Workout", icon: Dumbbell, testId: NAV.itemWorkout },
  { to: "/body-metrics", label: "Body Metrics", icon: Activity, testId: NAV.itemBodyMetrics },
  { to: "/nutrition", label: "Nutrition", icon: Apple, testId: NAV.itemNutrition },
  { to: "/habits", label: "Habits", icon: ListChecks, testId: NAV.itemHabits },
  { to: "/coach", label: "AI Coach", icon: Sparkles, testId: NAV.itemCoach },
  { to: "/journal", label: "Journal", icon: BookOpen, testId: NAV.itemJournal },
  { to: "/sleep", label: "Sleep", icon: Moon, testId: NAV.itemSleep },
  { to: "/progress", label: "Progress", icon: TrendingUp, testId: NAV.itemProgress },
];

// Shown in the sidebar only for admin accounts.
const ADMIN_ITEM = { to: "/admin", label: "Admin", icon: Shield };

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle, accent, accentId, setAccentId, accents, customHsl, setCustomColor } = useTheme();
  const navigate = useNavigate();
  useTrainReminder(); // in-app train reminder notification

  const initials = (user?.name || user?.email || "U").slice(0, 1).toUpperCase();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        data-testid={NAV.sidebar}
        className="hidden md:flex md:w-64 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))]"
      >
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

        <nav className="flex-1 px-3 space-y-1">
          {(user?.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS).map(({ to, label, icon: Icon, testId }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={testId}
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
            onClick={async () => { await logout(); navigate("/login"); }}
          >
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
          <div className="md:hidden font-semibold text-lg">LifeOS</div>
          <div className="hidden md:block text-sm text-muted-foreground">
            Welcome back, <span className="text-foreground font-medium">{user?.name || "Athlete"}</span>
          </div>
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
        </header>
        <div className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
