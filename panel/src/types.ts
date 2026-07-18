// Tipos de las respuestas del controller.

export interface SystemInfo {
  cpu_pct: number;
  ram_total_mb: number;
  ram_used_mb: number;
  ram_available_mb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  gpu: unknown | null;
}

export interface ContainerInfo {
  name: string;
  status: string;
  image: string;
}

export interface HealthModel {
  alias: string;
  model_id: string;
  status: string;
  load_time_s: number | null;
  last_used: string | null;
  n_infer: number | null;
  avg_infer_ms: number | null;
  est_ram_mb: number | null;
  error: string | null;
}

export interface ServiceHealth {
  status: string;
  rss_mb: number | null;
  models: HealthModel[];
}

export interface ServiceInfo {
  capability: string;
  title: string;
  mode: string;
  enabled: boolean;
  container_status: string | null;
  health: ServiceHealth | null;
}

export interface Overview {
  system: SystemInfo;
  containers: ContainerInfo[];
  services: ServiceInfo[];
  stats_24h: { requests: number; errors: number; avg_latency_ms: number | null };
  stats_24h_by_capability: {
    capability: string;
    requests: number;
    avg_latency_ms: number | null;
  }[];
}

export interface CapabilityRoute {
  path: string;
  op: string;
  mode: string;
  content: string;
}

export interface Capability {
  id: string;
  title: string;
  mode: string;
  service_url: string;
  container: string;
  routes: CapabilityRoute[];
  default_model: string | null;
  enabled: boolean;
  container_status: string | null;
  health: ServiceHealth | null;
}

export interface ModelRuntime {
  status: string;
  n_infer: number | null;
  avg_infer_ms: number | null;
  load_time_s: number | null;
}

export interface ModelInfo {
  id: number;
  capability: string;
  alias: string;
  model_id: string;
  adapter: string;
  version: string | null;
  framework: string | null;
  est_ram_mb: number | null;
  params: Record<string, unknown> | null;
  idle_unload_s: number | null;
  keep_warm: boolean;
  enabled: boolean;
  installed: boolean;
  notes: string | null;
  created_at: string;
  runtime: ModelRuntime | null;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface RequestLog {
  id: number;
  ts: string;
  request_id: string;
  api_key_id: number | null;
  source: string | null;
  capability: string;
  op: string | null;
  model_alias: string | null;
  status: number;
  latency_ms: number | null;
  error_code: string | null;
}

export interface TimeseriesPoint {
  bucket: string;
  requests: number;
  errors: number;
  avg_latency_ms: number | null;
}

export interface StatsSummary {
  top_models: {
    capability: string;
    model_alias: string;
    requests: number;
    avg_latency_ms: number | null;
  }[];
  top_errors: { capability: string; error_code: string; n: number }[];
}

export interface Job {
  job_id: string;
  capability: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  // el backend devuelve el error como { code, message }; se admite también cadena/null
  error: { code?: string; message?: string } | string | null;
  model_alias: string | null;
  source: string | null;
  latency_ms: number | null;
}

export interface JobDetail extends Job {
  result: unknown;
  payload: unknown;
}

export interface PlaygroundResult {
  model: string;
  status: number | string;
  latency_ms?: number;
  body?: unknown;
  job_id?: string;
}
