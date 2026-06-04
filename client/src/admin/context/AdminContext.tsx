import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_BASE } from '../../api.js';

export type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d' | '30d';
export type HealthStatus = 'Healthy' | 'Warning' | 'Critical' | 'Offline';

interface AdminState {
  globalTimeRange: TimeRange;
  systemHealth: Record<string, HealthStatus>;
  activeAlerts: AdminAlert[];
  unreadAlertCount: number;
  socketConnected: boolean;
  latestMetric: any;
}

export interface AdminAlert {
  alert_id: string;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  title: string;
  description: string;
  evidence?: Array<{ metric: string; value: number; threshold: number; unit?: string }>;
  timestamp: string;
  duration_seconds?: number;
}

type Action =
  | { type: 'range'; range: TimeRange }
  | { type: 'health'; health: Record<string, HealthStatus> }
  | { type: 'connected'; connected: boolean }
  | { type: 'metric'; metric: any }
  | { type: 'alerts'; alerts: AdminAlert[] }
  | { type: 'alert:new'; alert: AdminAlert }
  | { type: 'alert:resolve'; alertId: string }
  | { type: 'alerts:seen' };

const initialState: AdminState = {
  globalTimeRange: '1h',
  systemHealth: {
    api: 'Offline',
    workers: 'Offline',
    redis: 'Offline',
    mongodb: 'Offline',
    proxy_pool: 'Offline',
    queue: 'Offline'
  },
  activeAlerts: [],
  unreadAlertCount: 0,
  socketConnected: false,
  latestMetric: null
};

const AdminContext = createContext<{
  state: AdminState;
  socket: Socket | null;
  setRange: (range: TimeRange) => void;
  markAlertsSeen: () => void;
} | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const client = io(API_BASE, {
      path: '/admin/socket.io',
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      timeout: 10_000
    });
    setSocket(client);
    client.on('connect', () => {
      dispatch({ type: 'connected', connected: true });
      client.emit('subscribe', { pages: ['overview', 'alerts'] });
    });
    client.on('disconnect', () => dispatch({ type: 'connected', connected: false }));
    client.on('system:health', (health) => dispatch({ type: 'health', health }));
    client.on('metrics:live', (payload) => {
      dispatch({ type: 'metric', metric: payload?.metric || null });
      dispatch({ type: 'health', health: healthFromSnapshot(payload?.metric, payload?.queue) });
    });
    client.on('alerts:active', (alerts) => dispatch({ type: 'alerts', alerts }));
    client.on('alerts:new', (alert) => dispatch({ type: 'alert:new', alert }));
    client.on('alerts:resolve', (payload) => dispatch({ type: 'alert:resolve', alertId: payload.alert_id }));
    return () => {
      client.close();
    };
  }, []);

  const value = useMemo(() => ({
    state,
    socket,
    setRange: (range: TimeRange) => dispatch({ type: 'range', range }),
    markAlertsSeen: () => dispatch({ type: 'alerts:seen' })
  }), [socket, state]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

function healthFromSnapshot(metric: any, queue: any): Record<string, HealthStatus> {
  if (!metric && !queue) return initialState.systemHealth;
  return {
    api: statusFrom(metric?.api?.latency_p95 || 0, 500, 1000),
    workers: statusFrom(metric?.workers?.avg_cpu || 0, 85, 90),
    redis: statusFrom(metric?.redis?.maxmemory ? ((metric.redis?.memory_used || 0) / metric.redis.maxmemory) * 100 : 0, 75, 90),
    mongodb: statusFrom(metric?.mongodb?.latency_p95 || 0, 200, 500),
    proxy_pool: statusFromInverse(metric?.proxy_pool?.success_rate ?? 100, 85, 70),
    queue: statusFrom(queue?.backlog_growth_rate_per_min || 0, 50, 200)
  };
}

function statusFrom(value: number, warning: number, critical: number): HealthStatus {
  if (value >= critical) return 'Critical';
  if (value >= warning) return 'Warning';
  return 'Healthy';
}

function statusFromInverse(value: number, warning: number, critical: number): HealthStatus {
  if (value <= critical) return 'Critical';
  if (value <= warning) return 'Warning';
  return 'Healthy';
}

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside AdminProvider');
  return value;
}

function reducer(state: AdminState, action: Action): AdminState {
  switch (action.type) {
    case 'range':
      return { ...state, globalTimeRange: action.range };
    case 'health':
      return { ...state, systemHealth: { ...state.systemHealth, ...action.health } };
    case 'connected':
      return { ...state, socketConnected: action.connected };
    case 'metric':
      return { ...state, latestMetric: action.metric };
    case 'alerts':
      return { ...state, activeAlerts: action.alerts };
    case 'alert:new':
      return {
        ...state,
        activeAlerts: [action.alert, ...state.activeAlerts.filter((alert) => alert.alert_id !== action.alert.alert_id)],
        unreadAlertCount: state.activeAlerts.some((alert) => alert.alert_id === action.alert.alert_id) ? state.unreadAlertCount : state.unreadAlertCount + 1
      };
    case 'alert:resolve':
      return { ...state, activeAlerts: state.activeAlerts.filter((alert) => alert.alert_id !== action.alertId) };
    case 'alerts:seen':
      return { ...state, unreadAlertCount: 0 };
    default:
      return state;
  }
}
