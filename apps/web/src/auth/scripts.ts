type Turnstile = {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};
type Google = {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        callback: (response: { credential: string }) => void;
      }): void;
      prompt(): void;
      cancel(): void;
    };
  };
};
declare global {
  interface Window {
    turnstile?: Turnstile;
    google?: Google;
  }
}
const loads = new Map<string, Promise<void>>();
export function loadScript(src: string) {
  const existing = loads.get(src);
  if (existing) return existing;
  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => resolve();
    script.onerror = () => {
      loads.delete(src);
      script.remove();
      reject(new Error('Could not load sign-in service'));
    };
    document.head.append(script);
  });
  loads.set(src, load);
  return load;
}
