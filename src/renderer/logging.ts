import * as Sentry from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';

/**
 * Initializes Sentry error tracking for the renderer process.
 * Only initializes if SENTRY_DSN is configured and not in development mode.
 */
export function init() {
  if (window.envVars.SENTRY_DSN && window.envVars.NODE_ENV !== 'development') {
    Sentry.init(
      {
        dsn: window.envVars.SENTRY_DSN,
      },
      reactInit,
    );
  }
}

/**
 * Captures and logs an exception to both console and Sentry.
 * Logs to console in all environments, sends to Sentry only in production with valid DSN.
 * @param error - The error to capture, either an Error object or string message
 */
export function captureException(error: Error | string) {
  console.error(error);
  if (window.envVars.SENTRY_DSN && window.envVars.NODE_ENV !== 'development') {
    Sentry.captureException(error);
  }
}

/**
 * Captures and logs a warning to both console and Sentry.
 * Logs to console in all environments, sends to Sentry only in production with valid DSN.
 * @param warning - The warning message to capture
 */
export function captureWarning(warning: any) {
  console.warn(warning);
  if (window.envVars.SENTRY_DSN && window.envVars.NODE_ENV !== 'development') {
    Sentry.captureMessage(warning, 'warning');
  }
}

/**
 * Logs debug messages to the console.
 * @param messages - Variable number of messages to log
 */
export function debug(...messages: any[]) {
  console.debug(messages);
}

/**
 * Logs informational messages to the console.
 * @param messages - Variable number of messages to log
 */
export function info(...messages: any[]) {
  console.info(...messages);
}

/**
 * Logs warning messages to the console.
 * @param messages - Variable number of messages to log
 */
export function warn(...messages: any[]) {
  console.warn(...messages);
}
