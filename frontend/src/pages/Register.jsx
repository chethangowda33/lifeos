import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REGISTER } from "@/constants/testIds";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name, inviteCode);
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6 animate-fade-up">
        <div>
          <div className="text-xs uppercase tracking-widest text-maroon font-semibold">Create account</div>
          <h2 className="text-3xl font-semibold tracking-tight">Start your LifeOS</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Already have an account?{" "}
            <Link to="/login" data-testid={REGISTER.loginLink} className="text-maroon font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" data-testid={REGISTER.nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" data-testid={REGISTER.emailInput} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" data-testid={REGISTER.passwordInput} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input id="confirm" type="password" data-testid={REGISTER.passwordConfirmInput} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="invite">Invite code</Label>
            <Input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Ask CG for one" />
          </div>
        </div>
        {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">{error}</div>}
        <Button type="submit" disabled={loading} data-testid={REGISTER.submitButton} className="w-full bg-maroon hover:bg-[hsl(var(--maroon-hover))] text-white">
          {loading ? "Creating…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
