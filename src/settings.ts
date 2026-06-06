import * as obsidian from "obsidian";
import { PluginSettingTab, Setting, Platform, Notice } from "obsidian";
import type { App } from "obsidian";
import type { IWeekStartOption } from "obsidian-calendar-ui";
import { DEFAULT_WORDS_PER_DOT, DEFAULT_REFRESH_INTERVAL } from "src/constants";
import { t, getLanguage } from "./i18n";
import type { Language } from "./i18n";
import type { PeriodicConfig } from "src/periodic/types";
import { FileSuggest } from "src/periodic/ui/file-suggest";

import type CalendarPlugin from "./main";
import { DEFAULT_PERIODIC_CONFIG, DEFAULT_PERIODIC_TEMPLATE_PATH } from "./periodic/constants";

export interface TaskCalendarSettings {
  obsidianTag: string;
  caldavCategory: string;
  calendarName: string;
  serverUrl: string;
  username: string;
  passwordSecretId: string;
}

export interface TaskSyncSettings {
  enabled: boolean;
  calendar: TaskCalendarSettings;
  syncInterval: number;
  newTasksDestination: string;
  newTasksSection: string;
  excludedPaths: string[];
  autoResolveObsidianWins: boolean;
  includeObsidianLink: boolean;
  showAutoSyncNotifications: boolean;
  appliedMigrations?: string[];
}

export function createDefaultTaskCalendarSettings(): TaskCalendarSettings {
  return {
    obsidianTag: "sync",
    caldavCategory: "sync",
    calendarName: "",
    serverUrl: "",
    username: "",
    passwordSecretId: "",
  };
}

export interface ISettings {
  installedVersion: string;
  localeOverride: string; // Moved to Top Level

  assistant: {
    enabled: boolean;
    widgetOrder: string[];
    flipClock: {
      enabled: boolean;
    };
    calendar: {
      enabled: boolean;
      weekStart: IWeekStartOption;
      shouldConfirmBeforeCreate: boolean;
    };
    weather: {
      enabled: boolean;
      warnings: boolean;
      tokenSecretId: string;
      hostSecretId: string;
      city: string;
      refreshInterval: number;
      dailyRefreshInterval: number;
    };
    tasks: TaskSyncSettings;
  };

  periodicNotes: {
    enabled: boolean;
    calendarLinkage: boolean;
    wordsPerDot: number;
    day: PeriodicConfig;
    week: PeriodicConfig;
    month: PeriodicConfig;
    quarter: PeriodicConfig;
    year: PeriodicConfig;
    timelineComplication: boolean;
  };

  wordCount: {
    enabled: boolean;
    statusBar: boolean;
    statsMdPath: string;
    shockThreshold: number;
    debounceDelay: number;        // 防抖延迟时间（毫秒）
    autoSaveInterval: number;    // 自动保存间隔（毫秒）
    ignoredFiles: string[];      // 忽略计数的文件/文件夹列表
    
    heatmap: {
      enabled: boolean;
      refreshInterval: number;
      colorRanges: Array<{ min: number; max: number; opacity: number }>;
    };
  };

  pomodoro: {
    enabled: boolean;
    work: number;
    shortBreak: number;
    longBreak: number;
    longBreakInterval: number;
    continuous: boolean;
    autoCycles: number;
    notification: {
      sound: boolean;
      system: boolean;
    };
  };

  media: {
    enabled: boolean;
    trustedExeHash?: string; // Hash of the locally compiled/verified exe
  };
}

export const defaultSettings: ISettings = {
  installedVersion: "1.0.0",
  localeOverride: "system-default",

  assistant: {
    enabled: true,
    widgetOrder: ['flipClock', 'calendar', 'tasks', 'weather'],
    flipClock: {
      enabled: false,
    },
    calendar: {
      enabled: true,
      weekStart: "locale",
      shouldConfirmBeforeCreate: true,
    },
    weather: {
      enabled: false,
      warnings: false,
      tokenSecretId: "",
      hostSecretId: "",
      city: "",
      refreshInterval: 60,
      dailyRefreshInterval: 4,
    },
    tasks: {
      enabled: false,
      calendar: createDefaultTaskCalendarSettings(),
      syncInterval: 5,
      newTasksDestination: "Inbox.md",
      newTasksSection: "",
      excludedPaths: [],
      autoResolveObsidianWins: false,
      includeObsidianLink: false,
      showAutoSyncNotifications: false,
      appliedMigrations: [],
    },
  },

  periodicNotes: {
    enabled: true,
    calendarLinkage: true,
    wordsPerDot: DEFAULT_WORDS_PER_DOT,
    day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
    week: { ...DEFAULT_PERIODIC_CONFIG },
    month: { ...DEFAULT_PERIODIC_CONFIG },
    quarter: { ...DEFAULT_PERIODIC_CONFIG },
    year: { ...DEFAULT_PERIODIC_CONFIG },
    timelineComplication: true,
  },

  wordCount: {
    enabled: true,
    statusBar: true,
    statsMdPath: "stats.md",
    shockThreshold: 1000,
    debounceDelay: 2000,        // 防抖延迟时间（毫秒）
    autoSaveInterval: 30000,    // 自动保存间隔（毫秒）
    ignoredFiles: [],           // 忽略计数的文件/文件夹列表
    
    heatmap: {
      enabled: true,
      refreshInterval: DEFAULT_REFRESH_INTERVAL,
      colorRanges: [
        { min: 0, max: 149, opacity: 0.44 },
        { min: 150, max: 399, opacity: 0.6 },
        { min: 400, max: 749, opacity: 0.76 },
        { min: 750, max: 1499, opacity: 0.92 },
        { min: 1500, max: Infinity, opacity: 1 }
      ],
    },
  },

  pomodoro: {
    enabled: true,
    work: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    continuous: false,
    autoCycles: 0,
    notification: {
      sound: true,
      system: false,
    },
  },

  media: {
    enabled: false,
    trustedExeHash: "",
  },
};

export class CalendarSettingsTab extends PluginSettingTab {
  private plugin: CalendarPlugin;
  private pendingStatsMdPath: string | null = null;
  private pendingShockThreshold: number | null = null;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
    const lang = getLanguage();

    // Deconstruct NEW properties
    const { periodicNotes, wordCount } = this.plugin.options;

    // 1. General Settings (Locale)
    // 移除最上面的“常规设置”标题
    // new Setting(this.containerEl)
    //   .setName(t("settings-general-title", lang) || "General") // Fallback if key missing, but should be added
    //   .setHeading();

    this.addLocaleOverrideSetting(this.containerEl, lang);

    // 2. Assistant Panel
    this.addAssistantSettings(lang);

    // 2. Periodic Notes
    this.addCollapsibleSection(
      this.containerEl,
      t('settings-periodic-notes-section', lang),
      periodicNotes.enabled,
      (enabled) => this.plugin.writeOptions((old) => ({
        ...old,
        periodicNotes: { ...old.periodicNotes, enabled }
      })),
      (container) => {
        // Calendar Linkage
        this.addCollapsibleSection(
          container,
          t('settings-calendar-linkage-title', lang),
          periodicNotes.calendarLinkage,
          (val) => this.plugin.writeOptions((old) => ({
            ...old,
            periodicNotes: { ...old.periodicNotes, calendarLinkage: val }
          })),
          (_contentEl) => {
            // No additional settings for calendar linkage
          },
          false // Default closed
        );

        // Periodic Note Configurations
        this.addCollapsibleSection(
          container,
          t('settings-periodic-note-configs', lang),
          true,
          null,  // No state persistence - use internal state for collapsing
          (configsContainer) => {
            // Daily Notes
            this.addPeriodicNoteSetting(configsContainer, "day", t('label-periodicity-daily', lang), periodicNotes.day, lang);

            // Weekly Notes
            this.addPeriodicNoteSetting(configsContainer, "week", t('label-periodicity-weekly', lang), periodicNotes.week, lang);

            // Monthly Notes
            this.addPeriodicNoteSetting(configsContainer, "month", t('label-periodicity-monthly', lang), periodicNotes.month, lang);

            // Quarterly Notes
            this.addPeriodicNoteSetting(configsContainer, "quarter", t('label-periodicity-quarterly', lang), periodicNotes.quarter, lang);

            // Yearly Notes
            this.addPeriodicNoteSetting(configsContainer, "year", t('label-periodicity-yearly', lang), periodicNotes.year, lang);
          },
          false, // Default closed
          true   // Show toggle for collapsing/expanding
        );

        // Timeline Complication
        new Setting(container)
          .setName(t('settings-timeline-title', lang))
          .setDesc(t('settings-timeline-desc', lang))
          .addToggle((toggle) => {
            toggle.setValue(periodicNotes.timelineComplication);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions((old) => ({
                ...old,
                periodicNotes: { ...old.periodicNotes, timelineComplication: value }
              }));
            });
          });
      }
    );

    // 3. Word Count
    this.addCollapsibleSection(
      this.containerEl,
      t('settings-word-count-section-title', lang),
      wordCount.enabled,
      (enabled) => this.plugin.writeOptions((old) => ({
        ...old,
        wordCount: { ...old.wordCount, enabled }
      })),
      (container) => {
        // 3.1 Status Bar
        this.addSubToggle(
          container,
          t('settings-word-count-status-bar-title', lang),
          t('settings-word-count-status-bar-desc', lang),
          wordCount.statusBar,
          true,
          (val) => this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: { ...old.wordCount, statusBar: val }
          }))
        );

        this.addWordCountStatsMdPathSetting(container, lang);
        this.addWordCountShockThresholdSetting(container, lang);
        this.addWordCountDebounceDelaySetting(container, lang);
        this.addWordCountAutoSaveIntervalSetting(container, lang);
        this.addWordCountIgnoredFilesSetting(container, lang);

        // 3.2 Heatmap
        this.addCollapsibleSection(
          container,
          t('settings-word-count-bg-title', lang),
          wordCount.heatmap.enabled,
          (val) => this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: {
              ...old.wordCount,
              heatmap: { ...old.wordCount.heatmap, enabled: val }
            }
          })),
          (contentEl) => {
            this.addWordCountColorRangeSettings(contentEl, lang);
            this.addHeatmapRefreshIntervalSetting(contentEl, lang);
          },
          false // Default closed
        );
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
  ): void {
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

  private addAssistantSettings(lang: Language): void {
    const { assistant } = this.plugin.options;

    this.addCollapsibleSection(
        this.containerEl,
        t("settings-assistant-panel-title", lang),
        assistant.enabled, // Master toggle
        (enabled) => {
            this.plugin.writeOptions((old) => ({
                ...old,
                assistant: { ...old.assistant, enabled }
            }));
        },
        (container) => {
            // Add individual settings under Assistant Panel

            // Widget Order
            new Setting(container)
                .setName(t('settings-widget-order', lang))
                .setDesc(t('settings-widget-order-desc', lang))
                .addTextArea(textArea => {
                    textArea
                        .setValue(this.plugin.options.assistant.widgetOrder.join(', '))
                        .onChange(async (value) => {
                            const newOrder = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                            this.plugin.writeOptions(old => ({
                                ...old,
                                assistant: {
                                    ...old.assistant,
                                    widgetOrder: newOrder
                                }
                            }));
                            this.display();
                        });
                    textArea.inputEl.rows = 3;
                    textArea.inputEl.cols = 30;
                });

            // Flip Clock
            this.addCollapsibleSection(
                container,
                t('settings-show-flip-clock', lang),
                assistant.flipClock.enabled,
                (value) => {
                    this.plugin.writeOptions((old) => ({
                        ...old,
                        assistant: {
                            ...old.assistant,
                            flipClock: {
                                ...old.assistant.flipClock,
                                enabled: value
                            }
                        }
                    }));
                },
                (_contentEl) => {
                    // No additional settings for Flip Clock currently, but placeholder for future expansion
                },
                false // Default closed
            );

            // Calendar View
            this.addCollapsibleSection(
                container,
                t('settings-calendar-view-title', lang),
                assistant.calendar.enabled,
                (value) => {
                    this.plugin.writeOptions((old) => ({
                        ...old,
                        assistant: {
                            ...old.assistant,
                            calendar: {
                                ...old.assistant.calendar,
                                enabled: value
                            }
                        }
                    }));
                },
                (contentEl) => {
                    this.addDotThresholdSetting(contentEl, lang);
                    this.addWeekStartSetting(contentEl, lang);
                    this.addConfirmCreateSetting(contentEl, lang);
                },
                false // 默认收起
            );

            // Tasks
            this.addCollapsibleSection(
                container,
                t('settings-tasks-title', lang),
                assistant.tasks.enabled,
                (value) => {
                    this.plugin.writeOptions((old) => ({
                        ...old,
                        assistant: {
                            ...old.assistant,
                            tasks: {
                                ...old.assistant.tasks,
                                enabled: value
                            }
                        }
                    }));
                },
                (contentEl) => {
                    this.addTaskSyncSettings(contentEl, lang);
                },
                false
            );

            // Weather
            this.addCollapsibleSection(
                container,
                t('settings-weather-title', lang),
                assistant.weather.enabled,
                (value) => {
                    this.plugin.writeOptions((old) => ({
                        ...old,
                        assistant: {
                            ...old.assistant,
                            weather: {
                                ...old.assistant.weather,
                                enabled: value
                            }
                        }
                    }));
                },
                (contentEl) => {
                    // City
                    new Setting(contentEl)
                      .setName(t("settings-weather-city", lang))
                      .setDesc(t("settings-weather-city-desc", lang))
                      .addText(text => {
                        text.setPlaceholder("Beijing, Shanghai");
                        text.setValue(assistant.weather.city);
                        text.onChange(async (value) => {
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: {
                              ...old.assistant,
                              weather: { ...old.assistant.weather, city: value }
                            }
                          }));
                        });
                      });

                    // Token Secret
                    const tokenSetting = new Setting(contentEl)
                      .setName(t("settings-weather-token", lang))
                      .setDesc(t("settings-weather-token-desc", lang));
                    const SecretComponent = (obsidian as any).SecretComponent;
                    if (SecretComponent && this.app.secretStorage) {
                      const sc = new SecretComponent(this.app, tokenSetting.controlEl);
                      sc.setValue(assistant.weather.tokenSecretId || "");
                      sc.onChange(async (value: string) => {
                        this.plugin.writeOptions((old) => ({
                          ...old,
                          assistant: { ...old.assistant, weather: { ...old.assistant.weather, tokenSecretId: value } }
                        }));
                      });
                    } else {
                      tokenSetting.addText(text => {
                        text.inputEl.type = "password";
                        text.setValue(assistant.weather.tokenSecretId || "");
                        text.onChange(async (value) => {
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: { ...old.assistant, weather: { ...old.assistant.weather, tokenSecretId: value } }
                          }));
                        });
                      });
                    }

                    // Host Secret
                    const hostSetting = new Setting(contentEl)
                      .setName(t("settings-weather-host", lang))
                      .setDesc(t("settings-weather-host-desc", lang));
                    if (SecretComponent && this.app.secretStorage) {
                      const sc = new SecretComponent(this.app, hostSetting.controlEl);
                      sc.setValue(assistant.weather.hostSecretId || "");
                      sc.onChange(async (value: string) => {
                        this.plugin.writeOptions((old) => ({
                          ...old,
                          assistant: { ...old.assistant, weather: { ...old.assistant.weather, hostSecretId: value } }
                        }));
                      });
                    } else {
                      hostSetting.addText(text => {
                        text.setPlaceholder("e.g. abc-123.qweatherapi.com");
                        text.setValue(assistant.weather.hostSecretId || "");
                        text.onChange(async (value) => {
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: { ...old.assistant, weather: { ...old.assistant.weather, hostSecretId: value } }
                          }));
                        });
                      });
                    }

                    // Refresh Interval
                    new Setting(contentEl)
                      .setName(t("settings-weather-interval", lang))
                      .setDesc(t("settings-weather-interval-desc", lang))
                      .addText(text => {
                        text.inputEl.type = "number";
                        text.setValue(String(assistant.weather.refreshInterval));
                        text.onChange(async (value) => {
                          const num = parseInt(value);
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: {
                              ...old.assistant,
                              weather: { ...old.assistant.weather, refreshInterval: num }
                            }
                          }));
                        });
                      });

                    // Daily Refresh Interval
                    new Setting(contentEl)
                      .setName(t("settings-weather-daily-interval", lang))
                      .setDesc(t("settings-weather-daily-interval-desc", lang))
                      .addText(text => {
                        text.inputEl.type = "number";
                        text.setValue(String(assistant.weather.dailyRefreshInterval));
                        text.onChange(async (value) => {
                          const num = parseInt(value);
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: {
                              ...old.assistant,
                              weather: { ...old.assistant.weather, dailyRefreshInterval: num }
                            }
                          }));
                        });
                      });

                    // Warnings
                    new Setting(contentEl)
                      .setName(t("settings-weather-warnings-enable", lang))
                      .setDesc(t("settings-weather-warnings-desc", lang))
                      .addToggle(toggle => {
                        toggle.setValue(assistant.weather.warnings);
                        toggle.onChange(async (value) => {
                          this.plugin.writeOptions((old) => ({
                            ...old,
                            assistant: {
                              ...old.assistant,
                              weather: { ...old.assistant.weather, warnings: value }
                            }
                          }));
                        });
                      });
                },
                false // 默认收起
            );
        }
    );
}

  addDotThresholdSetting(container: HTMLElement, lang: Language): void {
    new Setting(container)
      .setName(t('settings-words-per-dot', lang))
      .setDesc(t('settings-words-per-dot-desc', lang))
      .addText((textfield) => {
        textfield.setPlaceholder(String(DEFAULT_WORDS_PER_DOT));
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.periodicNotes.wordsPerDot));
        textfield.onChange(async (value) => {
          const num = value !== "" ? Number(value) : DEFAULT_WORDS_PER_DOT;
          this.plugin.writeOptions((old) => ({
            ...old,
            periodicNotes: { ...old.periodicNotes, wordsPerDot: num }
          }));
        });
      });
  }

  addWeekStartSetting(container: HTMLElement, lang: Language): void {
    const { moment } = window;
    const localizedWeekdays = moment.weekdays();
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const localeWeekStartNum = window._bundledLocaleWeekSpec?.dow ?? (moment.localeData() as any)._week?.dow ?? 0;
    const localeWeekStart = moment.weekdays()[localeWeekStartNum];

    new Setting(container)
      .setName(t('settings-start-week', lang))
      .setDesc(t('settings-start-week-desc', lang))
      .addDropdown((dropdown) => {
        dropdown.addOption("locale", t('settings-locale-default', lang).replace("{day}", localeWeekStart));
        localizedWeekdays.forEach((day, i) => {
          dropdown.addOption(weekdays[i], day);
        });
        dropdown.setValue(this.plugin.options.assistant.calendar.weekStart);
        dropdown.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              calendar: { ...old.assistant.calendar, weekStart: value as IWeekStartOption }
            }
          }));
        });
      });
  }

  addLocaleOverrideSetting(container: HTMLElement, lang: Language): void {
    const sysLocale = navigator.language?.toLowerCase();

    new Setting(container)
      .setName(t('settings-override-locale', lang))
      .setDesc(t('settings-override-locale-desc', lang))
      .addDropdown((dropdown) => {
        dropdown.addOption("system-default", t('settings-locale-default', lang).replace("{day}", sysLocale));
        window.moment.locales().forEach((locale) => {
          dropdown.addOption(locale, locale);
        });
        // Use new path
        dropdown.setValue(this.plugin.options.localeOverride);

        dropdown.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            localeOverride: value
          }));
          window.moment.locale(value === 'system-default' ? sysLocale : value);

          // Refresh to apply locale-based defaults (like Weather city placeholder)
          this.display();
        });
      });
  }

  addConfirmCreateSetting(container: HTMLElement, lang: Language): void {
    new Setting(container)
      .setName(t('settings-confirm-create', lang))
      .setDesc(t('settings-confirm-create-desc', lang))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.assistant.calendar.shouldConfirmBeforeCreate);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              calendar: { ...old.assistant.calendar, shouldConfirmBeforeCreate: value }
            }
          }));
        });
      });
  }

  addWordCountColorRangeSettings(container: HTMLElement, lang: Language): void {
    const { colorRanges } = this.plugin.options.wordCount.heatmap;

    colorRanges.forEach((range, index) => {
      const setting = new Setting(container)
        .setName(`${t('settings-color-range', lang)} ${index + 1}`)
        .setDesc(t('settings-color-range-desc', lang)
          .replace('{min}', range.min.toString())
          .replace('{max}', range.max === Infinity ? t('word-count-range-infinity', lang) : range.max.toString())
          .replace('{opacity}', range.opacity.toString()));

      const inputsContainer = container.createDiv();
      inputsContainer.style.display = 'flex';
      inputsContainer.style.gap = '10px';
      inputsContainer.style.marginBottom = '10px';
      inputsContainer.style.marginTop = '5px';

      const minInput = inputsContainer.createEl('input', { type: 'number', placeholder: t('placeholder-min-value', lang) });
      minInput.style.width = '80px';
      minInput.value = String(range.min);

      if (index === 0) {
        minInput.disabled = true;
        minInput.value = "0";
      }

      minInput.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLInputElement;
        // Deep copy ranges
        const newRanges = JSON.parse(JSON.stringify(this.plugin.options.wordCount.heatmap.colorRanges));
        newRanges[index].min = Number(target.value);
        this.plugin.writeOptions((old) => ({
          ...old,
          wordCount: {
            ...old.wordCount,
            heatmap: { ...old.wordCount.heatmap, colorRanges: newRanges }
          }
        }));
      });

      const maxInput = inputsContainer.createEl('input', { type: range.max === Infinity ? 'text' : 'number', placeholder: t('placeholder-max-value', lang) });
      maxInput.style.width = '80px';

      if (index === colorRanges.length - 1) {
        maxInput.type = 'text';
        maxInput.value = t('word-count-range-infinity', lang);
        maxInput.disabled = true;
      } else {
        maxInput.value = range.max === Infinity ? "" : String(range.max);
      }

      maxInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const newRanges = JSON.parse(JSON.stringify(this.plugin.options.wordCount.heatmap.colorRanges));
        newRanges[index].max = target.value === "" ? Infinity : Number(target.value);
        this.plugin.writeOptions((old) => ({
          ...old,
          wordCount: {
            ...old.wordCount,
            heatmap: { ...old.wordCount.heatmap, colorRanges: newRanges }
          }
        }));
      });

      const opacityInput = inputsContainer.createEl('input', { type: 'number', placeholder: t('placeholder-opacity', lang) });
      opacityInput.setAttr('step', '0.01');
      opacityInput.style.width = '80px';
      opacityInput.value = String(range.opacity);
      opacityInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const newRanges = JSON.parse(JSON.stringify(this.plugin.options.wordCount.heatmap.colorRanges));
        newRanges[index].opacity = Number(target.value);
        this.plugin.writeOptions((old) => ({
          ...old,
          wordCount: {
            ...old.wordCount,
            heatmap: { ...old.wordCount.heatmap, colorRanges: newRanges }
          }
        }));
      });

      setting.settingEl.appendChild(inputsContainer);
    });

    // Reset button
    new Setting(container)
      .setName(t('settings-reset-ranges', lang))
      .setDesc(t('settings-reset-ranges-desc', lang))
      .addButton((button) => {
        button.setButtonText(t('placeholder-reset', lang));
        button.onClick(async () => {
          const defaultRanges = [
            { min: 0, max: 149, opacity: 0.44 },
            { min: 150, max: 399, opacity: 0.6 },
            { min: 400, max: 749, opacity: 0.76 },
            { min: 750, max: 1499, opacity: 0.92 },
            { min: 1500, max: Infinity, opacity: 1 }
          ];
          this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: {
              ...old.wordCount,
              heatmap: { ...old.wordCount.heatmap, colorRanges: defaultRanges }
            }
          }));
          this.display();
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
        textfield.setValue(String(this.plugin.options.wordCount.heatmap.refreshInterval));
        textfield.onChange(async (value) => {
          const num = value !== "" ? Number(value) : DEFAULT_REFRESH_INTERVAL;
          this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: {
              ...old.wordCount,
              heatmap: { ...old.wordCount.heatmap, refreshInterval: num }
            }
          }));
        });
      });
  }

  addWordCountStatsMdPathSetting(container: HTMLElement, lang: Language): void {
    const title = t("settings-word-count-stats-md-path", lang);
    const desc = t("settings-word-count-stats-md-path-desc", lang);

    new Setting(container)
      .setName(title)
      .setDesc(desc)
      .addText((textfield) => {
        textfield.setPlaceholder("stats.md");
        textfield.setValue(this.plugin.options.wordCount.statsMdPath);
        textfield.onChange(async (value) => {
          this.pendingStatsMdPath = value.trim();
          // We'll save in onSettingsUpdate which is debounced
        });
      });
  }

  addWordCountShockThresholdSetting(container: HTMLElement, lang: Language): void {
    const title = t("settings-word-count-shock-threshold", lang);
    const desc = t("settings-word-count-shock-threshold-desc", lang);

    new Setting(container)
      .setName(title)
      .setDesc(desc)
      .addText((textfield) => {
        textfield.setPlaceholder("1000");
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.wordCount.shockThreshold));
        textfield.onChange(async (value) => {
          const parsed = value !== "" ? Number(value) : 1000;
          const valid = Number.isInteger(parsed) && (parsed === -1 || parsed > 0);
          if (!valid) {
            new Notice(
              lang === "zh-cn"
                ? `大变化阈值必须为 -1（禁用）或正整数，已回退为默认值 ${defaultSettings.wordCount.shockThreshold}`
                : `Shock threshold must be -1 (disable) or a positive integer. Reverted to default: ${defaultSettings.wordCount.shockThreshold}`
            );
            this.pendingShockThreshold = defaultSettings.wordCount.shockThreshold;
          } else {
            this.pendingShockThreshold = parsed;
          }
          // We'll save in onSettingsUpdate which is debounced
        });
      });
  }

  addWordCountDebounceDelaySetting(container: HTMLElement, lang: Language): void {
    const title = t("settings-word-count-debounce-delay", lang);
    const desc = t("settings-word-count-debounce-delay-desc", lang);

    new Setting(container)
      .setName(title)
      .setDesc(desc)
      .addText((textfield) => {
        textfield.setPlaceholder("2000");
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.wordCount.debounceDelay));
        textfield.onChange(async (value) => {
          const num = value !== "" ? Number(value) : 2000;
          this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: {
              ...old.wordCount,
              debounceDelay: num
            }
          }));
        });
      });
  }

  addWordCountAutoSaveIntervalSetting(container: HTMLElement, lang: Language): void {
    const title = t("settings-word-count-auto-save-interval", lang);
    const desc = t("settings-word-count-auto-save-interval-desc", lang);

    new Setting(container)
      .setName(title)
      .setDesc(desc)
      .addText((textfield) => {
        textfield.setPlaceholder("30000");
        textfield.inputEl.type = "number";
        textfield.setValue(String(this.plugin.options.wordCount.autoSaveInterval));
        textfield.onChange(async (value) => {
          const num = value !== "" ? Number(value) : 30000;
          this.plugin.writeOptions((old) => ({
            ...old,
            wordCount: {
              ...old.wordCount,
              autoSaveInterval: num
            }
          }));
        });
      });
  }

  addWordCountIgnoredFilesSetting(container: HTMLElement, lang: Language): void {
    const title = t("settings-word-count-ignored-files", lang);
    const desc = t("settings-word-count-ignored-files-desc", lang);
    const placeholder = `Inbox/example.md    # Exact file match
Inbox/              # Folder prefix match (includes subfolders)
/^tmp-.*$/         # Regex (wrapped in / /)`;

    // Debounce helper - waits for user to stop typing before applying
    const debouncedUpdate = (() => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      return (fn: () => void, delay = 1000) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(fn, delay);
      };
    })();

    new Setting(container)
      .setName(title)
      .setDesc(desc)
      .addTextArea((textArea) => {
        textArea.setPlaceholder(placeholder);
        textArea.setValue(this.plugin.options.wordCount.ignoredFiles?.join("\n") ?? "");
        textArea.inputEl.rows = 5;
        textArea.inputEl.style.width = "100%";
        textArea.onChange((value) => {
          const lines = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
          // Debounce the settings update to avoid frequent triggering
          debouncedUpdate(() => {
            this.plugin.writeOptions((old) => ({
              ...old,
              wordCount: {
                ...old.wordCount,
                ignoredFiles: lines
              }
            }));
          }, 1000);
        });
      });
  }

  private addTaskSyncSettings(container: HTMLElement, lang: Language): void {
    const tasks = this.plugin.options.assistant.tasks;

    new Setting(container)
      .setName(t("settings-tasks-sync-interval", lang))
      .setDesc(t("settings-tasks-sync-interval-desc", lang))
      .addText((text) => {
        text.inputEl.type = "number";
        text.setPlaceholder("5");
        text.setValue(String(tasks.syncInterval));
        text.onChange(async (value) => {
          const syncInterval = Math.max(0, Number.parseInt(value, 10) || 0);
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, syncInterval },
            },
          }));
        });
      });

    new Setting(container)
      .setName(t("settings-tasks-new-destination", lang))
      .setDesc(t("settings-tasks-new-destination-desc", lang))
      .addText((text) => {
        text.setPlaceholder("Inbox.md");
        text.setValue(tasks.newTasksDestination);
        text.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, newTasksDestination: value.trim() || "Inbox.md" },
            },
          }));
        });
      });

    new Setting(container)
      .setName(t("settings-tasks-new-section", lang))
      .setDesc(t("settings-tasks-new-section-desc", lang))
      .addText((text) => {
        text.setPlaceholder("Tasks");
        text.setValue(tasks.newTasksSection);
        text.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, newTasksSection: value.trim() },
            },
          }));
        });
      });

    this.addTaskExcludedPathsSetting(container, lang);

    new Setting(container)
      .setName(t("settings-tasks-obsidian-wins", lang))
      .setDesc(t("settings-tasks-obsidian-wins-desc", lang))
      .addToggle((toggle) => {
        toggle.setValue(tasks.autoResolveObsidianWins);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, autoResolveObsidianWins: value },
            },
          }));
        });
      });

    new Setting(container)
      .setName(t("settings-tasks-include-link", lang))
      .setDesc(t("settings-tasks-include-link-desc", lang))
      .addToggle((toggle) => {
        toggle.setValue(tasks.includeObsidianLink);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, includeObsidianLink: value },
            },
          }));
        });
      });

    new Setting(container)
      .setName(t("settings-tasks-auto-notices", lang))
      .setDesc(t("settings-tasks-auto-notices-desc", lang))
      .addToggle((toggle) => {
        toggle.setValue(tasks.showAutoSyncNotifications);
        toggle.onChange(async (value) => {
          this.plugin.writeOptions((old) => ({
            ...old,
            assistant: {
              ...old.assistant,
              tasks: { ...old.assistant.tasks, showAutoSyncNotifications: value },
            },
          }));
        });
      });

    this.addTaskCalendarSettings(container, lang, tasks.calendar);
  }

  private addTaskCalendarSettings(
    container: HTMLElement,
    lang: Language,
    calendar: TaskCalendarSettings
  ): void {
    new Setting(container)
      .setName(t("settings-tasks-calendar", lang))
      .setHeading();

    this.addTaskCalendarTextSetting(container, "calendarName", t("settings-tasks-calendar-name", lang), t("settings-tasks-calendar-name-desc", lang), "Work");
    this.addTaskCalendarTextSetting(container, "serverUrl", t("settings-tasks-server-url", lang), t("settings-tasks-server-url-desc", lang), "https://caldav.example.com");
    this.addTaskCalendarTextSetting(container, "username", t("settings-tasks-username", lang), "", "username");
    this.addTaskPasswordSetting(container, lang, calendar);
    this.addTaskCalendarTextSetting(container, "obsidianTag", t("settings-tasks-obsidian-tag", lang), t("settings-tasks-obsidian-tag-desc", lang), "sync");
    this.addTaskCalendarTextSetting(container, "caldavCategory", t("settings-tasks-caldav-category", lang), t("settings-tasks-caldav-category-desc", lang), "sync");
  }

  private addTaskCalendarTextSetting(
    container: HTMLElement,
    key: keyof Pick<TaskCalendarSettings, "calendarName" | "serverUrl" | "username" | "obsidianTag" | "caldavCategory">,
    name: string,
    desc: string,
    placeholder: string
  ): void {
    const calendar = this.plugin.options.assistant.tasks.calendar;
    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setPlaceholder(placeholder);
        text.setValue(calendar?.[key] ?? "");
        text.onChange(async (value) => {
          this.updateTaskCalendar({ [key]: value } as Partial<TaskCalendarSettings>);
        });
      });
  }

  private addTaskPasswordSetting(
    container: HTMLElement,
    lang: Language,
    calendar: TaskCalendarSettings
  ): void {
    const passwordSetting = new Setting(container)
      .setName(t("settings-tasks-password", lang))
      .setDesc(t("settings-tasks-password-desc", lang));
    const SecretComponent = (obsidian as any).SecretComponent;
    if (SecretComponent && this.app.secretStorage) {
      const sc = new SecretComponent(this.app, passwordSetting.controlEl);
      sc.setValue(calendar.passwordSecretId || "");
      sc.onChange(async (value: string) => {
        this.updateTaskCalendar({ passwordSecretId: value });
      });
    } else {
      passwordSetting.controlEl.createDiv({
        cls: "setting-item-description",
        text: t("settings-tasks-secret-unavailable", lang),
      });
    }
  }

  private addTaskExcludedPathsSetting(container: HTMLElement, lang: Language): void {
    const placeholder = `Inbox/example.md    # Exact file match
Inbox/              # Folder prefix match (includes subfolders)
/^tmp-.*$/         # Regex (wrapped in / /)`;
    const debouncedUpdate = (() => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      return (fn: () => void, delay = 1000) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(fn, delay);
      };
    })();

    new Setting(container)
      .setName(t("settings-tasks-excluded-paths", lang))
      .setDesc(t("settings-tasks-excluded-paths-desc", lang))
      .addTextArea((textArea) => {
        textArea.setPlaceholder(placeholder);
        textArea.setValue(this.plugin.options.assistant.tasks.excludedPaths?.join("\n") ?? "");
        textArea.inputEl.rows = 5;
        textArea.inputEl.style.width = "100%";
        textArea.onChange((value) => {
          const excludedPaths = value.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
          debouncedUpdate(() => {
            this.plugin.writeOptions((old) => ({
              ...old,
              assistant: {
                ...old.assistant,
                tasks: { ...old.assistant.tasks, excludedPaths },
              },
            }));
          }, 1000);
        });
      });
  }

  private updateTaskCalendar(patch: Partial<TaskCalendarSettings>): void {
    this.plugin.writeOptions((old) => ({
      ...old,
      assistant: {
        ...old.assistant,
        tasks: {
          ...old.assistant.tasks,
          calendar: { ...old.assistant.tasks.calendar, ...patch },
        },
      },
    }));
  }

  addMediaSettings(lang: Language): void {
    const isWin = Platform.isWin;
    const title = t("media-control-title", lang);
    const { enabled } = this.plugin.options.media;

    this.addCollapsibleSection(
      this.containerEl,
      title,
      enabled,
      (val) => {
        this.plugin.writeOptions((old) => ({
          ...old,
          media: { ...old.media, enabled: val }
        }));
      },
      (contentEl) => {
        if (!isWin) {
          contentEl.createDiv({ text: t("settings-media-windows-only", lang), cls: "setting-item-description" });
        }
      }
    );
  }

  addPomodoroSettings(lang: Language): void {
    const title = t("pomo-title", lang);
    const pomo = this.plugin.options.pomodoro;

    this.addCollapsibleSection(
      this.containerEl,
      title,
      pomo.enabled,
      (enabled) => this.plugin.writeOptions((old) => ({
        ...old,
        pomodoro: { ...old.pomodoro, enabled }
      })),
      (container) => {
        // Time Settings (sub-collapsible section with expand/collapse toggle)
        this.addCollapsibleSection(
          container,
          t("settings-pomo-time-settings", lang),
          true,
          null,  // No state change
          (timeContentEl) => {
            new Setting(timeContentEl)
              .setName(t("settings-pomo-work", lang))
              .setDesc(t("settings-pomo-work-desc", lang))
              .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(pomo.work));
                text.onChange(async (value) => {
                  const num = parseInt(value);
                  this.plugin.writeOptions((old) => ({
                    ...old,
                    pomodoro: { ...old.pomodoro, work: num }
                  }));
                });
              });

            new Setting(timeContentEl)
              .setName(t("settings-pomo-short-break", lang))
              .setDesc(t("settings-pomo-short-break-desc", lang))
              .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(pomo.shortBreak));
                text.onChange(async (value) => {
                  const num = parseInt(value);
                  this.plugin.writeOptions((old) => ({
                    ...old,
                    pomodoro: { ...old.pomodoro, shortBreak: num }
                  }));
                });
              });

            new Setting(timeContentEl)
              .setName(t("settings-pomo-long-break", lang))
              .setDesc(t("settings-pomo-long-break-desc", lang))
              .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(pomo.longBreak));
                text.onChange(async (value) => {
                  const num = parseInt(value);
                  this.plugin.writeOptions((old) => ({
                    ...old,
                    pomodoro: { ...old.pomodoro, longBreak: num }
                  }));
                });
              });

            new Setting(timeContentEl)
              .setName(t("settings-pomo-long-break-interval", lang))
              .setDesc(t("settings-pomo-long-break-interval-desc", lang))
              .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(pomo.longBreakInterval));
                text.onChange(async (value) => {
                  const num = parseInt(value);
                  this.plugin.writeOptions((old) => ({
                    ...old,
                    pomodoro: { ...old.pomodoro, longBreakInterval: num }
                  }));
                });
              });

            new Setting(timeContentEl)
              .setName(t("settings-pomo-auto-cycles", lang))
              .setDesc(t("settings-pomo-auto-cycles-desc", lang))
              .addText((text) => {
                text.inputEl.type = "number";
                text.setValue(String(pomo.autoCycles));
                text.onChange(async (value) => {
                  const num = parseInt(value);
                  this.plugin.writeOptions((old) => ({
                    ...old,
                    pomodoro: { ...old.pomodoro, autoCycles: num }
                  }));
                });
              });

            new Setting(timeContentEl)
              .setName(t("settings-pomo-continuous", lang))
              .setDesc(t("settings-pomo-continuous-desc", lang))
              .addToggle(toggle => toggle
                .setValue(pomo.continuous)
                .onChange(val => this.plugin.writeOptions((old) => ({
                  ...old,
                  pomodoro: { ...old.pomodoro, continuous: val }
                })))
              );
          },
          false, // Default closed
          true   // Show toggle for collapsing/expanding
        );

        // Notification Settings (sub-collapsible section with expand/collapse toggle)
        this.addCollapsibleSection(
          container,
          t("settings-notification-settings", lang),
          true,
          null,  // No state change
          (notificationContentEl) => {
            new Setting(notificationContentEl)
              .setName(t("settings-notification-sound", lang))
              .setDesc(t("settings-notification-sound-desc", lang))
              .addToggle(toggle => toggle
                .setValue(pomo.notification.sound)
                .onChange(val => this.plugin.writeOptions((old) => ({
                  ...old,
                  pomodoro: {
                    ...old.pomodoro,
                    notification: { ...old.pomodoro.notification, sound: val }
                  }
                })))
              );

            new Setting(notificationContentEl)
              .setName(t("settings-use-system-notification", lang))
              .setDesc(t("settings-use-system-notification-desc", lang))
              .addToggle(toggle => toggle
                .setValue(pomo.notification.system)
                .onChange(val => this.plugin.writeOptions((old) => ({
                  ...old,
                  pomodoro: {
                    ...old.pomodoro,
                    notification: { ...old.pomodoro.notification, system: val }
                  }
                })))
              );
          },
          false, // Default closed
          true   // Show toggle for collapsing/expanding
        );
      }
    );
  }

  private createIndentedContainer(parent: HTMLElement): HTMLElement {
    const container = parent.createDiv();
    container.style.paddingLeft = "15px";
    return container;
  }

  private addPeriodicNoteSetting(
    container: HTMLElement,
    granularity: "day" | "week" | "month" | "quarter" | "year",
    label: string,
    config: PeriodicConfig,
    lang: Language
  ): void {
    const capitalLabel = label.charAt(0).toUpperCase() + label.slice(1);
    this.addCollapsibleSection(
      container,
      capitalLabel,
      config.enabled,
      (enabled) => {
        this.plugin.writeOptions((old) => ({
          ...old,
          periodicNotes: {
            ...old.periodicNotes,
            [granularity]: { ...old.periodicNotes[granularity], enabled }
          }
        }));
      },
      (contentEl) => {
        // Format
        new Setting(contentEl)
          .setName(t("settings-periodic-format", lang))
          .setDesc(t("settings-periodic-format-desc", lang))
          .addText((textfield) => {
            textfield.setPlaceholder("YYYY-MM-DD");
            textfield.setValue(config.format);
            textfield.onChange(async (value) => {
              this.plugin.writeOptions((old) => ({
                ...old,
                periodicNotes: {
                  ...old.periodicNotes,
                  [granularity]: { ...old.periodicNotes[granularity], format: value }
                }
              }));
            });
          });

        // Folder
        new Setting(contentEl)
          .setName(t("settings-periodic-folder", lang))
          .setDesc(t("settings-periodic-folder-desc", lang))
          .addText((textfield) => {
            textfield.setPlaceholder("Daily/");
            textfield.setValue(config.folder);
            textfield.onChange(async (value) => {
              this.plugin.writeOptions((old) => ({
                ...old,
                periodicNotes: {
                  ...old.periodicNotes,
                  [granularity]: { ...old.periodicNotes[granularity], folder: value }
                }
              }));
            });
          });

        // Template
        const templateTitleKey = `template-title-${granularity}` as Parameters<typeof t>[0];
        new Setting(contentEl)
          .setName(t(templateTitleKey, lang))
          .setDesc(t("settings-common-template-desc", lang))
          .addText((textfield) => {
            textfield.setPlaceholder(DEFAULT_PERIODIC_TEMPLATE_PATH[granularity]);
            textfield.setValue(config.templatePath ?? "");
            new FileSuggest(this.app, textfield.inputEl);
            textfield.onChange(async (value) => {
              this.plugin.writeOptions((old) => ({
                ...old,
                periodicNotes: {
                  ...old.periodicNotes,
                  [granularity]: {
                    ...old.periodicNotes[granularity],
                    templatePath: value.trim()
                  }
                }
              }));
            });
          });

        // Open at Startup
        new Setting(contentEl)
          .setName(t("settings-periodic-open-at-startup", lang))
          .setDesc(t("settings-periodic-open-at-startup-desc", lang))
          .addToggle((toggle) => {
            toggle.setValue(config.openAtStartup);
            toggle.onChange(async (value) => {
              this.plugin.writeOptions((old) => ({
                ...old,
                periodicNotes: {
                  ...old.periodicNotes,
                  [granularity]: { ...old.periodicNotes[granularity], openAtStartup: value }
                }
              }));
            });
          });
      },
      false // Default closed
    );
  }

  private addCollapsibleSection(
    parent: HTMLElement,
    title: string,
    enabled: boolean,
    onToggle: ((enabled: boolean) => void) | null,
    contentBuilder: (container: HTMLElement) => void,
    defaultOpen = false,
    showToggle = true
  ): void {
    let section: Setting;
    let currentState = enabled;  // Internal state for stateless containers
    
    if (showToggle) {
      section = new Setting(parent)
          .setName(title)
          .addToggle(toggle => {
              toggle.setValue(currentState).onChange((value) => {
                  currentState = value;  // Update internal state
                  // Only call onToggle if it's provided (not null)
                  if (onToggle !== null) {
                      onToggle(value);
                  }
              });
          });
    } else {
      // Create a pure container/label without toggle
      section = new Setting(parent)
          .setName(title);
      section.settingEl.style.fontSize = "0.9rem";
      section.settingEl.style.fontWeight = "500";
    }

    const contentContainer = parent.createDiv();
    // Apply indentation based on parent's padding
    const parentPaddingLeft = window.getComputedStyle(parent).paddingLeft;
    const currentIndent = parentPaddingLeft ? parseInt(parentPaddingLeft) : 0;
    contentContainer.style.paddingLeft = (currentIndent + 15) + "px";
    contentContainer.style.marginBottom = "10px";
    
    let hasBuiltContent = false;
    
    const toggleContent = () => {
        if (contentContainer.style.display === "none") {
            contentContainer.style.display = "block";
            if (!hasBuiltContent) {
                contentBuilder(contentContainer);
                hasBuiltContent = true;
            }
        } else {
            contentContainer.style.display = "none";
        }
    };

    // If no toggle, always show content
    if (showToggle) {
        contentContainer.style.display = defaultOpen ? "block" : "none";

        if (defaultOpen) {
            contentBuilder(contentContainer);
            hasBuiltContent = true;
        }

        section.settingEl.addEventListener('click', toggleContent);
    } else {
        // No toggle - always show content
        contentContainer.style.display = "block";
        contentBuilder(contentContainer);
        hasBuiltContent = true;
    }
  }
}
