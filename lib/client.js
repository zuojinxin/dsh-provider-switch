// ============================================================================
// Provider Switch — Client half (static Cordis plugin, browser bundle)  [v0.6.11]
//
// 四个表面：
//   1. 输入框模型选择器（conversation.input.model 槽，priority -1 shadow 官方
//      ModelSelect）：顶部新增关键字搜索框；被禁用供应商的整组模型被过滤掉
//      （v0.5.4 起不再显示「当前模型的供应商已被禁用」的警示条——那次移除在
//      README 行为说明里；本文件只保留目录加载失败的重试横幅）。数据面完全复用
//      官方 modelDirectories 服务（同目录、同 selectModel RPC），只改视图。
//   2. /model 命令弹层：包装 commandUi 已注册 model 贡献的 ui.options，
//      过滤被禁用供应商的行（v0.2.0；结构变化时静默降级为不过滤）。
//   3. 设置 → 模型页：MutationObserver 在每行供应商的「编辑」按钮前注入
//      「已启用/已禁用」开关（技术同 dsh-session-manager 侧边栏菜单的 DOM
//      注入；CSS 类为哈希名，用 [class*=...] 子串匹配，官方升级改类名时
//      开关消失但优雅降级，不影响其他功能）。
//   4. 供应商重命名（v0.3.0）：编辑卡片展开后，点击卡片标题（editorTitle）
//      即可内联编辑供应商显示名；Enter 或点击「应用」按钮提交，写入
//      llm-pi-ai 命名空间的 providers.<id>.displayName，settings 事件驱动
//      即时同步。Esc 或「取消」放弃编辑。
//
// 账号行开关（v0.6.11）：官方「DeepSeek 账号」行是账号态派生的伪供应商
// （provider id `deepseek-account`），官方客户端把它的显示名本地化成
// 「DeepSeek 账号」（真实注册名 "DeepSeek Account"），且该行 rowActions 内
// 没有任何按钮——显示名匹配与 aria-label 反推两条路径同时失效，开关注入不到。
// 现在改用行内独有的 accountStatus 标记兜底映射，账号行与其他供应商一样可启停。
//
// 状态流：客户端只通过 /api/provider-switch/state + /set + /rename 与 Host
// 通信；Host 把禁用集合写入 DSH settings 文档（provider-switch 命名空间），
// 重命名写入 llm-pi-ai 命名空间，于是 settings/document-updated 事件同时驱动
// 本插件刷新与官方模型页重载。
// 切换失败（v0.6.6）：/set 返回 ok:false 或请求失败时弹一个 toast 说明原因，
// 开关随后同步回权威值——此前失败与「没点到」在界面上完全一样，无法排查。
// 乐观更新（v0.6.7）：点击即时本地翻转开关，不等 Host 落盘往返（settings.update
// 要写 profile 文档，约 1s），写入返回后再对齐权威值、失败回滚并 toast；等待期间
// 开关保持可点（旧版置灰按钮会让「卡顿」变成另一种可见症状）。
// 写入去重（v0.6.7）：同一供应商同时只允许一个在途 /set，连点只累积「最后意图」，
// 在途请求返回后最多补发一次收敛——否则每次点击都发一个请求会排队（Host 串行落盘
// 各约 1s），停手后开关还会自己继续切换好几秒。
//
// 弹窗关闭策略 + 选中判定重做（v0.6.8）：
//   症状一「正在输出会话时弹窗刚打开就自己消失」：旧版在 root 上挂 focusout 关闭
//     （`onBlur`），把「焦点离开弹窗」当成「点到了外面」——任何把焦点移出弹窗的动作
//     都会被误判，例如宿主 composer 在会话输出期间重渲染/取回键盘焦点、切走窗口再
//     切回来。真实浏览器里已复现：一边每 50ms 重渲染并把焦点收回输入区，一边打开弹窗，
//     旧版弹窗会被关掉（v0.6.8 不会被关）。
//   症状二「点弹窗里的空白/滚动条滑块，看着点中了其实没选中，弹窗还消失了」：点
//     分组标题、内边距、间隙、滚动条时浏览器会把焦点从搜索框移到 body（relatedTarget
//     为 null），旧版的 focusout 判定同样当成外部点击；而选中本身是「点了就立刻关窗，
//     select 在后台异步跑」，失败时既没有反馈也没有回头路。
//   现在：① 关闭只由显式交互驱动 —— 触发器、Escape、选中成功、弹窗外的 mousedown
//     （capture 阶段，避免被宿主 stopPropagation 吞掉）；② 弹窗内的 mousedown 默认行为
//     一律 preventDefault（输入类元素与滚动条除外），焦点与键盘导航不会被「点一下空白」
//     打断；③ 选中以 select() 的返回值为准：官方 inject 返回 {ok:true}/{ok:false,error}，
//     本插件回退路径返回 true/false，统一归一后只在**确认生效**时关窗，未生效则保持
//     弹窗打开、在该行显示等待态、并把真实原因 toast 出来；④ 在途写入期间忽略重复点击，
//     8s 未落地则解除等待态（不会把列表锁死在「选择中」）。
//
// 关闭弹窗只认真实指针输入（v0.6.9，修「会话正在输出时点开弹窗、它自己消失」）：
//   实证根因不是焦点、不是裁剪、也不是层叠：第三方插件 dsh-streamfold（流式折叠）为了
//   自动折叠流式行，会在聊天行上 `dispatchEvent(new MouseEvent('mousedown', …))`
//   （dsh-streamfold/lib/client.js:313-320）——不带坐标（clientX/clientY 默认 0,0）、
//   isTrusted=false、冒泡到 document。它「跑完把思考与工具调用折起」的时机正好是流式
//   输出期间，于是这条合成事件被 v0.6.8 的关闭逻辑（与官方 ModelSelect 同一句
//   `document.addEventListener("mousedown", closeOutside)`）当成了「用户点了外面」。
//   现在：① 事件从 mousedown 换成 pointerdown（合成 MouseEvent 没有配套 pointerdown，
//   且 pointerdown 天然覆盖鼠标/触摸/触控笔）；② isTrusted === false 一律不关窗；
//   ③ 兜底「坐标与目标自洽」（elementFromPoint 对不上就不关），只对主文档树内的目标生效。
//   官方给 ModelSelect 加同类检查**不会**让这段可删：我们在 priority -1 上 shadow 了
//   official 座位，插件在场时跑的就是本文件，官方那份不会执行。可移除条件只有一条——
//   本插件不再自己监听 document 级指针事件（不再 shadow 官方座位，或改用宿主/官方的
//   浮层原语由它统一负责 dismiss）。
// ============================================================================
window.__ModuleLoader__.load({
  id: 'dsh-provider-switch',
  factory: (require) => {
    const React = require('react');

    // ---- CSS（从官方 ModelSelect 的样式表改写为 psw- 前缀，另加搜索框/开关）----
    const css = [
      '.psw-root{min-width:0;position:relative}',
      '.psw-trigger{min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}',
      '.psw-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.psw-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.psw-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.psw-triggerEffort{color:var(--dsw-alias-label-caption);flex:none}',
      '.psw-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}',
      '.psw-chevronOpen{transform:rotate(180deg)}',
      '.psw-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-alias-bg-layer-1);width:min(240px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}',
      '.psw-status,.psw-empty{color:var(--dsw-alias-label-tertiary);padding:10px;font-size:13px;line-height:20px}',
      '.psw-error,.psw-warning{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;padding:7px 8px;font-size:12px;line-height:18px;display:flex}',
      '.psw-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}',
      '.psw-retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}',
      '.psw-search{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);width:100%;height:30px;border-radius:8px;padding:0 10px;font-size:12px;line-height:18px;margin-bottom:6px;flex:none}',
      '.psw-search:focus{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.psw-search::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.psw-groups{min-height:0;overflow-y:auto}',
      '.psw-group+.psw-group{margin-top:4px}',
      '.psw-groupTitle{z-index:1;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;position:sticky;top:0}',
      '.psw-option{width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:10px;outline:none;align-items:center;gap:8px;padding:6px 8px;display:flex}',
      '.psw-option:hover:not(:disabled),.psw-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.psw-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
      '.psw-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}',
      '.psw-check{color:var(--dsw-alias-label-primary);flex:0 0 18px;place-items:center;display:grid}',
      '.psw-cell{width:100%;height:40px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;border-radius:10px;align-items:center;gap:8px;padding:0 10px;font-size:14px;line-height:22px;display:flex}',
      '.psw-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-cellLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}',
      '.psw-cellValue{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 auto;overflow:hidden}',
      '.psw-cellChevron{color:var(--dsw-alias-label-tertiary);flex:none}',
      // ---- 选中在途（v0.6.8）：在点击的那一行 check 位显示等待态，不置灰、不禁用 ----
      '.psw-optionPending{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-pending{box-sizing:border-box;width:14px;height:14px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:psw-spin .7s linear infinite}',
      '@keyframes psw-spin{to{transform:rotate(360deg)}}',
      // ---- 设置页行内开关 ----
      '.psw-switch{box-sizing:border-box;position:relative;display:inline-flex;align-items:center;justify-content:flex-start;width:34px;height:18px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;flex:none;transition:background .2s ease,border-color .2s ease}',
      '.psw-switch::after{content:\'\';position:absolute;left:1px;top:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .2s ease,background .2s ease}',
      '.psw-switch:hover:not(:disabled):not(.psw-switch-on){border-color:var(--dsw-alias-label-dimmed)}',
      '.psw-switch:disabled{opacity:.5;cursor:default}',
      '.psw-switch-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.psw-switch-on::after{transform:translateX(16px);background:#fff}',
      // ---- 供应商重命名：可点击标题 + 内联输入框 ----
      '.psw-editableName{cursor:pointer;border-radius:4px;margin:0 -2px;padding:0 2px;transition:background .12s ease}',
      '.psw-editableName:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-nameInput{box-sizing:border-box;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 6px;font-size:14px;font-weight:500;line-height:22px;height:24px;outline:none;width:200px;max-width:100%}',
      '.psw-nameInput:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.psw-nameError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:4px 0 0}',
      // ---- 目录加载失败提示条（error 重试 + warning 分组加载失败）----
      '.psw-toast{position:fixed;bottom:24px;right:24px;z-index:9999;max-width:380px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:20px;box-shadow:0 4px 16px rgba(0,0,0,.28);cursor:pointer;background:#d9534f;color:#fff}',
      // v0.6.10：非错误提示（热挂载时「临时生效」），蓝色区分于红色失败 toast
      '.psw-toast-info{background:#2f6feb}',
      // ---- 写入窗口内压掉官方页的「重载置灰」闪烁（v0.6.12）----
      // 官方「模型」页把每行「编辑/删除」的 disabled 绑在 status !== 'ready' 上，
      // 任何 settings 文档写入都会广播 settings/document-updated → 官方页 load()，
      // 整排按钮掉到 opacity .4 再恢复，肉眼就是「点一下开关闪一下」。
      // 只在我们自己那次写入的窗口里把这层灰顶回 1：disabled 语义不变（依旧不可点、
      // 依旧 cursor:default），变的只有颜色。
      'body[data-psw-writing] li[class*=rowCard] span[class*=rowActions] button:disabled{opacity:1}',
      'body[data-psw-writing] li[class*=rowCard] button[class*=addModelButton]:disabled{opacity:1}'
    ].join('');

    return {
      name: 'dsh-provider-switch',
      // DSH 0.1.2-alpha.3 客户端上下文按声明白名单放行服务访问：未在 inject
      // 声明的服务会被 cordis 上下文 get 拒绝（"cannot get property ... without
      // inject"）。modelDirectories.directoryFor() 内部访问 ctx.remote.session，
      // 必须在此声明（与官方 ui-model-selection 的模块级 inject 一致）。
      inject: [
        'commandUi',
        'locale',
        'sessions',
        'slots',
        'remote',
        'remote.session'
      ],
      apply(ctx) {
        // DSH 0.1.2-alpha.3：slots 等客户端服务改为经 ctx.inject 异步就绪，
        // apply() 不再同步 gate（ctx.get('slots') 此时可能为 undefined，
        // 旧代码会直接 return 导致整个插件静默失效）。所有服务依赖一律走
        // ctx.inject，且各部分分别 try/catch，单点失败不影响其他功能。

        const stylesSvc = ctx.get('styles');
        if (stylesSvc && typeof stylesSvc.insert === 'function') {
          stylesSvc.insert(css);
        } else if (typeof document !== 'undefined') {
          const tag = document.createElement('style');
          tag.setAttribute('data-plugin', 'dsh-provider-switch');
          tag.textContent = css;
          document.head.appendChild(tag);
        }

        // ---- Host HTTP API ----
        function api(name, args) {
          return fetch('/api/provider-switch/' + name, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args || {})
          }).then((r) => r.json());
        }

        // 端点失败时的可见反馈：开关是 DOM 注入的，没有自己的错误区域，
        // 写入被拒时静默还原会让用户看到「点了没反应」。
        let toastTimer = null;
        function showToast(text, kind) {
          try {
            let el = document.querySelector('[data-psw-toast]');
            if (!el) {
              el = document.createElement('div');
              el.setAttribute('data-psw-toast', '1');
              el.addEventListener('click', () => { try { el.remove(); } catch (e) {} });
              document.body.appendChild(el);
            }
            el.className = 'psw-toast' + (kind ? ' psw-toast-' + kind : '');
            el.textContent = text;
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { try { el.remove(); } catch (e) {} toastTimer = null; }, 6000);
          } catch (e) {}
        }

        const isZh = () => {
          try {
            const l = ctx.get('locale');
            const snap = l && typeof l.getSnapshot === 'function' ? l.getSnapshot() : undefined;
            const id = snap && (snap.active || snap.locale || snap.id);
            return !id || String(id).toLowerCase().indexOf('zh') === 0;
          } catch (e) { return true; }
        };
        const t = (zh, en) => (isZh() ? zh : en);

        // =====================================================================
        // 共享状态：禁用集合 + 供应商目录（Host 是唯一事实来源）
        // =====================================================================
        let state = { disabled: [], providers: [] };
        const subs = new Set();
        function getSnapshot() { return state; }
        function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }

        // 乐观更新（v0.6.7）：开关视觉状态由 state.disabled 驱动，而 Host 的写入要
        // 落盘 profile 文档（settings.update → configEditor.edit →
        // reconcileProfilePatches），往返约 1s；此前开关必须等这个往返结束、再等一次
        // settings/document-updated 触发的 state 拉取才翻转，观感就是「点了卡一下」。
        // 现在点击即本地翻转，写入返回后再对齐权威值，失败回滚并 toast。pending 记录
        // 进行中的目标值，使慢响应期间其他事件触发的 refreshState 不会把乐观值冲掉。
        const pending = new Map();
        function reconcile(serverDisabled) {
          const set = new Set(Array.isArray(serverDisabled) ? serverDisabled : []);
          for (const [pid, want] of pending) { want ? set.add(pid) : set.delete(pid); }
          return [...set].sort();
        }
        function applyState(patch) {
          // 每次生成新快照引用：React useSyncExternalStore 用 Object.is 比较
          // getSnapshot 返回值，原地改同一对象会被判定「未变」而拒绝重渲染——
          // alpha.3 下选择菜单因此一直读到初始空禁用集合，禁用过滤恒不生效。
          state = Object.assign({}, state, patch);
          for (const fn of [...subs]) { try { fn(); } catch (e) {} }
        }
        function refreshState() {
          return api('state', {}).then((res) => {
            if (res && res.ok) {
              applyState({ disabled: reconcile(res.disabled || []), providers: res.providers || [] });
              try { syncPageDom(); } catch (e) {}
            }
          }).catch(() => {});
        }

        // alpha.3 设置 → 模型页行内匹配：优先展示名/id 精确匹配；兜底从
        // rowActions 内按钮 aria-label 精确提取 provider id token（无 displayName
        // 时 aria-label 为纯 id，自定义显示名时为 "显示名 (id)"）。
        // v0.6.11 补：官方「DeepSeek 账号」行（provider id `deepseek-account`）
        // 是账号态派生的伪供应商——官方客户端把它的显示名本地化成「DeepSeek
        // 账号」（真实注册名是 "DeepSeek Account"），且该行 rowActions 内一个
        // 按钮都没有，上面两条匹配路径都落空。用行内独有的 accountStatus 标记
        // 兜底映射；state.providers 里没有时合成一个，Host 守卫只认 id 字符串。
        const ACCOUNT_PROVIDER = 'deepseek-account';
        function accountProvider() {
          for (const p of state.providers) {
            if (p && p.id === ACCOUNT_PROVIDER) return p;
          }
          return { id: ACCOUNT_PROVIDER, name: 'DeepSeek Account' };
        }
        function matchProviderInRow(row) {
          if (row.querySelector('span[class*=accountStatus]')) return accountProvider();
          const nameEl = row.querySelector('span[class*=rowName]');
          const displayName = nameEl ? String(nameEl.textContent || '').trim() : '';
          if (displayName) {
            for (const p of state.providers) {
              if (p.name === displayName || p.id === displayName) return p;
            }
          }
          const actions = row.querySelector('span[class*=rowActions]');
          if (actions) {
            const labels = Array.from(actions.querySelectorAll('button'))
              .map((b) => String(b.getAttribute('aria-label') || '')).join(' ');
            const tokens = (labels + ' ' + String(actions.textContent || '')).match(/[\w.-]+/g) || [];
            for (const p of state.providers) {
              if (tokens.indexOf(String(p.id)) >= 0) return p;
            }
          }
          return null;
        }

        // ---- 事件驱动刷新：settings 文档变化（含本插件写入）/ 适配器增删 /
        // 凭据变化 / 重连兜底（同官方 ui-settings-models 订阅集）----
        ctx.inject(['remote'], (scope) => {
          try {
            const offs = [
              scope.remote.$on('settings/document-updated', () => { refreshState(); }),
              scope.remote.$on('llm/adapters-updated', () => { refreshState(); }),
              scope.remote.$on('credentials/reference-updated', () => { refreshState(); })
            ];
            scope.effect(() => () => {
              disposeAll(offs);
            }, 'provider-switch: state refresh');
            refreshState();
          } catch (e) {}
        });

        // =====================================================================
        // 设置 → 模型页：供应商行「编辑」按钮前的启用/禁用开关（DOM 注入）
        // =====================================================================
        // 写入去重（v0.6.7）：每个供应商同时只允许一个在途 /set。点击立即乐观翻转，
        // 在途请求返回后若「最后意图」与权威值不符，再补发一次收敛——于是无论用户点
        // 多快，停手后最多只剩一个补发请求，不会出现「排队的请求逐个落盘、把开关继续
        // 来回切换」的回声（旧版每次点击都发一个请求，Host 侧串行落盘各约 1s，连点
        // 10 次就排 10 个，停手后开关还会自己继续切换好几秒）。
        const inflight = new Map();
        // 对齐权威值 + 刷新设置页开关（sendSet 的收尾分支共用）
        function applyRemote(remote) {
          applyState({ disabled: reconcile(remote) });
          syncToggles();
        }

        // v0.6.10：市场热挂载的实例没有可写的 settings 行，宿主会返回
        // persisted:false——开关本次会话已生效（内存态），但没落盘。这里给一次
        // 非报错的蓝色提示，避免用户看到「点了没反应/报错」以为插件坏了。
        let notedEphemeral = false;
        function noteEphemeral() {
          if (notedEphemeral) return;
          notedEphemeral = true;
          showToast(
            t(
              '已生效（临时）：当前插件未接入持久化配置，重启 DSH 后会重新读取',
              'Applied for this session only: this plugin has no writable settings row, so it re-reads the persisted config after a DSH restart'
            ),
            'info'
          );
        }

        // ---- 写入窗口：压掉官方页重载期间的「置灰闪烁」（v0.6.12）-------------
        // 每次落盘都会让官方「模型」页重新 load()，期间所有行按钮 disabled →
        // opacity .4，恢复后回弹，肉眼就是「闪一下」。官方页改不了，只能在我们
        // 自己触发的那次重载里把这层灰顶回正常（CSS 见 body[data-psw-writing]）。
        //
        // 只掩盖「我们引起的那次变灰」：点下去之前按钮本来就没灰，才说明随后的
        // 变灰是这次写入的重载；若点之前已经是灰的（设置只读、页面正在加载等
        // 固有禁用态），一律不掩盖。窗口有硬上限，到点必摘，绝不长期挂着。
        const WRITE_MASK_MS = 2500;
        let maskUntil = 0;
        let maskEligible = false;
        let maskTimer = null;
        let masking = false;
        function officialDimmed() {
          if (typeof document === 'undefined') return false;
          return document.querySelector(
            'li[class*=rowCard] span[class*=rowActions] button:not([data-psw-toggle]):disabled,'
            + 'li[class*=rowCard] button[class*=addModelButton]:disabled'
          ) !== null;
        }
        function setMask(on) {
          if (on === masking) return;
          masking = on;
          try {
            if (on) document.body.setAttribute('data-psw-writing', '1');
            else document.body.removeAttribute('data-psw-writing');
          } catch (e) {}
        }
        function stopMaskWatch() {
          if (maskTimer !== null) {
            clearInterval(maskTimer);
            maskTimer = null;
          }
          setMask(false);
        }
        function beginWriteWindow() {
          // 连点时官方页可能正处在上一次重载的置灰中：此时不能判定为「固有禁用态」，
          // 否则第二次写入会把还在进行的掩盖提前摘掉。
          maskEligible = masking || !officialDimmed();
          maskUntil = Date.now() + WRITE_MASK_MS;
          if (maskTimer !== null) return;
          maskTimer = setInterval(function () {
            if (Date.now() > maskUntil) {
              stopMaskWatch();
              return;
            }
            const dimmed = maskEligible && officialDimmed();
            setMask(dimmed);
            // 灰过又恢复 = 这次重载结束，提前摘掉
            if (masking && !dimmed) stopMaskWatch();
          }, 60);
        }

        function sendSet(pid, want) {
          beginWriteWindow();
          inflight.set(pid, want);
          const finish = (ok, remoteList, message, persisted) => {
            inflight.delete(pid);
            const remote = Array.isArray(remoteList) ? remoteList : [];
            const target = pending.get(pid);
            if (!ok) {
              // 失败只在「本次写入仍是用户最后意图」时回滚 + 提示，避免旧响应
              // 干扰新手势
              if (target === want) {
                pending.delete(pid);
                showToast(t('切换失败：', 'Toggle failed: ') + (message || t('宿主没有响应', 'no response from host')));
                refreshState();
              }
              syncToggles();
              return;
            }
            // 最后意图已满足（或已无未决意图）：对齐权威值收工
            if (target === undefined || (remote.indexOf(pid) >= 0) === target) {
              if (target !== undefined) pending.delete(pid);
              applyRemote(remote);
              if (persisted === false) noteEphemeral();
              return;
            }
            // 写的就是最后意图、权威值却没体现 → 宿主没真正写入，不重试（防死循环）
            if (target === want) {
              pending.delete(pid);
              applyRemote(remote);
              showToast(t('切换未生效：宿主未写入该配置', 'Toggle did not take effect: the host did not persist it'));
              return;
            }
            // 仍有更新的意图：保留乐观覆盖，补发一次收敛
            applyRemote(remote);
            sendSet(pid, target);
          };
          api('set', { provider: pid, disabled: want }).then(
            (res) => {
              if (res && res.ok) finish(true, res.disabled, null, res.persisted);
              else finish(false, null, res && res.message, true);
            },
            () => { finish(false, null, t('无法连接宿主端点', 'cannot reach the host endpoint'), true); }
          );
        }

        let syncQueued = false;
        // 设置 → 模型页供应商行（开关与重命名两个注入面共用）：行元素 + 匹配到的供应商
        function providerRows() {
          if (typeof document === 'undefined') return [];
          const out = [];
          for (const row of document.querySelectorAll('li[class*=rowCard]')) {
            const provider = matchProviderInRow(row);
            if (provider) out.push({ row, provider });
          }
          return out;
        }
        function syncToggles() {
          syncQueued = false;
          for (const { row, provider } of providerRows()) {
            const actions = row.querySelector('span[class*=rowActions]');
            if (!actions) continue;
            let btn = actions.querySelector('[data-psw-toggle]');
            if (!btn) {
              btn = document.createElement('button');
              btn.type = 'button';
              btn.setAttribute('data-psw-toggle', '1');
              btn.setAttribute('role', 'switch');
              btn.__pswProvider = provider.id;
              btn.addEventListener('click', () => {
                const pid = btn.__pswProvider;
                // 无论点多快：只更新「最后意图」并立即本地翻转（不等 Host 落盘
                // 往返），中间态不产生请求。不要把按钮置 disabled —— 那会让开关
                // 在等待期间变灰不可选，等于把「卡顿」换成另一种可见症状。
                const want = !(state.disabled.indexOf(pid) >= 0);
                pending.set(pid, want);
                applyState({ disabled: reconcile(state.disabled) });
                syncToggles();
                // 同一供应商同时只允许一个在途写入；已在途则等它返回后按最后意图
                // 补发（见 sendSet），避免请求排队造成「停手后开关继续自己切换」。
                if (!inflight.has(pid)) sendSet(pid, want);
              });
              const edit = actions.querySelector('button');
              if (edit && edit.parentNode === actions) actions.insertBefore(btn, edit);
              else actions.appendChild(btn);
            }
            const isOff = state.disabled.indexOf(provider.id) >= 0;
            // 清掉任何遗留的 disabled（旧版会在写入期间置灰开关）：开关任何时候
            // 都可点，视觉状态只由 state.disabled 决定。
            if (btn.disabled) btn.disabled = false;
            btn.textContent = '';
            btn.setAttribute('aria-checked', String(!isOff));
            btn.className = 'psw-switch' + (isOff ? '' : ' psw-switch-on');
            btn.title = isOff
              ? t('已禁用：该供应商的模型将从选择器隐藏，且会话无法调用。点击重新启用。', 'Disabled: models are hidden from the picker and calls are blocked. Click to re-enable.')
              : t('已启用：该供应商的模型可见可用。点击禁用。', 'Enabled: models visible and callable. Click to disable.');
          }
        }

        // 设置页两个注入面一起刷新（开关 + 重命名标题）
        function syncPageDom() {
          syncToggles();
          syncRenameEditors();
        }
        function installPageToggles() {
          if (window.__pswTogglesInstalled) return function () {};
          window.__pswTogglesInstalled = true;
          try { syncPageDom(); } catch (e) {}
          const observer = new MutationObserver(function () {
            if (syncQueued) return;
            syncQueued = true;
            try { requestAnimationFrame(function () { syncPageDom(); }); } catch (e) { syncPageDom(); }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          return function cleanup() {
            observer.disconnect();
            window.__pswTogglesInstalled = false;
          };
        }
        ctx.effect(function () { return installPageToggles(); }, 'provider-switch: page toggles');

        // =====================================================================
        // 设置 → 模型页：供应商编辑卡片标题内联重命名（DOM 注入，v0.3.0）
        //
        // 展开供应商编辑卡片后，卡片标题（[class*=editorTitle]）可点击变为
        // 输入框。Enter 或「应用」按钮提交到 /api/provider-switch/rename，
        // Host 写入 llm-pi-ai 命名空间的 providers.<id>.displayName；
        // settings/document-updated 事件驱动官方模型页重载，新名称即时同步。
        // Esc 或「取消」放弃。官方升级改类名时静默降级（标题不可点击）。
        // =====================================================================
        let renameReClicking = false;

        function syncRenameEditors() {
          for (const { row, provider } of providerRows()) {
            const editor = row.querySelector('[class*=editor]');
            if (!editor) continue;
            const headerEl = editor.querySelector('[class*=editorHeader]');
            if (!headerEl) continue;
            const titleEl = headerEl.querySelector('[class*=editorTitle]');
            if (!titleEl) continue;
            // 已在编辑中（我们的 input 还在），跳过
            if (editor.querySelector('[data-psw-name-input]')) continue;
            // 已增强过
            if (titleEl.getAttribute('data-psw-editable') === '1') continue;
            titleEl.setAttribute('data-psw-editable', '1');
            titleEl.classList.add('psw-editableName');
            titleEl.title = t('点击重命名供应商', 'Click to rename provider');
            titleEl.addEventListener('click', function () {
              startRenameEdit(editor, headerEl, titleEl, provider);
            });
          }
        }

        function startRenameEdit(editor, headerEl, titleEl, provider) {
          // 如果已有输入框在编辑，不重复创建
          if (editor.querySelector('[data-psw-name-input]')) return;
          const currentName = String(titleEl.textContent || '').trim();

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'psw-nameInput';
          input.value = currentName;
          input.setAttribute('data-psw-name-input', '1');
          input.setAttribute('data-psw-original', currentName);

          titleEl.style.display = 'none';
          headerEl.insertBefore(input, titleEl);

          let errorEl = null;
          const showError = function (msg) {
            clearError();
            errorEl = document.createElement('p');
            errorEl.className = 'psw-nameError';
            errorEl.textContent = msg;
            editor.insertBefore(errorEl, headerEl.nextSibling);
          };
          const clearError = function () {
            if (errorEl) { try { errorEl.remove(); } catch (e) {} errorEl = null; }
          };
          const revert = function () {
            try { input.remove(); } catch (e) {}
            titleEl.style.display = '';
            clearError();
          };

          const doRename = async function () {
            const newName = input.value.trim();
            clearError();
            if (newName === currentName) { revert(); return true; }
            // 空名称且当前没有自定义名（标题就是 provider id）→ 无事可做
            if (!newName && currentName === provider.id) { revert(); return true; }
            input.disabled = true;
            // 重命名同样写 settings 文档 → 官方页同样重载置灰，一并掩盖
            beginWriteWindow();
            try {
              const res = await api('rename', { provider: provider.id, displayName: newName });
              if (res && res.ok) return true;
              input.disabled = false;
              const detail = (res && (res.message || res.error)) || t('服务器无响应', 'No response from server');
              showError(t('重命名失败：{detail}', 'Rename failed: {detail}').replace('{detail}', detail));
              return false;
            } catch (e) {
              input.disabled = false;
              showError(t('重命名失败：{detail}', 'Rename failed: {detail}').replace('{detail}', String(e && e.message || e)));
              return false;
            }
          };

          // 找到操作按钮
          const actionsEl = editor.querySelector('[class*=editorActions]');
          const applyBtn = actionsEl ? actionsEl.querySelector('[class*=primaryButton]') : null;
          const cancelBtn = actionsEl ? actionsEl.querySelector('[class*=secondaryButton]') : null;

          // 拦截「应用」按钮：先提交重命名，再放行官方 apply
          if (applyBtn && !applyBtn.__pswRenameApply) {
            applyBtn.__pswRenameApply = true;
            applyBtn.addEventListener('click', async function (e) {
              if (renameReClicking) return; // 程序触发的二次点击，放行
              const myInput = editor.querySelector('[data-psw-name-input]');
              if (!myInput) return;
              const newName = myInput.value.trim();
              const origName = myInput.getAttribute('data-psw-original') || '';
              if (newName === origName) return; // 没改名，放行
              e.stopPropagation();
              e.preventDefault();
              const ok = await doRename();
              if (ok) {
                // 重命名成功：等 settings 事件驱动 React 重渲染后，二次点击
                // 让官方 apply 完成（保存其他字段 / 关闭卡片）
                renameReClicking = true;
                setTimeout(function () {
                  try {
                    const btn = editor.querySelector('[class*=editorActions] [class*=primaryButton]');
                    if (btn) btn.click();
                  } catch (err) {}
                  renameReClicking = false;
                }, 150);
              }
            }, true);
          }

          // 拦截「取消」按钮：先还原输入框
          if (cancelBtn && !cancelBtn.__pswRenameCancel) {
            cancelBtn.__pswRenameCancel = true;
            cancelBtn.addEventListener('click', function () {
              if (editor.querySelector('[data-psw-name-input]')) revert();
            }, true);
          }

          // 键盘：Enter 提交（触发应用按钮），Esc 取消
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (applyBtn) applyBtn.click();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              revert();
            }
          });

          // 聚焦并全选
          try { input.focus(); input.select(); } catch (e) {}
        }

        // =====================================================================
        // 输入框模型选择器：官方 ModelSelect 的 fork（搜索 + 禁用过滤 + 警示条）
        // =====================================================================
        const h = React.createElement;

        // 统一的 effect 清理（两处 scope.effect 收尾共用）
        function disposeAll(offs) {
          for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) {} }
        }

        // 合成事件识别（v0.6.9）：脚本 dispatchEvent 出来的事件 isTrusted 恒为 false，
        // 真实输入（鼠标/触摸/触控笔/系统注入的受信输入）恒为 true —— 这是浏览器给的、
        // 无法伪造的判据。再加一道「坐标与目标自洽」兜底：挡住那些带 0,0 坐标却把 target
        // 设在页面中部的注入事件；只对主文档树内的目标做这个检查——shadow root 里的目标
        // 用 contains 判定会误伤（宿主与内部元素互相 contains 都为 false）。
        function isSyntheticPointer(event) {
          if (event.isTrusted === false) return true;
          const target = event.target;
          if (!(target instanceof Element)) return false;
          if (target.getRootNode() !== document) return false;
          const hit = document.elementFromPoint(event.clientX, event.clientY);
          if (hit === null) return true;
          try { return !(hit === target || hit.contains(target) || target.contains(hit)); } catch (e) { return false; }
        }

        // 选项行（v0.6.9 抽取）：模型面板与推理等级面板的行结构完全一样，只有
        // 「是否选中 / 是否在途 / 标题 / 点击行为 / key」不同——此前两处各重复十几行。
        function optionRow(props) {
          const selected = props.selected;
          const pending = props.pending;
          return h('button', {
            ref: props.ref,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': selected,
            'aria-busy': pending || void 0,
            className: 'psw-option' + (pending ? ' psw-optionPending' : ''),
            ...props.title === void 0 ? {} : { title: props.title },
            onClick: props.onClick,
            key: props.key
          },
            h('span', { className: 'psw-optionCopy' },
              h('span', { className: 'psw-modelName' }, props.label)
            ),
            h('span', { className: 'psw-check' },
              pending ? h('span', { className: 'psw-pending' })
                : selected ? h(CheckIcon, {}) : null)
          );
        }

        // 根面板的下钻单元格（模型 / 推理等级两行结构相同，v0.6.9 抽取）
        function paneCell(props) {
          return h('button', {
            ref: props.ref,
            type: 'button',
            role: 'menuitem',
            className: 'psw-cell',
            onClick: props.onClick
          },
            h('span', { className: 'psw-cellLabel' }, props.label),
            h('span', { className: 'psw-cellValue' }, props.value),
            h(ChevronRightIcon, { className: 'psw-cellChevron' })
          );
        }

        // 选中载荷（v0.6.8）：模型行「显示勾选」与「提交给宿主的载荷」由同一个函数生成，
        // 带上模型自己的默认推理等级——与官方 ModelSelect 和官方 /model 弹层完全一致
        // （此前行里的载荷丢掉了 reasoningEffort，勾选与提交内容可能不一致）。
        function selectionOf(group, model) {
          return {
            provider: group.id,
            model: model.id,
            ...model.reasoning && model.reasoning.defaultEffort !== void 0 ? { reasoningEffort: model.reasoning.defaultEffort } : {}
          };
        }

        function ChevronDownIcon({ className }) {
          return h('svg', { width: 14, height: 14, viewBox: '0 0 12 12', fill: 'none', className, style: { flex: 'none' } },
            h('path', { d: 'M3 4.5L6 7.5L9 4.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }
        function ChevronRightIcon({ className }) {
          return h('svg', { width: 14, height: 14, viewBox: '0 0 12 12', fill: 'none', className, style: { flex: 'none' } },
            h('path', { d: 'M4.5 3L7.5 6L4.5 9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }
        function CheckIcon() {
          return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { flex: 'none' } },
            h('path', { d: 'M3.5 8.5L6.5 11.5L12.5 4.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }

        function PswModelSelect(props) {
          const directory = props.directory;
          const locked = props.locked;
          const available = props.available;
          const load = props.load;
          const select = props.select;
          const state = React.useSyncExternalStore(
            (fn) => directory.subscribe(fn),
            () => directory.getSnapshot()
          );
          const psw = React.useSyncExternalStore(subscribe, getSnapshot);
          const [open, setOpen] = React.useState(false);
          const [pane, setPane] = React.useState('root');
          const [query, setQuery] = React.useState('');
          const lastActionRef = React.useRef('load');
          const [toast, setToast] = React.useState(null);
          const toastSeq = React.useRef(0);
          const rootRef = React.useRef(null);
          const triggerRef = React.useRef(null);
          const searchRef = React.useRef(null);
          const itemRefs = React.useRef([]);
          const id = React.useId();

          const blocked = React.useMemo(() => new Set(psw.disabled), [psw.disabled]);

          // 过滤：剔除被禁用供应商的整组；关键字分词 AND 匹配（词序无关，
          // 空格/-/_/./: 视为分隔符，模型名/描述/供应商名任一命中即算）
          const groups = React.useMemo(() => {
            const tokens = String(query || '').trim().toLowerCase().split(/[\s\-_./:]+/).filter(Boolean);
            const out = [];
            for (const g of state.groups) {
              if (blocked.has(g.id)) continue;
              const models = tokens.length
                ? g.models.filter((m) => {
                    const hay = [
                      String(m.name || '').toLowerCase(),
                      String(m.description || '').toLowerCase(),
                      String(g.name || '').toLowerCase()
                    ].join(' ');
                    return tokens.every((tok) => hay.indexOf(tok) >= 0);
                  })
                : g.models;
              if (models.length > 0) out.push(Object.assign({}, g, { models }));
            }
            return out;
          }, [state.groups, blocked, query]);

          const choices = React.useMemo(() => groups.flatMap((group) => group.models.map((model) => ({
            group,
            model,
            selection: selectionOf(group, model)
          }))), [groups]);

          const currentChoice = choices[state.current === null ? -1 : choices.findIndex((c) => c.selection.provider === state.current.provider && c.selection.model === state.current.model)];
          const reasoning = currentChoice && currentChoice.model.reasoning;
          const effectiveEffort = state.current && state.current.reasoningEffort !== void 0 ? state.current.reasoningEffort : (reasoning ? reasoning.defaultEffort : void 0);
          const effortLabel = reasoning === void 0 ? void 0
            : effectiveEffort === void 0 ? t('Default', 'Default')
            : (reasoning.efforts.find((level) => level.id === effectiveEffort) || {}).name || effectiveEffort;
          const effortChoices = React.useMemo(() => reasoning === void 0 ? [] : [
            ...(reasoning.defaultEffort === void 0 ? [{ key: 'provider-default', effort: void 0, label: t('Default', 'Default') }] : []),
            ...reasoning.efforts.map((effort) => ({
              key: 'effort:' + effort.id,
              effort: effort.id,
              label: effort.name
            }))
          ], [reasoning]);
          // 在途选中（v0.6.8）：本插件自己维护，不读目录 store 的 state.pending——
          // 0.1.7-rc 的 pending 曾残留不落地，官方靠它把整列表置灰，本插件不跟它走
          // （保留 0.6.x 的「永不置灰/禁用」策略），只用它标出「哪一行正在等待」。
          const [selecting, setSelecting] = React.useState(null);
          const selectingRef = React.useRef(false);
          // 选项行永不 disabled：点击后只进入本地等待态并忽略重复点击（见 submitSelection），
          // 列表整体保持可点、不变灰。
          const reload = () => { lastActionRef.current = 'load'; load(); };

          // 可用性变化时拉一次目录。用 ref 持有 load：load 是宿主 inject 给的闭包
          // （渲染机按 entry × 会话绑定缓存，正常态身份稳定，但重注册/换会话就会换新），
          // 把它放进依赖数组等于把「要不要重新拉目录」交给宿主的闭包身份决定——夹具按
          // 最坏情况模拟（每帧新闭包）时 1.5s 内会发 30 次 load RPC。改用 ref 后只在
          // available 真正翻转时拉。
          const loadRef = React.useRef(load);
          loadRef.current = load;
          React.useEffect(() => {
            if (available) { lastActionRef.current = 'load'; loadRef.current(); }
          }, [available]);

          // 关闭策略（v0.6.8/v0.6.9）：只由**显式交互**关窗——触发器、Escape、选中成功、
          // 以及「弹窗外的真实指针按下」。焦点丢失不再关窗（旧版就是这样被误判的）：
          //   · 任何把焦点移出弹窗的动作（宿主 composer 在会话输出期间重渲染/取回键盘
          //     焦点、切走窗口再切回来）都会让旧版把弹窗判成「点到了外面」直接关掉；
          //   · 点击弹窗内的空白（分组标题、内边距、行间空隙、滚动条）会让搜索框失焦
          //     且 relatedTarget 为 null，旧版同样误判为外部点击 → 「点空了就没了」。
          // v0.6.9 再收紧一层：只认真实指针输入（isSyntheticPointer），脚本派发的合成
          // mousedown（例如 dsh-streamfold 折叠流式行时派发的那条）不再能关掉本弹窗。
          // 用 capture 阶段绑定：宿主或其他插件在冒泡阶段 stopPropagation 也盖不住它。
          React.useEffect(() => {
            if (!open) return;
            const closeOutside = (event) => {
              const root = rootRef.current;
              if (root === null) return;
              // .psw-menu 是 rootRef 子树内的绝对定位节点，其内部任何位置都算「弹窗内」
              if (event.target instanceof Node && root.contains(event.target)) return;
              if (isSyntheticPointer(event)) return;
              setOpen(false);
              setPane('root');
              setQuery('');
            };
            const evtName = typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown';
            document.addEventListener(evtName, closeOutside, true);
            return () => { document.removeEventListener(evtName, closeOutside, true); };
          }, [open]);

          // 焦点归属（v0.6.8）：下钻/返回都显式交还焦点，否则「返回根面板」后焦点落在
          // body 上，再按 Esc 就没有任何元素把按键冒泡到弹窗（关不掉）。
          // paneFocus 记录「回到根面板时该把焦点交给哪个单元格」。
          const paneFocus = React.useRef(null);
          React.useEffect(() => {
            if (!open) return;
            const intent = paneFocus.current;
            paneFocus.current = null;
            const scope = rootRef.current;
            if (pane === 'model') {
              if (searchRef.current) searchRef.current.focus();
              return;
            }
            if (pane === 'effort') {
              const checked = scope ? scope.querySelector('.psw-option[aria-checked="true"]') : null;
              const first = scope ? scope.querySelector('.psw-option') : null;
              (checked || first || triggerRef.current).focus();
              return;
            }
            // 根面板：把焦点交还给打开它的那个单元格（0=模型，1=推理等级）
            const cells = scope ? scope.querySelectorAll('.psw-cell') : [];
            const cell = intent === null ? null : cells[intent === 'effort' ? 1 : 0];
            (cell || triggerRef.current).focus();
          }, [open, pane]);

          if (!available) return null;

          const show = () => {
            setPane('root');
            setQuery('');
            setOpen(true);
            // 与官方一致：触发器持有焦点，弹窗内的键盘操作（含 Esc 关窗）始终有落点
            if (triggerRef.current) triggerRef.current.focus();
            reload();
          };
          const close = (restoreFocus) => {
            setOpen(false);
            setPane('root');
            setQuery('');
            if (restoreFocus) queueMicrotask(() => { if (triggerRef.current) triggerRef.current.focus(); });
          };
          const moveFocus = (offset) => {
            const items = itemRefs.current.filter((item) => item !== null);
            if (items.length === 0) return;
            // 焦点不在任何行上（例如刚点过搜索框/空白处）时，↓ 从第一行、↑ 从最后一行开始
            const active = items.findIndex((item) => item === document.activeElement);
            const next = active === -1
              ? (offset > 0 ? 0 : items.length - 1)
              : (active + offset + items.length) % items.length;
            items[next].focus();
          };
          const onRootKeyDown = (event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              if (pane !== 'root') { paneFocus.current = pane === 'effort' ? 'effort' : 'model'; setPane('root'); }
              else close(true);
              return;
            }
            if (!open) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            }
          };
          // 弹窗内的 mousedown 默认行为会把焦点从搜索框移到 body（点空白、分组标题、
          // 行内边距、滚动条时都会发生）。阻止它：焦点与键盘导航不会被「点一下空白」
          // 打断。两个例外必须保留默认行为——输入类元素（否则无法定位光标）与滚动条
          // （否则滑块拖不动/点不动，正是「滑块看着点中了其实没选中」的另一半成因）。
          const keepFocusInside = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('input, textarea, select, [contenteditable="true"]') !== null) return;
            const box = target.closest('.psw-groups');
            if (box !== null) {
              const bar = box.offsetWidth - box.clientWidth;
              if (bar > 0) {
                // 经典滚动条：命中右侧滚动条带 → 保留默认行为（滑块要能拖、能点）
                if (event.clientX >= box.getBoundingClientRect().left + box.clientWidth) return;
              } else if (target === box) {
                // 覆盖式滚动条（宽度为 0）：滚动条与列表重叠，命中容器本身时不能拦
                return;
              }
            }
            event.preventDefault();
          };
          // ---- 选中判定（v0.6.8）：以 select() 的**返回值**为准，不以「点到了」为准 ----
          // 官方 inject 的 select() 解析 {ok:true} / {ok:false,error:{code,message}}；
          // 本插件的回退路径解析 true / false；available=false 时官方解析 undefined
          // （官方语义是「不落地也不关窗」，这里按未生效处理）。
          const judgeSelection = (result) => {
            if (result === true) return { ok: true, message: '' };
            if (!result || result === false || typeof result !== 'object') return { ok: false, message: '' };
            if (result.ok === true) return { ok: true, message: '' };
            const error = result.error || {};
            const code = error.code || result.code || '';
            if (code === 'session/writer-held') {
              return { ok: false, message: t('当前会话被其他 DSH 实例占用，请关掉它再试', 'This session is in use by another DSH instance; close it and retry') };
            }
            return { ok: false, message: String(error.message || result.message || code || '') };
          };
          // 提交一次选择：只有**确认生效**才关窗；未生效保持弹窗打开 + toast 真实原因。
          // 在途期间忽略新的点击（避免两次 select 互相顶掉），8s 未落地则解除等待态。
          const submitSelection = (selection, key) => {
            if (selectingRef.current) return;
            selectingRef.current = true;
            setSelecting(key);
            lastActionRef.current = 'select';
            let settled = false;
            const finish = (judged) => {
              if (settled) return;
              settled = true;
              selectingRef.current = false;
              setSelecting(null);
              if (judged.ok) { close(true); return; }
              const detail = judged.message || t('宿主没有确认这次选择', 'the host did not confirm the selection');
              toastSeq.current += 1;
              setToast({ seq: toastSeq.current, text: t('模型未切换：', 'Model not switched: ') + detail });
            };
            const timer = setTimeout(() => {
              finish({ ok: false, message: t('等待宿主响应超时', 'the host did not respond in time') });
            }, 8000);
            const settle = (result) => { clearTimeout(timer); finish(judgeSelection(result)); };
            let promise;
            try { promise = select(selection); }
            catch (e) { settle({ ok: false, message: String((e && e.message) || e) }); return; }
            Promise.resolve(promise).then(
              settle,
              (e) => { settle({ ok: false, message: String((e && e.message) || e) }); }
            );
          };
          const choose = (choice) => {
            const selection = choice.selection;
            // 同一模型再点一次：不再提交（否则会把用户手选的推理等级重置回默认），直接关窗
            if (state.current && state.current.provider === selection.provider && state.current.model === selection.model) { close(true); return; }
            submitSelection(selection, selection.provider + '/' + selection.model);
          };
          const chooseEffort = (effort) => {
            if (state.current === null) return;
            if (effectiveEffort === effort) { close(true); return; }
            submitSelection({
              provider: state.current.provider,
              model: state.current.model,
              ...effort === void 0 ? {} : { reasoningEffort: effort }
            }, 'effort:' + String(effort));
          };
          const modelLabel = currentChoice && currentChoice.model.name ? currentChoice.model.name : t('选择模型', 'Select model');
          const triggerLabel = effortLabel === void 0 ? modelLabel : modelLabel + ' · ' + effortLabel;
          // 目录加载失败的重试横幅（model 面板与 effort 面板共用）
          const errorBanner = state.error !== null && lastActionRef.current === 'load'
            ? h('div', { className: 'psw-error' },
                h('span', null, t('模型操作失败：{message}', 'Model operation failed: {message}').replace('{message}', state.error)),
                h('button', { type: 'button', className: 'psw-retry', onClick: reload }, t('重新加载', 'Reload'))
              )
            : null;

          itemRefs.current = [];
          let itemIndex = 0;
          const itemRef = () => {
            const at = itemIndex++;
            return (node) => { itemRefs.current[at] = node; };
          };

          const modelPane = h(React.Fragment, null,
            h('input', {
              ref: searchRef,
              type: 'text',
              className: 'psw-search',
              placeholder: t('搜索模型名称/描述/供应商…', 'Search model name, description, provider…'),
              value: query,
              onChange: (e) => setQuery(e.target.value),
              // Esc 在搜索框里必须自己处理：这里 stopPropagation 是拦宿主的全局 Esc，
              // 顺带也拦住了 root 上的按键处理，所以按下时要自己回到上一层/关窗。
              onKeyDown: (e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                if (pane !== 'root') { paneFocus.current = 'model'; setPane('root'); }
                else close(true);
              }
            }),
            state.status === 'loading' && h('div', { className: 'psw-status' }, t('正在刷新模型列表…', 'Refreshing model list…')),
            errorBanner,
            state.failures.map((failure) => h('div', { className: 'psw-warning', key: failure.id },
              h('span', null, t('{name} 加载失败：{message}', '{name} failed to load: {message}')
                .replace('{name}', failure.name).replace('{message}', failure.message)),
              h('button', { type: 'button', className: 'psw-retry', onClick: reload }, t('重新加载', 'Reload'))
            )),
            h('div', { className: 'psw-groups scrollable' },
              groups.map((group) => {
                const headingId = id + '-' + group.id;
                return h('section', { role: 'group', 'aria-labelledby': headingId, className: 'psw-group', key: group.id },
                  h('div', { className: 'psw-groupTitle', id: headingId }, group.name),
                  group.models.map((model) => optionRow({
                    ref: itemRef(),
                    selected: state.current && state.current.provider === group.id && state.current.model === model.id,
                    pending: selecting === group.id + '/' + model.id,
                    title: model.name,
                    label: model.name,
                    onClick: () => { choose({ group, model, selection: selectionOf(group, model) }); },
                    key: model.id
                  }))
                );
              })
            ),
            state.status === 'ready' && choices.length === 0 && h('div', { className: 'psw-empty' },
              String(query || '').trim() ? t('没有匹配的模型', 'No matching models') : t('没有可用的模型。', 'No models available.'))
          );

          return h('div', { ref: rootRef, className: 'psw-root', onKeyDown: onRootKeyDown },
            h('button', {
              ref: triggerRef,
              type: 'button',
              className: 'psw-trigger',
              'aria-haspopup': 'menu',
              'aria-expanded': open,
              'aria-controls': open ? id + '-menu' : void 0,
              title: triggerLabel,
              disabled: locked,
              onClick: () => { if (open) close(); else show(); }
            },
              h('span', { className: 'psw-triggerLabel' }, modelLabel),
              effortLabel !== void 0 && h('span', { className: 'psw-triggerEffort' }, effortLabel),
              h(ChevronDownIcon, { className: 'psw-chevron' + (open ? ' psw-chevronOpen' : '') })
            ),
            open && h('div', {
              id: id + '-menu',
              className: 'psw-menu',
              role: 'menu',
              'aria-busy': state.status === 'loading' || selecting !== null,
              onMouseDown: keepFocusInside
            },
              pane === 'root' && h(React.Fragment, null,
                paneCell({
                  ref: itemRef(),
                  label: t('模型', 'Model'),
                  value: modelLabel,
                  onClick: () => { setPane('model'); }
                }),
                reasoning !== void 0 && paneCell({
                  ref: itemRef(),
                  label: t('推理等级', 'Effort'),
                  value: effortLabel,
                  onClick: () => { setPane('effort'); }
                })
              ),
              pane === 'model' && modelPane,
              pane === 'effort' && h(React.Fragment, null,
                errorBanner,
                effortChoices.length === 0
                  ? h('div', { className: 'psw-empty' }, t('当前模型未提供推理等级。', 'This model provides no reasoning effort levels.'))
                  : effortChoices.map((level) => optionRow({
                    ref: itemRef(),
                    selected: effectiveEffort === level.effort,
                    pending: selecting === 'effort:' + String(level.effort),
                    label: level.label,
                    onClick: () => { chooseEffort(level.effort); },
                    key: level.key
                  }))
              )
            ),
            toast !== null && h('div', {
              className: 'psw-toast',
              onClick: () => { setToast(null); }
            }, toast.text)
          );
        }

        // shadow 官方 ModelSelect。alpha.3 的 SlotCore 明确：single 席位按 priority
        // 决定渲染赢家——官方以默认 priority 0 注册，插件必须以**不同** priority
        // 注册才合法，且「lowest renders」。取 -1 沿袭旧 shadow 语义：
        // 与官方(0) 不冲突、又保证胜出。
        //
        // v0.6.0：数据面改走「官方槽位注册项自己的 inject」。官方 entry 的
        // inject 闭包捕获的是官方 ui-model-selection 的 modelDirectories——若有
        // 第三方插件（如 vision-router）装饰官方数据面做隐藏/投影，这里拿到的
        // 就是它已过滤的权威数据。于是本插件的输入框选择器与官方输入框选择器
        // 看到同一份数据：第三方插件在「输入框选择器」上的隐藏/显示设置原样
        // 保留（/model 弹层同理，各自独立），本插件只在此基础上叠加自己的禁用
        // 过滤。找不到官方项 / inject 不可用 / 无第三方装饰时，回退到原始读取，
        // 行为与旧版完全一致（零回归）。
        ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
          try {
            const models = scope.modelDirectories;
            const sessions = scope.sessions;
            let registered = false;
            const injectShadow = (sessionId) => {
              try {
                const entries = scope.slots.entries('conversation.input.model');
                // 排除本插件自己（inject 函数引用对比），取剩余中 priority 最低
                // 的——即「本插件缺席时本会渲染」的官方注册项。
                const official = entries
                  .filter((e) => e && typeof e.inject === 'function' && e.inject !== injectShadow)
                  .sort((a, b) => ((a.options && a.options.priority) || 0) - ((b.options && b.options.priority) || 0))[0];
                if (official) return official.inject(sessionId);
              } catch (e) {}
              const directory = models.directoryFor(sessionId);
              const available = sessions.subagentAddress(sessionId) === void 0;
              return {
                available,
                directory: directory.store,
                load: () => { if (available) directory.load().catch(() => {}); },
                select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)
              };
            };
            const registerShadow = () => {
              if (registered) return;
              try {
                scope.slots.register({
                  name: 'conversation.input.model',
                  priority: -1,
                  inject: injectShadow
                }, PswModelSelect);
                registered = true;
              } catch (e) { /* 席位未就绪/瞬时冲突：保持官方选择器，等下次 inject 再试 */ }
            };
            scope.slots.inject('conversation.input.model', registerShadow);
          } catch (e) { /* shadow 失败静默降级：官方选择器无搜索/过滤，其余功能不受影响 */ }
        });

        // =====================================================================
        // /model 命令弹层过滤 [v0.2.0]
        //
        // 官方 contract：commandUi.register 重名抛错、decorate 只对 host 目录
        // 命令生效——/model 是客户端贡献命令，两个正门都走不通。唯一安全挂点
        // 是运行时已注册的贡献对象本身：CommandUiRuntime 把贡献存在普通属性
        // this.live.contributions（Map，按名索引），这里直接包装其 ui.options，
        // 返回前滤掉禁用供应商的行（选项 id 形如 "<providerId>/<modelId>"，
        // failure 行以 failure/ 开头须保留）。内部结构变化或时序不巧时静默
        // 降级为不过滤；dispose 恢复原函数。
        // =====================================================================
        ctx.inject(['commandUi', 'remote'], (scope) => {
          try {
            const contributions = scope.commandUi && scope.commandUi.live && scope.commandUi.live.contributions;
            if (!contributions || typeof contributions.get !== 'function') return;
            let wrappedEntry = null;
            const attempt = () => {
              try {
                if (wrappedEntry !== null) return;
                const ui = contributions.get('model') && contributions.get('model').ui;
                if (!ui || typeof ui.options !== 'function' || ui.__pswWrapped) return;
                const originalOptions = ui.options;
                const wrappedOptions = async (session, signal) => {
                  const rows = await originalOptions(session, signal);
                  if (!Array.isArray(rows) || state.disabled.length === 0) return rows;
                  return rows.filter((row) => {
                    const id = String((row && row.id) || '');
                    if (id.indexOf('failure/') === 0) return true;
                    return !state.disabled.some((p) => id === p || id.indexOf(p + '/') === 0);
                  });
                };
                ui.options = wrappedOptions;
                ui.__pswWrapped = true;
                wrappedEntry = { ui, originalOptions };
              } catch (e) {}
            };
            attempt();
            // model 贡献由 official model-selection 注册，可能晚于 commandUi 就绪：
            // 事件驱动 + 一次性延迟兜底重试。
            const offs = [
              scope.remote.$on('llm/adapters-updated', attempt),
              scope.remote.$on('settings/document-updated', attempt)
            ];
            const timer = setTimeout(attempt, 1500);
            scope.effect(() => () => {
              clearTimeout(timer);
              disposeAll(offs);
              try {
                if (wrappedEntry && wrappedEntry.ui && wrappedEntry.ui.options &&
                    wrappedEntry.ui.__pswWrapped) {
                  wrappedEntry.ui.options = wrappedEntry.originalOptions;
                  delete wrappedEntry.ui.__pswWrapped;
                }
              } catch (e) {}
            }, 'provider-switch: /model popup filter');
          } catch (e) { /* 静默降级：弹层不过滤，其他功能不受影响 */ }
        });
      }
    };
  }
});