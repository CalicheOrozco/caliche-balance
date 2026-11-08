import { createHash } from "node:crypto";
import type { Response } from "express";

/*
 * The page Claude opens to connect: sign in with the Caliche Balance username and password and
 * allow access. In the app's look (dark green, Manrope) and in Spanish or English, after the
 * browser's language.
 */

export type PageLang = "es" | "en";

const TEXT = {
  es: {
    title: "Conectar Caliche Balance",
    heading: "Conectar con Claude",
    lead: (client: string) =>
      `<strong>${client}</strong> quiere usar tu cuenta de Caliche Balance: leer y agregar tus pesadas, metas, estudios de laboratorio, datos de Apple Salud y logros.`,
    back: (host: string) => `Al terminar vuelves a <strong>${host}</strong>`,
    username: "Nombre de usuario",
    password: "Contraseña",
    show: "Mostrar",
    hide: "Ocultar",
    allow: "Entrar y permitir",
    cancel: "Cancelar",
  },
  en: {
    title: "Connect Caliche Balance",
    heading: "Connect to Claude",
    lead: (client: string) =>
      `<strong>${client}</strong> wants to use your Caliche Balance account: read and add your weigh-ins, goals, lab studies, Apple Health data and badges.`,
    back: (host: string) => `You will be sent back to <strong>${host}</strong>`,
    username: "Username",
    password: "Password",
    show: "Show",
    hide: "Hide",
    allow: "Sign in and allow",
    cancel: "Cancel",
  },
};

export const LOGIN_ERRORS = {
  es: {
    missing: "Escribe tu nombre de usuario y tu contraseña.",
    wrong: "El usuario o la contraseña no son correctos.",
    tooMany: "Demasiados intentos. Espera unos minutos y vuelve a intentar.",
    invalid: "Este enlace para entrar no es válido. Empieza otra vez desde Claude.",
    expired: "Este enlace para entrar caducó. Empieza otra vez desde Claude.",
    noProfile: "Primero completa tu perfil en la app de Caliche Balance.",
  },
  en: {
    missing: "Enter your username and password.",
    wrong: "The username or password is not correct.",
    tooMany: "Too many attempts. Wait a few minutes and try again.",
    invalid: "This sign-in link is not valid. Start again from Claude.",
    expired: "This sign-in link expired. Start again from Claude.",
    noProfile: "Finish your profile in the Caliche Balance app first.",
  },
};

export function pageLang(acceptLanguage: string | undefined): PageLang {
  return (acceptLanguage ?? "").toLowerCase().startsWith("en") ? "en" : "es";
}

const showPassword = (lang: PageLang) =>
  `const i=this.previousElementSibling;const s=i.type==='password';i.type=s?'text':'password';this.textContent=s?'${TEXT[lang].hide}':'${TEXT[lang].show}'`;
const hashOf = (script: string) => createHash("sha256").update(script).digest("base64");

/** The page cannot be framed, runs only its one inline handler, and its form only posts back here or to where the sign-in returns. */
export function sendPage(res: Response, status: number, html: string, lang: PageLang, redirectUri?: string) {
  let returnTo = "";
  try {
    if (redirectUri) returnTo = ` ${new URL(redirectUri).origin}`;
  } catch {
    // A redirect that is not a URL adds nothing to the allowed form targets.
  }
  res
    .status(status)
    .set({
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; script-src 'unsafe-hashes' 'sha256-${hashOf(showPassword(lang))}'; form-action 'self'${returnTo}; frame-ancestors 'none'; base-uri 'none'`,
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    })
    .type("html")
    .send(html);
}

const escape = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderLogin(input: {
  lang: PageLang;
  request?: string;
  clientName?: string;
  redirectHost?: string;
  username?: string;
  error?: string;
  fatal?: string;
}): string {
  const t = TEXT[input.lang];
  const body = input.fatal
    ? `<p class="error" role="alert">${escape(input.fatal)}</p>`
    : `
      <p class="lead">${t.lead(escape(input.clientName))}</p>
      <p class="host">${t.back(escape(input.redirectHost))}</p>
      ${input.error ? `<p class="error" role="alert">${escape(input.error)}</p>` : ""}
      <form method="post" action="/api/oauth/login">
        <input type="hidden" name="request" value="${escape(input.request)}">
        <label>${t.username}<input name="username" autocomplete="username" autocapitalize="none" value="${escape(input.username)}" required></label>
        <label>${t.password}
          <span class="pw">
            <input name="password" type="password" autocomplete="current-password" required>
            <button type="button" class="eye" onclick="${showPassword(input.lang)}">${t.show}</button>
          </span>
        </label>
        <button class="primary" name="action" value="allow">${t.allow}</button>
        <button class="secondary" name="action" value="deny" formnovalidate>${t.cancel}</button>
      </form>`;

  return `<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
  @font-face{font-family:Manrope;font-weight:200 800;font-display:swap;src:url("/fonts/manrope-latin.woff2") format("woff2")}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:#050807;color:#edf3ef;font:15px/1.5 Manrope,system-ui,sans-serif}
  main{width:100%;max-width:400px;display:flex;flex-direction:column;gap:18px}
  .brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px}
  .brand img{width:40px;height:40px;border-radius:12px}
  .brand span{color:#2dc26b}
  h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em}
  .lead{margin:0;color:#b0beb6;font-weight:600}
  .host{margin:0;font-size:13px;color:#85948b;font-weight:600}
  form{display:flex;flex-direction:column;gap:14px}
  label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:#b0beb6}
  input{height:54px;padding:0 16px;border-radius:16px;background:#0e1411;border:1px solid #1d2722;color:#edf3ef;font:inherit;font-size:16px;font-weight:600;outline:none;width:100%}
  input:focus{border:2px solid #2dc26b}
  .pw{position:relative;display:block}
  .pw input{padding-right:84px}
  .eye{position:absolute;right:6px;top:9px;height:36px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:#85948b;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
  .primary{height:56px;border:0;border-radius:18px;background:#2dc26b;color:#03140a;font:inherit;font-size:17px;font-weight:800;cursor:pointer}
  .secondary{height:52px;border:0;border-radius:18px;background:#172019;color:#edf3ef;font:inherit;font-weight:700;cursor:pointer}
  .error{margin:0;padding:12px 16px;border-radius:16px;background:rgba(240,114,114,.14);color:#f07272;font-weight:600}
  :focus-visible{outline:2px solid #2dc26b;outline-offset:2px}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="/icon-192.png" alt=""><div><span>Caliche</span> Balance</div></div>
  <h1>${t.heading}</h1>
  ${body}
</main>
</body>
</html>`;
}
