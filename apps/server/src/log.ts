import type { Logger } from "@home-dashboard/shared";

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function makeLogger(scope: string): Logger {
  const prefix = () => `${stamp()} [${scope}]`;
  return {
    debug: (msg, ...args) => console.debug(prefix(), msg, ...args),
    info: (msg, ...args) => console.info(prefix(), msg, ...args),
    warn: (msg, ...args) => console.warn(prefix(), msg, ...args),
    error: (msg, ...args) => console.error(prefix(), msg, ...args),
  };
}
