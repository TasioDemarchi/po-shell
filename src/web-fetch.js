// web_fetch: the explorer's only window to the web, read-only and bounded.
//
// A child with network is a child that can exfiltrate, so the limits are half
// the feature: public destinations only, every redirect re-validated with the
// same rule, a byte cap and a time cap per request, an in-memory cache and a
// per-process egress budget. Nothing is written to disk and nothing is logged.
//
// Every failure is a value — `{ ok: false, error }` with a short Spanish reason
// a child can act on — never an exception that would kill the child.
//
// The rules here are a policy, not a sandbox: validation happens before the
// request, so a DNS rebinding that flips between the lookup and the connection
// is declared out of reach.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_BUDGET = 10;
const MAX_HEADINGS = 20;
const MAX_LINKS = 30;
const JS_SHELL_CHARS = 200;
const JS_SHELL_SCRIPTS = 3;
const EXTRACTS = ["structure", "text", "links"];
// No cookies, no Authorization, no header of the user: what the parent's
// session knows never leaves with the child.
const ACCEPT = "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1";

/** Parsed pages, keyed by normalized URL: two reads of the same URL cost one request. */
const pageCache = new Map();
/** Egress budget, per process: 10 actual requests, redirects included. */
const processBudget = { used: 0, limit: DEFAULT_BUDGET };

function reason(error) {
  return error instanceof Error ? error.message : String(error ?? "error desconocido");
}

function positive(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function settingsOf(options = {}) {
  const maxRedirects = Math.trunc(Number(options.maxRedirects));
  return {
    extract: EXTRACTS.includes(options.extract) ? options.extract : "structure",
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    lookup: options.lookup ?? dnsLookup,
    timeoutMs: positive(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxBytes: positive(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRedirects: Number.isFinite(maxRedirects) && maxRedirects >= 0 ? maxRedirects : DEFAULT_MAX_REDIRECTS,
    budget: budgetOf(options.budget),
  };
}

/** The injected counter (tests) or the process-wide one. Mutated in place. */
function budgetOf(injected) {
  if (!injected || typeof injected !== "object") return processBudget;
  if (!Number.isFinite(Number(injected.limit)) || Number(injected.limit) <= 0) injected.limit = DEFAULT_BUDGET;
  if (!Number.isFinite(Number(injected.used)) || Number(injected.used) < 0) injected.used = 0;
  return injected;
}

function normalizeUrl(value) {
  try {
    return { ok: true, url: new URL(value).href };
  } catch {
    return { ok: false, error: `url inválida: ${value} no es una URL completa (hace falta http:// o https://)` };
  }
}

function unbracket(hostname) {
  return String(hostname ?? "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * The IPv4 address hiding inside `value`, or null: dotted quads as they come,
 * and the IPv4-mapped IPv6 forms (`::ffff:c0a8:10a` is `192.168.1.10`).
 */
function toDottedQuad(value) {
  const source = String(value ?? "").trim().toLowerCase();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(source)) return source;
  const mapped = /^::ffff:(.+)$/.exec(source);
  if (!mapped) return null;
  const tail = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(tail)) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * True for loopback, private, link-local and IPv6 ULA addresses, plus the
 * IPv4-mapped forms of all of them. An unknown address counts as private:
 * failing closed is the only safe default for an egress check.
 */
function isPrivateAddress(address) {
  const value = unbracket(address).replace(/%.*$/, "");
  if (!value) return true;

  const v4 = toDottedQuad(value);
  if (v4) {
    const parts = v4.split(".").map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (value === "::" || value === "::1") return true;
  if (/^fe[89ab]/.test(value)) return true; // fe80::/10, link-local
  if (/^f[cd]/.test(value)) return true; // fc00::/7, unique-local
  return false;
}

function blockedName(host) {
  const name = host.replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) {
    return "localhost queda fuera: la tool lee solo direcciones públicas";
  }
  if (name === "local" || name.endsWith(".local")) {
    return `${name} es un nombre local (*.local), no una dirección pública; usá la URL real del sitio`;
  }
  return null;
}

async function inspectDestination(value, lookup) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    return { ok: false, error: `url inválida: ${value} no es una URL completa (hace falta http:// o https://)` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `solo http y https: ${parsed.protocol.replace(/:$/, "")} no se puede leer desde acá` };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: "la URL trae usuario o clave embebidos; esa credencial no viaja: quitala y volvé a pedir la página",
    };
  }

  const host = unbracket(parsed.hostname);
  if (!host) return { ok: false, error: "la URL no trae host: falta el dominio" };

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      const label = toDottedQuad(host) ?? host;
      return { ok: false, error: `${label} es una dirección privada o reservada; la tool solo lee direcciones públicas` };
    }
    return { ok: true, url: parsed.href };
  }

  const byName = blockedName(host);
  if (byName) return { ok: false, error: byName };

  let addresses;
  try {
    const found = await lookup(host, { all: true });
    addresses = Array.isArray(found) ? found : [found];
  } catch {
    return { ok: false, error: `no se pudo resolver ${host}: revisá el nombre o probá otra URL` };
  }
  if (!addresses.length) {
    return { ok: false, error: `no se pudo resolver ${host}: el DNS no devolvió ninguna dirección` };
  }
  // One private (or unknown) answer is enough: the host could be talking to anything.
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry.trim() : String(entry?.address ?? "").trim();
    if (!address) {
      return { ok: false, error: `no se pudo resolver ${host}: el DNS devolvió una dirección vacía` };
    }
    if (isPrivateAddress(address)) {
      return { ok: false, error: `${host} resuelve a ${address}, una dirección privada o reservada; se rechaza` };
    }
  }
  return { ok: true, url: parsed.href };
}

/**
 * Public destination check, the same rule before the first request and before
 * every redirect hop. Returns a value: `{ ok: true, url }` or `{ ok: false, error }`.
 */
export async function assertPublicUrl(url, { lookup = dnsLookup } = {}) {
  try {
    return await inspectDestination(url, lookup);
  } catch (error) {
    return { ok: false, error: `no se pudo validar la URL: ${reason(error)}` };
  }
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** The handful of entities real pages use, plus numeric refs, decoded once. */
export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (match, body) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
      if (code === 160) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return ENTITIES.get(body.toLowerCase()) ?? match;
  });
}

// Tags whose content is never readable text. `head` goes too: the title, the
// meta and the canonical already have their own fields.
const NOISE_TAGS = ["script", "style", "nav", "template", "noscript", "svg", "head"];
const NOISE_BLOCK = new RegExp(`<(${NOISE_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
const NOISE_OPEN = new RegExp(`<(${NOISE_TAGS.join("|")})\\b[\\s\\S]*$`, "i");

/** Readable text: noise and comments out, entities decoded, whitespace collapsed. */
export function htmlToText(html) {
  const value = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(NOISE_BLOCK, " ")
    // A body cut by the byte cap leaves the tag open: drop the rest of it.
    .replace(NOISE_OPEN, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function attributes(tag) {
  const found = {};
  for (const match of String(tag).matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g,
  )) {
    found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return found;
}

function metaTags(html) {
  return [...String(html ?? "").matchAll(/<meta\b[^>]*>/gi)].map((match) => attributes(match[0]));
}

function metaContent(metas, attribute, key) {
  const wanted = key.toLowerCase();
  const hit = metas.find((meta) => String(meta[attribute] ?? "").toLowerCase() === wanted);
  const content = hit?.content;
  return typeof content === "string" && content.trim() ? decodeEntities(content).trim() : null;
}

function resolveHref(href, baseUrl) {
  const value = decodeEntities(String(href ?? "").trim());
  if (!value || value.startsWith("#") || /^(?:javascript|data|mailto|tel|about):/i.test(value)) return null;
  try {
    const url = new URL(value, baseUrl || undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Outgoing links: absolute against `baseUrl`, http(s) only, deduplicated, capped. */
export function htmlToLinks(html, baseUrl = "") {
  const seen = new Set();
  const links = [];
  for (const match of String(html ?? "").matchAll(/<a\b[^>]*>/gi)) {
    const absolute = resolveHref(attributes(match[0]).href, baseUrl);
    if (!absolute || seen.has(absolute)) continue;
    seen.add(absolute);
    links.push(absolute);
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

function canonicalOf(html, baseUrl) {
  for (const match of String(html ?? "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = attributes(match[0]);
    const rel = String(tag.rel ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("canonical")) {
      const absolute = resolveHref(tag.href, baseUrl);
      if (absolute) return absolute;
    }
  }
  return null;
}

/** The whole structure the tool needs, still as data: `{ title, description, canonical, og, headings, links, text }`. */
export function htmlToStructure(html, baseUrl = "") {
  const source = String(html ?? "");
  const metas = metaTags(source);

  const titleHtml = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? "";
  const title = htmlToText(titleHtml) || null;

  const og = {};
  for (const meta of metas) {
    const property = String(meta.property ?? "").toLowerCase();
    if (!property.startsWith("og:") || !meta.content) continue;
    if (property in og) continue; // the first one wins, the way browsers read it
    og[property] = decodeEntities(meta.content).trim();
  }

  const headings = [];
  for (const match of source.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = htmlToText(match[2]);
    if (!text) continue;
    headings.push({ level: Number(match[1]), text });
    if (headings.length >= MAX_HEADINGS) break;
  }

  return {
    title,
    description: metaContent(metas, "name", "description") ?? metaContent(metas, "property", "og:description"),
    canonical: canonicalOf(source, baseUrl),
    og,
    headings,
    links: htmlToLinks(source, baseUrl),
    text: htmlToText(source),
  };
}

/** Few readable characters plus several scripts: the page renders itself with JS. */
function looksLikeJsShell(html, text) {
  const scripts = (String(html ?? "").match(/<script\b/gi) ?? []).length;
  return text.length < JS_SHELL_CHARS && scripts >= JS_SHELL_SCRIPTS;
}

function httpError(status) {
  if (status === 404) return "la página respondió 404: esa URL no existe; revisá el path o probá la raíz del sitio";
  if (status === 401 || status === 403) return `la página respondió ${status}: pide login o bloquea el acceso, no hay nada que leer acá`;
  if (status === 429) return "la página respondió 429: pide esperar; no reintentes, citá la fuente y seguí";
  if (status >= 500) return `la página respondió ${status}: el servidor falló, no es tu URL; probá más tarde`;
  return `la página respondió ${status}: no hay contenido que leer`;
}

/** Read at most `maxBytes` off the stream; never `await res.text()` on an unbounded body. */
async function readBody(response, maxBytes) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    return { html: "", bytes: 0, truncated: false };
  }
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const room = maxBytes - bytes;
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        bytes = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        // The stream is already gone; nothing to free.
      }
    }
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { html: new TextDecoder("utf-8").decode(merged), bytes, truncated };
}

async function requestOnce(url, settings) {
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  const onTimeout = () => controller.abort(timeout.reason ?? new Error("timeout"));
  if (timeout.aborted) onTimeout();
  else timeout.addEventListener("abort", onTimeout, { once: true });
  const timedOut = () => timeout.aborted;

  try {
    const response = await settings.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: ACCEPT },
    });

    const status = Number(response?.status) || 0;
    const headers = response?.headers;
    const location = typeof headers?.get === "function" ? headers.get("location") : null;

    if (status >= 300 && status < 400) {
      try {
        await response.body?.cancel?.();
      } catch {
        // A redirect body is not worth reading, and not worth failing over.
      }
      return { ok: true, status, location: location || null };
    }
    if (status < 200 || status >= 300) {
      try {
        await response.body?.cancel?.();
      } catch {
        // Same: the status is the answer.
      }
      return { ok: false, error: status ? httpError(status) : "la respuesta no trajo un status HTTP" };
    }

    const body = await readBody(response, settings.maxBytes);
    const structure = htmlToStructure(body.html, url);
    return {
      ok: true,
      status,
      location: null,
      html: body.html,
      bytes: body.bytes,
      truncated: body.truncated,
      structure,
      jsShell: looksLikeJsShell(body.html, structure.text),
    };
  } catch (error) {
    if (timedOut() || error?.name === "TimeoutError" || error?.name === "AbortError") {
      return {
        ok: false,
        error: `timeout: la página no respondió en ${settings.timeoutMs} ms; probá otra URL o pedí la fuente en Markdown`,
      };
    }
    return { ok: false, error: `no se pudo leer ${url}: ${reason(error)}` };
  } finally {
    timeout.removeEventListener("abort", onTimeout);
  }
}

async function download(startUrl, settings) {
  const budget = settings.budget;
  let current = startUrl;
  let redirects = 0;
  let requests = 0;

  for (;;) {
    if (budget.used >= budget.limit) {
      return {
        ok: false,
        error: `presupuesto de red agotado: ${budget.limit} requests por proceso (redirects incluidos) y ya se usaron todos; devolvé al padre lo que tengas`,
      };
    }
    // The same rule for the first URL and for every hop: a redirect to a
    // private destination is an error, never a warning.
    const destination = await assertPublicUrl(current, { lookup: settings.lookup });
    if (!destination.ok) return destination;
    current = destination.url;

    budget.used += 1;
    requests += 1;
    const response = await requestOnce(current, settings);
    if (!response.ok) return response;

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) {
        return { ok: false, error: `la página respondió ${response.status} sin Location: no hay a dónde ir` };
      }
      if (redirects >= settings.maxRedirects) {
        return {
          ok: false,
          error: `más de ${settings.maxRedirects} redirects: la página no llega a ningún lado; pedile al padre la URL final`,
        };
      }
      const next = resolveHref(response.location, current);
      if (!next) return { ok: false, error: "el redirect apunta a una URL inválida o a otro esquema" };
      redirects += 1;
      current = next;
      continue;
    }

    return {
      ok: true,
      requests,
      page: {
        url: current,
        status: response.status,
        truncated: response.truncated,
        jsShell: response.jsShell,
        bytes: response.bytes,
        structure: response.structure,
      },
    };
  }
}

// `extract` narrows what comes back: structure is everything, text and links
// stay tiny on purpose — a child's context is the budget.
function present(page, extract, requests) {
  const structure = page.structure;
  const result = {
    ok: true,
    url: page.url,
    status: page.status,
    title: structure.title,
    description: structure.description,
    canonical: structure.canonical,
    og: structure.og,
    headings: structure.headings,
    links: structure.links,
    text: structure.text,
    truncated: page.truncated,
    jsShell: page.jsShell,
    bytes: page.bytes,
    requests,
  };
  if (extract === "text") {
    for (const key of ["description", "canonical", "og", "headings", "links"]) delete result[key];
  }
  if (extract === "links") {
    for (const key of ["description", "canonical", "og", "headings", "text"]) delete result[key];
  }
  return result;
}

async function runPage(input, options) {
  const settings = settingsOf(options ?? {});
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "falta la url: pasá una URL http o https, por ejemplo https://nodejs.org/api/fs.html" };
  }
  const normalized = normalizeUrl(raw);
  if (!normalized.ok) return normalized;

  const cached = pageCache.get(normalized.url);
  if (cached) return present(cached, settings.extract, 0);

  const fetched = await download(normalized.url, settings);
  if (!fetched.ok) return fetched;
  pageCache.set(normalized.url, fetched.page);
  return present(fetched.page, settings.extract, fetched.requests);
}

/**
 * Read one public page and return it as data. Never throws.
 *
 * Options: `extract` (structure | text | links), `fetchImpl` and `lookup` (both
 * injectable, so a test never touches the network), `timeoutMs`, `maxBytes`,
 * `maxRedirects`, and `budget` — a mutable `{ used, limit }` counter instead of
 * the process-wide one, for tests.
 *
 * ok: `{ ok: true, url, status, title, description, canonical, og, headings,
 * links, text, truncated, jsShell, bytes, requests }` — narrowed by `extract`.
 * Otherwise: `{ ok: false, error }` with a short Spanish reason.
 */
export async function fetchPage(url, options = {}) {
  try {
    return await runPage(url, options);
  } catch (error) {
    return { ok: false, error: `no se pudo leer la página: ${reason(error)}` };
  }
}
