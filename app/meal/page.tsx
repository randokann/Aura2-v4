"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function MealPage() {
  const { authMode } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authMode === "unauthenticated") {
      router.replace("/");
    }
  }, [authMode, router]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 w-full">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
        Meals
      </h1>
      <div className="mt-8 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-12 text-center">
        <div className="text-4xl mb-4">🚧</div>
        <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">
          Not yet configured
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          The meal page is coming soon. Check back later!
        </p>
      </div>
    </div>
  );
}
