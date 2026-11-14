import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * In-process pub/sub that feeds Server-Sent Events. Single-instance only:
 * for >1 API replica swap this for Postgres LISTEN/NOTIFY or Redis pub/sub (same interface).
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);
export const topics = {
  restaurant: (id: string) => `r:${id}`,
  order: (id: string) => `o:${id}`,
};
export type BusEvent = { type: string; [k: string]: unknown };
export const publish = (topic: string, ev: BusEvent) => bus.emit(topic, ev);

export function openStream(req: FastifyRequest, reply: FastifyReply, subscribe: string[], hello: BusEvent) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (ev: BusEvent) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  send(hello);
  const handler = (ev: BusEvent) => send(ev);
  subscribe.forEach((t) => bus.on(t, handler));
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.raw.on('close', () => { clearInterval(ping); subscribe.forEach((t) => bus.off(t, handler)); });
}
