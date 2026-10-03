import { tr } from "@/lib/i18n";
import type { NewAssetType } from "@/lib/types";

const ASSET_TYPE_LABELS: Record<NewAssetType, string> = {
  app: tr("应用"),
  endpoint: tr("接口"),
  ip: "IP",
  root_domain: tr("根域名"),
  service: tr("服务"),
  subdomain: tr("子域名"),
};

const TASK_ASSET_SOURCE_LABELS: Record<string, string> = {
  agent: tr("Agent 发现"),
  anchor: tr("黑板锚点"),
  api: tr("资产 API"),
  company: tr("企业关联"),
  legacy: tr("历史关联"),
  manual: tr("人工加入"),
  system: tr("系统关联"),
  task: tr("任务初始化"),
};

export function taskAssetTypeLabel(type: NewAssetType): string {
  return ASSET_TYPE_LABELS[type];
}

export function taskAssetSourceLabel(source: string): string {
  return TASK_ASSET_SOURCE_LABELS[source] ?? source;
}
