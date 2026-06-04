import mongoose from 'mongoose';

const costMetricSchema = new mongoose.Schema({
  date: { type: Date, required: true, unique: true, index: true },
  servers_usd: { type: Number, default: 0 },
  workers_usd: { type: Number, default: 0 },
  storage_usd: { type: Number, default: 0 },
  bandwidth_usd: { type: Number, default: 0 },
  proxies_usd: { type: Number, default: 0 },
  databases_usd: { type: Number, default: 0 },
  total_daily_usd: { type: Number, default: 0 },
  total_weekly_usd: { type: Number, default: 0 },
  total_monthly_usd_projected: { type: Number, default: 0 }
});

costMetricSchema.index({ date: -1 });

export const CostMetric = mongoose.model('CostMetric', costMetricSchema);
