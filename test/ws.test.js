import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import * as ws from "../src/libs/ws.js";

async function startServer() {
  const server = http.createServer((req, res) => res.end("ok"));
  ws.init(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

async function stopServer(server) {
  await ws.close();
  await new Promise((resolve) => server.close(resolve));
}

async function requestUpgrade(port, target) {
  const socket = net.connect(port, "127.0.0.1");
  try {
    await once(socket, "connect");
    socket.write(
      `GET ${target} HTTP/1.1\r\n` +
        "Host: localhost\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    const chunk = await Promise.race([
      once(socket, "data").then(([data]) => data),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("no upgrade response")), 1_000),
      ),
    ]);
    return chunk.toString();
  } finally {
    socket.destroy();
  }
}

test("malformed upgrade target is rejected without crashing", async () => {
  const { server, port } = await startServer();
  try {
    const response = await requestUpgrade(port, "http://[::1");
    assert.match(response, /^HTTP\/1\.1 400/);
    assert.equal(server.listening, true);
  } finally {
    await stopServer(server);
  }
});

test("unknown websocket path is rejected with 404", async () => {
  const { server, port } = await startServer();
  try {
    const response = await requestUpgrade(port, "/tidak-ada");
    assert.match(response, /^HTTP\/1\.1 404/);
    assert.equal(server.listening, true);
  } finally {
    await stopServer(server);
  }
});
