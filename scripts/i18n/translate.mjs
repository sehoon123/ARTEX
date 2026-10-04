// Fill missing en/ko keys only. Validate all requested responses before saving anything.
import { extractStrings, loadJSON, validateTranslation, writeAtomic, EN, KO } from "./extract.mjs";

const LANGS = { en: "English", ko: "Korean (한국어)" };
const SYS = (lang) => `You are a professional software-localization engineer translating the UI of ARTEX from Simplified Chinese to ${lang}.
Rules:
- Translate meaning naturally and concisely for a technical audience.
- Preserve every placeholder exactly, including its occurrence count: {n0}, {n1}, {args}, etc. You may reorder them for natural grammar, but never add or remove any.
- Preserve code, identifiers, file paths, URLs, environment variables, HTTP methods, and product/tech names (Agent, Worker, Planner, LLM, Token, MCP, Skill, SSE, CIDR, ICP, SQL, IDOR, bash, DeepSeek, Brave, Tavily).
- Preserve meaningful whitespace and line breaks. Never turn a newline into the literal characters backslash + n.
- Return ONLY a JSON object mapping every input key to its translation. No prose or code fence.`;

function integerEnv(name, fallback, min) {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

async function callLLM(system, user, timeout) {
  const signal = AbortSignal.timeout(timeout);
  if (process.env.ANTHROPIC_API_KEY) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.I18N_MODEL || "claude-haiku-4-5-20251001", max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
    });
    if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}`);
    const data = await response.json();
    return data.content.map((part) => part.text || "").join("");
  }
  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.I18N_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST", signal,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.I18N_MODEL || "gpt-4o-mini", response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }
  throw new Error("No API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
}

function parseResponse(text) {
  if (typeof text !== "string") throw new Error("Provider returned no text");
  const map = JSON.parse(text.trim());
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("Provider returned an invalid translation map");
  return map;
}

function saveDictionary(path, dict) {
  const sorted = Object.fromEntries(Object.keys(dict).sort().map((key) => [key, dict[key]]));
  writeAtomic(path, JSON.stringify(sorted, null, 2) + "\n");
}

try {
  const wanted = process.argv.slice(2);
  if (wanted.some((lang) => !Object.hasOwn(LANGS, lang))) throw new Error("Usage: translate.mjs [en] [ko]");
  if (!wanted.length) wanted.push("en", "ko");
  const batchSize = integerEnv("BATCH", 40, 1);
  const limit = integerEnv("LIMIT", Infinity, 0);
  const timeout = integerEnv("I18N_TIMEOUT_MS", 60000, 1);
  const all = extractStrings();
  // Read both first: corrupt dictionaries must be noticed even during a one-locale run.
  const dictionaries = { en: loadJSON(EN), ko: loadJSON(KO) };
  const updates = [];
  for (const lang of new Set(wanted)) {
    const dict = Object.assign(Object.create(null), dictionaries[lang]);
    const missing = all.filter((key) => !Object.hasOwn(dict, key));
    const selected = missing.slice(0, limit);
    if (!missing.length) { console.error(`[${lang}] up to date (${Object.keys(dict).length} keys).`); continue; }
    console.error(`[${lang}] translating ${selected.length}/${missing.length} missing strings…`);
    for (let i = 0; i < selected.length; i += batchSize) {
      const batch = selected.slice(i, i + batchSize);
      const user = `Translate these ${batch.length} strings to ${LANGS[lang]}. Input JSON (translate the values):\n${JSON.stringify(Object.fromEntries(batch.map((key) => [key, key])))}`;
      const map = parseResponse(await callLLM(SYS(LANGS[lang]), user, timeout));
      for (const key of batch) {
        if (!Object.hasOwn(map, key)) throw new Error(`[${lang}] Provider omitted ${JSON.stringify(key)}`);
        validateTranslation(key, map[key]);
      }
      for (const key of batch) dict[key] = map[key];
      console.error(`  [${lang}] ${Math.min(i + batchSize, selected.length)}/${selected.length}`);
    }
    if (selected.length) updates.push({ path: lang === "en" ? EN : KO, dict });
  }
  // A failed HTTP request, invalid JSON, missing key or placeholder mismatch saves nothing.
  for (const { path, dict } of updates) saveDictionary(path, dict);
  console.error(`Translation complete: ${updates.length} dictionary file(s) updated.`);
} catch (error) { console.error(`Translation failed: ${error.message}`); process.exitCode = 1; }
