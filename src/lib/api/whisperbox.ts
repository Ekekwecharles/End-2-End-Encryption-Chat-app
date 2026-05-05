const DEFAULT_BASE_URL = "https://whisperbox.koyeb.app";

export type UUID = string;

export type RegisterRequest = {
  username: string;
  display_name: string;
  password: string;
  public_key: string; // base64
  wrapped_private_key: string; // base64
  pbkdf2_salt: string; // base64
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type RefreshRequest = {
  refresh_token: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "bearer" | string;
  expires_in: number;
};

export type UserProfile = {
  id: UUID;
  username: string;
  display_name: string;
  public_key: string; // base64
  wrapped_private_key: string; // base64
  pbkdf2_salt: string; // base64
  created_at: string; // ISO date-time
};

export type AuthResponse = TokenResponse & {
  refresh_token: string;
  user: UserProfile;
};

export type UserPublicInfo = {
  id: UUID;
  username: string;
  display_name: string;
};

export type UserPublicKey = {
  public_key: string; // base64
};

export type ConversationSummary = {
  user_id: UUID;
  display_name: string;
  username: string;
  last_message_at: string | null;
};

export type EncryptedPayload = {
  ciphertext: string; // base64
  iv: string; // base64
  encryptedKey: string; // base64
  encryptedKeyForSelf: string; // base64
};

export type SendMessageRequest = {
  to: UUID;
  payload: EncryptedPayload;
};

export type MessageResponse = {
  id: UUID;
  from_user_id: UUID;
  to_user_id: UUID;
  payload: Record<string, unknown>;
  delivered: boolean;
  created_at: string; // ISO date-time
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function getApiErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const body = error.body as any;
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      const first = body.detail[0];
      if (typeof first?.msg === "string" && first.msg.length > 0) return first.msg;
    }
    if (typeof body?.detail === "string" && body.detail.length > 0) {
      return body.detail;
    }
    if (error.status === 409) return "Username is already taken.";
    if (error.status === 401) return "Invalid credentials.";
    return `Request failed (${error.status}).`;
  }

  if (error instanceof TypeError) {
    return "Network error. Check your internet connection or CORS/backend availability.";
  }

  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}

type RequestOptions = {
  accessToken?: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function toQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function requestJson<TResponse>(
  path: string,
  init: RequestInit,
  opts: RequestOptions = {},
): Promise<TResponse> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (opts.accessToken) {
    headers.set("Authorization", `Bearer ${opts.accessToken}`);
  }

  const res = await fetch(joinUrl(baseUrl, path), {
    ...init,
    headers,
    signal: opts.signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "detail" in (body as any)
        ? `Request failed (${res.status})`
        : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }

  return body as TResponse;
}

export const whisperbox = {
  register: (payload: RegisterRequest, opts?: RequestOptions) =>
    requestJson<AuthResponse>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, opts),

  login: (payload: LoginRequest, opts?: RequestOptions) =>
    requestJson<AuthResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, opts),

  me: (opts?: RequestOptions) =>
    requestJson<UserProfile>("/auth/me", { method: "GET" }, opts),

  refresh: (payload: RefreshRequest, opts?: RequestOptions) =>
    requestJson<TokenResponse>("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, opts),

  logout: (payload: RefreshRequest, opts?: RequestOptions) =>
    requestJson<Record<string, unknown>>("/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, opts),

  searchUsers: (q: string, opts?: RequestOptions) =>
    requestJson<UserPublicInfo[]>(
      `/users/search${toQuery({ q })}`,
      { method: "GET" },
      opts,
    ),

  getPublicKey: (userId: UUID, opts?: RequestOptions) =>
    requestJson<UserPublicKey>(`/users/${userId}/public-key`, { method: "GET" }, opts),

  listConversations: (opts?: RequestOptions) =>
    requestJson<ConversationSummary[]>("/conversations", { method: "GET" }, opts),

  getMessages: (
    userId: UUID,
    params: { limit?: number; before?: string | null } = {},
    opts?: RequestOptions,
  ) =>
    requestJson<MessageResponse[]>(
      `/conversations/${userId}/messages${toQuery({
        limit: params.limit ?? 50,
        before: params.before ?? undefined,
      })}`,
      { method: "GET" },
      opts,
    ),

  sendMessage: (payload: SendMessageRequest, opts?: RequestOptions) =>
    requestJson<MessageResponse>("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, opts),
};

