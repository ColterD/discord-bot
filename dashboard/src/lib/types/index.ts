/** Docker container types */
export interface ContainerInfo {
  id: string;
  name: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created';
  status: string;
  image: string;
  ports: PortInfo[];
  created: number;
  /** CPU usage as percentage of total system (0-100%) */
  cpu: number | null;
  /** Number of CPU cores on the system */
  cpuCores: number | null;
  memory: MemoryInfo | null;
}

export interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp';
}

export interface MemoryInfo {
  used: number;
  limit: number;
  percent: number;
}

/** GPU/VRAM types */
export interface GpuStatus {
  name: string;
  totalMB: number;
  usedMB: number;
  freeMB: number;
  usagePercent: number;
  temperature?: number;
}

/** Log entry from container logs */
export interface LogEntry {
  timestamp: string;
  message: string;
  stream: 'stdout' | 'stderr';
}

/** WebSocket message types */
export type WebSocketMessageType =
  | 'containers'
  | 'gpu'
  | 'logs'
  | 'error'
  | 'connected';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  data: T;
  timestamp: number;
}

/** API response types */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/** Container action types */
export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause';

/** Service health status */
export interface ServiceHealth {
  name: string;
  healthy: boolean;
  message?: string;
  responseTime?: number;
}

/** Dashboard stats */
export interface DashboardStats {
  totalContainers: number;
  runningContainers: number;
  stoppedContainers: number;
  totalCpu: number;
  totalMemory: MemoryInfo | null;
  gpu: GpuStatus | null;
}

/** Metric data point for time-series charts */
export interface MetricDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

/** Historical metrics data */
export interface MetricsHistory {
  cpu: MetricDataPoint[];
  memory: MetricDataPoint[];
  gpu?: MetricDataPoint[];
  vram?: MetricDataPoint[];
}

/** Container metrics snapshot */
export interface ContainerMetrics {
  containerId: string;
  containerName: string;
  cpu: number;
  memoryPercent: number;
  memoryUsed: number;
  timestamp: number;
}

/** Settings category for configuration */
export interface SettingsCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  settings: SettingItem[];
}

/** Individual setting item */
export interface SettingItem {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'secret';
  value: string | number | boolean;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  required?: boolean;
  sensitive?: boolean;
}
