export const alertThresholds = {
  flapWindowMs: Number(process.env.ADMIN_ALERT_FLAP_WINDOW_MS || 60_000),
  suppressionMs: Number(process.env.ADMIN_ALERT_SUPPRESSION_MS || 300_000),
  workerCpuAverage: {
    warning: Number(process.env.ADMIN_ALERT_WORKER_CPU_WARNING || 85),
    critical: Number(process.env.ADMIN_ALERT_WORKER_CPU_CRITICAL || 90)
  },
  queueBacklogGrowthPerMin: {
    warning: Number(process.env.ADMIN_ALERT_QUEUE_GROWTH_WARNING || 50),
    critical: Number(process.env.ADMIN_ALERT_QUEUE_GROWTH_CRITICAL || 200)
  },
  redisMemoryPercent: {
    warning: Number(process.env.ADMIN_ALERT_REDIS_MEMORY_WARNING || 75),
    critical: Number(process.env.ADMIN_ALERT_REDIS_MEMORY_CRITICAL || 90)
  },
  mongoLatencyP95Ms: {
    warning: Number(process.env.ADMIN_ALERT_MONGO_P95_WARNING_MS || 200),
    critical: Number(process.env.ADMIN_ALERT_MONGO_P95_CRITICAL_MS || 500)
  },
  proxySuccessRate: {
    warning: Number(process.env.ADMIN_ALERT_PROXY_SUCCESS_WARNING || 85),
    critical: Number(process.env.ADMIN_ALERT_PROXY_SUCCESS_CRITICAL || 70)
  },
  failureRateIncreasePercent: {
    warning: Number(process.env.ADMIN_ALERT_FAILURE_INCREASE_WARNING || 20),
    critical: Number(process.env.ADMIN_ALERT_FAILURE_INCREASE_CRITICAL || 40)
  },
  domainBlockRate: {
    warning: Number(process.env.ADMIN_ALERT_DOMAIN_BLOCK_WARNING || 30),
    critical: Number(process.env.ADMIN_ALERT_DOMAIN_BLOCK_CRITICAL || 50)
  }
} as const;
