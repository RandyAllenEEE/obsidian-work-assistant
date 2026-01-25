import "obsidian";

declare module "obsidian" {
    export class SecretComponent extends BaseComponent {
        constructor(app: App, containerEl: HTMLElement);
        setValue(value: string): this;
        onChange(cb: (value: string) => unknown): this;
    }

    export class SecretStorage {
        getSecret(id: string): string | null;
        listSecrets(): string[];
        setSecret(id: string, secret: string): void;
    }

    interface App {
        secretStorage: SecretStorage;
    }

    interface Plugin {
        app: App;
    }
}
