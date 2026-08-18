import React, { useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { supabase } from "../lib/supabase";
import { AuthProvider, useAuth } from "./AuthProvider";

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

function Probe({ onChange }) {
  const auth = useAuth();
  useEffect(() => {
    onChange(auth);
  }, [auth, onChange]);
  return null;
}

describe("AuthProvider", () => {
  let container;
  let root;
  let authCallback;
  let unsubscribe;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    unsubscribe = jest.fn();
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabase.auth.onAuthStateChange.mockImplementation((callback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe } } };
    });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  test("initializes, follows auth changes, and unsubscribes", async () => {
    const states = [];
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe onChange={(state) => states.push(state)} />
        </AuthProvider>
      );
    });

    expect(states.at(-1)).toMatchObject({ user: null, session: null, loading: false });

    const signedIn = {
      access_token: "token-1",
      user: { id: "user-1", email: "user@example.com" },
    };
    await act(async () => authCallback("SIGNED_IN", signedIn));
    expect(states.at(-1)).toMatchObject({
      user: signedIn.user,
      session: signedIn,
      loading: false,
    });

    const refreshed = { ...signedIn, access_token: "token-2" };
    await act(async () => authCallback("TOKEN_REFRESHED", refreshed));
    expect(states.at(-1).session).toBe(refreshed);
    expect(states.at(-1).user).toBe(signedIn.user);

    await act(async () => authCallback("SIGNED_OUT", null));
    expect(states.at(-1)).toMatchObject({ user: null, session: null, loading: false });

    act(() => root.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    root = null;
  });
});
