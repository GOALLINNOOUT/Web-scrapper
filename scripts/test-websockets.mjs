#!/usr/bin/env node

import WebSocket from 'ws';
import { io } from 'socket.io-client';

const base = process.env.API_BASE || process.env.VITE_API_BASE || 'http://127.0.0.1:8080';
const deviceId = process.env.DEVICE_ID || `ws-test-${Date.now()}`;
const timeoutMs = Number(process.env.WS_TEST_TIMEOUT_MS || 10000);

async function main() {
  console.log(`API: ${base}`);
  await testLiveEvents();
  await testAdminSocket();
  console.log('WebSocket smoke test passed.');
}

function wsBase() {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

async function testLiveEvents() {
  const url = wsBase();
  url.pathname = '/events';
  url.search = `deviceId=${encodeURIComponent(deviceId)}`;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('/events WebSocket timed out'));
    }, timeoutMs);

    const socket = new WebSocket(url.toString());
    socket.on('message', (data) => {
      const text = data.toString();
      console.log(`/events message: ${text}`);
      if (text.includes('"connected"')) {
        clearTimeout(timer);
        socket.close();
        resolve();
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function testAdminSocket() {
  await new Promise((resolve, reject) => {
    const socket = io(base, {
      path: '/admin/socket.io',
      transports: ['websocket'],
      timeout: timeoutMs,
      reconnection: false
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('/admin/socket.io timed out'));
    }, timeoutMs);

    socket.on('connected', (payload) => {
      console.log(`/admin/socket.io connected: ${JSON.stringify(payload)}`);
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
