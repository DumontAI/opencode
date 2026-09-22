// Branded HTML pages for local OAuth callback servers.
//
// These are served by the loopback HTTP servers that finish an OAuth exchange
// (MCP, Codex/ChatGPT, xAI, Snowflake, DigitalOcean, ...). The functions return
// a fully self-contained HTML string with no external assets, so they work
// offline and drop into any transport (`res.end(...)`, Effect `response.end`,
// etc.).
//
// The visual language mirrors the Dumont Code app: the design tokens are a curated
// subset of the OC-2 semantic tokens in `packages/ui/src/styles/theme.css`, and
// the wordmark is the same geometry as `packages/ui/src/components/logo.tsx`.
// Keep this file in sync with those sources when the brand changes.

export interface CallbackPageOptions {
  /** Friendly integration name shown as a subtitle, e.g. "xAI", "Snowflake", "MCP". */
  provider?: string
  /** Attempt to close the window shortly after success. Defaults to true. */
  autoClose?: boolean
}

export function success(options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization successful",
    body: renderCard({
      status: "success",
      headline: "Authorization successful",
      message: provider
        ? `Dumont Code is now connected to ${escapeHtml(provider)}.`
        : "Dumont Code is now authorized.",
      footnote: "You can close this window.",
    }),
    script: options?.autoClose === false ? undefined : AUTO_CLOSE_SCRIPT,
  })
}

export function error(detail: string, options?: CallbackPageOptions) {
  const provider = options?.provider
  return renderDocument({
    title: "Authorization failed",
    body: renderCard({
      status: "error",
      headline: "Authorization failed",
      message: provider
        ? `Dumont Code couldn't finish connecting to ${escapeHtml(provider)}.`
        : "Dumont Code couldn't complete authorization.",
      detail,
      footnote: "Close this window and try again from Dumont Code.",
    }),
  })
}

export interface BootstrapOptions {
  /** Same-origin path the in-browser script POSTs the parsed callback to. */
  tokenPath: string
  provider?: string
}

// For flows where the credential arrives in the URL fragment (implicit grant),
// the browser must relay it back to the loopback server. This renders a pending
// page whose script reads the fragment, POSTs it to `tokenPath`, then resolves
// to the success or error state in place.
export function bootstrap(options: BootstrapOptions) {
  return renderDocument({
    title: "Finishing sign-in",
    body: renderCard({
      status: "pending",
      headline: "Finishing sign-in",
      message: options.provider
        ? `Completing your ${escapeHtml(options.provider)} authorization.`
        : "Completing authorization.",
      footnote: "You can close this window once sign-in finishes.",
    }),
    script: bootstrapScript(options),
  })
}

export * as OauthCallbackPage from "./page"

type Status = "pending" | "success" | "error"

function renderCard(input: { status: Status; headline: string; message: string; detail?: string; footnote: string }) {
  const detail = input.detail?.trim()
  return `<main class="card" id="oc-card" data-status="${input.status}" role="status" aria-live="polite">
      <div class="brand">${WORDMARK}</div>
      <div class="status" aria-hidden="true">
        <span class="icon icon-pending">${ICON_SPINNER}</span>
        <span class="icon icon-success">${ICON_CHECK}</span>
        <span class="icon icon-error">${ICON_CROSS}</span>
      </div>
      <h1 class="headline" id="oc-headline">${escapeHtml(input.headline)}</h1>
      <p class="message" id="oc-message">${input.message}</p>
      <pre class="detail" id="oc-detail"${detail ? "" : " hidden"}>${detail ? escapeHtml(detail) : ""}</pre>
      <p class="footnote" id="oc-footnote">${escapeHtml(input.footnote)}</p>
    </main>`
}

function renderDocument(input: { title: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(input.title)} · Dumont Code</title>
    <style>${STYLES}</style>
  </head>
  <body>
    ${input.body}${input.script ? `\n    <script>${input.script}</script>` : ""}
  </body>
</html>`
}

const AUTO_CLOSE_SCRIPT = `setTimeout(function(){try{window.close()}catch(e){}},2500)`

function bootstrapScript(options: BootstrapOptions) {
  return `var PROVIDER=${scriptString(options.provider ?? "")};
var TOKEN_URL=new URL(${scriptString(options.tokenPath)},window.location.origin).href;
(function(){
  var card=document.getElementById("oc-card"),headline=document.getElementById("oc-headline"),message=document.getElementById("oc-message"),detail=document.getElementById("oc-detail"),footnote=document.getElementById("oc-footnote");
  function fail(text){card.dataset.status="error";headline.textContent="Authorization failed";message.textContent=PROVIDER?("Dumont Code couldn't finish connecting to "+PROVIDER+"."):"Dumont Code couldn't complete authorization.";if(text){detail.textContent=text;detail.hidden=false}footnote.textContent="Close this window and try again from Dumont Code."}
  function ok(){card.dataset.status="success";headline.textContent="Authorization successful";message.textContent=PROVIDER?("Dumont Code is now connected to "+PROVIDER+"."):"Dumont Code is now authorized.";detail.hidden=true;footnote.textContent="You can close this window.";setTimeout(function(){try{window.close()}catch(e){}},2500)}
  try{
    var hash=new URLSearchParams((window.location.hash||"").slice(1));
    var search=new URLSearchParams(window.location.search||"");
    var err=hash.get("error")||search.get("error");
    var errDescription=hash.get("error_description")||search.get("error_description");
    var body=err?{error:err,error_description:errDescription||""}:{access_token:hash.get("access_token")||"",expires_in:hash.get("expires_in")||"0",state:hash.get("state")||""};
    fetch(TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(res){
      if(!res.ok)return res.text().catch(function(){return""}).then(function(t){throw new Error(t||("callback failed ("+res.status+")"))});
      if(err){fail(errDescription||err);return}
      ok();
    }).catch(function(e){fail(String(e&&e.message?e.message:e))});
  }catch(e){fail(String(e&&e.message?e.message:e))}
})()`
}

function scriptString(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// Curated subset of OC-2 tokens (packages/ui/src/styles/theme.css). Default is
// light; dark applies via prefers-color-scheme. The [data-theme] selectors let a
// host force a scheme without changing the default.
const LIGHT_VARS = `
    --oc-bg: #f8f8f8;
    --oc-card: #fcfcfc;
    --oc-text-strong: #171717;
    --oc-text-base: #6f6f6f;
    --oc-text-weak: #8f8f8f;
    --oc-border-weak: #e5e5e5;
    --oc-icon-strong: #171717;
    --oc-icon-base: #8f8f8f;
    --oc-icon-weak: #dbdbdb;
    --oc-success: #2dba26;
    --oc-error: #ed4831;
    --oc-detail-bg: #fff8f6;
    --oc-detail-border: #fdc3b7;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.10), 0 6px 12px -2px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.06);`

const DARK_VARS = `
    --oc-bg: #101010;
    --oc-card: #161616;
    --oc-text-strong: rgba(255,255,255,.936);
    --oc-text-base: rgba(255,255,255,.618);
    --oc-text-weak: rgba(255,255,255,.422);
    --oc-border-weak: #282828;
    --oc-icon-strong: #ededed;
    --oc-icon-base: #7e7e7e;
    --oc-icon-weak: #343434;
    --oc-success: #12c905;
    --oc-error: #fc533a;
    --oc-detail-bg: #28110c;
    --oc-detail-border: #6a1206;
    --oc-shadow: 0 16px 48px -6px rgba(0,0,0,.55), 0 6px 12px -2px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.4);`

const STYLES = `
  :root { color-scheme: light dark;${LIGHT_VARS}
    --oc-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --oc-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${DARK_VARS} } }
  :root[data-theme="dark"] {${DARK_VARS} }
  :root[data-theme="light"] {${LIGHT_VARS} }

  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--oc-bg);
    color: var(--oc-text-base);
    font-family: var(--oc-font-sans);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .card {
    width: min(100%, 28rem);
    padding: 2.25rem 2rem 1.75rem;
    background: var(--oc-card);
    border: 1px solid var(--oc-border-weak);
    border-radius: 14px;
    box-shadow: var(--oc-shadow);
    text-align: center;
  }
  .brand { display: flex; justify-content: center; margin-bottom: 1.75rem; }
  .brand svg { height: 28px; width: auto; }
  .status { display: flex; justify-content: center; margin-bottom: 1.125rem; }
  .icon { display: none; line-height: 0; }
  .icon svg { display: block; }
  .card[data-status="pending"] .icon-pending,
  .card[data-status="success"] .icon-success,
  .card[data-status="error"] .icon-error { display: block; }
  .icon-success { color: var(--oc-success); }
  .icon-error { color: var(--oc-error); }
  .icon-pending { color: var(--oc-text-weak); }
  .headline { margin: 0; font-size: 1.1875rem; font-weight: 500; line-height: 1.3; letter-spacing: -0.012em; color: var(--oc-text-strong); }
  .message { margin: 0.5rem 0 0; font-size: 0.9375rem; color: var(--oc-text-base); }
  .detail {
    margin: 1.25rem 0 0;
    padding: 0.75rem 0.875rem;
    text-align: left;
    font-family: var(--oc-font-mono);
    font-size: 0.8125rem;
    line-height: 1.55;
    color: var(--oc-text-strong);
    background: var(--oc-detail-bg);
    border: 1px solid var(--oc-detail-border);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 9.5rem;
    overflow: auto;
  }
  .detail[hidden] { display: none; }
  .footnote { margin: 1.5rem 0 0; font-size: 0.8125rem; color: var(--oc-text-weak); }
  .spinner { animation: oc-spin 0.8s linear infinite; transform-origin: center; }
  @keyframes oc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
`

// Dumont Code wordmark. Same treatment as the desktop app: the winged D keeps
// brand teal so it matches the dock icon, the DUMONT letters follow the page
// tokens so they read on both the light and dark card.
const WORDMARK = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200.000000 300.000000" fill="none" aria-label="Dumont Code" role="img">
        <g transform="translate(0.000000,300.000000) scale(0.100000,-0.100000)" stroke="none">
          <path d="M305 2706 c-61 -61 2 -320 110 -452 31 -37 34 -46 25 -69 -44 -116
54 -381 187 -506 40 -38 145 -111 176 -122 17 -6 14 -12 -21 -52 -49 -56 -99
-157 -123 -249 -24 -92 -28 -666 -5 -751 36 -136 118 -215 254 -244 84 -18
992 -15 1107 4 104 17 216 44 229 57 6 4 17 8 25 8 24 0 198 90 278 143 80 55
222 189 270 257 145 205 204 347 237 575 86 594 -259 1168 -815 1355 -192 65
-175 64 -1081 68 l-828 3 -25 -25z m1684 -181 c150 -22 351 -95 412 -151 8 -8
21 -14 28 -14 20 0 235 -221 279 -286 189 -284 230 -659 105 -973 -133 -336
-440 -589 -778 -641 -45 -7 -256 -10 -597 -8 l-528 3 -32 33 -33 32 0 353 0
352 34 68 c73 144 167 211 245 176 26 -12 43 -49 65 -144 18 -75 77 -189 133
-256 369 -444 1066 -268 1183 299 74 357 -172 724 -545 814 -28 7 -253 13
-595 17 l-550 6 -70 33 c-113 53 -213 168 -239 275 l-6 27 691 0 c570 0 710
-3 798 -15z m-1319 -475 c77 -41 117 -44 700 -50 l565 -5 72 -31 c140 -61 239
-162 295 -303 33 -85 33 -263 -2 -341 -201 -456 -816 -394 -934 95 -45 185
-109 246 -276 264 -203 20 -339 112 -420 282 -40 86 -41 111 0 89z" fill="#41b8b0" />
          <path d="M1715 1731 c-197 -89 -213 -339 -30 -460 54 -36 187 -38 250 -4 190
102 178 378 -21 463 -58 25 -145 26 -199 1z" fill="#41b8b0" />
          <path d="M8173 2161 c-355 -96 -562 -434 -488 -795 68 -328 326 -536 664 -536
244 0 447 106 573 299 131 201 141 520 22 718 -93 153 -213 248 -389 308 -80
27 -291 30 -382 6z m342 -309 c134 -68 205 -243 176 -431 -29 -183 -153 -294
-331 -295 -194 -1 -307 94 -347 289 -43 208 48 392 227 459 39 14 235 -1 275
-22z" fill="var(--oc-icon-base)" />
          <path d="M3307 2163 c-4 -3 -7 -303 -7 -666 l0 -659 328 4 c267 4 338 8 387
22 219 62 377 214 451 436 27 78 26 319 0 405 -80 259 -261 406 -555 450 -103
15 -590 22 -604 8z m669 -320 c71 -36 111 -79 150 -159 25 -53 28 -70 28 -169
2 -194 -48 -286 -194 -357 -63 -30 -69 -31 -200 -32 l-135 -1 -3 378 -2 379
147 -4 c141 -4 151 -6 209 -35z" fill="var(--oc-icon-base)" />
          <path d="M4664 2156 c-3 -8 -4 -216 -1 -463 3 -418 5 -452 24 -510 78 -236
254 -353 528 -353 280 0 478 141 539 386 13 51 16 138 16 508 l0 446 -160 0
-160 0 0 -415 c0 -451 -4 -491 -51 -549 -79 -95 -245 -106 -347 -23 -8 6 -23
29 -35 51 -21 40 -22 53 -27 486 l-5 445 -158 3 c-130 2 -158 0 -163 -12z" fill="var(--oc-icon-base)" />
          <path d="M6000 1505 l0 -665 160 0 160 0 0 381 c0 216 4 378 9 375 5 -3 16
-29 26 -58 9 -29 36 -102 60 -163 23 -60 59 -155 80 -210 20 -55 40 -109 45
-120 4 -11 23 -60 42 -110 l34 -90 132 -3 c120 -2 133 -1 138 15 3 10 10 27
14 38 5 11 66 175 137 365 l128 345 3 -382 2 -383 160 0 160 0 0 665 0 665
-186 0 -185 0 -15 -37 c-8 -21 -21 -51 -28 -68 -8 -16 -27 -66 -44 -110 -26
-67 -61 -154 -101 -250 -5 -11 -19 -45 -31 -75 -11 -30 -25 -64 -30 -75 -4
-11 -32 -80 -61 -152 -29 -73 -55 -133 -59 -133 -9 0 -9 0 -195 460 -25 63
-73 183 -107 265 -33 83 -65 156 -70 163 -8 9 -59 12 -194 12 l-184 0 0 -665z" fill="var(--oc-icon-base)" />
          <path d="M9210 1505 l0 -665 160 0 160 0 0 395 c0 217 3 395 8 394 4 0 84
-116 177 -258 94 -142 211 -318 260 -392 l90 -134 163 -3 162 -2 0 665 0 665
-160 0 -160 0 0 -400 c0 -242 -4 -400 -9 -400 -6 0 -36 39 -67 88 -32 48 -118
179 -192 292 -74 113 -160 243 -190 290 -92 141 -71 130 -249 130 l-153 0 0
-665z" fill="var(--oc-icon-base)" />
          <path d="M10557 2163 c-4 -3 -7 -64 -7 -135 l0 -128 175 0 175 0 0 -530 0
-530 163 0 162 0 0 527 0 528 175 5 175 5 0 130 0 130 -506 3 c-278 1 -509 -1
-512 -5z" fill="var(--oc-icon-base)" />
        </g>
      </svg>`

const ICON_CHECK = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.4 2.4 4.6-5.4" /></svg>`

const ICON_CROSS = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>`

const ICON_SPINNER = `<svg class="spinner" viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.2" /><path d="M21 12a9 9 0 0 0-9-9" /></svg>`
