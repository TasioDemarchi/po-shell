import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cosine,
  semanticConfig,
  vectorBuffer,
  vectorFromBlob,
} from "../src/semantic.js";

test("cosine scores similar and orthogonal vectors", () => {
  assert.ok(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0])) > 0.99);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
});

test("vector blobs round-trip Float32 values", () => {
  const vector = Float32Array.from([0.25, -1, 3.5]);
  const restored = vectorFromBlob(vectorBuffer(vector));
  assert.deepEqual([...restored], [...vector]);
});

test("semanticConfig reads Nan auth and can be disabled", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-semantic-"));
  fs.writeFileSync(
    path.join(dir, "models.json"),
    JSON.stringify({ providers: { nan: { baseUrl: "https://api.nan.builders/v1" } } }),
  );
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ defaultProvider: "nan" }),
  );
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ nan: { key: "test-key", type: "api" } }),
  );
  const config = semanticConfig({ PI_CODING_AGENT_DIR: dir });
  assert.equal(config.embeddingModel, "qwen3-embedding");
  assert.equal(config.rerankModel, "rerank");
  assert.equal(config.baseUrl, "https://api.nan.builders/v1");
  assert.equal(semanticConfig({ PI_CODING_AGENT_DIR: dir, PLAIN_SEMANTIC: "off" }), null);
});


test("semanticConfig falls back to NAN_API_KEY and provider apiKey placeholders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plain-semantic-env-"));
  fs.writeFileSync(
    path.join(dir, "models.json"),
    JSON.stringify({ providers: { nan: { apiKey: "$NAN_API_KEY" } } }),
  );
  assert.equal(semanticConfig({ PI_CODING_AGENT_DIR: dir, NAN_API_KEY: "env-key" }).apiKey, "env-key");
  assert.equal(
    semanticConfig({ PI_CODING_AGENT_DIR: dir, PLAIN_SEMANTIC_API_KEY: "plain-key" }).apiKey,
    "plain-key",
  );
});
