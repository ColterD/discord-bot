/**
 * Services Module Index
 * Re-exports all service functionality
 */

// Health Monitor Service - Self-healing infrastructure
export {
  getHealthMonitor,
  type HealthCheckResult,
  HealthMonitor,
  HealthStatus,
  type MonitoredService,
  type RecoveryResult,
  startHealthMonitor,
  stopHealthMonitor,
} from "./health-monitor.js";

// Maintenance Service - Periodic cleanup tasks
export {
  getLastMaintenanceRun,
  startMaintenanceScheduler,
  stopMaintenanceScheduler,
  triggerMaintenance,
} from "./maintenance.js";
// Notification Service - Owner alerts and DM notifications
export {
  AlertCategory,
  getNotificationService,
  NotificationService,
  type OwnerAlert,
  type RecoveryAttempt,
} from "./notifications.js";
// Scheduler Service - BullMQ-based reminder scheduling
export { getSchedulerService, SchedulerService } from "./scheduler.js";
