export function retentionDays() {
  const parsed = Number(process.env.DATA_RETENTION_DAYS || 7);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 7;
}

export function retentionDate() {
  return new Date(Date.now() + retentionDays() * 24 * 60 * 60 * 1000);
}
