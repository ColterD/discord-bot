/**
 * Test runner that writes output to file for verification
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { join } from "path";

// Redirect console output to both stdout and file
const logFile: string[] = [];

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function addToLog(level: string, ...args: unknown[]) {
  const message = `[${new Date().toISOString()}] [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  logFile.push(message);
  if (level === 'ERROR') {
    originalError(...args);
  } else if (level === 'WARN') {
    originalWarn(...args);
  } else {
    originalLog(...args);
  }
}

console.log = (...args: unknown[]) => addToLog('INFO', ...args);
console.error = (...args: unknown[]) => addToLog('ERROR', ...args);
console.warn = (...args: unknown[]) => addToLog('WARN', ...args);

// Import and run the test
import("./send-test-message.js").then(async () => {
  // Test should have run via top-level await
  // Write log to file
  const logPath = join(process.cwd(), 'test-results.log');
  writeFileSync(logPath, logFile.join(''), 'utf-8');
  console.log(`\nTest results written to: ${logPath}`);
}).catch((error) => {
  console.error('Failed to run tests:', error);
  const logPath = join(process.cwd(), 'test-results.log');
  writeFileSync(logPath, logFile.join('') + `\nERROR: ${error}\n`, 'utf-8');
  process.exit(1);
});
