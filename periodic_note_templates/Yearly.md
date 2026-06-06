---
daily_created: {{year:YYYY-MM-DD}}
daily_year: {{year:YYYY}}
tags:
  - Yearly
---

<< [[40_归档 Archives/0_记录/5_年记/{{year-1y:YYYY}}|⬅️ 去年]] | [[40_归档 Archives/0_记录/5_年记/{{year+1y:YYYY}}|明年 ➡️]] >>

# 🌟 {{year:YYYY}} 年度概览

> [!QUOTE] 年度关键词
> 给这一年定一个主题词：__________

## 🎯 年度核心目标

1. **学术/职业**：
2. **健康/生活**：
3. **财务/其他**：

## 🗓️ 季度回顾

```dataview
TABLE WITHOUT ID file.link AS "季度", daily_quarter AS "Q"
FROM #Quarterly
WHERE daily_year = this.daily_year
SORT file.name ASC
```

---

# 🎓 学术生涯记录

## 🏆 发表与荣誉

## 📚 重点研读文献

---

# 🌲 个人成长

## 🧩 知识库统计

> 见证这一年的积累

* **新建文献笔记**： `$= dv.pages('"10_项目 Projects" OR "20_领域 Areas"').where(p => p.file.folder.includes("文献") && p.daily_year == dv.current().daily_year).length` 篇
* **新建项目笔记**： `$= dv.pages('"10_项目 Projects"').where(p => !p.file.folder.includes("文献") && p.daily_year == dv.current().daily_year).length` 篇

## 💌 给未来的自己
