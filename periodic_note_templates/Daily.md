---
daily_created: {{date:YYYY-MM-DD}}
daily_year: {{date:YYYY}}
daily_month: "{{date:MM}}"
daily_week: {{date:gggg-[W]ww}}
daily_day: "{{date:DD}}"
daily_weekday: {{date:dddd}}
tags:
  - Daily
---

<< [[40_归档 Archives/0_记录/1_日记/{{date-1d:YYYY/MM/YYYY-MM-DD-dddd}}|前一日]] | [[40_归档 Archives/0_记录/1_日记/{{date+1d:YYYY/MM/YYYY-MM-DD-dddd}}|后一日]] >>

# 📅计划概况

## 🚀新计划

- [ ] 

## 🔥历史遗留

```dataview
TASK
WHERE !completed
AND daily_created < date("{{date:YYYY-MM-DD}}")
```

## ✅今日已完成

```dataview
TASK
WHERE completed
AND completion = date("{{date:YYYY-MM-DD}}")
```

# 📊今日工作

## 📚研读文献

```dataview
LIST
FROM "30_资源 Resources/文献/条目"
WHERE contains(file.folder, "文献")
AND file.mday = date("{{date:YYYY-MM-DD}}")
SORT file.ctime ASC
```

## 📒编辑笔记

### ✏️创建

```dataview
LIST
FROM ""
WHERE !contains(file.folder, "40_归档 Archives")
AND file.cday = date("{{date:YYYY-MM-DD}}")
SORT file.ctime ASC
```

### ✍️更新

```dataview
LIST
FROM ""
WHERE !contains(file.folder, "30_资源 Resources/文献/条目")
AND !contains(file.folder, "40_归档 Archives")
AND file.mday = date("{{date:YYYY-MM-DD}}")
AND file.cday != date("{{date:YYYY-MM-DD}}")
SORT file.mtime ASC
```

## 🔬实验日志

# 🧠思考与沉淀

## 🎯每日复盘

### 🚫今日卡点

### 💡尤里卡时刻

### ⭕待解决/开放问题

- [ ]

## 📝随笔

## 🌲领域学习与资源积累

```dataview
LIST
FROM "20_领域 Areas" OR "30_资源 Resources"
WHERE file.mday = date("{{date:YYYY-MM-DD}}")
SORT file.mtime ASC
```
