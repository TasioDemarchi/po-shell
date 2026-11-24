#!/usr/bin/env node
// Verificador de instalación de po-shell.
// No instala nada, no escribe nada y no pide credenciales: solo dice qué falta.
import { installReport, postinstallReport, renderInstallReport } from "../src/install.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const postinstall = args.includes("--postinstall");
const help = args.includes("--help") || args.includes("-h");
const unknown = args.filter(
  (arg) => !["--json", "--postinstall", "--dry-run", "--help", "-h"].includes(arg),
);

if (help) {
  console.log(`po-shell installer — verifica que po-shell pueda arrancar

Uso:
  node scripts/install.mjs [--dry-run] [--json]
  node scripts/install.mjs --postinstall

Opciones:
  --dry-run      no hace nada más que verificar (es el único modo)
  --json         salida JSON
  --postinstall  modo instalación: nunca falla y calla si todo está bien

Este script no instala Node, Pi ni paquetes. Imprime el comando exacto.`);
  process.exit(0);
}

if (unknown.length) {
  console.error(`po-shell installer: opción desconocida: ${unknown.join(" ")}`);
  process.exit(postinstall ? 0 : 2);
}

if (postinstall) {
  try {
    postinstallReport();
  } catch (error) {
    console.warn(`po-shell: postinstall no pudo verificar la instalación: ${error.message}`);
  }
  process.exit(0);
}

const report = installReport();
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  renderInstallReport(report);
}
process.exit(report.ok ? 0 : 1);
