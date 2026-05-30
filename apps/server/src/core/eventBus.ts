import type { InternalEvent, InternalEventKind, InternalEventOf } from "./contracts.js";

type Handler<K extends InternalEventKind> = (event: InternalEventOf<K>) => void;

type WildcardHandler = (event: InternalEvent) => void;

export type EventBus = {
  emit: <K extends InternalEventKind>(event: InternalEventOf<K>) => void;
  on: <K extends InternalEventKind>(kind: K, handler: Handler<K>) => () => void;
  onAny: (handler: WildcardHandler) => () => void;
};

export function createEventBus(): EventBus {
  const byKind = new Map<InternalEventKind, Set<(event: InternalEvent) => void>>();
  const wildcardHandlers = new Set<WildcardHandler>();

  return {
    emit(event) {
      for (const handler of wildcardHandlers) {
        handler(event);
      }

      const handlers = byKind.get(event.kind);
      if (!handlers) {
        return;
      }

      for (const handler of handlers) {
        handler(event);
      }
    },
    on(kind, handler) {
      const wrapped = (event: InternalEvent) => {
        if (event.kind === kind) {
          handler(event as InternalEventOf<typeof kind>);
        }
      };

      const existing = byKind.get(kind);
      if (existing) {
        existing.add(wrapped);
      } else {
        byKind.set(kind, new Set([wrapped]));
      }

      return () => {
        const current = byKind.get(kind);
        if (!current) {
          return;
        }

        current.delete(wrapped);
        if (current.size === 0) {
          byKind.delete(kind);
        }
      };
    },
    onAny(handler) {
      wildcardHandlers.add(handler);

      return () => {
        wildcardHandlers.delete(handler);
      };
    }
  };
}
