// ============================================================================
// Provider Switch — Client half (static Cordis plugin, browser bundle)  [v0.6.7]
//
// 四个表面：
//   1. 输入框模型选择器（conversation.input.model 槽，priority -1 shadow 官方
//      ModelSelect）：顶部新增关键字搜索框；被禁用供应商的整组模型被过滤掉；
//      当前会话已选模型所属供应商被禁用时显示警示条。数据面完全复用官方
//      modelDirectories 服务（同目录、同 selectModel RPC），只改视图。
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
      '.psw-selected{background:0 0}',
      '.psw-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
      '.psw-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}',
      '.psw-check{color:var(--dsw-alias-label-primary);flex:0 0 18px;place-items:center;display:grid}',
      '.psw-cell{width:100%;height:40px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;border-radius:10px;align-items:center;gap:8px;padding:0 10px;font-size:14px;line-height:22px;display:flex}',
      '.psw-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-cellLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}',
      '.psw-cellValue{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 auto;overflow:hidden}',
      '.psw-cellChevron{color:var(--dsw-alias-label-tertiary);flex:none}',
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
      '.psw-toast{position:fixed;bottom:24px;right:24px;z-index:9999;max-width:380px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:20px;box-shadow:0 4px 16px rgba(0,0,0,.28);cursor:pointer;background:#d9534f;color:#fff}'
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
        function showToast(text) {
          try {
            let el = document.querySelector('[data-psw-toast]');
            if (!el) {
              el = document.createElement('div');
              el.setAttribute('data-psw-toast', '1');
              el.className = 'psw-toast';
              el.addEventListener('click', () => { try { el.remove(); } catch (e) {} });
              document.body.appendChild(el);
            }
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
        let state = { disabled: [], providers: [], loaded: false };
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
              applyState({ disabled: reconcile(res.disabled || []), providers: res.providers || [], loaded: true });
              try { syncToggles(); syncRenameEditors(); } catch (e) {}
            }
          }).catch(() => {});
        }

        // alpha.3 设置 → 模型页行内匹配：优先展示名/id 精确匹配；兜底从
        // rowActions 内按钮 aria-label 精确提取 provider id token（无 displayName
        // 时 aria-label 为纯 id，自定义显示名时为 "显示名 (id)"）。
        function matchProviderInRow(row) {
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
              for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) {} }
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
        function sendSet(pid, want) {
          inflight.set(pid, want);
          const finish = (ok, remoteList, message) => {
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
              applyState({ disabled: reconcile(remote), loaded: true });
              syncToggles();
              return;
            }
            // 写的就是最后意图、权威值却没体现 → 宿主没真正写入，不重试（防死循环）
            if (target === want) {
              pending.delete(pid);
              applyState({ disabled: reconcile(remote), loaded: true });
              syncToggles();
              showToast(t('切换未生效：宿主未写入该配置', 'Toggle did not take effect: the host did not persist it'));
              return;
            }
            // 仍有更新的意图：保留乐观覆盖，补发一次收敛
            applyState({ disabled: reconcile(remote), loaded: true });
            syncToggles();
            sendSet(pid, target);
          };
          api('set', { provider: pid, disabled: want }).then(
            (res) => {
              if (res && res.ok) finish(true, res.disabled);
              else finish(false, null, res && res.message);
            },
            () => { finish(false, null, t('无法连接宿主端点', 'cannot reach the host endpoint')); }
          );
        }

        let syncQueued = false;
        function syncToggles() {
          if (typeof document === 'undefined') return;
          syncQueued = false;
          const rows = document.querySelectorAll('li[class*=rowCard]');
          for (const row of rows) {
            const actions = row.querySelector('span[class*=rowActions]');
            if (!actions) continue;
            const provider = matchProviderInRow(row);
            if (!provider) continue;
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
            btn.className = 'psw-switch ' + (isOff ? 'psw-switch-off' : 'psw-switch-on');
            btn.title = isOff
              ? t('已禁用：该供应商的模型将从选择器隐藏，且会话无法调用。点击重新启用。', 'Disabled: models are hidden from the picker and calls are blocked. Click to re-enable.')
              : t('已启用：该供应商的模型可见可用。点击禁用。', 'Enabled: models visible and callable. Click to disable.');
          }
        }

        function installPageToggles() {
          if (window.__pswTogglesInstalled) return function () {};
          window.__pswTogglesInstalled = true;
          try { syncToggles(); syncRenameEditors(); } catch (e) {}
          const observer = new MutationObserver(function () {
            if (syncQueued) return;
            syncQueued = true;
            try { requestAnimationFrame(function () { syncToggles(); syncRenameEditors(); }); } catch (e) { syncToggles(); syncRenameEditors(); }
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
          if (typeof document === 'undefined') return;
          const rows = document.querySelectorAll('li[class*=rowCard]');
          for (const row of rows) {
            const editor = row.querySelector('[class*=editor]');
            if (!editor) continue;
            const provider = matchProviderInRow(row);
            if (!provider) continue;
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
          input.setAttribute('data-psw-provider', provider.id);
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
            selection: {
              provider: group.id,
              model: model.id,
              ...model.reasoning && model.reasoning.defaultEffort !== void 0 ? { reasoningEffort: model.reasoning.defaultEffort } : {}
            }
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
          // 选项不使用 disabled：点击后立即关闭弹窗，select 在后台异步执行
          // （避免 DSH 0.1.7-rc syncInputs 残留 selecting 导致的变灰，也避免选择中的卡顿感）
          const busy = false;
          const reload = () => { lastActionRef.current = 'load'; load(); };

          React.useEffect(() => {
            if (available) { lastActionRef.current = 'load'; load(); }
          }, [available, load]);

          React.useEffect(() => {
            if (!open) return;
            const closeOutside = (event) => {
              if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
            };
            document.addEventListener('mousedown', closeOutside);
            return () => { document.removeEventListener('mousedown', closeOutside); };
          }, [open]);

          // 打开模型面板时聚焦搜索框
          React.useEffect(() => {
            if (open && pane === 'model' && searchRef.current) searchRef.current.focus();
          }, [open, pane]);

          if (!available) return null;

          const show = () => { setPane('root'); setOpen(true); reload(); };
          const close = (restoreFocus) => {
            setOpen(false);
            setPane('root');
            setQuery('');
            if (restoreFocus) queueMicrotask(() => { if (triggerRef.current) triggerRef.current.focus(); });
          };
          const moveFocus = (offset) => {
            const items = itemRefs.current.filter((item) => item !== null);
            if (items.length === 0) return;
            const active = items.findIndex((item) => item === document.activeElement);
            items[(Math.max(active, 0) + offset + items.length) % items.length].focus();
          };
          const onRootKeyDown = (event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              if (pane !== 'root') setPane('root');
              else close(true);
              return;
            }
            if (!open) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            }
          };
          const onBlur = (event) => {
            if (event.relatedTarget instanceof Node && rootRef.current && rootRef.current.contains(event.relatedTarget)) return;
            close();
          };
          const settleSelection = (accepted) => {

            if (accepted) return;
            const message = directory.getSnapshot().error;
            if (message !== null) {
              toastSeq.current += 1;
              setToast({ seq: toastSeq.current, text: t('模型操作失败：{message}', 'Model operation failed: {message}').replace('{message}', message) });
            }
          };
          const choose = (selection) => {
            if (state.current && state.current.provider === selection.provider && state.current.model === selection.model) { close(true); return; }
            lastActionRef.current = 'select';
            close(true);
            select(selection).then(settleSelection);
          };
          const chooseEffort = (effort) => {
            if (state.current === null) return;
            if (effectiveEffort === effort) { close(true); return; }
            const selection = {
              provider: state.current.provider,
              model: state.current.model,
              ...effort === void 0 ? {} : { reasoningEffort: effort }
            };
            lastActionRef.current = 'select';
            close(true);
            select(selection).then(settleSelection);
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
              onKeyDown: (e) => { if (e.key === 'Escape') e.stopPropagation(); }
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
                  group.models.map((model) => {
                    const selected = state.current && state.current.provider === group.id && state.current.model === model.id;
                    return h('button', {
                      ref: itemRef(),
                      type: 'button',
                      role: 'menuitemradio',
                      'aria-checked': selected,
                      className: 'psw-option' + (selected ? ' psw-selected' : ''),
                      title: model.name,
                      disabled: busy,
                      onClick: () => { choose({ provider: group.id, model: model.id }); },
                      key: model.id
                    },
                      h('span', { className: 'psw-optionCopy' },
                        h('span', { className: 'psw-modelName' }, model.name)
                      ),
                      h('span', { className: 'psw-check' }, selected ? h(CheckIcon, {}) : null)
                    );
                  })
                );
              })
            ),
            state.status === 'ready' && choices.length === 0 && h('div', { className: 'psw-empty' },
              String(query || '').trim() ? t('没有匹配的模型', 'No matching models') : t('没有可用的模型。', 'No models available.'))
          );

          return h('div', { ref: rootRef, className: 'psw-root', onKeyDown: onRootKeyDown, onBlur },
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
            open && h('div', { id: id + '-menu', className: 'psw-menu', role: 'menu', 'aria-busy': state.status === 'loading' || busy },
              pane === 'root' && h(React.Fragment, null,
                h('button', {
                  ref: itemRef(), type: 'button', role: 'menuitem', className: 'psw-cell',
                  onClick: () => { setPane('model'); }
                },
                  h('span', { className: 'psw-cellLabel' }, t('模型', 'Model')),
                  h('span', { className: 'psw-cellValue' }, modelLabel),
                  h(ChevronRightIcon, { className: 'psw-cellChevron' })
                ),
                reasoning !== void 0 && h('button', {
                  ref: itemRef(), type: 'button', role: 'menuitem', className: 'psw-cell',
                  onClick: () => { setPane('effort'); }
                },
                  h('span', { className: 'psw-cellLabel' }, t('推理等级', 'Effort')),
                  h('span', { className: 'psw-cellValue' }, effortLabel),
                  h(ChevronRightIcon, { className: 'psw-cellChevron' })
                )
              ),
              pane === 'model' && modelPane,
              pane === 'effort' && h(React.Fragment, null,
                errorBanner,
                effortChoices.length === 0
                  ? h('div', { className: 'psw-empty' }, t('当前模型未提供推理等级。', 'This model provides no reasoning effort levels.'))
                  : effortChoices.map((level) => h('button', {
                      ref: itemRef(), type: 'button', role: 'menuitemradio',
                      'aria-checked': effectiveEffort === level.effort,
                      className: 'psw-option' + (effectiveEffort === level.effort ? ' psw-selected' : ''),
                      disabled: busy,
                      onClick: () => { chooseEffort(level.effort); },
                      key: level.key
                    },
                      h('span', { className: 'psw-optionCopy' },
                        h('span', { className: 'psw-modelName' }, level.label)
                      ),
                      h('span', { className: 'psw-check' }, effectiveEffort === level.effort ? h(CheckIcon, {}) : null)
                    ))
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
              for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) {} }
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