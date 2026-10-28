import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RESET_PASSWORD } from "@/constants/testIds";
import { CheckCircle2 } from "lucide-react";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  // A link with no token can't reset anything — send the user to request a fresh one.
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 text-center animate-fade-up">
          <h2 className="text-2xl font-semibold tracking-tight">Invalid reset link</h2>
          <p className="text-sm text-muted-foreground">
            This link is missing its reset token. Request a new one and try again.
          </p>
          <Link to="/forgot-password" className="inline-block text-sm text-maroon font-medium hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 animate-fade-up">
        {done ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-[hsl(var(--maroon)/0.12)] text-maroon flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Password updated</h2>
            <p className="text-sm text-muted-foreground">
              Your password has been changed. You can now sign in with your new password.
            </p>
            <Button
              type="button"
              onClick={() => navigate("/login")}
              data-testid={RESET_PASSWORD.loginLink}
              className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              Go to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Password reset</div>
              <h2 className="text-3xl font-semibold tracking-tight">Set a new password</h2>
              <p className="text-sm text-muted-foreground">
                Choose a new password for your account.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid={RESET_PASSWORD.passwordInput}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  data-testid={RESET_PASSWORD.passwordConfirmInput}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
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
              data-testid={RESET_PASSWORD.submitButton}
              className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              {loading ? "Updating…" : "Update password"}
            </Button>

            <p className="text-sm text-muted-foreground text-center">
              <Link to="/login" className="text-maroon font-medium hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
