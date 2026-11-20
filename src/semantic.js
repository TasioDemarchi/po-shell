import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson } from "./util.js";

const DEFAULT_BASE_URL = "https://api.nan.builders/v1";
const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding";
const DEFAULT_RERANK_MODEL = "rerank";
const TIMEOUT_MS = 15_000;

function agentDir(env = process.env) {
  return env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function envValue(value, env = process.env) {
  const text = String(value ?? "");
  return text.startsWith("$") ? String(env[text.slice(1)] ?? "") : text;
}

function providerConfig(env = process.env) {
  const dir = agentDir(env);
  const models = readJson(path.join(dir, "models.json"), {});
  const settings = readJson(path.join(dir, "settings.json"), {});
  const provider = settings.defaultProvider || "nan";
  const providerData = models.providers?.[provider] ?? models.providers?.nan ?? {};
  const auth = readJson(path.join(dir, "auth.json"), {});
  return {
    provider,
    baseUrl: String(env.PLAIN_SEMANTIC_BASE_URL || providerData.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""),
    apiKey:
      env.PLAIN_SEMANTIC_API_KEY ||
      env.NAN_API_KEY ||
      auth[provider]?.key ||
      auth.nan?.key ||
      envValue(providerData.apiKey, env),
  };
}

export function semanticConfig(env = process.env) {
  if (["0", "off", "false", "no"].includes(String(env.PLAIN_SEMANTIC ?? "").toLowerCase())) {
    return null;
  }
  const provider = providerConfig(env);
  if (!provider.apiKey) return null;
  return {
    ...provider,
    embeddingModel: env.PLAIN_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    rerankModel: env.PLAIN_RERANK_MODEL || DEFAULT_RERANK_MODEL,
  };
}

async function postJson(url, body, apiKey) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`semantic request failed: ${response.status}`);
  return response.json();
}

export async function embedTexts(texts, env = process.env) {
  const config = semanticConfig(env);
  if (!config) return null;
  const clean = texts.map((text) => String(text ?? "").slice(0, 30_000));
  if (!clean.length) return [];
  const out = [];
  for (let i = 0; i < clean.length; i += 32) {
    const batch = clean.slice(i, i + 32);
    const data = await postJson(
      `${config.baseUrl}/embeddings`,
      { model: config.embeddingModel, input: batch },
      config.apiKey,
    );
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const row of rows) out.push(Float32Array.from(row.embedding ?? []));
  }
  return out;
}

export async function rerankDocuments(query, documents, env = process.env) {
  const config = semanticConfig(env);
  if (!config || !documents.length) return null;
  const data = await postJson(
    `${config.baseUrl}/rerank`,
    {
      model: config.rerankModel,
      query,
      documents: documents.map((doc) => String(doc ?? "").slice(0, 8_000)),
      top_n: documents.length,
    },
    config.apiKey,
  );
  return (data.results ?? []).map((row) => ({
    index: Number(row.index),
    score: Number(row.relevance_score ?? 0),
  }));
}

export function vectorBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function vectorFromBlob(blob) {
  if (!blob) return null;
  const buffer = Buffer.from(blob);
  if (buffer.length % 4 !== 0) return null;
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}
