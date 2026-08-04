import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {

  const [user, setUser] = useState(null);

  const [session, setSession] = useState(null);

  const [loading, setLoading] = useState(true);

useEffect(() => {
  async function initializeAuth() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setSession(session);
    setUser(session?.user ?? null);

    setLoading(false);
  }

  initializeAuth();
}, []);

return (
  <AuthContext.Provider
    value={{
      user,
      session,
      loading,
    }}
  >
    {children}
  </AuthContext.Provider>
);

}
export function useAuth() {
  return useContext(AuthContext);
}