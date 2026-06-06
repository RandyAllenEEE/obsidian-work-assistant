---
daily_created: {{month:YYYY-MM-DD}}
daily_year: {{month:YYYY}}
daily_month: "{{month:MM}}"
tags:
  - Monthly
---

<< [[{{periodic:month:-1M}}|⬅️ 上一月]] | [[{{periodic:month:+1M}}|下一月 ➡️]] >>

# 📅 {{month:YYYY-MM}} 月度概览

## 🎯 本月目标 (OKRs)

> [!ABSTRACT] 关键成果
> 1. **科研突破**：
> 2. **论文进度**：
> 3. **自我提升**：

## 🗓️ 本月周记索引

```dataview
LIST
FROM #Weekly
WHERE daily_month = this.daily_month
AND daily_year = this.daily_year
SORT file.name ASC
```

---

# 📥 知识输入汇总

## 📚 本月研读文献

```dataview
TABLE file.ctime AS "记录日期"
FROM "30_资源 Resources/文献/条目"
WHERE daily_month = this.daily_month
AND daily_year = this.daily_year
SORT file.ctime ASC
```

---

# 📤 产出与推进

## 🔨 项目关键进展

```dataview
TABLE file.folder AS "所属项目", file.mtime AS "最后修改"
FROM "10_项目 Projects"
WHERE daily_month = this.daily_month
AND daily_year = this.daily_year
SORT file.folder ASC
```

## 🔬 实验与仿真总结

---

# 🧠 月度复盘

## 🔄 4L 回顾法

* **Liked**：
* **Learned**：
* **Lacked**：
* **Longed**：

## 📊 习惯追踪
