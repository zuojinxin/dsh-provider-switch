// ============================================================================
// Provider Switch — Client half (static Cordis plugin, browser bundle)  [v0.3.0]
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
      '.psw-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:min(240px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}',
      '.psw-status,.psw-empty{color:var(--dsw-alias-label-tertiary);padding:10px;font-size:13px;line-height:20px}',
      '.psw-error,.psw-warning{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;padding:7px 8px;font-size:12px;line-height:18px;display:flex}',
      '.psw-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}',
      '.psw-retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}',
      '.psw-search{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);width:100%;height:30px;border-radius:8px;padding:0 10px;font-size:12px;line-height:18px;margin-bottom:6px;flex:none}',
      '.psw-search:focus{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.psw-search::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.psw-groups{min-height:0;overflow-y:auto}',
      '.psw-group+.psw-group{margin-top:4px}',
      '.psw-groupTitle{z-index:1;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;position:sticky;top:0}',
      '.psw-option{width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:10px;outline:none;align-items:center;gap:8px;padding:6px 8px;display:flex}',
      '.psw-option:hover:not(:disabled),.psw-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
      '.psw-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.psw-selected{background:0 0}',
      '.psw-optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}',
      '.psw-modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}',
      '.psw-description{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}',
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
      // ---- 选择失败提示 ----
      '.psw-toast{position:fixed;bottom:24px;right:24px;z-index:9999;max-width:380px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:20px;box-shadow:0 4px 16px rgba(0,0,0,.28);cursor:pointer;background:#d9534f;color:#fff}'
    ].join('');

    return {
      name: 'dsh-provider-switch',
      apply(ctx) {
        const slots = ctx.get('slots');
        if (!slots) return;

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
        const state = { disabled: [], providers: [], loaded: false };
        const subs = new Set();
        function getSnapshot() { return state; }
        function subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }
        function applyState(patch) {
          Object.assign(state, patch);
          for (const fn of [...subs]) { try { fn(); } catch (e) {} }
        }
        function refreshState() {
          return api('state', {}).then((res) => {
            if (res && res.ok) {
              applyState({ disabled: res.disabled || [], providers: res.providers || [], loaded: true });
              syncToggles();
              syncRenameEditors();
            }
          }).catch(() => {});
        }

        // ---- 事件驱动刷新：settings 文档变化（含本插件写入）与适配器增删 ----
        ctx.inject(['remote'], (scope) => {
          const offs = [
            scope.remote.$on('settings/document-updated', () => { refreshState(); }),
            scope.remote.$on('llm/adapters-updated', () => { refreshState(); })
          ];
          scope.effect(() => () => {
            for (const off of offs) { try { if (typeof off === 'function') off(); } catch (e) {} }
          }, 'provider-switch: state refresh');
          refreshState();
        });

        // =====================================================================
        // 设置 → 模型页：供应商行「编辑」按钮前的启用/禁用开关（DOM 注入）
        // =====================================================================
        let syncQueued = false;
        function syncToggles() {
          if (typeof document === 'undefined') return;
          syncQueued = false;
          const rows = document.querySelectorAll('li[class*=rowCard]');
          for (const row of rows) {
            const actions = row.querySelector('span[class*=rowActions]');
            if (!actions) continue;
            const nameEl = row.querySelector('span[class*=rowName]');
            const displayName = nameEl ? String(nameEl.textContent || '').trim() : '';
            let provider = null;
            for (const p of state.providers) {
              if (p.name === displayName || p.id === displayName) { provider = p; break; }
            }
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
                const current = state.disabled.indexOf(pid) >= 0;
                btn.disabled = true;
                api('set', { provider: pid, disabled: !current }).then((res) => {
                  if (res && res.ok) {
                    applyState({ disabled: res.disabled || [] });
                    syncToggles();
                  }
                }).catch(() => {}).then(() => {
                  if (btn && btn.isConnected) btn.disabled = false;
                });
              });
              const edit = actions.querySelector('button');
              if (edit && edit.parentNode === actions) actions.insertBefore(btn, edit);
              else actions.appendChild(btn);
            }
            const isOff = state.disabled.indexOf(provider.id) >= 0;
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

        function providerFromRow(row) {
          const nameEl = row.querySelector('span[class*=rowName]');
          const displayName = nameEl ? String(nameEl.textContent || '').trim() : '';
          for (const p of state.providers) {
            if (p.name === displayName || p.id === displayName) return p;
          }
          return null;
        }

        function syncRenameEditors() {
          if (typeof document === 'undefined') return;
          const rows = document.querySelectorAll('li[class*=rowCard]');
          for (const row of rows) {
            const editor = row.querySelector('[class*=editor]');
            if (!editor) continue;
            const provider = providerFromRow(row);
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
        function WarningIcon() {
          return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { flex: 'none' } },
            h('path', { d: 'M8 2.5L14.6 13.5H1.4L8 2.5Z', fill: 'currentColor' }));
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
              label: effort.name,
              ...effort.description !== void 0 ? { description: effort.description } : {}
            }))
          ], [reasoning]);
          const busy = state.status === 'selecting';
          const reload = () => { lastActionRef.current = 'load'; load(); };
          const currentBlocked = state.current && blocked.has(state.current.provider);

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
            if (accepted) { if (rootRef.current !== null) close(true); return; }
            const message = directory.getSnapshot().error;
            if (message !== null) {
              toastSeq.current += 1;
              setToast({ seq: toastSeq.current, text: t('模型操作失败：{message}', 'Model operation failed: {message}').replace('{message}', message) });
            }
          };
          const choose = (selection) => {
            if (state.current && state.current.provider === selection.provider && state.current.model === selection.model) { close(true); return; }
            lastActionRef.current = 'select';
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
            select(selection).then(settleSelection);
          };
          const modelLabel = currentChoice && currentChoice.model.name ? currentChoice.model.name : t('选择模型', 'Select model');
          const triggerLabel = effortLabel === void 0 ? modelLabel : modelLabel + ' · ' + effortLabel;

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
            state.error !== null && lastActionRef.current === 'load' && h('div', { className: 'psw-error' },
              h('span', null, t('模型操作失败：{message}', 'Model operation failed: {message}').replace('{message}', state.error)),
              h('button', { type: 'button', className: 'psw-retry', onClick: reload }, t('重新加载', 'Reload'))
            ),
            currentBlocked && h('div', { className: 'psw-warning' },
              h('span', null, t('当前模型的供应商已被禁用，请选择其他模型', 'The current model\'s provider is disabled — pick another model')),
              h(WarningIcon, {})
            ),
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
                        h('span', { className: 'psw-modelName' }, model.name),
                        model.description !== void 0 && h('span', { className: 'psw-description' }, model.description)
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
                state.error !== null && lastActionRef.current === 'load' && h('div', { className: 'psw-error' },
                  h('span', null, t('模型操作失败：{message}', 'Model operation failed: {message}').replace('{message}', state.error)),
                  h('button', { type: 'button', className: 'psw-retry', onClick: reload }, t('重新加载', 'Reload'))
                ),
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
                        h('span', { className: 'psw-modelName' }, level.label),
                        level.description !== void 0 && h('span', { className: 'psw-description' }, level.description)
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

        // shadow 官方 ModelSelect：priority -1 是渲染赢家（官方支持的
        // shadows-shipped-ui 姿势）。数据面（available/directory/load/select）
        // 与官方完全一致，均来自 modelDirectories 服务。
        ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
          const models = scope.modelDirectories;
          const sessions = scope.sessions;
          scope.slots.inject('conversation.input.model', () => scope.slots.register({
            name: 'conversation.input.model',
            priority: -1,
            inject: (sessionId) => {
              const directory = models.directoryFor(sessionId);
              const available = sessions.subagentAddress(sessionId) === void 0;
              return {
                available,
                directory: directory.store,
                load: () => { if (available) directory.load().catch(() => {}); },
                select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)
              };
            }
          }, PswModelSelect));
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
        ctx.inject(['commandUi'], (scope) => {
          try {
            const live = scope.commandUi && scope.commandUi.live;
            const contributions = live && live.contributions;
            const ui = contributions && contributions.get && contributions.get('model') && contributions.get('model').ui;
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
            scope.effect(() => () => {
              try {
                if (ui.options === wrappedOptions) { ui.options = originalOptions; delete ui.__pswWrapped; }
              } catch (e) {}
            }, 'provider-switch: /model popup filter');
          } catch (e) { /* 静默降级：弹层不过滤，其他功能不受影响 */ }
        });
      }
    };
  }
});