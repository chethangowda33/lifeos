import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // null = checking, false = unauthenticated, object = user
  const [user, setUser] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
      } catch {
        setUser(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) localStorage.setItem("access_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const register = async (email, password, name, inviteCode = "") => {
    const { data } = await api.post("/auth/register", { email, password, name, invite_code: inviteCode });
    if (data.access_token) localStorage.setItem("access_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    localStorage.removeItem("access_token");
    setUser(false);
  };

  // Password reset (logged-out flow). forgotPassword always resolves the same way
  // whether or not the email is registered — the backend never reveals it.
  const forgotPassword = async (email) => {
    const { data } = await api.post("/auth/forgot-password", { email });
    return data;
  };

  const resetPassword = async (token, newPassword) => {
    const { data } = await api.post("/auth/reset-password", { token, new_password: newPassword });
    return data;
  };

  const updateProfile = async (profile) => {
    const { data } = await api.put("/auth/profile", profile);
    setUser(data);
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateProfile, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
