# 墨流 Chrome 扩展

## 本地加载

1. 打开 Chrome 的 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 文件夹。
5. 打开或刷新微信公众号图文编辑页，右下角会出现“墨流”按钮。

扩展不读取或保存公众号登录 token，也不会绕过公众号的权限和发布确认。正文排版发生在当前页面；点击“保存为草稿”会触发公众号页面原有按钮；点击“进入发表确认”只打开公众号自身的发表流程。

## 已适配的 2026 编辑器结构

- 标题：`#js_title_main .title-editor-overlay .ProseMirror`
- 正文：`#ueditor_0 .rich_media_content .ProseMirror`
- 旧版正文兜底：`#edui1_iframeholder iframe` 内的可编辑节点
- 原生转载荐语：`.js_reprint_recommend_title` 与 `.js_reprint_recommend_content`
- 保存草稿：`#js_submit`
- 发表入口：`#js_send`

## 当前限制

- Markdown 中的远程图片会写入正文，但公众号是否完成转存需在首次保存前人工确认。
- 视频、小程序卡片、投票等公众号专属组件不会从公开转载文章中复制。
- 公开链接导入等同于“复制并修改原文”；只有获得相应版权许可时才应使用。若公众号已经提供原生转载权限，应优先使用“增强原生转载”。
