const winston = require("winston");
const config = require("./config");

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ── Dev formatter ────────────────────────────────────
const devFormat = printf(({ level, message, timestamp, service, ...meta }) => {
  const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `${timestamp} [${service}] ${level}: ${message}${extra}`;
});

// ── Prod formatter ───────────────────────────────────
const prodFormat = json();

const logger = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { service: config.appName, env: config.env },
  format: combine(timestamp(), errors({ stack: true })),
  transports: [
    new winston.transports.Console({
      format:
        config.env === "production"
          ? prodFormat
          : combine(colorize(), devFormat),
    }),
  ],
  // jangan exit on uncaught exception — biar app yang handle
  exitOnError: false,
});

// ── Child logger ────────────────────────────────────
logger.child = function (meta) {
  return winston.createLogger({
    level: logger.level,
    defaultMeta: { ...logger.defaultMeta, ...meta },
    format: logger.format,
    transports: logger.transports,
    exitOnError: false,
  });
};

module.exports = logger;
