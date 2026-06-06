---
daily_created: {{monday:YYYY-MM-DD}}
daily_year: {{monday:gggg}}
daily_month: "{{monday:MM}}"
daily_week: {{date:gggg-[W]ww}}
tags:
  - Weekly
---

<< [[{{periodic:week:-1w}}|⬅️ 上一周]] | [[{{periodic:week:+1w}}|下一周 ➡️]] >>

# 📅 {{date:gggg-[W]ww}} 概览

[[{{periodic:day:monday}}|周一 {{monday:MM-DD}}]] · [[{{periodic:day:tuesday}}|周二 {{tuesday:MM-DD}}]] · [[{{periodic:day:wednesday}}|周三 {{wednesday:MM-DD}}]] · [[{{periodic:day:thursday}}|周四 {{thursday:MM-DD}}]] · [[{{periodic:day:friday}}|周五 {{friday:MM-DD}}]] · [[{{periodic:day:saturday}}|周六 {{saturday:MM-DD}}]] · [[{{periodic:day:sunday}}|周日 {{sunday:MM-DD}}]]

## 🎯 本周核心

1. **主攻项目**：
2. **重点文献**：
3. **学习积累**：
4. **生活感悟**：

---

# 📥 知识输入

## 📚 深度研读

```dataview
TABLE file.ctime AS "记录时间"
FROM "30_资源 Resources/文献/条目"
WHERE daily_week = this.daily_week
SORT file.ctime ASC
```

## 🌲 资源库更新

> 本周收集到 "30_资源 Resources" 中的资料

```dataview
LIST
FROM "30_资源 Resources"
WHERE daily_week = this.daily_week
SORT file.ctime ASC
```

---

# 📤 产出与推进

## 🔨 项目实战

```dataview
TABLE file.folder AS "所属项目", file.mtime AS "最后修改"
FROM "10_项目 Projects"
WHERE daily_week = this.daily_week
SORT file.folder ASC
```

## 🔬 实验日志

---

# ✅ 任务看板

## 本周已完成

```dataview
TASK
WHERE completed
AND completion >= date("{{monday:YYYY-MM-DD}}")
AND completion <= date("{{sunday:YYYY-MM-DD}}")
```

## ⚠️ 遗留/待办

```dataview
TASK
WHERE !completed
AND file.day <= date("{{sunday:YYYY-MM-DD}}")
AND text != ""
AND !contains(tags, "#template")
```

---

# 🧠 每周复盘

## 🔄 ORID 回顾

- **Objective**：
- **Reflective**：
- **Interpretive**：
- **Decisional**：

## 🗓️ 下周展望

- [ ]
