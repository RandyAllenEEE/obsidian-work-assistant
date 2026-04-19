# Work Assistant Plugin

This is a comprehensive productivity center for [Obsidian](https://obsidian.md/), perfectly integrating **Calendar**, **Periodic Notes**, **Word Count Heatmap**, **Pomodoro Timer**, and **System Media Control** into a high-performance, modular efficiency ecosystem.

![screenshot-hero](https://raw.githubusercontent.com/liamcain/obsidian-calendar-plugin/master/images/screenshot-full.png)
*(Note: Due to rich functionality, the actual interface includes enhanced periodic notes integration and heatmap display)*

## 🚀 Version 3.2.0 Update: Performance and Stability Leap

This update focuses on refining core experiences, bringing you a smoother and more reliable workflow:

*   **🍅 Smart Pomodoro Timer**: New **automatic pause on exit** feature. When closing Obsidian, an ongoing Pomodoro session automatically pauses and saves its state, allowing seamless resumption next time without losing time.
*   **⚡ Extreme Performance**: Word count core rebuilt with background **Worker threads** and I/O debouncing, completely eliminating typing lag and reducing disk writes by 99%.
*   **🛡️ System Robustness**: Rewrote weather service and cache system lifecycle management, eliminating memory leaks and zombie timers, with lower resource consumption.

---

## 🌟 Core Features

### 📅 1. Modular Calendar View (Central Hub)
Your time management command center.
-   **Master Switch**: Not only displays the calendar but serves as the switch for the entire plugin. Closing the calendar automatically unloads related sub-features, ensuring zero resource consumption.
-   **Smart Integration**: Disabling the calendar automatically locks dependent features like heatmaps, preventing configuration conflicts.

### 🔁 2. Periodic Notes System
-   **Full Dimension Management**: Supports **Daily, Weekly, Monthly, Quarterly, Yearly** note management.
-   **Calendar Interaction**: Click calendar dates to directly create or jump to corresponding notes.
-   **On-Demand Loading**: File caching system activates only when this feature is enabled, consuming no memory when unused.

### 📊 3. Word Count & Heatmap
-   **Dual Architecture**:
    -   **Status Bar**: Real-time "Today's Word Count" display, lightweight and unobtrusive.
    -   **Calendar Heatmap**: Intuitive visualization of your writing habits, with deeper colors indicating higher productivity.
-   **Background Processing**: Calculation logic runs entirely in independent threads, never blocking the main interface.
-   **Smart Threshold Filter**: Implements shock detection to prevent abnormal jumps in word counts from distorting statistics.
-   **Persistent Storage**: Uses a single `stats.md` file with tabular format to store all word count history.
-   **Rename Resilience**: Handles file renames robustly with proper deduplication based on modification times.
-   **Broken Links Organization**: When files are deleted or become inaccessible, their word count changes are tracked in a dedicated "Broken Links" row, ensuring daily totals remain accurate and consistent.
-   **Ignore File Filtering**: Supports excluding specific files or patterns from word count tracking, perfect for filtering out large reference documents or temporary files.

### 🍅 4. Pomodoro Timer
-   **Immersive Experience**: Status bar resident display (`🍅 25:00`), not occupying screen space.
-   **Auto Logging**: Upon completion, automatically records achievements in the day's journal.
-   **State Persistence**: Whether restarting software or computer sleep, your focus progress is safely preserved.
-   **Audio Feedback**: Includes customizable sound notifications for completed sessions.

### 🎵 5. Native Media Control (Windows Only)
-   **SMTC Bridge**: Built-in high-performance C# bridge integrating Windows System Media Transport Controls directly into Obsidian.
-   **Zero Configuration**: No manual installation of dependencies required; the plugin handles all environmental configurations automatically.
-   **Lightning Fast Response**: Optimized thumbnail caching and polling mechanisms, many times faster than traditional solutions.

### 🌤️ 6. Weather Service
-   **Integrated Weather Data**: Provides real-time weather information display.
-   **QWeather Integration**: Utilizes QWeather API for accurate forecasts.
-   **Customizable Display**: Configurable refresh intervals and location settings.

### 📁 7. File Management Utilities
-   **Custom Templates**: Support for custom templates in periodic notes creation.
-   **Flexible Paths**: Customizable paths for different note types (daily, weekly, monthly, etc.).
-   **Smart Linking**: Automatic linking between related notes and calendar entries.

---

## ⚙️ Configuration & Architecture

The settings panel has been restructured to reflect strict hierarchical relationships:

1.  **Calendar View - Master Switch**
    *   Controls sidebar view.
    *   *When disabled*: Heatmap and calendar integration features will be disabled.

2.  **Periodic Notes**
    *   **Calendar Linkage**: Allows note operations through calendar clicks.
    *   **Granular Configuration**: Customize paths and templates for each level (daily/weekly/monthly/etc.).

3.  **Word Count**
    *   **Status Bar Component**: Toggle bottom status display.
    *   **Heatmap**: Toggle calendar background rendering.
        *   *Color Thresholds*: Customize colors representing your effort levels.
    *   **Storage Path**: Configure the location of the `stats.md` file.
    *   **Shock Threshold**: Set sensitivity for detecting significant word count changes.
    *   **Ignore Files**: Configure file paths or patterns to exclude from word count tracking.

4.  **Pomodoro Timer**
    *   **Timer Durations**: Customize work, break, and long break intervals.
    *   **Notification Settings**: Configure sound and system notifications.
    *   **Automatic Cycles**: Option for continuous or manual session management.

5.  **Media Control**
    *   **System Integration**: Enable native Windows media controls.
    *   **White Noise**: Background noise options for focus.

---

## 🏗️ Technical Architecture

### Key Design Decisions:
-   **Web Workers Offline Computing**: Heavy computational tasks like word count calculations are moved to background Worker threads to avoid blocking the main UI thread.
-   **I/O Debouncing**: Reduces frequent disk write operations, lowering resource consumption.
-   **Lifecycle Strict Management**: Cache and service lifecycles are rewritten to prevent memory leaks and zombie timers.

### Architecture Patterns:
-   **Modular/Plugin Pattern**: Feature decoupling through configuration switches to dynamically enable/disable modules.
-   **Observer Pattern**: Using Svelte Stores and Obsidian event systems for automatic UI updates when data changes.
-   **Singleton Pattern**: Used for managing service instances (such as CacheManager, WhiteNoiseService).
-   **Bridge Pattern**: Establishing communication bridges between JS/TS environments and native C# code (SMTC Bridge).

---

## 🤝 Acknowledgments

This project is built upon the excellent work of the open-source community. We especially thank the creators of the following plugins, whose work laid the foundation for this project:

1.  **[Liam Cain](https://github.com/liamcain)** - Creator of **calendar-plugin** and **periodic-notes**
    *   The core logic of our calendar view and periodic notes management functionality deeply integrates his pioneering work.
    
2.  **[Richardsl](https://github.com/Richardsl/heatmap-calendar-obsidiane)** - Creator of **heatmap-calendar-obsidian**
    *   Provided core inspiration for our high-performance background word count and heatmap rendering.

It is their open-source spirit that makes this tool possible.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.