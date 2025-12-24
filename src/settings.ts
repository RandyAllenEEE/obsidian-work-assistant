import { PluginSettingTab, Setting, Platform, ToggleComponent } from "obsidian";
import type { App } from "obsidian";
import type { IWeekStartOption } from "obsidian-calendar-ui";
import { DEFAULT_WORDS_PER_DOT, DEFAULT_REFRESH_INTERVAL } from "src/constants";
import { t, getLanguage } from "./i18n";
import type { Language } from "./i18n";
import type { PeriodicConfig } from "src/periodic/types";
import SettingsRouter from "./periodic/settings/pages/Router.svelte";
import { mount } from "svelte";

import type CalendarPlugin from "./main";
import { DEFAULT_PERIODIC_CONFIG } from "./periodic/constants";

export interface ISettings {
  wordsPerDot: number;
  weekStart: IWeekStartOption;
  shouldConfirmBeforeCreate: boolean;
  enableCalendar: boolean;
  enablePeriodicNotes: boolean;
  enableWordCount: boolean;
  enableWordCountStatusBar: boolean;
  enableHeatmap: boolean;

  enablePeriodicNotesCalendarLinkage: boolean;

  // Periodic Notes settings
  day: PeriodicConfig;
  week: PeriodicConfig;
  month: PeriodicConfig;
  quarter: PeriodicConfig;
  year: PeriodicConfig;

  installedVersion: string;
  enableTimelineComplication: boolean;
  localeOverride: string;

  // Word count background settings
  wordCountColorRanges: Array<{ min: number; max: number; opacity: number }>;

  // Advanced settings
  heatmapRefreshInterval: number;

  // Pomodoro settings
  enablePomodoro: boolean;
  pomo: number;
  shortBreak: number;
  longBreak: number;
  longBreakInterval: number;
  continuousMode: boolean;
  whiteNoise: boolean;
  systemMedia: boolean;
  notificationSound: boolean;
  useSystemNotification: boolean;
  numAutoCycles: number;
  pomoBackgroundNoiseFile: string;
}

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const defaultSettings = Object.freeze({
  shouldConfirmBeforeCreate: true,
  enableCalendar: true,
  enablePeriodicNotes: true,
  enableWordCount: true,
  enableWordCountStatusBar: true,
  enableHeatmap: true,
  enablePeriodicNotesCalendarLinkage: true,
  weekStart: "locale" as IWeekStartOption,

  wordsPerDot: DEFAULT_WORDS_PER_DOT,

  day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
  week: { ...DEFAULT_PERIODIC_CONFIG },
  month: { ...DEFAULT_PERIODIC_CONFIG },
  quarter: { ...DEFAULT_PERIODIC_CONFIG },
  year: { ...DEFAULT_PERIODIC_CONFIG },

  installedVersion: "1.0.0",
  enableTimelineComplication: true,
  localeOverride: "system-default",

  // Default word count color ranges
  wordCountColorRanges: [
    { min: 0, max: 149, opacity: 0.44 },
    { min: 150, max: 399, opacity: 0.6 },
    { min: 400, max: 749, opacity: 0.76 },
    { min: 750, max: 1499, opacity: 0.92 },
    { min: 1500, max: Infinity, opacity: 1 }
  ],

  heatmapRefreshInterval: DEFAULT_REFRESH_INTERVAL,

  // Pomodoro defaults
  enablePomodoro: true,
  pomo: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  continuousMode: false,
  whiteNoise: false,
  systemMedia: false,
  notificationSound: true,
  useSystemNotification: false,
  numAutoCycles: 0,
  pomoBackgroundNoiseFile: "",
});


export class CalendarSettingsTab extends PluginSettingTab {
  private plugin: CalendarPlugin;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
    const lang = getLanguage();
    const { enableCalendar, enableWordCount, enablePeriodicNotes } = this.plugin.options;

    // 1. Calendar View (Master)
    this.addCollapsibleSection(
      this.containerEl,
      t('settings-calendar-view-title', lang),
      enableCalendar,
      (enabled) => {
        const updates: Partial<ISettings> = { enableCalendar: enabled };
        if (!enabled) {
          // Strict Requirement: Actively disable dependent features
          updates.enablePeriodicNotesCalendarLinkage = false;
          updates.enableHeatmap = false;
        }
        this.plugin.writeOptions(() => updates);
        this.display(); // Force refresh to update dependent states in UI
      },
      (container) => {
        this.addWeekStartSetting(container, lang);
      }
    );

    // Dependent State: Is Calendar Active?
    const isCalendarActive = enableCalendar;


    // 2. Periodic Notes
    this.addCollapsibleSection(
      this.containerEl,
      t('settings-periodic-notes-section', lang),
      enablePeriodicNotes,
      (enabled) => this.plugin.writeOptions(() => ({ enablePeriodicNotes: enabled })),
      (container) => {
        // 2.1 Calendar Linkage (Dependent on Calendar View)
        this.addSubToggle(
          container,
          t('settings-calendar-linkage-title', lang),
          t('settings-calendar-linkage-desc', lang),
          this.plugin.options.enablePeriodicNotesCalendarLinkage,
          isCalendarActive, // Enabled only if Calendar is On
          (val) => this.plugin.writeOptions(() => ({ enablePeriodicNotesCalendarLinkage: val }))
        );

        if (this.plugin.options.enablePeriodicNotesCalendarLinkage && isCalendarActive) {
          // Words Per Dot is part of linkage visualization
          const linkageSubContainer = this.createIndentedContainer(container);
          this.addDotThresholdSetting(linkageSubContainer, lang);
          // Confirm Create is strictly requested under Linkage
          this.addConfirmCreateSetting(linkageSubContainer, lang);
        }

        // 2.2 Periodic Settings (Router)
        // Check if there's a divider needed?

        // Router for granularity settings
        mount(SettingsRouter, {
          target: container,
          props: {
            app: this.app,
            settings: this.plugin.settings,
          },
        });
      }
    );

    // 3. Word Count
    this.addCollapsibleSection(
      this.containerEl,
      t('settings-word-count-section-title', lang),
      enableWordCount,
      (enabled) => this.plugin.writeOptions(() => ({ enableWordCount: enabled })),
      (container) => {

        // 3.1 Status Bar
        this.addSubToggle(
          container,
          t('settings-word-count-status-bar-title', lang),
          t('settings-word-count-status-bar-desc', lang),
          this.plugin.options.enableWordCountStatusBar,
          true,
          (val) => this.plugin.writeOptions(() => ({ enableWordCountStatusBar: val }))
        );

        // 3.2 Heatmap (Dependent on Calendar View)
        // Title from i18n
        this.addSubToggle(
          container,
          t('settings-word-count-bg-title', lang), // "Word Count Heatmap"
          t('settings-word-count-heatmap-desc', lang),
          this.plugin.options.enableHeatmap,
          isCalendarActive, // Enabled only if Calendar is On
          (val) => this.plugin.writeOptions(() => ({ enableHeatmap: val }))
        );

        if (this.plugin.options.enableHeatmap && isCalendarActive) {
          const heatmapSubContainer = this.createIndentedContainer(container);
          this.addWordCountColorRangeSettings(heatmapSubContainer, lang);
          this.addHeatmapRefreshIntervalSetting(heatmapSubContainer, lang);
        }
      }
    );

    this.addMediaSettings(lang);
    this.addPomodoroSettings(lang);
  }

  // Helper for sub-toggles
  private addSubToggle(
    container: HTMLElement,
    name: string,
    desc: string,
    value: boolean,
    enabled: boolean,
    onChange: (value: boolean) => void
  ) {
    const setting = new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addToggle(toggle => {
        toggle.setValue(value).onChange(onChange);
        if (!enabled) {
          toggle.setDisabled(true);
        }
      });

    if (!enabled) {
      setting.settingEl.style.opacity = "0.5";
      setting.setDesc(desc + ` (${t('settings-requires-calendar-view', getLanguage())})`);
    }
  }

  addDotThresholdSetting(container: HTMLElement, lang: Language): void {
    new Setting(container)
      .setName(t('settings-words-per-dot', lang))
      .setDesc(t('settings-words-per-dot-desc', lang))
      .addText((textfield) => {
        textfield.setPlaceholder(String(DEFAULT_WORDS_PER_DOT));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.wordsPerDot));
        textfield.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            wordsPerDot: value !== "" ? Number(value) : undefined,
          }));
        });
      });
  }

  addWeekStartSetting(container: HTMLElement, lang: Language): void {
    const { moment } = window;

    const localizedWeekdays = moment.weekdays();
    const localeWeekStartNum = window._bundledLocaleWeekSpec?.dow ?? (moment.localeData() as any)._week?.dow ?? 0;
    const localeWeekStart = moment.weekdays()[localeWeekStartNum];

    new Setting(container)
      .setName(t('settings-start-week', lang))
      .setDesc(
        t('settings-start-week-desc', lang)
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("locale", t('settings-locale-default', lang).replace("{day}", localeWeekStart));
        localizedWeekdays.forEach((day, i) => {
          dropdown.addOption(weekdays[i], day);
        });
        dropdown.setValue(this.plugin.options.weekStart);
        dropdown.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            weekStart: value as IWeekStartOption,
          }));
        });
      });
  }

  addConfirmCreateSetting(container: HTMLElement, lang: Language): void {
    new Setting(container)
      .setName(t('settings-confirm-create', lang))
      .setDesc(t('settings-confirm-create-desc', lang))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.shouldConfirmBeforeCreate);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            shouldConfirmBeforeCreate: value,
          }));
        });
      });
  }

  /*
    addShowWeeklyNoteSetting(lang: Language): void {
      new Setting(this.containerEl)
        .setName(t('settings-show-week-number', lang))
        .setDesc(t('settings-show-week-number-desc', lang))
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.options.showWeeklyNote);
          toggle.onChange(async (value) => {
            this.plugin.writeOptions(() => ({ showWeeklyNote: value }));
            this.display(); // show/hide weekly settings
          });
        });
    }
  */

  /*
    addWeeklyNoteFormatSetting(lang: Language): void {
      new Setting(this.containerEl)
        .setName(t('settings-weekly-note-format', lang))
        .setDesc(t('settings-weekly-note-format-desc', lang))
        .addText((textfield) => {
          textfield.setValue(this.plugin.options.weeklyNoteFormat);
          textfield.setPlaceholder(DEFAULT_WEEK_FORMAT);
          textfield.onChange(async (value) => {
            this.plugin.writeOptions(() => ({ weeklyNoteFormat: value }));
          });
        });
    }
  */

  /*
    addWeeklyNoteTemplateSetting(lang: Language): void {
      new Setting(this.containerEl)
        .setName(t('settings-weekly-note-template', lang))
        .setDesc(
          t('settings-weekly-note-template-desc', lang)
        )
        .addText((textfield) => {
          textfield.setValue(this.plugin.options.weeklyNoteTemplate);
          textfield.onChange(async (value) => {
            this.plugin.writeOptions(() => ({ weeklyNoteTemplate: value }));
          });
        });
    }
  
    addWeeklyNoteFolderSetting(lang: Language): void {
      new Setting(this.containerEl)
        .setName(t('settings-weekly-note-folder', lang))
        .setDesc(t('settings-weekly-note-folder-desc', lang))
        .addText((textfield) => {
          textfield.setValue(this.plugin.options.weeklyNoteFolder);
          textfield.onChange(async (value) => {
            this.plugin.writeOptions(() => ({ weeklyNoteFolder: value }));
          });
        });
    }
  */


  addWordCountColorRangeSettings(container: HTMLElement, lang: Language): void {
    const { wordCountColorRanges } = this.plugin.options;

    // Create a setting for each color range
    wordCountColorRanges.forEach((range, index) => {
      const setting = new Setting(container)
        .setName(`${t('settings-color-range', lang)} ${index + 1}`)
        .setDesc(t('settings-color-range-desc', lang)
          .replace('{min}', range.min.toString())
          .replace('{max}', range.max === Infinity ? t('word-count-range-infinity', lang) : range.max.toString())
          .replace('{opacity}', range.opacity.toString()));

      // Create a flex container for the three inputs
      const inputsContainer = container.createDiv();
      inputsContainer.style.display = 'flex';
      inputsContainer.style.gap = '10px';
      inputsContainer.style.marginBottom = '10px';
      inputsContainer.style.marginTop = '5px';

      // Min value input
      const minInput = inputsContainer.createEl('input', { type: 'number', placeholder: t('placeholder-min-value', lang) });
      minInput.style.width = '80px';
      minInput.value = String(range.min);

      // Disable the first range's min input and set to 0
      if (index === 0) {
        minInput.disabled = true;
        minInput.value = "0";
      }

      minInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const newRanges = [...this.plugin.options.wordCountColorRanges];
        newRanges[index].min = Number(target.value);
        this.plugin.writeOptions(() => ({
          wordCountColorRanges: newRanges,
        }));
      });

      // Max value input
      const maxInput = inputsContainer.createEl('input', { type: range.max === Infinity ? 'text' : 'number', placeholder: t('placeholder-max-value', lang) });
      maxInput.style.width = '80px';

      // Handle Infinity and disabling for the last range
      if (index === wordCountColorRanges.length - 1) {
        maxInput.type = 'text';
        maxInput.value = t('word-count-range-infinity', lang);
        maxInput.disabled = true;
      } else {
        maxInput.value = range.max === Infinity ? "" : String(range.max);
      }

      maxInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const newRanges = [...this.plugin.options.wordCountColorRanges];
        newRanges[index].max = target.value === "" ? Infinity : Number(target.value);
        this.plugin.writeOptions(() => ({
          wordCountColorRanges: newRanges,
        }));
      });

      // Opacity input
      const opacityInput = inputsContainer.createEl('input', { type: 'number', placeholder: t('placeholder-opacity', lang) });
      opacityInput.setAttr('step', '0.01');
      opacityInput.style.width = '80px';
      opacityInput.value = String(range.opacity);
      opacityInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const newRanges = [...this.plugin.options.wordCountColorRanges];
        newRanges[index].opacity = Number(target.value);
        this.plugin.writeOptions(() => ({
          wordCountColorRanges: newRanges,
        }));
      });

      // Add the container to the setting
      setting.settingEl.appendChild(inputsContainer);
    });

    // Add button to reset to default ranges
    new Setting(container)
      .setName(t('settings-reset-ranges', lang))
      .setDesc(t('settings-reset-ranges-desc', lang))
      .addButton((button) => {
        button.setButtonText(t('placeholder-reset', lang));
        button.onClick(async () => {
          this.plugin.writeOptions(() => ({
            wordCountColorRanges: [
              { min: 0, max: 149, opacity: 0.44 },
              { min: 150, max: 399, opacity: 0.6 },
              { min: 400, max: 749, opacity: 0.76 },
              { min: 750, max: 1499, opacity: 0.92 },
              { min: 1500, max: Infinity, opacity: 1 }
            ],
          }));
          this.display(); // Refresh the settings display
        });
      });
  }

  addHeatmapRefreshIntervalSetting(container: HTMLElement, lang: Language): void {
    new Setting(container)
      .setName(t('settings-heatmap-refresh-interval', lang))
      .setDesc(t('settings-heatmap-refresh-interval-desc', lang))
      .addText((textfield) => {
        textfield.setPlaceholder(String(DEFAULT_REFRESH_INTERVAL));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.heatmapRefreshInterval));
        textfield.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            heatmapRefreshInterval: value !== "" ? Number(value) : DEFAULT_REFRESH_INTERVAL,
          }));
        });
      });
  }

  addMediaSettings(lang: Language): void {
    const isWin = Platform.isWin;
    // Section Title
    const title = t("media-control-title", lang);

    this.addCollapsibleSection(
      this.containerEl,
      title,
      this.plugin.options.systemMedia,
      (enabled) => {
        // Logic to update setting
        if (!isWin && enabled) {
          // Prevent enabling on non-Windows if that's the hard constraint
          // But let's assume valid state change for now or notify user.
          // For now, allow saving, logic elsewhere handles it.
        }
        this.plugin.writeOptions(() => ({ systemMedia: enabled }));
      },
      (contentEl) => {
        // Content of the section
        if (!isWin) {
          contentEl.createDiv({ text: "Media Control is currently only supported on Windows.", cls: "setting-item-description" });
          return;
        }

        new Setting(contentEl)
          .setName("System Media Integration")
          .setDesc("Experimental: Show media from other apps (Spotify, Chrome) in the sidebar. Requires restart.")
          .addToggle(toggle => {
            toggle.setValue(this.plugin.options.systemMedia)
              .setDisabled(true); // Controlled by master switch
          });

        // White Noise Settings
        new Setting(contentEl)
          .setName(t("settings-white-noise", lang))
          .setDesc(t("settings-white-noise-desc", lang))
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.options.whiteNoise);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                whiteNoise: value,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-pomo-background-noise", lang))
          .setDesc(t("settings-pomo-background-noise-desc", lang))
          .addText((text) => {
            text.setValue(this.plugin.options.pomoBackgroundNoiseFile);
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                pomoBackgroundNoiseFile: value,
              }));
            });
          });
      }
    );
  }

  addPomodoroSettings(lang: Language): void {
    const title = t("pomo-title", lang);

    this.addCollapsibleSection(
      this.containerEl,
      title,
      this.plugin.options.enablePomodoro,
      (enabled) => {
        this.plugin.writeOptions(() => ({ enablePomodoro: enabled }));
      },
      (contentEl) => {
        // Pomodoro Settings Content
        new Setting(contentEl)
          .setName(t("settings-pomo-duration", lang))
          .setDesc(t("settings-pomo-duration-desc", lang))
          .addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(this.plugin.options.pomo));
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                pomo: value !== "" ? Number(value) : 25,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-short-break", lang))
          .setDesc(t("settings-short-break-desc", lang))
          .addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(this.plugin.options.shortBreak));
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                shortBreak: value !== "" ? Number(value) : 5,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-long-break", lang))
          .setDesc(t("settings-long-break-desc", lang))
          .addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(this.plugin.options.longBreak));
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                longBreak: value !== "" ? Number(value) : 15,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-long-break-interval", lang))
          .setDesc(t("settings-long-break-interval-desc", lang))
          .addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(this.plugin.options.longBreakInterval));
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                longBreakInterval: value !== "" ? Number(value) : 4,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-continuous-mode", lang))
          .setDesc(t("settings-continuous-mode-desc", lang))
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.options.continuousMode);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                continuousMode: value,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-notification-sound", lang))
          .setDesc(t("settings-notification-sound-desc", lang))
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.options.notificationSound);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                notificationSound: value,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-pomo-num-auto-cycles", lang))
          .setDesc(t("settings-pomo-num-auto-cycles-desc", lang))
          .addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(this.plugin.options.numAutoCycles));
            text.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                numAutoCycles: value !== "" ? Number(value) : 0,
              }));
            });
          });

        new Setting(contentEl)
          .setName(t("settings-use-system-notification", lang))
          .setDesc(t("settings-use-system-notification-desc", lang))
          .addToggle((toggle) => {
            toggle.setValue(this.plugin.options.useSystemNotification);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions(() => ({
                useSystemNotification: value,
              }));
            });
          });
      }
    );
  }

  private addCollapsibleSection(
    container: HTMLElement,
    title: string,
    enabled: boolean,
    onToggle: (value: boolean) => void,
    renderContent: (container: HTMLElement) => void
  ) {
    const details = container.createEl('details');
    details.style.marginBottom = '10px';
    details.style.border = '1px solid var(--background-modifier-border)';
    details.style.borderRadius = '6px';
    details.style.padding = '10px';

    // Default to open if enabled? Or remember state?
    // Use enabled as default/initial state? User might want to close it while enabled.
    // But if disabled, it should probably be closed.
    details.open = enabled;

    const summary = details.createEl('summary');
    summary.style.display = 'flex';
    summary.style.justifyContent = 'space-between';
    summary.style.alignItems = 'center';
    summary.style.cursor = 'pointer';
    summary.style.listStyle = 'none'; // Try to hide default marker? 
    // Note: hiding default marker on details/summary varies by browser.
    // Obsidian might have styles.

    const titleEl = summary.createDiv();
    titleEl.setText(title);
    titleEl.style.fontWeight = 'bold';
    titleEl.style.fontSize = '1.1em';

    const toggleDiv = summary.createDiv();
    const toggle = new ToggleComponent(toggleDiv);
    toggle.setValue(enabled);
    toggle.onChange((value) => {
      onToggle(value);
      // If enabled, open. If disabled, close.
      if (value) {
        details.open = true;
      } else {
        details.open = false;
      }
    });
    toggleDiv.addEventListener('click', (e) => {
      e.stopPropagation(); // vital to prevent summary toggle
    });

    // Provide visual indicator for dropdown? 
    // Default detail creates a marker. 
    // We can rely on that or style it.

    const content = details.createDiv();
    content.style.marginTop = '10px';
    content.style.paddingLeft = '10px';
    content.style.borderLeft = '2px solid var(--background-modifier-border)';

    renderContent(content);
  }

  private createIndentedContainer(parent: HTMLElement): HTMLElement {
    const container = parent.createDiv();
    container.style.borderLeft = "2px solid var(--background-modifier-border)";
    container.style.paddingLeft = "18px";
    container.style.marginLeft = "4px";
    container.style.marginTop = "8px";
    container.style.marginBottom = "8px";
    return container;
  }
}
