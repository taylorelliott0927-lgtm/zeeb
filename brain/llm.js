// The brain's only link to an AI model: Google Gemini's free tier.
// If there is no key, or the call fails, the caller falls back to simple rules so Zeeb never freezes.
import { fetchWithTimeout, log } from "./util.js";

const KEY = process.env.GEMINI_API_KEY || "";
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
let model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
let discovered = false;

export const useModel = (m) => { if (m && !process.env.GEMINI_MODEL_FORCE) model = m; };
export const currentModel = () => model;
export const hasBrain = () => Boolean(KEY) && process.env.MOCK !== "1";
export const modelName = () => (hasBrain() ? model : "rules (no AI key)");

// Model names change over time. If ours disappears, pick the newest free "flash" model.
async function discoverModel() {
  discovered = true;
  const res = await fetchWithTimeout(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY } });
  if (!res.ok) return false;
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
  if (!ok.length) return false;
  log(`model ${model} unavailable, switching to ${ok[0]}`);
  model = ok[0];
  return true;
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

export async function askJSON(system, user, { temperature = 1.0 } = {}) {
  if (!hasBrain()) return null;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens: 4096 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/models/${model}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) },
        45000
      );
      if (res.status === 404 && !discovered && (await discoverModel())) continue;
      if (res.status === 429) {
        log("Gemini free limit reached for now, using rules this time");
        return null;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return parseJSON(text);
    } catch (e) {
      log(`Gemini attempt ${attempt + 1} failed:`, e.message);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}
