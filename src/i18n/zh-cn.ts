export default {
  // Plugin info
  "plugin-name": "工作助手",
  "plugin-description": "带有字数统计的日历视图，用于您的日常笔记",

  // Commands
  "command-open-view": "打开视图",
  "command-open-weekly-note": "打开周笔记",
  "command-reveal-active-note": "显示活动笔记",

  "command-open-note": "打开{periodicity}笔记",
  "command-next-note": "向后跳转到最近的{periodicity}笔记",
  "command-prev-note": "向前跳转到最近的{periodicity}笔记",
  "command-open-next-note": "打开下一个{periodicity}笔记",
  "command-open-prev-note": "打开上一个{periodicity}笔记",

  "label-periodicity-daily": "日常",
  "label-periodicity-weekly": "周",
  "label-periodicity-monthly": "月度",
  "label-periodicity-quarterly": "季度",
  "label-periodicity-yearly": "年度",

  // Settings - General
  "settings-general-title": "常规设置",
  "settings-words-per-dot": "每点字数",
  "settings-words-per-dot-desc": "一个点代表多少个字？（每个点代表您日记文件的总字数）",
  "settings-start-week": "一周开始于：",
  "settings-start-week-desc": "选择一周的开始日。选择'区域默认'使用moment.js指定的默认值",
  "settings-confirm-create": "创建新笔记前确认",
  "settings-confirm-create-desc": "创建新笔记前显示确认对话框",
  "settings-show-week-number": "显示周数",
  "settings-show-week-number-desc": "启用此选项可在日历中添加一列显示周数",

  // Settings - Weekly Note
  "settings-weekly-note-title": "周笔记设置",
  "settings-weekly-note-warning": "注意：周笔记设置正在迁移。建议您安装'Periodic Notes'插件以在未来保持此功能。",
  "settings-weekly-note-format": "周笔记格式",
  "settings-weekly-note-format-desc": "有关语法帮助，请参阅格式参考",
  "settings-weekly-note-template": "周笔记模板",
  "settings-weekly-note-template-desc": "选择要用作周笔记模板的文件",
  "settings-weekly-note-folder": "周笔记文件夹",
  "settings-weekly-note-folder-desc": "新周笔记将放在此处",

  // Settings - Word Count Background
  "settings-word-count-bg-title": "字数统计背景设置",
  "settings-color-range": "颜色范围",
  "settings-color-range-desc": "最小值: {min}, 最大值: {max}, 不透明度: {opacity}（基于日记文件字数的背景颜色强度）",
  "settings-reset-ranges": "重置为默认范围",
  "settings-reset-ranges-desc": "恢复默认的字数统计颜色范围",

  // Settings - Advanced
  "settings-advanced-title": "高级设置",
  "settings-override-locale": "覆盖区域设置：",
  "settings-override-locale-desc": "如果您想使用与默认不同的区域设置，请设置此项",

  // Settings - Placeholders
  "placeholder-min-value": "最小值",
  "placeholder-max-value": "最大值",
  "placeholder-opacity": "不透明度 (0-1)",
  "placeholder-reset": "重置",

  // Settings - Refresh Interval
  "settings-heatmap-refresh-interval": "热力图刷新间隔 (ms)",
  "settings-heatmap-refresh-interval-desc": "刷新热力图前等待的时间（毫秒）。默认值为 2000ms。",

  // Modals
  "modal-create-note-title": "新日常笔记",
  "modal-create-note-text": "文件 {filename} 不存在。您想要创建它吗？",
  "modal-create-note-cta": "创建",

  "settings-timeline-title": "在周期性笔记上显示'Timeline'组件",
  "settings-timeline-desc": "在所有周期性笔记的右上角添加一个可折叠的时间线",
  "modal-cancel": "取消",

  // Periodic Notes Details
  "periodic-note-heading-day": "日常笔记",
  "periodic-note-heading-week": "周笔记",
  "periodic-note-heading-month": "月度笔记",
  "periodic-note-heading-quarter": "季度笔记",
  "periodic-note-heading-year": "年度笔记",

  "settings-common-open-startup": "启动时打开",
  "settings-common-open-startup-desc": "每次打开此库时自动打开您的 {noteType}",
  "settings-common-format": "格式",
  "settings-common-syntax-ref": "语法参考",
  "settings-common-syntax-preview": "当前语法预览：",
  "settings-common-folder": "笔记文件夹",
  "settings-common-template-desc": "选择用作模板的文件",
  "settings-common-template-placeholder": "例如：templates/template-file",
  "settings-common-folder-placeholder": "例如：folder 1/folder 2",

  "template-title-day": "日常笔记模板",
  "template-title-week": "周笔记模板",
  "template-title-month": "月度笔记模板",
  "template-title-quarter": "季度笔记模板",
  "template-title-year": "年度笔记模板",

  "folder-desc-day": "新日常笔记将存放于此",
  "folder-desc-week": "新周笔记将存放于此",
  "folder-desc-month": "新月度笔记将存放于此",
  "folder-desc-quarter": "新季度笔记将存放于此",
  "folder-desc-year": "新年度笔记将存放于此",

  // Warnings
  "warning-loose-parsing": "您的文件名格式无法解析。如果您仍希望为您的 {periodicity} 笔记使用此格式，您需要在模板文件的 frontmatter 中包含以下内容：",
  "warning-fragile-basename": "您的基本文件名不是唯一可标识的。如果您仍希望使用此格式，建议您在日常笔记模板的 frontmatter 中包含以下内容：",

  // Status Bar
  "status-bar-words-today": "今日 {count} 字",

  // Calendar UI
  "calendar-week": "周",

  // Word Count Ranges
  "word-count-range-0": "0",
  "word-count-range-150": "150",
  "word-count-range-400": "400",
  "word-count-range-750": "750",
  "word-count-range-1500": "1500",
  "word-count-range-infinity": "无穷大"
};