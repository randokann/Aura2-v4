"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { authMode, continueAsGuest } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authMode !== "unauthenticated") {
      router.replace("/dashboard");
    }
  }, [authMode, router]);

  const handleGuest = () => {
    continueAsGuest();
    router.push("/dashboard");
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold text-violet-600 dark:text-violet-400">
            Aura2
          </h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            Your personal wellness companion
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/signin"
            className="block w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="block w-full rounded-lg border border-violet-600 px-4 py-3 text-sm font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950 transition-colors"
          >
            Create account
          </Link>
          <button
            onClick={handleGuest}
            className="w-full rounded-lg px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}
