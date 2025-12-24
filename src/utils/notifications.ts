// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");

export function sendSystemNotification(title: string, body: string, silent = true): void {
    if (!electron || !electron.remote) {
        console.warn("[Work Assistant] System notifications not supported or Electron not found.");
        return;
    }

    try {
        const Notification = (electron as any).remote.Notification;
        interface IElectronNotification {
            on(event: string, cb: () => void): void;
            show(): void;
            close(): void;
        }
        const n = new Notification({
            title: title,
            body: body,
            silent: silent
        }) as IElectronNotification;
        n.on("click", () => {
            n.close();
        });
        n.show();
    } catch (e) {
        console.error("[Work Assistant] Failed to send system notification:", e);
    }
}
