import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORGOT_PASSWORD } from "@/constants/testIds";
import { MailCheck } from "lucide-react";

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await forgotPassword(email);
      // The backend answers the same way whether or not the email exists, so the
      // UI must too — never confirm or deny that an account was found.
      setSent(true);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 animate-fade-up">
        {sent ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-[hsl(var(--maroon)/0.12)] text-maroon flex items-center justify-center">
              <MailCheck className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Check your email</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If an account exists for <span className="font-medium text-foreground">{email}</span>,
              we&apos;ve sent a link to reset your password. It expires in 60 minutes.
            </p>
            <p className="text-sm text-muted-foreground">
              Didn&apos;t get it? Check your spam folder, or{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="text-maroon font-medium hover:underline"
              >
                try again
              </button>
              .
            </p>
            <Link
              to="/login"
              data-testid={FORGOT_PASSWORD.loginLink}
              className="inline-block text-sm text-maroon font-medium hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Password reset</div>
              <h2 className="text-3xl font-semibold tracking-tight">Forgot your password?</h2>
              <p className="text-sm text-muted-foreground">
                Enter your email and we&apos;ll send you a link to set a new one.
              </p>
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                data-testid={FORGOT_PASSWORD.emailInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              data-testid={FORGOT_PASSWORD.submitButton}
              className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white"
            >
              {loading ? "Sending…" : "Send reset link"}
            </Button>

            <p className="text-sm text-muted-foreground text-center">
              Remembered it?{" "}
              <Link
                to="/login"
                data-testid={FORGOT_PASSWORD.loginLink}
                className="text-maroon font-medium hover:underline"
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
