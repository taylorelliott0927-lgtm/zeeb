// Zeeb's link to an AI model. It tries, in order:
//   1. your own PC's AI through Ollama (when OLLAMA_URL is set, i.e. the heartbeat is running on your PC)
//   2. Google Gemini's free tier (when GEMINI_API_KEY is set)
// If neither answers, the caller falls back to simple rules so Zeeb never freezes.
import { fetchWithTimeout, log } from "./util.js";

const KEY = process.env.GEMINI_API_KEY || "";
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
let model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
let geminiOut = false; // hit the free limit during this heartbeat

const OLLAMA_URL = (process.env.OLLAMA_URL || "").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
// Unload the model from the graphics card right after each answer, so games get all the memory back.
const OLLAMA_KEEP = process.env.OLLAMA_KEEP_ALIVE || "20s";
let ollamaDown = false;

let lastBrain = "";
const mock = () => process.env.MOCK === "1";

export const useModel = (m) => { if (m && !process.env.GEMINI_MODEL_FORCE) model = m; };
export const currentModel = () => model;
export const hasBrain = () => !mock() && Boolean(OLLAMA_URL || KEY);
export const modelName = () => lastBrain || (hasBrain() ? (OLLAMA_URL ? `your PC (${OLLAMA_MODEL})` : model) : "rules (no AI key)");

// Model names change over time, and a model can be busy or out of free requests.
// We keep a short list of free "flash" models (newest first) and move down it when one won't answer.
let candidates = null;
async function modelList() {
  if (candidates) return candidates;
  candidates = [];
  try {
    const res = await fetchWithTimeout(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY } });
    if (res.ok) {
      const list = (await res.json()).models || [];
      const ok = list
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
      ok.sort((a, b) => {
        const va = parseFloat(a.split("-")[1]), vb = parseFloat(b.split("-")[1]);
        if (vb !== va) return vb - va;
        return a.includes("lite") - b.includes("lite");
      });
      candidates = ok;
    }
  } catch {}
  return candidates;
}

function parseJSON(text) {
  const t = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("model did not return JSON");
  }
}

async function askOllama(system, user, temperature, opts = {}) {
  const asText = Boolean(opts.text);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          ...(asText ? {} : { format: "json" }),
          stream: false,
          keep_alive: OLLAMA_KEEP,
          options: { temperature: Math.min(temperature, 0.9), num_ctx: opts.numCtx || 8192, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
        }),
      }, 240000);
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const raw = data?.message?.content || "";
      const out = asText ? raw : parseJSON(raw);
      lastBrain = `your PC (${OLLAMA_MODEL})`;
      return out;
    } catch (e) {
      log(`PC brain attempt ${attempt + 1} failed:`, e.message);
      if (/ECONNREFUSED|fetch failed/i.test(e.message)) { ollamaDown = true; return null; }
    }
  }
  return null;
}

async function callGemini(m, body) {
  const res = await fetchWithTimeout(
    `${BASE}/models/${m}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) },
    45000
  );
  if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 160) };
  const data = await res.json();
  return { text: data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "" };
}

async function askGemini(system, user, temperature, opts = {}) {
  const asText = Boolean(opts.text);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { ...(asText ? {} : { responseMimeType: "application/json" }), temperature, maxOutputTokens: opts.maxTokens || 4096 },
  };
  const tried = new Set();
  let busyRetry = false;
  for (let step = 0; step < 6; step++) {
    if (tried.has(model)) {
      // Current model already failed this time: move to the next free model on the list.
      const next = (await modelList()).find((m) => !tried.has(m));
      if (!next) break;
      log(`trying another Gemini model: ${next}`);
      model = next;
    }
    try {
      const r = await callGemini(model, body);
      if (r.text !== undefined) {
        const out = asText ? r.text : parseJSON(r.text);
        lastBrain = model;
        return out;
      }
      if (r.status === 404) { log(`model ${model} is gone`); tried.add(model); continue; }
      if (r.status === 429) { log(`${model} is out of free requests for now`); tried.add(model); continue; }
      if (r.status === 503 || r.status === 500) {
        // Busy: one quick retry, then try a different model.
        if (!busyRetry) { busyRetry = true; log(`${model} is busy, retrying once`); await new Promise((x) => setTimeout(x, 2500)); continue; }
        log(`${model} is still busy`); tried.add(model); busyRetry = false; continue;
      }
      log(`Gemini ${r.status}: ${r.error}`);
      tried.add(model);
    } catch (e) {
      log(`Gemini call failed: ${e.message}`);
      tried.add(model);
    }
  }
  geminiOut = true; // nothing answered this heartbeat; don't keep hammering
  return null;
}

export async function askJSON(system, user, { temperature = 1.0 } = {}) {
  if (!hasBrain()) return null;
  if (OLLAMA_URL && !ollamaDown) {
    const r = await askOllama(system, user, temperature);
    if (r) return r;
  }
  if (KEY && !geminiOut) {
    const r = await askGemini(system, user, temperature);
    if (r) return r;
  }
  return null;
}

// Plain text answers (used when Zeeb writes code, which doesn't sit well inside JSON).
export async function askText(system, user, { temperature = 0.8, numCtx = 16384, maxTokens = 6000 } = {}) {
  if (!hasBrain()) return null;
  const opts = { text: true, numCtx, maxTokens };
  if (OLLAMA_URL && !ollamaDown) {
    const r = await askOllama(system, user, temperature, opts);
    if (r) return r;
  }
  if (KEY && !geminiOut) {
    const r = await askGemini(system, user, temperature, { ...opts, maxTokens: Math.max(maxTokens, 8192) });
    if (r) return r;
  }
  return null;
}
