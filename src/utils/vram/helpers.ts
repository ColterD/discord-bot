/**
 * VRAM Manager Helper Functions
 *
 * Utility functions for VRAM calculations and conversions.
 *
 * @module utils/vram/helpers
 */

import { BYTES_PER_MB } from "../../constants.js";

/**
 * Convert bytes to megabytes
 */
export function bytesToMB(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}
