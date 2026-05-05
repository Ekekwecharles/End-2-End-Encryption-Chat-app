"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthResponse,
  EncryptedPayload,
  MessageResponse,
  UserProfile,
  UUID,
} from "@/lib/api/whisperbox";
import { whisperbox } from "@/lib/api/whisperbox";
import {
  exportPublicKeySpkiBase64,
  generateRsaOaepKeyPair,
  unwrapPrivateKeyPkcs8Base64,
  wrapPrivateKeyPkcs8Base64,
} from "@/lib/crypto/crypto";
import { idbDel, idbGet, idbSet } from "@/lib/storage/idb";
import { WhisperBoxWS } from "@/lib/ws/whisperbox-ws";

type AuthStatus = "unauthenticated" | "locked" | "authenticated";

type AuthState = {
  status: AuthStatus;
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  publicKeyBase64: string | null;
  privateKey: CryptoKey | null;
  wsStatus: "idle" | "connecting" | "open" | "closed" | "error" | "reconnecting";
};

type AuthActions = {
  register: (params: {
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  login: (params: { username: string; password: string }) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  withAccessToken: <T,>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
  subscribeIncoming: (cb: (msg: MessageResponse) => void) => () => void;
  sendWsMessage: (to: UUID, payload: EncryptedPayload) => boolean;
};

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_TOKEN_KEY = "refresh_token";
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function msUntilRefresh(expiresInSeconds: number) {
  const refreshAt = Math.max(
    10,
    Math.min(expiresInSeconds - 60, Math.floor(expiresInSeconds * 0.8)),
  );
  return refreshAt * 1000;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "unauthenticated",
    accessToken: null,
    refreshToken: null,
    user: null,
    publicKeyBase64: null,
    privateKey: null,
    wsStatus: "idle",
  });

  const wsRef = useRef<WhisperBoxWS | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const incomingListenersRef = useRef(new Set<(msg: MessageResponse) => void>());

  const scheduleRefresh = (refreshToken: string, expiresInSeconds: number) => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(async () => {
      try {
        const t = await whisperbox.refresh({ refresh_token: refreshToken });
        setState((s) => ({ ...s, accessToken: t.access_token }));
        if (wsRef.current) {
          wsRef.current.setToken(t.access_token);
          wsRef.current.disconnect();
          wsRef.current.connect();
        }
        scheduleRefresh(refreshToken, t.expires_in);
      } catch {
        // If refresh fails, force re-login.
        await idbDel(REFRESH_TOKEN_KEY);
        setState({
          status: "unauthenticated",
          accessToken: null,
          refreshToken: null,
          user: null,
          publicKeyBase64: null,
          privateKey: null,
          wsStatus: "idle",
        });
      }
    }, msUntilRefresh(expiresInSeconds));
  };

  const connectWs = (accessToken: string) => {
    const ws = new WhisperBoxWS({
      token: accessToken,
      onStatusChange: (wsStatus) => setState((s) => ({ ...s, wsStatus })),
      onReceiveMessage: (msg) => {
        for (const cb of incomingListenersRef.current) cb(msg);
      },
    });
    wsRef.current = ws;
    ws.connect();
  };

  const disconnectWs = () => {
    wsRef.current?.disconnect();
    wsRef.current = null;
  };

  useEffect(() => {
    // Try silent session restore using refresh token (but crypto remains locked until password is provided).
    const run = async () => {
      const refreshToken = await idbGet<string>(REFRESH_TOKEN_KEY);
      if (!refreshToken) return;

      try {
        const t = await whisperbox.refresh({ refresh_token: refreshToken });
        const user = await whisperbox.me({ accessToken: t.access_token });
        setState((s) => ({
          ...s,
          status: "locked",
          refreshToken,
          accessToken: t.access_token,
          user,
          publicKeyBase64: user.public_key,
          privateKey: null,
        }));
        connectWs(t.access_token);
        scheduleRefresh(refreshToken, t.expires_in);
      } catch {
        await idbDel(REFRESH_TOKEN_KEY);
      }
    };
    void run();

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      disconnectWs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = useMemo<AuthActions>(() => {
    const applyAuth = async (
      auth: AuthResponse,
      password: string,
      existingPrivateKey?: CryptoKey | null,
    ) => {
      const privateKey =
        existingPrivateKey ??
        (await unwrapPrivateKeyPkcs8Base64(
          auth.user.wrapped_private_key,
          auth.user.pbkdf2_salt,
          password,
        ));

      await idbSet(REFRESH_TOKEN_KEY, auth.refresh_token);

      setState({
        status: "authenticated",
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        user: auth.user,
        publicKeyBase64: auth.user.public_key,
        privateKey,
        wsStatus: "idle",
      });

      connectWs(auth.access_token);
      scheduleRefresh(auth.refresh_token, auth.expires_in || ACCESS_TOKEN_TTL_SECONDS);
    };

    return {
      async register(params) {
        const { publicKey, privateKey } = await generateRsaOaepKeyPair(2048);
        const publicKeyBase64 = await exportPublicKeySpkiBase64(publicKey);
        const wrapped = await wrapPrivateKeyPkcs8Base64(privateKey, params.password);

        const auth = await whisperbox.register({
          username: params.username,
          display_name: params.displayName,
          password: params.password,
          public_key: publicKeyBase64,
          wrapped_private_key: wrapped.wrapped_private_key,
          pbkdf2_salt: wrapped.pbkdf2_salt,
        });

        await applyAuth(auth, params.password, privateKey);
      },

      async login(params) {
        const auth = await whisperbox.login({
          username: params.username,
          password: params.password,
        });
        await applyAuth(auth, params.password, null);
      },

      async unlock(password: string) {
        const { user, refreshToken, accessToken } = state;
        if (!user || !refreshToken || !accessToken) throw new Error("No locked session available.");

        const privateKey = await unwrapPrivateKeyPkcs8Base64(
          user.wrapped_private_key,
          user.pbkdf2_salt,
          password,
        );

        setState((s) => ({ ...s, status: "authenticated", privateKey }));
      },

      async logout() {
        const refreshToken = state.refreshToken;
        const accessToken = state.accessToken;

        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        disconnectWs();
        await idbDel(REFRESH_TOKEN_KEY);

        setState({
          status: "unauthenticated",
          accessToken: null,
          refreshToken: null,
          user: null,
          publicKeyBase64: null,
          privateKey: null,
          wsStatus: "idle",
        });

        if (refreshToken && accessToken) {
          try {
            await whisperbox.logout({ refresh_token: refreshToken }, { accessToken });
          } catch {
            // best-effort
          }
        }
      },

      async withAccessToken(fn) {
        const at = state.accessToken;
        if (!at) throw new Error("Not authenticated.");
        return fn(at);
      },

      subscribeIncoming(cb) {
        incomingListenersRef.current.add(cb);
        return () => {
          incomingListenersRef.current.delete(cb);
        };
      },

      sendWsMessage(to, payload) {
        return wsRef.current?.sendMessage(to, payload) ?? false;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken, state.refreshToken, state.user, state.privateKey, state.status]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, ...actions }), [state, actions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useMyUserId(): UUID | null {
  const { user } = useAuth();
  return user?.id ?? null;
}

