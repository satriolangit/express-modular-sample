module.exports = {
  prefix: "/users",

  async init(deps) {
    const { nats, ws, logger } = deps;

    logger.info("[user-management] init");

    // ── NATS core subscribe (fire-and-forget) ──────
    const sub = nats.subscribeJson("user.created");
    (async () => {
      for await (const { data } of sub) {
        logger.info("[user-management] event: user.created", data);
      }
    })().catch((err) =>
      logger.error("[user-management] sub error", { error: err.message }),
    );

    // ── JetStream durable consumer ─────────────────
    try {
      const consumer = await nats.consume("USERS", "user-management-worker");
      const messages = await consumer.consume();

      (async () => {
        for await (const m of messages) {
          try {
            const data = JSON.parse(nats.get().sc.decode(m.data));
            logger.info("[user-management] js: message", data);
            // do work here...
            m.ack();
          } catch (err) {
            logger.error("[user-management] js handler error", {
              error: err.message,
            });
            m.nak();
          }
        }
      })().catch((err) =>
        logger.error("[user-management] consumer error", {
          error: err.message,
        }),
      );
    } catch (err) {
      logger.warn("[user-management] JetStream consumer not available", {
        error: err.message,
      });
    }

    // ── WebSocket handler ──────────────────────────
    ws.register(
      "/ws/users",
      (socket, req) => {
        logger.info("[user-management] ws connected", {
          ip: req.socket.remoteAddress,
        });

        socket.send(
          JSON.stringify({ type: "welcome", feature: "user-management" }),
        );

        socket.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            logger.debug("[user-management] ws message", msg);
            socket.send(
              JSON.stringify({ echo: msg, at: new Date().toISOString() }),
            );
          } catch (err) {
            socket.send(JSON.stringify({ error: "invalid json" }));
          }
        });

        socket.on("close", () => {
          logger.info("[user-management] ws closed");
        });
      },
      { owner: "user-management" },
    );
  },
};
