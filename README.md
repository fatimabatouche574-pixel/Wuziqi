# 十九路围棋 · Android

一个面向手机端的离线围棋小游戏。玩家执黑，电脑执白，棋盘采用标准 19×19 规格，并保留普通、强势、碾压三档难度。

## 功能

- 标准 19×19 棋盘与九个星位
- 提子、禁自杀、简单劫争
- 双方连续停一手后终局数子
- 白棋贴 7.5 目
- 悔棋、重新开局、落子提示
- 普通、强势、碾压三档本地 AI
- 完全离线运行，无广告、无联网权限

> “碾压”模式使用启发式候选剪枝和蒙特卡洛推演，计算量明显高于另外两档，但它不是 AlphaGo 神经网络，也无法达到专业围棋引擎的棋力。

## 获取 APK

打开仓库的 **Actions** 页面，进入最新一次 **Build Android APK** 工作流，在页面底部下载 `Wuziqi-Go-debug-apk` 构建产物并解压，即可得到 `app-debug.apk`。

也可以进入 Actions 手动运行 `Build Android APK`。

## 本地构建

需要 JDK 17、Android SDK 34 与 Gradle 8.7：

```bash
gradle :app:assembleDebug
```

APK 输出位置：

```text
app/build/outputs/apk/debug/app-debug.apk
```
