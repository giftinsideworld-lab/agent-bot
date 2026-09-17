// Claude OAuth (PKCE) — портировано 1:1 из provisioner/bot.js:260-613.
// Используется кнопкой «🔄 Переподключить Claude» в user-боте.
//
// Источник истины — провижнер; при изменении OAuth-параметров Anthropic
// синхронизировать обе копии.

import { randomBytes, createHash } from "node:crypto";
import https from "node:https";

export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
// Loopback redirect — никакой сервер не слушает, юзер копирует URL из адресной строки.
// platform.claude.com/oauth/code/callback имеет Next.js SSR, который потребляет код server-side,
// поэтому к моменту копирования юзером он уже использован → HTTP 500 при exchange.
export const OAUTH_REDIRECT_PORT = 16424;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;
export const OAUTH_SCOPES = "user:inference user:profile user:sessions:claude_code user:mcp_servers";

export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState() {
  return randomBytes(16).toString("hex");
}

export function buildAuthUrl(codeChallenge, state) {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: OAUTH_REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: OAUTH_SCOPES,
    state: state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code, codeVerifier, state) {
  const body = JSON.stringify({
    grant_type: "authorization_code",
    code: code,
    code_verifier: codeVerifier,
    redirect_uri: OAUTH_REDIRECT_URI,
    client_id: OAUTH_CLIENT_ID,
    state: state,
  });

  console.log(`[oauth] exchanging code (${code.slice(0, 15)}...) for token, state=${state.slice(0, 10)}...`);

  const data = await new Promise((resolve, reject) => {
    const url = new URL(OAUTH_TOKEN_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      family: 4,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let raw = "";
      res.on("data", (d) => raw += d);
      res.on("end", () => {
        console.log(`[oauth] response: HTTP ${res.statusCode}, body: ${raw.slice(0, 500)}`);
        let parsed;
        try { parsed = JSON.parse(raw); } catch {
          return reject(new Error(`Non-JSON response (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
        }
        if (res.statusCode >= 400 || !parsed.access_token) {
          let errMsg;
          if (parsed.error && typeof parsed.error === "object") {
            errMsg = parsed.error.message || parsed.error.type || JSON.stringify(parsed.error);
          } else {
            errMsg = parsed.error_description || parsed.error || parsed.message || "unknown";
          }
          errMsg = `HTTP ${res.statusCode}: ${errMsg}`;
          console.log(`[oauth] token exchange failed: ${errMsg}`);
          return reject(new Error(errMsg));
        }
        resolve(parsed);
      });
    });

    req.on("error", (e) => reject(new Error(`Network error: ${e.code || e.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("Token request timeout (30s)")); });
    req.write(body);
    req.end();
  });

  console.log(`[oauth] token received, prefix: ${data.access_token.slice(0, 15)}..., expires_in: ${data.expires_in}`);
  return data;
}
