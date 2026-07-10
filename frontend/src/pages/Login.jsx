import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOGIN } from "@/constants/testIds";
import { Dumbbell } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <div className="hidden lg:flex flex-col w-1/2 bg-maroon text-white p-12 relative overflow-hidden">
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="flex items-center gap-2 relative">
          <div className="h-10 w-10 rounded-xl bg-white/15 border border-white/30 flex items-center justify-center">
            <Dumbbell className="h-5 w-5" />
          </div>
          <span className="font-semibold tracking-tight text-lg">LifeOS</span>
        </div>
        <div className="mt-auto relative max-w-md">
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">
            Your body.<br />Your routines.<br />Your operating system.
          </h1>
          <p className="mt-6 text-white/80 leading-relaxed">
            Train smarter with a library of 66+ exercises, 14 ready-made programs,
            and a full body-composition dashboard.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6 animate-fade-up">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Welcome back</div>
            <h2 className="text-3xl font-semibold tracking-tight">Sign in to LifeOS</h2>
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link to="/register" data-testid={LOGIN.registerLink} className="text-maroon font-medium hover:underline">
                Create one
              </Link>
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                data-testid={LOGIN.emailInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                data-testid={LOGIN.passwordInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            data-testid={LOGIN.submitButton}
            className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
