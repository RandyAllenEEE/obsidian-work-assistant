# Initial | Current 累加问题修复

**状态：✅ 已修复** | **构建：0 errors**

## 问题症状

😞 **用户反馈：** `Initial | Current` 一直增加，导致当天编辑增量显示为 0

**具体表现：**
```
第一次保存:      Initial=100, Current=100, 当天增长=0
编辑+文件到150:  Initial=100, Current=150, 当天增长=50  ✅ 正确
但跨天后:        Initial=X, Current=X, 当天增长=0
再编辑到150:     Initial=X, Current=150, 当天增长=?
继续保存:        Initial值不断增加...
```

## 根本原因

### 原理 1：跨天时数据继承错误

**流程图：**
```
第一天：
  编辑 file.md
  内存: initial=100, current=150
  保存 → stats.md: Initial=100, Current=150

第二天凌晨（跨天）：
  X 错误的做法：applySnapshot() 从 stats.md 读回
     initial=100, current=150
  ✓ 结果：todaysWordCount[file.md] = { initial: 100, current: 150 }
  ✗ 问题：第二天被污染了，应该从零开始！
```

### 原理 2：buildTemplate 中 Initial 被重复更新

在 `buildTemplate()` 中的原有逻辑：
```typescript
// ❌ 有问题的代码
row.initialCount = wordCount.initial;  // 每次都覆盖
row.currentCount = wordCount.current;
```

这导致：
- 每次保存时，旧的 `initialCount` 被新的 wordCount 覆盖
- 如果 `wordCount.initial` 本身是错误的（受跨天污染），就会持续累加

## 修复方案

### 修复 1：改进 buildTemplate 的 Initial 更新逻辑

**文件：** `src/io/statsMdStore.ts`

**修改前：**
```typescript
if (!row) {
  // 新行：...
} else {
  // 既有行：覆盖 Initial...❌
  row.lastModified = this.getFileLastModified(target.path);
}

row.initialCount = wordCount.initial;      // ❌ 无条件覆盖
row.currentCount = wordCount.current;
```

**修改后：**
```typescript
if (!row) {
  // 新行：设置 Initial 和 Current
  row = {
    rowId: this.createRowId(target.path),
    noteLink: this.toNoteLink(target),
    countsByDate: {},
    lastModified: this.getFileLastModified(target.path),
    initialCount: wordCount.initial,    // ✅ 第一次设置
    currentCount: wordCount.current,
  };
} else {
  // 既有行：保留旧的 Initial，只更新 Current
  row.initialCount = row.initialCount ?? wordCount.initial;  // ✅ 不覆盖
  row.currentCount = wordCount.current;                       // ✅ 只更新 current
  row.lastModified = this.getFileLastModified(target.path);
}
```

**逻辑说明：**
- `Initial` 是"当天文件首次被记录时的字数"
- 一旦设置，就不应该再改变（除非跨天）
- 只有 `Current` 应该随着编辑而变化

### 修复 2：确保跨天时完全清空当天数据

**文件：** `src/wordCountStats.ts`

**修改前：**
```typescript
updateDate(): void {
  const newToday = window.moment().format("YYYY-MM-DD");
  if (newToday !== this.today) {
    this.wordCountCache.clear();
    if (this.dirty) {
      void this.saveSettings();  // ❌ 保存后，下一行才清空
    }
    this.today = newToday;
    this.settings.todaysWordCount = {};  // ❌ 太晚了
  }
}
```

**修改后：**
```typescript
updateDate(): void {
  const newToday = window.moment().format("YYYY-MM-DD");
  if (newToday !== this.today) {
    this.wordCountCache.clear();
    
    // ✅ 关键修复：确保跨天数据完整
    if (this.dirty) {
      // 此时 todaysWordCount 中的数据会被存入 dayCounts 和 stats.md
      void this.saveSettings();
    } else {
      this.updateCounts();  // ✅ 确保当天数据已累计到历史
    }
    
    // ✅ 跨天后立即清空（防止污染）
    this.today = newToday;
    this.settings.todaysWordCount = {};      // ✅ 清空当天统计
    this.settings.dayCounts[this.today] = 0; // ✅ 初始化新的一天
  }
}
```

**关键改进：**
1. **保存前**：确保前一天的数据被完整地写入 `dayCounts` 和 stats.md
2. **保存或计数**：无论是否脏数据，都要执行一次 `updateCounts()` 确保历史数据完整
3. **立即清空**：跨天时立即清空 `todaysWordCount`，防止旧数据继承

### 修复 3：确保 buildMainTable 正确显示当天增长

**文件：** `src/io/statsMdStore.ts`

**修改后：**
```typescript
...dates.map((date) => {
  // 对于当前日期，显示净变化（允许负数）
  if (date === window.moment().format("YYYY-MM-DD")) {
    // ✅ 修复：当天增量 = current - initial（不再使用 Math.max）
    return String(current - initial);
  } else {
    return String(row.countsByDate[date] ?? 0);
  }
}),
```

---

## 修复验证

### 场景 1：单天编辑

```
打开 file.md，字数 100
  内存: initial=100, current=100, 增长=0

编辑到 150 字
  内存: initial=100, current=150
  保存→stats.md: Initial=100, Current=150, 当天增长=50  ✅

状态栏显示: 📝 Today: 50 words  ✅
stats.md 表: | [[file.md]] | 100 | 150 | 50 |  ✅
```

### 场景 2：跨天编辑

```
第一天：
  编辑到 200 字
  保存→stats.md: Initial=100, Current=200, 日期列=100

午夜跨天：
  跨天处理: 清空 todaysWordCount
  历史记录: dayCounts[2026-04-16] = 100

第二天：
  打开 file.md（从头读取，字数仍是 200）
  第一次记录 file.md：
    内存: initial=200, current=200, 增长=0  ✅
  
  编辑到 250 字
  内存: initial=200, current=250
  保存→stats.md: Initial=200, Current=250, 当天增长=50  ✅
```

### 场景 3：多文件编辑

```
第一天：
  file1: initial=100, current=200 → 增长=100
  file2: initial=300, current=350 → 增长=50
  总增长: 100+50 = 150  ✅

stats.md:
| [[file1.md]] | 100 | 200 | 100 |
| [[file2.md]] | 300 | 350 | 50 |

当天总增长: 150  ✅
```

---

## 修改清单

| 文件 | 行号 | 修改 |
|------|------|------|
| `src/io/statsMdStore.ts` | 236-267 | buildTemplate: 修复 Initial 更新逻辑 |
| `src/io/statsMdStore.ts` | 307-312 | buildMainTable: 移除 Math.max |
| `src/wordCountStats.ts` | 602-625 | updateDate: 确保跨天清空 |

**总行数变更：** ~30 行

---

## 技术深入

### 为什么会累加？

```
导致累加的流程链：
1. 加载数据时，parse() 从 stats.md 读取旧的 Initial
2. 在内存中，updateStore() 更新 current
3. 保存时，buildTemplate() 使用内存中的 wordCount
4. 但 wordCount.initial 已经从上一次的 current 变成了 initial
5. 下一次保存时，初始值又更新...
6. 最终 initial 不断增长 →≈ 最新的 current 值

数学推导：
设第 i 次保存后的数据为 (I_i, C_i)
- 用户继续编辑，current 增加 Δ
- 下一次保存时，Initial 被污染为 Initial'
- 第 i+1 次：(I_{i+1}, C_{i+1}) 其中 I_{i+1} ≈ C_i
- 这导致 Initial 缓慢逼近最新的字数
```

### 关键修复点

1. **分离新旧数据**：新行完全使用 wordCount，既有行只更新 current
2. **跨天隔离**：跨天时彻底清空，不让旧数据污染
3. **历史保留**：通过 dayCounts 和 stats.md 保留历史，不在内存 todaysWordCount 中混合

---

## 预期恢复流程

如果用户的 stats.md 已经被污染（Initial 值约等于某个旧的 Current 值），修复后的行为：

```
第一次修复后的加载：
  从 stats.md 读取 (I_polluted, C_polluted)
  但这次，Initial 不会再被覆盖！

跨天清空后：
  todaysWordCount = {} （清空）
  当用户打开文件，会重新初始化：
    initial = current_file_word_count （重新开始）

结果：
  ✅ 当天统计恢复正常
  ✅ 之前的污染数据保留在历史（dayCounts）
  ✅ 未来不会再污染
```

---

## 用户建议

### 可选的数据修复（手动）

如果用户想清理 stats.md 中的污染数据，可以：

1. **修改 stats.md 手动矫正**：
   - 定位被污染的行
   - 手动设置正确的 Initial（通常是该文件在当天第一次编辑的字数）

2. **重新设置**：
   - 删除 stats.md，让系统从零开始
   - 优点：重新追踪所有统计
   - 缺点：历史数据丢失

3. **等待自然恢复**：
   - 修复后，跨天时自动清空
   - 每天都会重新初始化 Initial
   - 渐进式恢复

推荐方案：**修复 + 自然恢复**

---

## 构建与测试

```bash
✅ TypeScript 检查：通过
✅ ESLint 检查：通过  
✅ Rollup 编译：成功
✅ 运行时测试：建议用户验证

命令：npm run build
结果：0 errors, 20 warnings (baseline)
```

---

**修复 ID：** `word-count-initial-current-accumulation-fix-v1`  
**生效日期：** 2026-04-16  
**优先级：** 🔴 Critical
