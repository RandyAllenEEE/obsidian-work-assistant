# Work Assistant Plugin

A comprehensive productivity companion for [Obsidian](https://obsidian.md/), unifying the best features of calendar visualization, periodic note management, and writing statistics into a single, cohesive plugin.

![screenshot-hero](https://raw.githubusercontent.com/liamcain/obsidian-calendar-plugin/master/images/screenshot-full.png)
*(Note: Screenshot represents the foundational Calendar view; actual interface includes enhanced periodic note integrations)*

## 🚀 Overview

**Work Assistant** is a substantial evolution and merger of several powerful community plugins. It is designed to be the central hub for your time-based knowledge management.

By combining the visual navigation of a **Calendar**, the powerful configuration of **Periodic Notes**, and the motivation of **Word Count Heatmaps**, this plugin offers a seamless workflow for journalling, planning, and reviewing.

## ✨ Key Features

### 📅 Unified Calendar View
Navigate your personal timeline with ease. The calendar view sits in your sidebar, allowing you to instantly jump to any Daily Note.
- **Visual Navigation**: Click any date to open or create that day's note.
- **Event Indicators**: See at a glance which days have notes, tasks, or significant writing activity.

### 🔁 Periodic Notes Powerhouse
Manage all your time-based notes in one place. No longer do you need separate plugins for different granularities.
- **Full Spectrum Support**: **Daily**, **Weekly**, **Monthly**, **Quarterly**, and **Yearly** notes.
- **Granular Configuration**: customize formatting, templates, and folders for each time period independently.
- **Smart Navigation**: Easily jump between adjacent time periods (e.g., Next Week, Previous Month).

### 🔥 Productivity Heatmap
Turn your calendar into a productivity tracker.
- **Word Count Visualization**: The background intensity of each day on the calendar reflects your writing volume.
- **Goal Tracking**: Visualize your consistency and "streaks" directly on your calendar.
- **Customizable**: Define your own word count thresholds and color intensities to match your workflow.

### 🍅 Integrated Pomodoro Timer
Stay focused with a built-in Pomodoro timer seamlessly integrated into your workflow.
- **Status Bar Integration**: Control the timer directly from the status bar (Start, Pause, Quit) with emoji indicators (🍅/🏖️).
- **Continuous Mode**: Automatically transition between focus sessions and breaks for uninterrupted flow.
- **Data Recording**: Automatically logs your completed Pomodoro sessions alongside your daily word counts.
- **Customizable**: Configure duration, breaks, auto-cycles, and notification sounds/white noise.

### ⚡ Performance & Reliability
- **Optimized Caching**: Smart cache updates ensure the plugin only re-indexes when necessary, saving resources.
- **Unified Data Format**: Internal storage standardized to ISO 8601 (`YYYY-MM-DD`) for robust data handling.
- **Robust Statistics**: Status bar displays "Today {file} / {total} words" with fail-safe logic ensuring accurate feedback even when switching contexts.

## 🛠️ Configuration

The plugin features a simplified, flat configuration structure for ease of use:

1.  **Periodic Settings**: Go to `Settings > Work Assistant` to enable and configure each note type (Day, Week, Month, Quarter, Year) individually.
2.  **Appearance**: Customize the calendar's "Start of Week", week number display, and locale settings.
3.  **Heatmap**: Adjust "Words per Dot" and color ranges to calibrate the visual feedback for your writing habits.

## 🤝 Credits & Acknowledgements

This project is built upon the incredible work of the Obsidian community. It stands on the shoulders of giants:

-   **Liam Cain**: The original creator of the [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) and [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) plugins. His architectural vision for time-based notes in Obsidian is the foundation of this plugin.
-   **Dhruvik Parikh**: For the inspiration and underlying logic regarding [Daily Stats](https://github.com/dhruvik/obsidian-daily-stats) and word count tracking.
-   **Community Contributors**: Thank you to all who have contributed PRs, translations, and ideas to the original repositories.

**Work Assistant** aims to honor these contributions by maintaining a maintained, unified, and modernized codebase for the community.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🚀 Release 2.2.0: The Native Performance Update

This major release completely re-architects how the plugin interacts with Windows Media controls, solving long-standing stability issues with PowerShell.

### 🌟 Key Changes
-   **Native Helper Bridge (`SMTCBridge.exe`)**: Replaced slow and fragile PowerShell scripts with a high-performance C# native application.
-   **Zero-Config Auto-Setup**: The plugin automatically compiles the bridge tool on your machine—no manual installation required.
-   **Optimized Performance**: New thumbnail caching system ensures zero memory bloat and reduces CPU usage during media polling.
-   **Polished UI**: Completely redesigned Status Bar Player with a themed, fade-in popover for album art and track info.

### 🛠️ Technical Details
-   **Architecture change**: Moved from internal `Add-Type` PowerShell reflection to a standalone IO-based Process Bridge.
-   **Reliability**: Fixes "Interface not found" COM errors by isolating WinRT logic into a separate process.
