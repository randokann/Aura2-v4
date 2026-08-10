"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type AuthMode = "authenticated" | "guest" | "unauthenticated";

export interface User {
  id: string;
  name: string;
  email?: string;
  isGuest: boolean;
}

interface AuthContextValue {
  user: User | null;
  authMode: AuthMode;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  continueAsGuest: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "aura2_auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("unauthenticated");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: User = JSON.parse(stored);
        setUser(parsed);
        setAuthMode(parsed.isGuest ? "guest" : "authenticated");
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const persist = (u: User) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  };

  const signIn = async (email: string, _password: string) => {
    // Placeholder: in a real app this would call an API
    const u: User = {
      id: crypto.randomUUID(),
      name: email.split("@")[0],
      email,
      isGuest: false,
    };
    persist(u);
    setUser(u);
    setAuthMode("authenticated");
  };

  const signUp = async (name: string, email: string, _password: string) => {
    // Placeholder: in a real app this would call an API
    const u: User = {
      id: crypto.randomUUID(),
      name,
      email,
      isGuest: false,
    };
    persist(u);
    setUser(u);
    setAuthMode("authenticated");
  };

  const continueAsGuest = () => {
    const u: User = {
      id: crypto.randomUUID(),
      name: "Guest",
      isGuest: true,
    };
    persist(u);
    setUser(u);
    setAuthMode("guest");
  };

  const signOut = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setAuthMode("unauthenticated");
  };

  return (
    <AuthContext.Provider
      value={{ user, authMode, signIn, signUp, continueAsGuest, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
