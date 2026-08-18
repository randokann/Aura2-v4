import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";
import { clearAuthRedirectError, getAuthRedirectError } from "../lib/authRedirect";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {

  const [user, setUser] = useState(null);

  const [session, setSession] = useState(null);

  const [loading, setLoading] = useState(true);

  const [authError, setAuthError] = useState(null);

  const latestSessionRef = useRef({ token: undefined, userId: undefined });

  const clearAuthError = useCallback(() => setAuthError(null), []);

useEffect(() => {
  let active = true;

  const applySession = (nextSession, event) => {
    if (!active) return;
    const nextToken = nextSession?.access_token;
    const nextUserId = nextSession?.user?.id;
    const latest = latestSessionRef.current;

    if (latest.token !== nextToken || latest.userId !== nextUserId) {
      latestSessionRef.current = { token: nextToken, userId: nextUserId };
      setSession(nextSession ?? null);
    }
    if (latest.userId !== nextUserId || event === "USER_UPDATED") {
      setUser(nextSession?.user ?? null);
    }
    setLoading(false);
  };

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, nextSession) => {
    applySession(nextSession, event);
  });

  async function initializeAuth() {
    try {
      const {
        data: { session: initialSession },
        error,
      } = await supabase.auth.getSession();
      if (error) throw error;
      applySession(initialSession, "INITIAL_SESSION");
    } catch (error) {
      if (active) {
        setAuthError("Authentication couldn't be restored. Please try signing in again.");
      }
    } finally {
      const redirectError = getAuthRedirectError();
      if (active && redirectError) setAuthError(redirectError);
      if (redirectError) clearAuthRedirectError();
      if (active) setLoading(false);
    }
  }

  initializeAuth();

  return () => {
    active = false;
    subscription.unsubscribe();
  };
}, []);

return (
  <AuthContext.Provider
    value={{
      user,
      session,
      loading,
      authError,
      clearAuthError,
    }}
  >
    {children}
  </AuthContext.Provider>
);

}
export function useAuth() {
  return useContext(AuthContext);
}
