const tag = (level) => `[${level}]`;

module.exports = {
  info: (...a) => console.log(tag("info"), ...a),
  warn: (...a) => console.warn(tag("warn"), ...a),
  error: (...a) => console.error(tag("error"), ...a),
  debug: (...a) => {
    if (process.env.DEBUG) console.log(tag("debug"), ...a);
  },
};
