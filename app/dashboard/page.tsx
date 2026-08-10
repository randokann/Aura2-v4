"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function Dashboard() {
  const { user, authMode } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authMode === "unauthenticated") {
      router.replace("/");
    }
  }, [authMode, router]);

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Welcome back, {user.name}
          {user.isGuest && (
            <span className="ml-2 text-base font-normal text-amber-600 dark:text-amber-400">
              (Guest)
            </span>
          )}
        </h1>
        {user.isGuest && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            You are browsing as a guest.{" "}
            <Link
              href="/signup"
              className="text-violet-600 dark:text-violet-400 hover:underline"
            >
              Create an account
            </Link>{" "}
            to save your data.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/meal"
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 hover:border-violet-400 dark:hover:border-violet-600 transition-colors"
        >
          <div className="text-2xl mb-2">🍽️</div>
          <h2 className="font-semibold text-zinc-800 dark:text-zinc-100">
            Meals
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Track your daily nutrition
          </p>
        </Link>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 opacity-50 cursor-not-allowed">
          <div className="text-2xl mb-2">📊</div>
          <h2 className="font-semibold text-zinc-800 dark:text-zinc-100">
            Progress
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
