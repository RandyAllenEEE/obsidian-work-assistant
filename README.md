# Work Assistant Plugin

A comprehensive productivity hub for [Obsidian](https://obsidian.md/), unifying **Calendar**, **Periodic Notes**, **Word Count Heatmap**, **Pomodoro**, and **System Media Control** into a single, high-performance ecosystem.

![screenshot-hero](https://raw.githubusercontent.com/liamcain/obsidian-calendar-plugin/master/images/screenshot-full.png)
*(Note: Screenshot represents the foundational Calendar view; actual interface includes enhanced periodic note integrations)*

## 🚀 Release 3.0.0: The Architectural Evolution

Version 3.0.0 represents a complete paradigm shift, moving from a collection of features to a **strictly hierarchical, modular system**. Every feature is now isolated, ensuring zero performance overhead when disabled.

### 🌟 Key Features

#### 📅 1. Modular Calendar View (The Hub)
The central navigation pillar.
-   **Strict Master Control**: Toggling "Calendar View" completely registers/unregisters the underlying view components.
-   **Active Dependency Management**: Disabling the calendar automatically locks and disables dependent features (Heatmap, Linkage) to prevent configuration errors.

#### 🔁 2. Periodic Notes System
-   **Granular Control**: Manage Day, Week, Month, Quarter, and Year notes with independent templates and folders.
-   **Calendar Linkage**: Smart integration allowing you to create/open notes by clicking dates.
    -   *Logic*: Interaction handlers are physically removed if this feature is disabled.
-   **Smart Caching**: The file cache is exclusively loaded when Periodic Notes are active, ensuring zero overhead for non-users.

#### 📊 3. Word Count & Heatmap
-   **Split Architecture**:
    -   **Status Bar**: Lightweight "Words Today" tracking.
    -   **Heatmap**: Visualizes productivity on the calendar.
-   **Performance**: Heatmap rendering logic is dormant if the Calendar or Heatmap toggle is off, effectively eliminating efficient calculation waste.

#### 🍅 4. Pomodoro Timer
-   **Integrated Workflow**: Seamless timer in your status bar (`🍅 25:00`).
-   **Auto-Logging**: Automatically records completed sessions to your daily notes.

#### 🎵 5. Native Media Control (Windows)
-   **SMTC Bridge**: A high-performance, native C# bridge that integrates Windows System Media Transport Controls directly into Obsidian.
-   **Zero-Config**: No manual installation required. The plugin handles the native bridge setup.
-   **Performance**: Improved polling and thumbnail caching compared to legacy PowerShell implementations.

---

## 🛠️ Configuration & Hierarchy

The settings panel has been rebuilt to reflect the strict architectural hierarchy:

1.  **Calendar View** (Master Switch)
    *   Controls the sidebar view.
    *   *If OFF*: Heatmap and Calendar Linkage are strictly disabled.

2.  **Periodic Notes** (Master Switch)
    *   **Calendar Linkage**: Sub-feature for calendar interaction.
        *   *Words Per Dot*: Visualization setting.
        *   *Confirm Creation*: Safety check before creating new notes.
    *   **Granularity Config**: Set up your daily/weekly note paths.

3.  **Word Count** (Master Switch)
    *   **Status Bar**: Toggles the widget.
    *   **Heatmap**: Toggles the calendar background visualization.
        *   *Color Ranges*: Customize intensity steps.

---

## 🤝 Credits & Acknowledgements

Built upon the incredible work of the Obsidian community:
-   **Liam Cain**: Creator of the original Calendar and Periodic Notes plugins.
-   **Dhruvik Parikh**: Inspiration for Daily Stats word counting logic.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
