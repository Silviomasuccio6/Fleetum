type LabelValue = string | number | boolean | null | undefined;

type HttpObservation = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

type PrismaObservation = {
  model?: string;
  action: string;
  durationMs: number;
  slow: boolean;
};

const HTTP_DURATION_BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DB_DURATION_BUCKETS_SECONDS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

const sanitizeLabel = (value: LabelValue) =>
  String(value ?? "unknown")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, " ");

const labelKey = (labels: Record<string, LabelValue>) =>
  Object.keys(labels)
    .sort()
    .map((key) => `${key}="${sanitizeLabel(labels[key])}"`)
    .join(",");

const metricKey = (name: string, labels: Record<string, LabelValue>) => {
  const renderedLabels = labelKey(labels);
  return renderedLabels ? `${name}{${renderedLabels}}` : name;
};

const incCounter = (name: string, labels: Record<string, LabelValue>, value = 1) => {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + value);
};

const setGauge = (name: string, labels: Record<string, LabelValue>, value: number) => {
  gauges.set(metricKey(name, labels), value);
};

const observeHistogram = (name: string, labels: Record<string, LabelValue>, buckets: number[], valueSeconds: number) => {
  for (const bucket of buckets) {
    if (valueSeconds <= bucket) incCounter(`${name}_bucket`, { ...labels, le: bucket });
  }
  incCounter(`${name}_bucket`, { ...labels, le: "+Inf" });
  incCounter(`${name}_count`, labels);
  incCounter(`${name}_sum`, labels, valueSeconds);
};

export const normalizeMetricPath = (path: string) => {
  const pathname = path.split("?")[0] || "/";
  return pathname
    .replace(/\bc[a-z0-9]{20,}\b/gi, ":id")
    .replace(/\b[0-9a-f]{24,}\b/gi, ":id")
    .replace(/\b\d+\b/g, ":id")
    .replace(/\/+/g, "/");
};

export const metrics = {
  observeHttpRequest(input: HttpObservation) {
    const labels = {
      method: input.method,
      path: normalizeMetricPath(input.path),
      status_class: `${Math.floor(input.statusCode / 100)}xx`
    };
    incCounter("fleetum_http_requests_total", labels);
    observeHistogram("fleetum_http_request_duration_seconds", labels, HTTP_DURATION_BUCKETS_SECONDS, input.durationMs / 1000);
    if (input.statusCode >= 500) incCounter("fleetum_http_errors_total", labels);
  },

  observePrismaOperation(input: PrismaObservation) {
    const labels = {
      model: input.model ?? "raw",
      action: input.action
    };
    observeHistogram("fleetum_prisma_operation_duration_seconds", labels, DB_DURATION_BUCKETS_SECONDS, input.durationMs / 1000);
    if (input.slow) incCounter("fleetum_prisma_slow_operations_total", labels);
  },

  recordPrismaError(action = "unknown") {
    incCounter("fleetum_prisma_errors_total", { action });
  },

  setDbAvailable(available: boolean) {
    setGauge("fleetum_db_available", {}, available ? 1 : 0);
  },

  renderPrometheus() {
    const lines: string[] = [
      "# HELP fleetum_http_requests_total HTTP requests by method, normalized path and status class.",
      "# TYPE fleetum_http_requests_total counter",
      "# HELP fleetum_http_request_duration_seconds HTTP request duration histogram.",
      "# TYPE fleetum_http_request_duration_seconds histogram",
      "# HELP fleetum_http_errors_total HTTP 5xx responses.",
      "# TYPE fleetum_http_errors_total counter",
      "# HELP fleetum_prisma_operation_duration_seconds Prisma operation duration histogram.",
      "# TYPE fleetum_prisma_operation_duration_seconds histogram",
      "# HELP fleetum_prisma_slow_operations_total Prisma operations slower than configured threshold.",
      "# TYPE fleetum_prisma_slow_operations_total counter",
      "# HELP fleetum_prisma_errors_total Prisma client errors.",
      "# TYPE fleetum_prisma_errors_total counter",
      "# HELP fleetum_db_available Database readiness gauge, 1 means available.",
      "# TYPE fleetum_db_available gauge"
    ];

    for (const [key, value] of counters.entries()) lines.push(`${key} ${value}`);
    for (const [key, value] of gauges.entries()) lines.push(`${key} ${value}`);
    return `${lines.join("\n")}\n`;
  }
};
