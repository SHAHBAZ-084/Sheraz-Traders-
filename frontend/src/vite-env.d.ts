/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    grainPos?: {
      platform: NodeJS.Platform;
      selectDirectory?: () => Promise<string | null>;
    };
  }
}
