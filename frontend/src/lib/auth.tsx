"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshAccessToken, setAccessToken, setUnauthorizedHandler } from "./api";
import type { Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (data: {
    email: string; password: string; full_name: string; organization_name?: string; invitation_token?: string;
  }) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<Me | null>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    try {
      const data = await api<Me>("/auth/me");
      setMe(data);
      return data;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      setMe(null);
      const path = window.location.pathname;
      if (!["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(path) && !path.startsWith("/invite")) {
        router.replace(`/login?next=${encodeURIComponent(path + window.location.search)}`);
      }
    });
    (async () => {
      const token = await refreshAccessToken();
      if (token) await reload();
      setLoading(false);
    })();
  }, [reload, router]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      reload,
      async login(email, password) {
        const t = await api<{ access_token: string }>("/auth/login", { method: "POST", body: { email, password } });
        setAccessToken(t.access_token);
        const m = (await reload())!;
        return m;
      },
      async register(data) {
        const t = await api<{ access_token: string }>("/auth/register", { method: "POST", body: data });
        setAccessToken(t.access_token);
        return (await reload())!;
      },
      async logout() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        setAccessToken(null);
        setMe(null);
        qc.clear();
        router.replace("/login");
      },
    }),
    [me, loading, reload, qc, router],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
