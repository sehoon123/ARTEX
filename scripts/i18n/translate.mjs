// Auto-fill en.json / ko.json for any Chinese display string missing a translation,
// using an LLM. Only fills gaps — existing entries (incl. manual fixes) are kept.
//
//   node scripts/i18n/translate.mjs            # fill gaps for en + ko
//   node scripts/i18n/translate.mjs ko         # only ko
//   LIMIT=100 node scripts/i18n/translate.mjs  # cap per run (cost control)
//
// Provider (auto-detected from env, same keys ARTEX already uses):
//   ANTHROPIC_API_KEY  -> Anthropic Messages API   (model: I18N_MODEL or claude-3-5-haiku-latest)
//   OPENAI_API_KEY     -> OpenAI chat completions   (model: I18N_MODEL or gpt-4o-mini)
//   I18N_BASE_URL      -> override OpenAI-compatible base URL (e.g. a local gateway)
import { writeFileSync } from "node:fs";
import { extractStrings, loadJSON, EN, KO } from "./extract.mjs";

const LANGS = { en: "English", ko: "Korean (한국어)" };
const targets = process.argv.slice(2).filter((a) => a in LANGS);
const wanted = targets.length ? targets : ["en", "ko"];
const BATCH = Number(process.env.BATCH || 40);
const LIMIT = Number(process.env.LIMIT || Infinity);

const SYS = (lang) =>
  `You are a professional software-localization engineer translating the UI of ARTEX, an autonomous web-penetration-testing console, from Simplified Chinese to ${lang}.
Rules:
- Translate meaning for a technical security audience; natural, concise UI wording.
- Keep placeholders EXACTLY as-is: {n0} {n1} ... and {args}. Do not add/remove/reorder them.
- Do NOT translate: code, identifiers, file paths, URLs, env vars, HTTP methods, numbers, and product/tech terms that stay in English (Agent, Worker, Planner, LLM, Token, MCP, Skill, SSE, CIDR, ICP, SQL, XSS, IDOR, RCE, bash, nmap, sqlmap, Fastjson, DeepSeek, Brave, Tavily, DingTalk/Feishu/WeCom).
- Preserve leading/trailing spaces and punctuation style (·, 、, ，, 。, ：) sensibly for the target language.
- Return ONLY a JSON object mapping each input string to its translation. No prose, no code fence.`;

async function callLLM(system, user) {
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.I18N_MODEL || "claude-3-5-haiku-latest",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.content.map((c) => c.text || "").join("");
  }
  if (process.env.OPENAI_API_KEY) {
    const base = process.env.I18N_BASE_URL || "https://api.openai.com/v1";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.I18N_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return j.choices[0].message.content;
  }
  throw new Error("No API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (same key ARTEX uses).");
}

function parseJSON(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error(`No JSON in response: ${text.slice(0, 120)}`);
  return JSON.parse(text.slice(s, e + 1));
}

function writeSorted(path, obj) {
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

const all = extractStrings();
for (const lang of wanted) {
  const path = lang === "en" ? EN : KO;
  const dict = loadJSON(path);
  let missing = all.filter((s) => !(s in dict));
  if (missing.length > LIMIT) missing = missing.slice(0, LIMIT);
  if (!missing.length) {
    console.error(`[${lang}] up to date (${Object.keys(dict).length} keys).`);
    continue;
  }
  console.error(`[${lang}] translating ${missing.length} new strings…`);
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const user = `Translate these ${batch.length} strings to ${LANGS[lang]}. Input JSON (translate the values):\n${JSON.stringify(Object.fromEntries(batch.map((s) => [s, s])), null, 0)}`;
    try {
      const map = parseJSON(await callLLM(SYS(LANGS[lang]), user));
      for (const s of batch) if (typeof map[s] === "string" && map[s]) dict[s] = map[s];
      writeSorted(path, dict); // persist incrementally so a crash doesn't lose progress
      console.error(`  [${lang}] ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
    } catch (e) {
      console.error(`  [${lang}] batch ${i} failed: ${e.message}`);
    }
  }
  console.error(`[${lang}] done -> ${path} (${Object.keys(dict).length} keys)`);
}
