import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  decodeEntities,
  fetchPage,
  htmlToLinks,
  htmlToStructure,
  htmlToText,
} from "../src/web-fetch.js";
import { WEB_TOOLS, roleTools } from "../src/subagent-roles.js";
import { subagentToolBlock } from "../src/subagent-policy.js";

// No test in this file touches the network: every fetch is a stub and every
// hostname is resolved by an injected `lookup`. The cases are the limits in
// docs/features/explorer-web.md, one by one.

/** Public by default; only the names listed here are private. */
async function lookup(host) {
  if (host === "rebind.example") return [{ address: "10.0.0.5", family: 4 }];
  if (host === "mixed.example") {
    return [
      { address: "93.184.216.34", family: 4 },
      { address: "fd00::1", family: 6 },
    ];
  }
  return [{ address: "93.184.216.34", family: 4 }];
}

/** A fresh counter per test: the module's budget is per process and shared. */
const freshBudget = (limit = 10) => ({ used: 0, limit });

function html(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

/** A stub that answers by URL and remembers every call, so "no request" is provable. */
function stub(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route == null) throw new Error(`the test stub has no route for ${url}`);
    return typeof route === "function" ? route(url) : route;
  };
  impl.calls = calls;
  return impl;
}

const DOCS_PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Leer archivos &amp; streams | Node.js v22</title>
  <meta name="description" content="La API fs promete leer archivos sin bloquear el event loop.">
  <link rel="canonical" href="https://nodejs.org/api/fs.html">
  <meta property="og:title" content="Módulo fs">
  <meta property="og:type" content="article">
  <meta property="og:image" content="https://nodejs.org/static/images/logo.svg">
  <style>body { color: #333 }</style>
  <script>window.analytics = { id: "gtm-1" };</script>
</head>
<body>
  <nav><a href="/docs/">Docs</a><a href="/api/">API</a></nav>
  <header><h1>Módulo <code>fs</code></h1></header>
  <main>
    <h2>fs.promises.readFile</h2>
    <p>Lee un archivo entero y devuelve un Buffer. Usá &quot;UTF-8&quot; como encoding.</p>
    <h3 id="errores">Errores &#38; cierres</h3>
    <p>Si el archivo no existe, la promesa rechaza con ENOENT.</p>
    <template><p>secreto del template</p></template>
    <noscript><p>activá JS</p></noscript>
    <svg><text>icono</text></svg>
    <!-- comentario que no se lee -->
    <a href="/api/fs.html#clase-fs">Clase fs</a>
    <a href="/api/fs.html#clase-fs">Clase fs</a>
    <a href="https://github.com/nodejs/node">Código</a>
    <a href="javascript:void(0)">nada</a>
    <a href="#top">arriba</a>
  </main>
</body>
</html>`;

const LANDING_PAGE = `<!doctype html>
<html lang="es">
<head>
  <title>Po — el harness que no te miente</title>
  <meta name="Description" content="Tareas, memoria y reviews congeladas para agentes de código.">
  <meta property="og:title" content="Po Shell">
  <meta property="og:description" content="Un harness determinista.">
  <meta property="og:url" content="https://po.example/">
  <link rel="canonical" href="https://po.example/">
  <script src="/app.js"></script>
</head>
<body>
  <h1>El harness que no te miente</h1>
  <h2>Qué hace</h2>
  <p>Plan, delegación, verificación&nbsp;y reviews que se pueden volver a correr.</p>
  <a href="/precios">Precios</a>
  <a href="https://docs.po.example/guia">Guía</a>
</body>
</html>`;

// ---------------------------------------------------------------------------
// U1 — destination validation (the SSRF limit), before any request
// ---------------------------------------------------------------------------

const REFUSED = [
  ["file:///etc/passwd", /solo http y https/],
  ["ftp://example.com/dump.txt", /solo http y https/],
  ["https://user:secret@example.com/docs", /usuario o clave/],
  ["http://localhost:3000/x", /localhost queda fuera/],
  ["http://docs.local/", /nombre local/],
  ["http://127.0.0.1/", /127\.0\.0\.1 es una dirección privada/],
  ["https://10.0.0.5/admin", /10\.0\.0\.5 es una dirección privada/],
  ["http://192.168.1.10/", /192\.168\.1\.10 es una dirección privada/],
  ["http://172.16.4.4/", /172\.16\.4\.4 es una dirección privada/],
  ["http://169.254.1.1/latest/meta-data", /169\.254\.1\.1 es una dirección privada/],
  ["http://0.0.0.0:8080/", /0\.0\.0\.0 es una dirección privada/],
  ["http://[::1]/", /::1 es una dirección privada/],
  ["http://[fe80::1]/", /fe80::1 es una dirección privada/],
  ["http://[fd00::1]/", /fd00::1 es una dirección privada/],
  ["http://[::ffff:192.168.1.10]/", /192\.168\.1\.10 es una dirección privada/],
];

test("every non-public destination is refused before a single request", async () => {
  for (const [url, expected] of REFUSED) {
    const result = await assertPublicUrl(url, { lookup });
    assert.equal(result.ok, false, `${url} must be refused`);
    assert.match(result.error, expected, `${url} → ${result.error}`);
    assert.equal("url" in result, false);
  }
});

test("a hostname that resolves to a private address is refused, even next to a public one", async () => {
  const rebind = await assertPublicUrl("https://rebind.example/docs", { lookup });
  assert.equal(rebind.ok, false);
  assert.match(rebind.error, /rebind\.example resuelve a 10\.0\.0\.5/);

  const mixed = await assertPublicUrl("https://mixed.example/docs", { lookup });
  assert.equal(mixed.ok, false, "one private answer is enough");
  assert.match(mixed.error, /fd00::1/);

  const publicOne = await assertPublicUrl("https://nodejs.org/api/fs.html", { lookup });
  assert.deepEqual(publicOne, { ok: true, url: "https://nodejs.org/api/fs.html" });
});

test("an unresolvable host, an empty url and a bad scheme never throw", async () => {
  const broken = await assertPublicUrl("https://nope.example/", {
    lookup: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /no se pudo resolver nope\.example/);

  assert.match((await fetchPage("", { lookup, budget: freshBudget() })).error, /falta la url/);
  assert.match((await fetchPage("no-es-una-url", { lookup, budget: freshBudget() })).error, /url inválida/);

  // A lookup that answers with nothing usable fails closed instead of passing.
  for (const answer of [[], [{}]]) {
    const empty = await assertPublicUrl("https://blank.example/", { lookup: async () => answer });
    assert.equal(empty.ok, false, `lookup ${JSON.stringify(answer)} must not validate a host`);
  }
});

// ---------------------------------------------------------------------------
// U1 — redirects: up to three, each hop re-validated as strictly as the first
// ---------------------------------------------------------------------------

test("a chain of three redirects is followed and the final URL is reported", async () => {
  const fetchImpl = stub({
    "https://docs.example/a": redirect("https://docs.example/b"),
    "https://docs.example/b": redirect("/c", 301),
    "https://docs.example/c": redirect("d", 307),
    "https://docs.example/d": html(DOCS_PAGE),
  });

  const result = await fetchPage("https://docs.example/a", { fetchImpl, lookup, budget: freshBudget() });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.url, "https://docs.example/d");
  assert.equal(result.status, 200);
  assert.equal(result.requests, 4, "three redirects plus the page, all counted");
  assert.deepEqual(fetchImpl.calls, [
    "https://docs.example/a",
    "https://docs.example/b",
    "https://docs.example/c",
    "https://docs.example/d",
  ]);
});

test("a fourth redirect is refused instead of followed", async () => {
  const fetchImpl = stub({
    "https://docs.example/1": redirect("/2"),
    "https://docs.example/2": redirect("/3"),
    "https://docs.example/3": redirect("/4"),
    "https://docs.example/4": redirect("/5"),
    "https://docs.example/5": html("<h1>nunca</h1>"),
  });

  const result = await fetchPage("https://docs.example/1", { fetchImpl, lookup, budget: freshBudget() });
  assert.equal(result.ok, false);
  assert.match(result.error, /más de 3 redirects/);
  assert.deepEqual(fetchImpl.calls, [
    "https://docs.example/1",
    "https://docs.example/2",
    "https://docs.example/3",
    "https://docs.example/4",
  ]);
});

test("a redirect to a private destination is an error, not a warning", async () => {
  const fetchImpl = stub({
    "https://docs.example/go": redirect("http://127.0.0.1/"),
  });

  const result = await fetchPage("https://docs.example/go", { fetchImpl, lookup, budget: freshBudget() });
  assert.equal(result.ok, false);
  assert.match(result.error, /127\.0\.0\.1 es una dirección privada/);
  assert.deepEqual(fetchImpl.calls, ["https://docs.example/go"], "the private hop is never fetched");

  const toMetadata = stub({
    "https://docs.example/next": redirect("http://169.254.169.254/latest/meta-data/"),
  });
  const hijacked = await fetchPage("https://docs.example/next", {
    fetchImpl: toMetadata,
    lookup,
    budget: freshBudget(),
  });
  assert.equal(hijacked.ok, false);
  assert.match(hijacked.error, /169\.254\.169\.254 es una dirección privada/);
  assert.equal(toMetadata.calls.length, 1);
});

// ---------------------------------------------------------------------------
// U2 — extraction: tolerant regexes, decoded entities, no raw HTML
// ---------------------------------------------------------------------------

test("entities decode, including the numeric refs", () => {
  assert.equal(decodeEntities("Tom &amp; Jerry &lt;tag&gt; &quot;x&quot; &#39;y&#39; a&nbsp;b"), 'Tom & Jerry <tag> "x" \'y\' a b');
  assert.equal(decodeEntities("caf&#233; y &#x27;otra&#x27;"), "café y 'otra'");
  assert.equal(decodeEntities("&desconocida; queda igual"), "&desconocida; queda igual");
});

test("htmlToText drops noise, comments and entities, and collapses whitespace", () => {
  const text = htmlToText(DOCS_PAGE);
  assert.ok(!/<[a-z/]/i.test(text), "no tags survive");
  assert.equal(text.includes("gtm-1"), false, "script bodies are gone");
  assert.equal(text.includes("#333"), false, "style bodies are gone");
  assert.equal(text.includes("comentario que no se lee"), false, "comments are gone");
  assert.equal(text.includes("secreto del template"), false, "template bodies are gone");
  assert.equal(text.includes("activá JS"), false, "noscript bodies are gone");
  assert.equal(text.includes("icono"), false, "svg bodies are gone");
  assert.equal(text.includes("Docs"), false, "nav is not readable text");
  assert.equal(text.includes("  "), false, "whitespace is collapsed");
  assert.equal(text.includes("&amp;"), false, "entities were decoded first");
  assert.match(text, /fs\.promises\.readFile/);
  assert.match(text, /Lee un archivo entero y devuelve un Buffer\. Usá "UTF-8" como encoding\./);
  assert.match(text, /ENOENT/);
});

test("the docs fixture gives title, meta, canonical, og, h1-h3 and absolute links", async () => {
  const fetchImpl = stub({ "https://docs.example/api/fs.html": html(DOCS_PAGE) });
  const result = await fetchPage("https://docs.example/api/fs.html", {
    fetchImpl,
    lookup,
    budget: freshBudget(),
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.title, "Leer archivos & streams | Node.js v22");
  assert.equal(result.description, "La API fs promete leer archivos sin bloquear el event loop.");
  assert.equal(result.canonical, "https://nodejs.org/api/fs.html");
  assert.deepEqual(result.og, {
    "og:title": "Módulo fs",
    "og:type": "article",
    "og:image": "https://nodejs.org/static/images/logo.svg",
  });
  assert.deepEqual(result.headings, [
    { level: 1, text: "Módulo fs" },
    { level: 2, text: "fs.promises.readFile" },
    { level: 3, text: "Errores & cierres" },
  ]);
  assert.deepEqual(result.links, [
    "https://docs.example/docs/",
    "https://docs.example/api/",
    "https://docs.example/api/fs.html#clase-fs",
    "https://github.com/nodejs/node",
  ], "outgoing links, deduplicated, absolute, javascript: and #anchors dropped");
  assert.equal(result.truncated, false);
  assert.equal(result.jsShell, false);
  assert.ok(result.bytes > 0);
});

test("the landing fixture resolves relative links against the final URL", async () => {
  const fetchImpl = stub({
    "http://po.example/": redirect("https://po.example/home", 308),
    "https://po.example/home": html(LANDING_PAGE),
  });
  const result = await fetchPage("http://po.example/", { fetchImpl, lookup, budget: freshBudget() });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.url, "https://po.example/home");
  assert.equal(result.title, "Po — el harness que no te miente");
  assert.equal(result.description, "Tareas, memoria y reviews congeladas para agentes de código.");
  assert.equal(result.canonical, "https://po.example/");
  assert.equal(result.og["og:description"], "Un harness determinista.");
  assert.deepEqual(result.headings, [
    { level: 1, text: "El harness que no te miente" },
    { level: 2, text: "Qué hace" },
  ]);
  assert.deepEqual(result.links, ["https://po.example/precios", "https://docs.po.example/guia"]);
  assert.match(result.text, /verificación y reviews/);
});

test("extract text returns only the text, extract links only the links", async () => {
  const fetchImpl = stub({ "https://docs.example/text": html(DOCS_PAGE) });

  const asText = await fetchPage("https://docs.example/text", {
    fetchImpl,
    lookup,
    budget: freshBudget(),
    extract: "text",
  });
  assert.equal(asText.ok, true);
  assert.match(asText.text, /ENOENT/);
  assert.equal("links" in asText, false);
  assert.equal("headings" in asText, false);

  const asLinks = await fetchPage("https://docs.example/text", {
    fetchImpl,
    lookup,
    budget: freshBudget(),
    extract: "links",
  });
  assert.deepEqual(asLinks.links, [
    "https://docs.example/docs/",
    "https://docs.example/api/",
    "https://docs.example/api/fs.html#clase-fs",
    "https://github.com/nodejs/node",
  ]);
  assert.equal("text" in asLinks, false);
  assert.equal(asLinks.requests, 0, "the second read came from the cache");
});

test("helpers cap and deduplicate on their own", () => {
  const many = Array.from({ length: 40 }, (_, index) => `<a href="/p${index}">p${index}</a>`).join("");
  assert.equal(htmlToLinks(many, "https://example.com/").length, 30, "links cap at 30");
  assert.deepEqual(htmlToLinks('<a href="/x">x</a><a href="/x">x</a><a href="#y">y</a>', "https://example.com/"), [
    "https://example.com/x",
  ]);

  const headings = Array.from({ length: 25 }, (_, index) => `<h2>t${index}</h2>`).join("");
  assert.equal(htmlToStructure(headings, "https://example.com/").headings.length, 20, "headings cap at 20");
});

// ---------------------------------------------------------------------------
// U1 — the byte cap: read the stream, stop at maxBytes, report truncated
// ---------------------------------------------------------------------------

test("a body bigger than maxBytes is cut at the cap and marked truncated", async () => {
  const long = `<!doctype html><html><body><h1>Corto</h1><p>${"palabra ".repeat(400)}</p></body></html>`;
  const fetchImpl = stub({ "https://big.example/doc": html(long) });

  const result = await fetchPage("https://big.example/doc", {
    fetchImpl,
    lookup,
    budget: freshBudget(),
    maxBytes: 64,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.truncated, true);
  assert.equal(result.bytes, 64, "reading stopped exactly at the cap");
  assert.ok(result.text.length < 64);
});

test("a body under the cap is not truncated", async () => {
  const fetchImpl = stub({ "https://small.example/doc": html("<html><body><p>hola</p></body></html>") });
  const result = await fetchPage("https://small.example/doc", {
    fetchImpl,
    lookup,
    budget: freshBudget(),
    maxBytes: 4096,
  });
  assert.equal(result.truncated, false);
  assert.equal(result.text, "hola");
});

// ---------------------------------------------------------------------------
// U1 — timeout, budget, cache
// ---------------------------------------------------------------------------

test("a request that hangs is aborted and reported as a timeout, not a throw", async () => {
  const hanging = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("the operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  // `AbortSignal.timeout` does not keep the event loop active (Node docs), so a
  // stub that only pends would let the loop drain before the abort. A real fetch
  // holds its socket; here the timer plays that role and is cleared after.
  const alive = setTimeout(() => {}, 1000);
  try {
    const result = await fetchPage("https://slow.example/doc", {
      fetchImpl: hanging,
      lookup,
      budget: freshBudget(),
      timeoutMs: 5,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /timeout/);
    assert.match(result.error, /5 ms/);
  } finally {
    clearTimeout(alive);
  }
});

test("the egress budget stops the eleventh request with an explicit error", async () => {
  const routes = {};
  for (let index = 1; index <= 10; index += 1) {
    routes[`https://budget.example/${index}`] = html(`<h1>página ${index}</h1>`);
  }
  routes["https://budget.example/11"] = html("<h1>página 11</h1>");
  const fetchImpl = stub(routes);
  const budget = freshBudget();

  for (let index = 1; index <= 10; index += 1) {
    const result = await fetchPage(`https://budget.example/${index}`, { fetchImpl, lookup, budget });
    assert.equal(result.ok, true, `request ${index}: ${result.error}`);
    assert.equal(result.requests, 1);
  }
  assert.equal(budget.used, 10);

  const overLimit = await fetchPage("https://budget.example/11", { fetchImpl, lookup, budget });
  assert.equal(overLimit.ok, false);
  assert.match(overLimit.error, /presupuesto de red agotado/);
  assert.match(overLimit.error, /10 requests por proceso/);
  assert.equal(fetchImpl.calls.length, 10, "the eleventh never left the process");
  assert.equal(budget.used, 10);
});

test("an exhausted budget says so before validating anything", async () => {
  let lookups = 0;
  const result = await fetchPage("https://budget.example/again", {
    fetchImpl: stub({}),
    lookup: async (host) => {
      lookups += 1;
      return lookup(host);
    },
    budget: { used: 10, limit: 10 },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /presupuesto de red agotado/);
  assert.equal(lookups, 0);
});

test("the same URL twice costs one request, a different URL costs two", async () => {
  const fetchImpl = stub({
    "https://cache.example/page": html("<h1>una</h1><p>contenido estable</p>"),
    "https://cache.example/otra": html("<h1>otra</h1>"),
  });
  const budget = freshBudget();

  const first = await fetchPage("https://cache.example/page", { fetchImpl, lookup, budget });
  const second = await fetchPage("https://cache.example/page", { fetchImpl, lookup, budget });
  assert.equal(first.requests, 1);
  assert.equal(second.requests, 0, "the cache answers, the network does not");
  assert.equal(second.text, first.text);
  assert.deepEqual(fetchImpl.calls, ["https://cache.example/page"]);
  assert.equal(budget.used, 1, "a cached read spends no budget");

  const other = await fetchPage("https://cache.example/otra", { fetchImpl, lookup, budget });
  assert.equal(other.requests, 1);
  assert.equal(fetchImpl.calls.length, 2);
});

// ---------------------------------------------------------------------------
// U2/U3 — the JS shell, and the tool's slot in the role matrix
// ---------------------------------------------------------------------------

test("a page that only renders with JS is reported as such, not as empty", async () => {
  const shell = `<!doctype html><html><head><title>App</title>
    <script src="/runtime.js"></script><script src="/vendor.js"></script>
    <script src="/main.js"></script><script>window.__DATA__ = {"a":1}</script>
  </head><body><div id="root">Cargando…</div></body></html>`;
  const fetchImpl = stub({ "https://app.example/": html(shell) });
  const result = await fetchPage("https://app.example/", { fetchImpl, lookup, budget: freshBudget() });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.jsShell, true);
  assert.ok(result.text.length < 200);

  const staticPage = stub({ "https://docs.example/static": html(DOCS_PAGE) });
  const normal = await fetchPage("https://docs.example/static", {
    fetchImpl: staticPage,
    lookup,
    budget: freshBudget(),
  });
  assert.equal(normal.jsShell, false);
});

test("an HTTP error comes back as a value with a Spanish reason", async () => {
  const fetchImpl = stub({ "https://docs.example/missing": html("nope", { status: 404 }) });
  const result = await fetchPage("https://docs.example/missing", { fetchImpl, lookup, budget: freshBudget() });
  assert.equal(result.ok, false);
  assert.match(result.error, /404/);
  assert.match(result.error, /no existe/);
});

test("web_fetch is the explorer's, refused for worker and reviewer", () => {
  assert.deepEqual(WEB_TOOLS, ["web_search", "web_fetch"], "only the names this repo registers");
  assert.ok(roleTools("explorer").includes("web_fetch"));
  assert.equal(roleTools("worker").includes("web_fetch"), false);
  assert.equal(roleTools("reviewer").includes("web_fetch"), false);
  assert.throws(() => roleTools("worker", ["read", "web_fetch"]), /worker cannot use web_fetch/);
  assert.throws(() => roleTools("reviewer", ["web_fetch"]), /reviewer cannot use web_fetch/);

  const cwd = process.cwd();
  const input = { url: "https://nodejs.org/api/fs.html" };
  assert.equal(subagentToolBlock("web_fetch", input, cwd, { role: "explorer" }), null);
  assert.match(subagentToolBlock("web_fetch", input, cwd, { role: "worker" }), /no tiene acceso a la web/);
  assert.match(subagentToolBlock("web_fetch", input, cwd, { role: "reviewer" }), /no tiene acceso a la web/);
});
