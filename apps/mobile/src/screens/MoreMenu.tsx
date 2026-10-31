/**
 * <MoreMenu/>: the "⋯" top-bar button and its bottom sheet, which runs registry commands by id (no new commands):
 * View > Theme (Light, Dark, Auto: applied at once and persisted through setTheme), Edit > Settings…, Help > Agent
 * skill… and Help > About Gonq. The full overflow menu with every other command is M-25; MENU_COMMAND_IDS is what
 * this interim sheet lists. Exports MoreMenu and MENU_COMMAND_IDS.
 */
import { useState } from 'react';
import { registry, type CommandContext } from '@gonq/editor/commands';
import { BottomSheet } from '../shell/BottomSheet';
import { runFileCommand } from '../shell/documents';
import { useNavigator } from '../shell/StackNavigator';
import { useThemeChoice } from '../shell/theme';
import { aboutScreen } from './AboutScreen';
import { agentSkillScreen } from './AgentSkillScreen';
import { settingsScreen } from './SettingsScreen';

export const THEME_COMMAND_IDS = ['view.theme.light', 'view.theme.dark', 'view.theme.auto'] as const;
export const MENU_COMMAND_IDS = ['edit.settings', 'help.agentSkill', 'help.about'] as const;

export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const { push } = useNavigator();
  const [theme, setTheme] = useThemeChoice();
  const label = (id: string) => registry.commands().find((c) => c.id === id)?.label ?? id;

  const ctx: Partial<CommandContext> = {
    theme,
    setTheme,
    openSettings: () => push(settingsScreen),
    openAgentSkill: () => push(agentSkillScreen),
    openAbout: () => push(aboutScreen),
  };
  const run = (id: string) => {
    setOpen(false);
    runFileCommand(id, ctx);
  };

  return (
    <>
      <button type="button" className="m-tap" aria-label="More" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        ⋯
      </button>
      <BottomSheet open={open} title="Menu" onClose={() => setOpen(false)}>
        <div className="m-label" id="m-menu-theme">
          Theme
        </div>
        <div role="radiogroup" aria-labelledby="m-menu-theme">
          {THEME_COMMAND_IDS.map((id) => {
            const checked = registry.commands().find((c) => c.id === id)?.checked?.(ctx as CommandContext) ?? false;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                className="m-tap"
                style={{ width: '100%', justifyContent: 'space-between' }}
                onClick={() => run(id)}
              >
                {label(id)}
                <span aria-hidden="true">{checked ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        {MENU_COMMAND_IDS.map((id) => (
          <button key={id} type="button" className="m-tap" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => run(id)}>
            {label(id)}
          </button>
        ))}
      </BottomSheet>
    </>
  );
}
