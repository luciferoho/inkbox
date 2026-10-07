<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import { t, type MsgKey } from '@/i18n'
import { SHORTCUT_COMMANDS, effectiveShortcuts, accelKeys } from '@shared/shortcuts'
import { runPluginCommand } from '@/services/pluginHost'

/** 右侧快捷键面板：墨脊键盘图标开关，宽度过渡折叠/展开。
 *  应用级命令来自注册表（改键后实时跟随），编辑器内格式键仍为固定清单。 */
const ui = useUiStore()

const eff = computed(() => effectiveShortcuts(ui.shortcuts))

/* 注册表组：常用 = 文件命令；视图与模式 = 视图/外观/设置；查找挂在编辑组首行动态渲染。
   键帽格式全面板统一：一个组合一枚 kbd（"Ctrl+Shift+F" 一枚），双组合条目两枚 */
const REG_GROUPS = computed(() => {
  const keysOf = (id: string): string[] => {
    const keys = accelKeys(eff.value[id])
    return keys.length ? [keys.join('+')] : []
  }
  return [
    {
      title: t('sc.gCommon'),
      items: SHORTCUT_COMMANDS.filter((c) => c.group === 'file').map((c) => ({
        id: c.id,
        label: t(c.labelKey as MsgKey),
        keys: keysOf(c.id)
      }))
    },
    {
      title: t('sc.gView'),
      items: SHORTCUT_COMMANDS.filter((c) => c.group === 'view').map((c) => ({
        id: c.id,
        label: t(c.labelKey as MsgKey),
        keys: keysOf(c.id)
      }))
    }
  ]
})

const findLabel = computed(() => accelKeys(eff.value['edit:find']).join('+'))

/** 运行插件命令（宿主侧 try/catch，失败 toast 不出面板） */
function runCmd(id: string): void {
  runPluginCommand(id)
}

/* 固定键组：编辑器内格式键与即显模式操作（不支持自定义）。
   与上方注册表组同一键帽格式：一个组合一枚 kbd，" / " 分隔多组合 */
const STATIC_GROUPS = computed<{ title: string; items: { k: string[]; d: string }[] }[]>(() => [
  {
    title: t('sc.gEdit'),
    items: [
      { k: ['Ctrl+B'], d: t('sc.bold') },
      { k: ['Ctrl+I'], d: t('sc.italic') },
      { k: ['Ctrl+K'], d: t('sc.link') },
      { k: ['Ctrl+Shift+X'], d: t('sc.strike') },
      { k: ['Ctrl+Shift+C'], d: t('sc.inlineCode') },
      { k: ['Ctrl+=', 'Ctrl+-'], d: t('sc.heading') }
    ]
  },
  {
    title: t('sc.gWysiwyg'),
    items: [
      { k: ['Tab', 'Shift+Tab'], d: t('sc.indent') },
      { k: ['Esc'], d: t('sc.exitCode') },
      { k: ['Ctrl+Enter'], d: t('sc.afterCode') }
    ]
  }
])
</script>

<template>
  <aside class="sc-panel">
    <div class="sc-head">
      <span class="sc-heading">{{ $t('sc.title') }}</span>
      <button class="collapse-btn" :title="$t('sc.collapse')" @click="ui.toggleShortcutPanel()">
        <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M3.5 1.5L7 5l-3.5 3.5" />
        </svg>
      </button>
    </div>
    <div class="sc-body">
      <section v-for="g in REG_GROUPS" :key="g.title" class="sc-group">
        <p class="sc-title">{{ g.title }}</p>
        <div v-for="it in g.items" :key="it.id" class="sc-item">
          <span class="sc-desc">{{ it.label }}</span>
          <span class="sc-keys">
            <template v-if="it.keys.length">
              <kbd v-for="(key, i) in it.keys" :key="i">{{ key }}</kbd>
            </template>
            <kbd v-else class="unset">{{ $t('settings.scDisabled') }}</kbd>
          </span>
        </div>
      </section>
      <section v-if="ui.pluginCommands.length" class="sc-group">
        <p class="sc-title">{{ $t('sc.gPlugins') }}</p>
        <button
          v-for="c in ui.pluginCommands"
          :key="c.id"
          class="sc-cmd"
          :title="c.plugin + ' · ' + $t('sc.pluginRun')"
          @click="runCmd(c.id)"
        >
          <svg class="sc-cmd-ico" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
            <path d="M2.5 1.2v7.6L8.4 5z" fill="currentColor" />
          </svg>
          <span class="sc-cmd-name">{{ c.title }}</span>
          <span class="sc-cmd-src">{{ c.plugin }}</span>
        </button>
      </section>
      <section v-for="g in STATIC_GROUPS" :key="g.title" class="sc-group">
        <p class="sc-title">{{ g.title }}</p>
        <div v-for="it in g.items" :key="it.d" class="sc-item">
          <span class="sc-desc">{{ it.d }}</span>
          <span class="sc-keys">
            <kbd v-for="(key, i) in it.k" :key="i">{{ key }}</kbd>
          </span>
        </div>
        <!-- 查找替换为可改键命令，动态渲染在本组末行（同一键帽格式：一组合一枚） -->
        <div v-if="g.title === $t('sc.gEdit')" class="sc-item">
          <span class="sc-desc">{{ $t('sc.find') }}</span>
          <span class="sc-keys">
            <kbd v-if="findLabel">{{ findLabel }}</kbd>
            <kbd v-else class="unset">{{ $t('settings.scDisabled') }}</kbd>
          </span>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sc-panel {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-left: 1px solid var(--border);
}

.sc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 10px 8px 16px;
  flex-shrink: 0;
}

.sc-heading {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--text-2);
}

.collapse-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-s);
  display: grid;
  place-items: center;
  color: var(--text-2);
}

.collapse-btn:hover {
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.sc-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 14px 16px;
}

.sc-group {
  margin-bottom: 16px;
}

.sc-title {
  font-size: 11px;
  color: var(--text-2);
  letter-spacing: 2px;
  margin: 10px 0 6px;
}

/* 行布局：功能名在左占满、键帽右对齐成整齐右列（键帽列不再定宽，
   一组合一枚后中间不再留 156px 空洞，长描述也有空间不折行） */
.sc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  font-size: 12px;
}

/* 插件命令行：整行动作条目（▶ 图标 + 命令名 + 来源插件），与其他键位组区分。
   宽度不超出组容器（此前负 margin 溢出 6px 被面板滚动容器裁切） */
.sc-cmd {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  margin: 1px 0;
  padding: 5px 6px;
  border-radius: var(--radius-s);
  text-align: left;
  font-size: 12px;
  color: var(--text-1);
}

.sc-cmd-ico {
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

.sc-cmd-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-cmd-src {
  flex-shrink: 0;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}

.sc-cmd:hover {
  background: var(--surface-2);
}

.sc-cmd:hover .sc-cmd-ico {
  opacity: 1;
}

.sc-keys {
  display: inline-flex;
  gap: 3px;
  flex-wrap: nowrap;
  flex-shrink: 0;
  justify-content: flex-end;
}

.sc-keys kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  white-space: nowrap;
}

.sc-keys kbd.unset {
  color: var(--text-2);
  opacity: 0.7;
}

.sc-desc {
  color: var(--text-2);
  line-height: 1.5;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
