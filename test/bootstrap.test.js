import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "bootstrap.sh");

test("bootstrap.sh is POSIX sh and parses with sh -n", () => {
  const source = fs.readFileSync(script, "utf8");
  assert.match(source, /^#!\/bin\/sh\n/);
  assert.match(source, /^set -eu$/m);

  const check = spawnSync("sh", ["-n", script], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("bootstrap.sh --help documents the three modes and the restore --yes", () => {
  const help = spawnSync("sh", [script, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  const out = help.stdout;

  // Los tres modos.
  assert.match(out, /Modos:/);
  assert.match(out, /sin --from/);
  assert.match(out, /--from <origen>/);
  assert.match(out, /--no-restore/);

  // Las tres formas de origen que acepta --from.
  assert.match(out, /directorio de backup/);
  assert.match(out, /\.tar\.gz/);
  assert.match(out, /curl -fLo/);
  assert.match(out, /manifest\.json/);

  // El --yes del restore lo da el humano, no el script, y la db no se restaura.
  assert.match(out, /po-shell restore <dir> --yes --global --no-db/);
  assert.match(out, /ese --yes lo\s+das vos/i);
  assert.match(out, /base de datos del backup no se restaura/);
  assert.match(out, /index --rebuild/);
});

// bootstrap.sh se niega a correr como root: en un contenedor root estos tests
// solo podrían pasar si se saltean.
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
const rootOnly = asRoot ? "corre como root: bootstrap.sh se niega" : false;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Arma un .tar.gz con las entradas dadas, relativo a $work.
function tarPackage(work, entries) {
  const archive = path.join(work, "paquete.tar.gz");
  const tar = spawnSync("tar", ["czf", archive, "-C", work, ...entries], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  return archive;
}

function runWithPackage(archive) {
  return spawnSync("sh", [script, "--from", archive], { encoding: "utf8" });
}

test("bootstrap.sh reindexes before integrity so integrity checks the rebuilt index", () => {
  const source = fs.readFileSync(script, "utf8");
  const reindex = source.indexOf("po_shell index --rebuild");
  const integrity = source.indexOf("po_shell integrity");
  assert.ok(reindex > 0, "no encontré el paso po_shell index --rebuild");
  assert.ok(integrity > 0, "no encontré el paso po_shell integrity");
  assert.ok(reindex < integrity, "index --rebuild tiene que correr antes que integrity");
});

test("bootstrap.sh rejects unknown flags and --from without an origin", () => {
  const unknown = spawnSync("sh", [script, "--nope"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /opción desconocida/);

  const missing = spawnSync("sh", [script, "--from"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--from necesita/);
});

test("bootstrap.sh finds manifest.json two levels inside the package", { skip: rootOnly }, () => {
  const work = tempDir("po-shell-bootstrap-nested-");
  const backup = path.join(work, "po-shell-migracion", "backup");
  fs.mkdirSync(backup, { recursive: true });
  // Un `tar czf po-shell-migracion.tar.gz po-shell-migracion` deja el manifest
  // en po-shell-migracion/backup/manifest.json. El contenido es falso a
  // propósito: así el script se detiene al leerlo, después de ubicarlo, y el
  // test no llega a install.sh (que corre npm link).
  fs.writeFileSync(path.join(backup, "manifest.json"), "no es JSON: manifest falso\n");
  const archive = tarPackage(work, ["po-shell-migracion"]);

  const run = runWithPackage(archive);
  assert.equal(run.status, 1, run.stdout);
  assert.doesNotMatch(run.stderr, /no trae manifest\.json/);

  const located = run.stderr
    .split("\n")
    .find((line) => line.includes("manifest.json ilegible en"));
  assert.ok(located, run.stderr);
  assert.match(located, /po-shell-migracion\/backup$/);
});

test("bootstrap.sh refuses a package with two manifest.json at the same level", { skip: rootOnly }, () => {
  const work = tempDir("po-shell-bootstrap-ambiguous-");
  for (const name of ["grupo-a", "grupo-b"]) {
    const dir = path.join(work, name, "backup");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), "{}\n");
  }
  const archive = tarPackage(work, ["grupo-a", "grupo-b"]);

  const run = runWithPackage(archive);
  assert.equal(run.status, 1, run.stdout);
  assert.doesNotMatch(run.stderr, /no trae manifest\.json/);
  assert.match(run.stderr, /trae 2 manifest\.json en el mismo nivel/);
  // Nombra los dos candidatos en vez de elegir uno.
  assert.match(run.stderr, /grupo-a\/backup/);
  assert.match(run.stderr, /grupo-b\/backup/);
});
