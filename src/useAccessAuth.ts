import { useCallback, useEffect, useState } from "react";
import { accessApi, AccessError } from "./lib/accessApi";

export type AccessState = "checking" | "signed-in" | "signed-out" | "unavailable";

export interface AccessStatus {
  state: AccessState;
  email: string | null;
  message: string | null;
}

export function useAccessAuth() {
  const [status, setStatus] = useState<AccessStatus>({
    state: "checking",
    email: null,
    message: null,
  });

  useEffect(() => {
    let active = true;
    void accessApi.me().then(
      ({ email }) => {
        if (active) setStatus({ state: "signed-in", email, message: null });
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof AccessError && error.kind === "signed-out") {
          setStatus({ state: "signed-out", email: null, message: error.message });
        } else {
          setStatus({
            state: "unavailable",
            email: null,
            message: error instanceof Error ? error.message : "Access identity verification is unavailable.",
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(() => {
    window.location.assign(accessApi.signInUrl());
  }, []);

  return { status, signIn };
}
