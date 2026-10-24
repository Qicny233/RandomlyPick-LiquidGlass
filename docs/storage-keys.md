# localStorage 约定

正式版（`/`）和 Beta（`/beta/`）在同一个域名下，**共用同一份 localStorage**。
任何一个版本改了数据格式，另一个版本都会读到，所以键的兼容性必须当成公共接口来维护。

## 现有键

| 键 | 写入方 | 用途 | 格式 |
|---|---|---|---|
| `rplg_channel_v1` | 两版 | 版本渠道选择 | `release` / `preview` |
| `onboarding_done_v4` | 两版 | 是否看过引导（有意共享，切换版本不重看） | `1` |
| `lottery_weights_v2` | 两版 | 概率权重 | 长度等于名单数、0–10 的数字数组 |
| `lottery_history_v1` | 两版 | 抽取历史 | `[{ t: number, name: string }]` |
| `lottery_theme_v1` | 两版 | 主题 | `blue` / `dark` / `macaron` |
| `lg_compat_v1` | 两版 | 兼容模式 | `1` |
| `lottery_funmsg_v1` | 两版 | 趣味寄语开关 | `0` / `1` |
| `lg_8mode_v1` | 两版 | 八人组模式 | `0` / `1` |
| `lg_8speed_v1` | 两版 | 八人组速度 | 数字字符串 |
| `lg_hscroll_v1` | 两版 | 横向滚动模式 | `h` / `classic` |
| `lg_star_mode_v1` | 两版 | 星光模式 | `ind` / 其他 |
| `lottery_perf_v1` | 两版 | 性能信息开关 | `1` |
| `nailong_enabled` | 两版 | 奶龙装饰 | `1` / `0` |
| `flow_bg_enabled` | 两版 | 流光背景 | `1` / `0` |
| `race-audio-v1` | Beta 赛车 | 音量与静音 | `{ v: number, m: boolean }` |

## 规则

1. **不原地改格式**：任何键的结构要变，新增带版本后缀的键（如 `lottery_weights_v3`），
   先读旧键迁移，再写新键。旧键保留一段时间，别直接删。
2. **读取端必须容错**：`try/catch` + 类型/范围校验，坏数据回退默认值，不能整页报错。
3. **有意共享的键**（渠道、引导）不要加版本后缀，它们就是跨版本状态。
4. **V7 专属的新键**统一加 `_v7` 后缀，避免将来正式版升到 V7 时误读。
5. 改键相关代码后，至少在正式版和 Beta 各开一次页面，确认双方都不报错。
