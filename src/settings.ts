import { PluginSettingTab, Setting, Platform } from "obsidian";
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

    // Get the current language from Obsidian
    const lang = getLanguage();

    this.containerEl.createEl("h3", {
      text: t('settings-general-title', lang),
    });
    this.addDotThresholdSetting(lang);
    this.addWeekStartSetting(lang);
    this.addConfirmCreateSetting(lang);

    // Add word count background settings
    this.containerEl.createEl("h3", {
      text: t('settings-word-count-bg-title', lang),
    });
    this.addWordCountColorRangeSettings(lang);
    this.addHeatmapRefreshIntervalSetting(lang);

    this.containerEl.createEl("h3", {
      text: t("media-control-title", lang),
    });
    this.addMediaSettings(lang);

    this.containerEl.createEl("h3", {
      text: t("pomo-title", lang),
    });
    this.addPomodoroSettings(lang);

    // Calendar Sets
    mount(SettingsRouter, {
      target: this.containerEl,
      props: {
        app: this.app,
        settings: this.plugin.settings,
      },
    });
  }

  addDotThresholdSetting(lang: Language): void {
    new Setting(this.containerEl)
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

  addWeekStartSetting(lang: Language): void {
    const { moment } = window;

    const localizedWeekdays = moment.weekdays();
    const localeWeekStartNum = window._bundledLocaleWeekSpec?.dow ?? (moment.localeData() as any)._week?.dow ?? 0;
    const localeWeekStart = moment.weekdays()[localeWeekStartNum];

    new Setting(this.containerEl)
      .setName(t('settings-start-week', lang))
      .setDesc(
        t('settings-start-week-desc', lang)
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("locale", `Locale default (${localeWeekStart})`);
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

  addConfirmCreateSetting(lang: Language): void {
    new Setting(this.containerEl)
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


  addWordCountColorRangeSettings(lang: Language): void {
    const { wordCountColorRanges } = this.plugin.options;

    // Create a setting for each color range
    wordCountColorRanges.forEach((range, index) => {
      const setting = new Setting(this.containerEl)
        .setName(`${t('settings-color-range', lang)} ${index + 1}`)
        .setDesc(t('settings-color-range-desc', lang)
          .replace('{min}', range.min.toString())
          .replace('{max}', range.max === Infinity ? t('word-count-range-infinity', lang) : range.max.toString())
          .replace('{opacity}', range.opacity.toString()));

      // Create a flex container for the three inputs
      const inputsContainer = this.containerEl.createDiv();
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
    new Setting(this.containerEl)
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

  addHeatmapRefreshIntervalSetting(lang: Language): void {
    new Setting(this.containerEl)
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
    // 1. System Media Integration (Master Switch)
    if (Platform.isWin) {
      new Setting(this.containerEl)
        .setName("System Media Integration")
        .setDesc("Experimental: Show media from other apps (Spotify, Chrome) in the sidebar. Requires restart.")
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.options?.systemMedia ?? false);
          toggle.onChange(async (value) => {
            this.plugin.writeOptions(() => ({
              systemMedia: value,
            }));
            // Refresh to update dependent settings visibility
            this.display();
          });
        });
    }

    // 2. White Noise Toggle
    const isSystemMediaEnabled = Platform.isWin && this.plugin.options?.systemMedia;

    // Only show or enable White Noise settings if System Media Integration is enabled (if that's the requirement)
    // The user said "subject to the master switch control". 
    // If I interpret strictly: if Master Switch is OFF, these are hidden or disabled.
    // Given the previous functionality was independent, this is a restrictive change requested by the user.
    // I will disable them if the master switch is off (and exist).

    // Helper to check if we should enable controls
    const isEnabled = isSystemMediaEnabled;
    const disabledDesc = isEnabled ? "" : " (Requires System Media Integration enabled)";

    new Setting(this.containerEl)
      .setName(t("settings-white-noise", lang))
      .setDesc(t("settings-white-noise-desc", lang) + disabledDesc)
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options!.whiteNoise);
        toggle.setDisabled(!isEnabled);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            whiteNoise: value,
          }));
        });
      });

    // 3. Background Noise File
    new Setting(this.containerEl)
      .setName(t("settings-pomo-background-noise", lang))
      .setDesc(t("settings-pomo-background-noise-desc", lang) + disabledDesc)
      .addText((text) => {
        text.setValue(this.plugin.options.pomoBackgroundNoiseFile);
        text.setDisabled(!isEnabled);
        text.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            pomoBackgroundNoiseFile: value,
          }));
        });
      });
  }

  addPomodoroSettings(lang: Language): void {

    new Setting(this.containerEl)
      .setName(t("settings-pomo-duration", lang))
      .setDesc(t("settings-pomo-duration-desc", lang))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.options!.pomo));
        text.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            pomo: value !== "" ? Number(value) : 25,
          }));
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings-short-break", lang))
      .setDesc(t("settings-short-break-desc", lang))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.options!.shortBreak));
        text.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            shortBreak: value !== "" ? Number(value) : 5,
          }));
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings-long-break", lang))
      .setDesc(t("settings-long-break-desc", lang))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.options!.longBreak));
        text.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            longBreak: value !== "" ? Number(value) : 15,
          }));
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings-long-break-interval", lang))
      .setDesc(t("settings-long-break-interval-desc", lang))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.options!.longBreakInterval));
        text.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            longBreakInterval: value !== "" ? Number(value) : 4,
          }));
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings-continuous-mode", lang))
      .setDesc(t("settings-continuous-mode-desc", lang))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options!.continuousMode);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            continuousMode: value,
          }));
        });
      });




    new Setting(this.containerEl)
      .setName(t("settings-notification-sound", lang))
      .setDesc(t("settings-notification-sound-desc", lang))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options!.notificationSound);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            notificationSound: value,
          }));
        });
      });

    new Setting(this.containerEl)
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




    new Setting(this.containerEl)
      .setName(t("settings-use-system-notification", lang))
      .setDesc(t("settings-use-system-notification-desc", lang)) // Need to check
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.useSystemNotification);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions(() => ({
            useSystemNotification: value,
          }));
        });
      });
  }
}
