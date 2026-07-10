import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <div className="animate-pulse text-sm">Loading…</div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}
