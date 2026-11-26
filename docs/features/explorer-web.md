---
type: feature
status: active
---

# Feature: web_fetch, the explorer's read-only window to the web

Risk: high

## Outcome

Que el `explorer` pueda leer una página —la documentación de una librería, una landing que hay que
analizar— y devolver algo que un modelo pueda usar: título, meta, encabezados, links y texto legible,
nunca HTML crudo. Solo él tiene red; `worker` y `reviewer` siguen sin acceso.

## Pain

Hoy `ROLE_RULES.explorer.web` vale `true` y `WEB_TOOLS` nombra cinco tools que nadie registra: el
hijo se lanza con `--no-extensions`, así que la capacidad es una intención. Un explorer con una
misión web no tiene con qué cumplirla y no lo dice.

La búsqueda (etapa 2) no entra acá: `web_fetch` resuelve los dos casos reales —leer una doc, analizar
una landing— y no depende de ningún proveedor.

## Design

### La tool

`web_fetch(url, { extract })` en `src/web-fetch.js`, registrada en
`extensions/po-shell-subagent.ts` solo cuando el rol es `explorer`, igual que `memory_search`.

- `extract: "structure"` (default) devuelve un bloque compacto: título, `description`, canonical y
  `og:*`, encabezados (`h1`–`h3`, acotados), links salientes absolutos (acotados) y el texto legible.
- `extract: "text"` devuelve solo el texto. `extract: "links"` solo los links.
- Lo crudo no entra nunca al contexto del hijo: el HTML se convierte y se trunca antes de volver.
- Los links son un dato, no una instrucción: el hijo los lee, no los sigue solo.

### Los límites

Un hijo con red es un hijo que puede exfiltrar, así que los límites son la mitad de la feature:

- **Destino:** solo `http`/`https`. Se rechazan `localhost`, `*.local`, IPs privadas
  (`10/8`, `172.16/12`, `192.168/16`, `127/8`), link-local (`169.254/16`, `fe80::/10`), ULA
  (`fc00::/7`), loopback IPv6 (`::1`) y URLs con credenciales embebidas. Se resuelve el host con
  `dns.lookup` y se rechaza si **alguna** dirección es privada.
- **Saltos:** máximo 3 redirects, y **cada destino se re-valida** con la misma regla.
- **Tamaño y tiempo:** tope de bytes leídos (por defecto 512 KiB) y de tiempo por request (10 s); el
  cuerpo se corta y se marca `truncated`.
- **Presupuesto de egress:** 10 requests por proceso hijo. Agotado, la tool responde con un error
  explícito; no hay reintentos silenciosos.
- **Sin estado de la sesión:** no se envían cookies, ni `Authorization`, ni headers del usuario. No se
  guardan cuerpos en disco: la caché es un `Map` en memoria del proceso, así que dos lecturas de la
  misma URL cuestan un request.
- **DNS rebinding:** la validación es previa al request, no un sandbox. Queda declarado como límite:
  la policy no es una barrera del sistema operativo.

### Lo que la página no dice

Si el documento tiene pocos caracteres legibles y varios `<script>`, la respuesta lo dice —«la página
se renderiza con JS; probá la fuente en Markdown, el repo o `llms.txt`»— en vez de devolver vacío. Sin
navegador headless: rompería el cero dependencias. El explorer reporta el límite, no inventa.

## Units

- [x] **U1 — El módulo.** `src/web-fetch.js`: validación de destino, `dns.lookup`, redirects
      re-validados, topes de bytes y tiempo, caché en memoria, presupuesto de egress, y el error como
      valor (`{ ok: false, error }`), nunca una excepción que mate al hijo. (D1)
- [x] **U2 — La extracción.** `htmlToStructure`, `htmlToText`, `htmlToLinks` y la detección de
      JS-shell, sobre HTML sin dependencias: regex tolerantes y entidades decodificadas, con fixtures
      reales de doc y de landing en `test/`. (D1)
- [x] **U3 — La tool.** `extensions/po-shell-subagent.ts` registra `web_fetch` solo para `explorer`;
      `src/subagent-roles.js` suma `web_fetch` a las tools del explorer y `WEB_TOOLS` queda con los
      nombres que el repo realmente registra (`web_search` para la etapa 2). (D1)
- [x] **U4 — Los tests.** Destinos rechazados (incluido un redirect hacia uno privado), extracción por
      modo, truncado, timeout, presupuesto agotado, caché y la matriz de roles. El test inyecta
      `fetchImpl` y `lookup`: ningún test toca la red. (D1)

## Decisions

- **`web_fetch` antes que `web_search`.** Leer una URL resuelve los dos casos reales; el search solo
  descubre URLs, y un scraper no oficial falla en silencio justo cuando hace falta. La etapa 2 queda
  con proveedor por env var: `PO_SHELL_SEARCH_PROVIDER` + `PO_SHELL_SEARCH_KEY`, sin clave la tool
  responde «no configurado». Se descarta DuckDuckGo HTML: endpoint no oficial, sin contrato, con rate
  limit y cambios que rompen el parseo sin aviso.
- D1 — Se implementa web_fetch antes que web_search: leer una URL resuelve los dos casos reales (documentación y landing) y no depende de un proveedor; la búsqueda queda como etapa 2 con PO_SHELL_SEARCH_PROVIDER/KEY y se descarta el scraping de DuckDuckGo por frágil y silencioso al fallar.

## Out of scope

- `web_search` y cualquier proveedor (etapa 2, con su propio doc si crece).
- Render de JS, navegador headless o motor de plantillas.
- Seguir links, crawl, sitemap o concurrencia: una URL por llamada.
- Descargar binarios, PDFs o assets (CSS, JS, imágenes).
- `worker` y `reviewer` con red: el guard ya los rechaza y no se toca eso.
