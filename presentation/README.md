# NoldOJ 三模型评测 · 自动演示 PPT

基于仓库根目录 `evaluation_report.md` / `README.md` 的评测结论，制作的一份 **11 页、约 4 分钟、可无人值守自动播放** 的中文演示。

## 成品文件

| 文件 | 用途 |
|---|---|
| `output/NoldOJ_Evaluation_Report.ppsx` | **直接放映**：双击即全屏播放，自动配音、自动动画、自动换页、循环 |
| `output/NoldOJ_Evaluation_Report.pptx` | 可编辑源文件，动画/音频/转场均已内置 |
| `output/preview/slide01.png` … `slide11.png` | 每页 1600×900 预览图 |
| `output/script.md` | 11 页完整配音脚本 |
| `output/video_meta.md` | 视频标题、简介、标签与章节时间轴（可直接复制发布） |
| `output/animation_spec.json` | 每个动画对象的开始时间/时长/效果 |

音频已全部 **嵌入** PPT，拷贝单个 `.ppsx` 即可播放，不需要附带 wav 文件。

## 播放说明

- 双击 `.ppsx` 进入全屏放映；按 `Esc` 退出。
- 全程无需点击：每页按该页配音时长自动前进，末页结束后自动回到第 1 页循环。
- 若系统提示"受保护的视图"，请先点击"启用内容"，否则嵌入音频不会播放。
- 建议使用 PowerPoint 2016 及以上 / Microsoft 365；WPS 对嵌入媒体与动画时间轴支持不完整。
- 字体使用 `Microsoft YaHei UI` 与 `Bahnschrift`（Windows 10/11 自带）。

## 页面结构（约 4 分 12 秒）

1. 封面：NoldOJ 同题开发评测
2. 评测方法：一份需求，三种答卷
3. 选手介绍：三种工程哲学
4. 总分：28.0 / 26.3 / 23.5
5. 功能完整性
6. 稳定性与工程化
7. 用户体验与部署
8. 最终排名领奖台
9. 关键亮点
10. 选型建议：场景最优解
11. 结论：代码是答卷，工程化是分数（页脚附结果站与源码仓库链接）

## 技术实现

全流程 Python，可完整重建：

| 模块 | 说明 |
|---|---|
| `script.py` | 11 页中文配音脚本（同时导出 `script.md`） |
| `audio_engine.py` | piper 中文语音合成 + numpy 程序化配乐 + 逐页混音 |
| `common.py` | 深色科技风主题、渐变背景、卡片/文字/动画登记工具 |
| `build_pptx.py` | python-pptx 生成 11 页原生形状，写入备注与动画 spec |
| `animate_com.py` | PowerPoint COM 注入音频、`MediaPlay` 自动播放、淡入转场、自动换页、入场动画 |
| `export_preview.py` | COM 导出每页 PNG 预览 |
| `verify_timing.py` | 校验 XML 时间轴与 `animation_spec.json` 是否一致 |
| `verify_playback.py` | 真实放映冒烟测试，检查是否无需点击自动换页 |
| `validate_final.py` | 成品完整性检查（页数、嵌入音频、onClick、时长） |

音频方案：

- 语音：piper `zh_CN-huayan-medium`（22050 Hz），`length_scale=1.15`，语速偏稳。
- 配乐：numpy 合成 Am9–Fmaj9–Cmaj9–G6 和弦垫，82 BPM，含 pad / pluck / bass / 鼓点 / 混响。
- 混音：整段配乐先生成，再按每页时长切片，保证跨页音乐相位连续；旁白 RMS 约 −17.7 dB，峰值约 −0.7 dB。

动画方案：

- 共 406 个入场动画（fade / rise / wipe / zoom），按脚本节奏排在 0–2.5 s 内。
- 第 1 个效果 `AfterPrevious`，其余 `WithPrevious` + 绝对延迟；时间轴已逐页比对，与 spec 偏差 < 60 ms。
- 每页 1 个 `MediaPlay` 效果自动播放该页"配音 + 配乐"，无任何 `onClick` 触发器。
- 页面转场为 0.7 s 淡入，`AdvanceOnTime` = 音频时长 + 0.12 s。

## 重建

```powershell
cd F:\AI-OJ-Match
python -X utf8 presentation/build_pptx.py      # 生成视觉页面 + animation_spec.json
python -X utf8 presentation/audio_engine.py    # piper 配音 + numpy 配乐 + 分页混音
python -X utf8 presentation/animate_com.py     # COM 注入音频/动画/转场，导出 ppsx
python -X utf8 presentation/export_preview.py  # 可选：导出预览图
```

依赖：`python-pptx`、`numpy`、`piper-onnx`、`pywin32`、`Pillow`；需本机安装桌面版 PowerPoint。

中文语音模型未入库（约 63 MB），重建前下载到 `presentation/assets/voice/`：

```
https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json
```

`assets/audio/` 下的分页 WAV、旁白与 `soundtrack.wav` 属于可再生成的中间产物，已通过 `.gitignore` 排除；成品 PPT 内的音频是嵌入的，播放不依赖这些文件。

## 已验证

- 11 页、每页 1 个嵌入 WAV、无 `onClick` 触发器。
- 实际放映测试：第 1→2 页 15.99 s、第 2→3 页 23.06 s，与配音时长（15.33 s / 22.12 s）匹配，全程未点击。
- 每页 `advTm` 均等于该页音频时长 + 0.12 s；11 段音频时长与 `audio_meta.json` 完全一致。
- 406 个动画的开始时间与设计稿逐项比对通过。
