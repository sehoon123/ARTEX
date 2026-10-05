import { tr } from "@/lib/i18n";
import type { Agent, AssetInterceptRule, PromptVar, Tool } from "@/lib/types";
import originals from "./builtin-tool-descriptions.json";
import metadata from "./builtin-metadata.json";

// Display labels only. Exact defaults must match; edited/custom originals stay raw.
function agentDefault(agent: Pick<Agent, "builtin"> & Partial<Pick<Agent, "key">>) {
  return agent.builtin && agent.key && Object.hasOwn(metadata.agents, agent.key)
    ? metadata.agents[agent.key as keyof typeof metadata.agents]
    : undefined;
}

export function agentName(agent: Pick<Agent, "name" | "builtin"> & Partial<Pick<Agent, "key">>): string {
  return agentDefault(agent)?.name === agent.name ? tr(agent.name) : agent.name;
}

export function agentDescription(agent: Pick<Agent, "description" | "builtin"> & Partial<Pick<Agent, "key">>): string {
  const text = agent.description ?? "";
  return agentDefault(agent)?.description === text ? tr(text) : text;
}

export function variableDescription(variable: Pick<PromptVar, "name" | "description">, agent?: Pick<Agent, "builtin" | "key">): string {
  const defaults = (agent ? agentDefault(agent)?.variables : undefined) as Record<string, string> | undefined;
  const globals: Record<string, string> = metadata.globalVariables;
  const expected = Object.hasOwn(globals, variable.name) ? globals[variable.name]
    : defaults && Object.hasOwn(defaults, variable.name) ? defaults[variable.name] : undefined;
  return expected === variable.description ? tr(variable.description) : variable.description;
}

export function assetNote(rule: Pick<AssetInterceptRule, "builtin" | "kind" | "pattern" | "note">): string {
  return rule.builtin && metadata.assetRules.some(original =>
    original.kind === rule.kind && original.pattern === rule.pattern && original.note === rule.note)
    ? tr(rule.note) : rule.note;
}

export function toolDescription(tool: Pick<Tool, "key" | "description" | "system">): string {
  if (tool.system && Object.hasOwn(originals, tool.key) &&
      originals[tool.key as keyof typeof originals] === tool.description) {
    const key = `builtin.tool.${tool.key}.summary`;
    const text = tr(key);
    return text === key ? tool.description : text;
  }
  return tool.description;
}

// Built-in command-rule names: the rule API carries no `builtin` flag, so provenance
// comes from an exact match against the source-extracted catalogue (db/db.go `[内置]`
// names in builtin-metadata.json). A catalogued name shows its reviewed translation;
// any other name (user-created) stays raw. This is display-only; stored rule.name,
// matching, and saved payloads are never changed. A user rule copying a built-in name
// verbatim would show the same translated text — cosmetic and harmless.
const builtinInterceptNames = new Set<string>(metadata.interceptNames);
export function interceptRuleName(name: string | null | undefined): string {
  return name && builtinInterceptNames.has(name) ? tr(name) : (name ?? "");
}
