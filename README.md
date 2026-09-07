# Litematic 三维预览

[![SJMCL Extension](https://img.shields.io/badge/SJMCL-Extension-4f46e5)](https://mc.sjtu.cn/sjmcl/)
[![GitHub Release](https://img.shields.io/github/v/release/zaixiZaixiSJTU/Litematic_viewer?display_name=tag)](https://github.com/zaixiZaixiSJTU/Litematic_viewer/releases/latest)
[![License](https://img.shields.io/github/license/zaixiZaixiSJTU/Litematic_viewer)](LICENSE)

在 [SJMCL](https://mc.sjtu.cn/sjmcl/) 中本地解析并交互式预览 Litematica `.litematic` 原理图。扩展会自动读取当前实例的原理图目录，并合并客户端 JAR 与相关模组 JAR 中的方块状态、模型和纹理进行渲染。

## 功能

- 自动列出当前所选实例 `schematics` 目录中的 `.litematic` 文件，并默认打开第一个文件
- 在启动器实例的原理图列表中注册“三维预览”按钮；按钮位于“复制/移动”左侧，并直接打开所选原理图
- 支持 gzip NBT、多区域、负方向区域尺寸和跨 64 位边界的方块状态索引
- 负尺寸区域按包围盒最小角还原，避免原理图在 X/Z 方向镜像或沿 Y 轴倒置
- 按完整方块状态加载原版 blockstate、模型 JSON 和纹理图集
- 根据原理图中的命名空间匹配已启用模组，加载整合包自定义方块的 blockstate、模型和纹理
- 按 `options.txt` 中的启用顺序叠加实例 ZIP 资源包，并读取 Fabric/NeoForge 模组中的嵌套 JAR 资源
- 对不支持标准 JSON 模型的动态方块，优先用同名模型或模组纹理生成静态近似模型；无可用资源时才显示占位方块
- 自动识别实例的 Minecraft 与模组加载器；对受支持的环境自动安装轻量模型导出器，使用游戏完成加载后的真实烘焙四边形和纹理
- 仅允许实际覆盖 `16 × 16 × 16` 且六面完整的模型遮挡相邻面，避免非完整方块造成缺面
- 支持拖拽旋转、滚轮缩放、地面网格及透明方块分层
- 展示原理图名称、作者、区域数、方块数、总体积、数据版本和坐标范围
- 支持从文件系统手动选择 `.litematic` 文件
- 所有原理图和游戏资源均在本地处理，不会上传

## 安装

1. 前往 [Releases](https://github.com/zaixiZaixiSJTU/Litematic_viewer/releases/latest) 下载最新的 `.sjmclx` 文件。
2. 打开 SJMCL，进入“设置 → 扩展”。
3. 添加下载的 `.sjmclx` 文件并启用扩展。
4. 更新版本时，建议先卸载旧版并重启 SJMCL，以免前端缓存继续加载旧代码。

## 使用

1. 在 SJMCL 中选择一个已经安装完成的游戏实例。
2. 将 `.litematic` 文件放入该实例的 `schematics` 文件夹。
3. 从启动器首页卡片或扩展页面打开“Litematic 三维预览”；也可以在“实例 → 原理图”中点击具体原理图右侧、“复制/移动”左侧的“三维预览”按钮。
4. 从左侧列表切换原理图；也可以点击“选择文件”打开其他位置的文件。
5. 首次预览 Forge/NeoForge 1.20.1 整合包时，扩展会自动把模型导出器安装到当前实例。启动并进入一次游戏主界面后返回刷新预览，即可加载生成的 `litematic-viewer/baked-models.zip`。

页面顶部显示“原版模型”时，表示客户端资源加载成功；显示“兼容模型”时，扩展会使用不带原版纹理的兼容预览，并在页面中说明资源加载失败的原因。

## 已知限制

- 游戏烘焙模型自动导出当前支持 Forge/早期 NeoForge 1.20.1；其他 Minecraft/加载器版本仍使用标准 JSON、同名纹理近似或占位方块。
- ZIP 格式的已启用实例资源包会参与覆盖；文件夹形式资源包暂时无法通过当前 SJMCL 扩展文件接口读取。
- 游戏烘焙导出可还原自定义模型加载器产生的方块几何；依赖世界邻居、方块实体 NBT、着色器或逐帧动画的渲染仍无法做到完全 1:1。
- 告示牌文字、旗帜图案及部分依赖方块实体 NBT 的特殊渲染暂不完整。
- 超过 25 万个候选方块时会自动抽样显示，以避免 WebView 占用过多内存；统计数据仍保持完整。
- 原理图的数据版本与当前实例差异较大时，部分新版或旧版方块可能缺少对应模型。

## 本地开发

需要 Node.js 18.18.0 或更高版本。

```bash
git clone https://github.com/zaixiZaixiSJTU/Litematic_viewer.git
cd Litematic_viewer
npm install
npm test
npm run build
```

构建结果位于 `dist/`：

- `dist/cn.sjtu.sjmcl.litematic_viewer/`：解包后的扩展目录
- `dist/cn.sjtu.sjmcl.litematic_viewer-<version>.sjmclx`：可安装扩展包

监听源码并输出开发扩展：

```bash
npm run dev
npm run dev -- --path ./dist/dev
```

## 项目结构

- `src/index.ts`：SJMCL 扩展注册入口
- `src/navigation/`：扩展页面 slug、路由和查询参数构造
- `src/slots/`：启动器 UI slot 注册（包括实例原理图快捷预览按钮）
- `src/litematic/`：gzip、NBT 和 Litematic 解析
- `src/viewer/resource-pack.ts`：客户端 JAR 方块状态、模型和纹理加载
- `src/viewer/mod-resources.ts`：原理图命名空间提取和相关模组筛选
- `src/viewer/baked-export.ts`：实例环境识别和游戏模型导出器选择
- `exporters/forge-1.20.1/`：Forge/早期 NeoForge 1.20.1 游戏烘焙模型导出器
- `src/viewer/resource-scene.ts`：原版资源模型渲染与交互
- `src/viewer/scene.ts`：资源不可用时的兼容渲染
- `src/pages/viewer-page.tsx`：原理图列表、文件选择和预览页面
- `scripts/`：开发、版本和打包脚本

## 相关项目与文档

- [SJMCL 扩展开发文档](https://mc.sjtu.cn/sjmcl/dev/extension/)
- [create-sjmcl-extension](https://www.npmjs.com/package/create-sjmcl-extension)
- [deepslate](https://github.com/misode/deepslate) — Minecraft 模型渲染库
- [Schem-at/schematic-renderer](https://github.com/Schem-at/schematic-renderer) — 渲染架构参考

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
