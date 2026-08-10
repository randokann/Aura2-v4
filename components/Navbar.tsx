"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function Navbar() {
  const { user, authMode, signOut } = useAuth();

  return (
    <nav className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href={authMode !== "unauthenticated" ? "/dashboard" : "/"}
          className="text-lg font-bold text-violet-600 dark:text-violet-400"
        >
          Aura2
        </Link>

        {authMode !== "unauthenticated" && (
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Dashboard
            </Link>
            <Link
              href="/meal"
              className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Meals
            </Link>
            <div className="flex items-center gap-2">
              {user?.isGuest && (
                <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  Guest
                </span>
              )}
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {user?.name}
              </span>
              <button
                onClick={signOut}
                className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
