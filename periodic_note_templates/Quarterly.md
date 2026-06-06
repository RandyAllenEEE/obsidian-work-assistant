---
daily_created: {{quarter:YYYY-MM-DD}}
daily_year: {{quarter:YYYY}}
daily_quarter: {{quarter:[Q]Q}}
tags:
  - Quarterly
---

<< [[{{periodic:quarter:-3M}}|⬅️ 上一季度]] | [[{{periodic:quarter:+3M}}|下一季度 ➡️]] >>

# 🚀 {{quarter:YYYY-[Q]Q}} 季度规划

## 🗺️ 大事件

1. 
2. 
3. 

## 🗓️ 月度回顾

> 包含的月份

```dataview
LIST
FROM #Monthly
WHERE daily_year = this.daily_year
AND (
  (this.daily_quarter = "Q1" AND (daily_month = "01" OR daily_month = "02" OR daily_month = "03")) OR
  (this.daily_quarter = "Q2" AND (daily_month = "04" OR daily_month = "05" OR daily_month = "06")) OR
  (this.daily_quarter = "Q3" AND (daily_month = "07" OR daily_month = "08" OR daily_month = "09")) OR
  (this.daily_quarter = "Q4" AND (daily_month = "10" OR daily_month = "11" OR daily_month = "12"))
)
SORT file.name ASC
```

---

# 📈 科研里程碑

## 📝 论文与发表

* [ ] 构思/大纲：
* [ ] 数据/实验：
* [ ] 撰写/投稿：

## 🛠️ 技能树点亮

# 🧠 季度复盘

* **最大的胜利**：
* **最大的挑战**：
* **下季度调整**：
