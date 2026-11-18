import { useEffect, useState } from 'react';
import { Switch } from '@ui-sdk/react/switch';
import { ChoiceGroup } from './ChoiceGroup';
import {
  builtInThemeColors,
  CUSTOM_THEME_NAME_LENGTH,
  generateThemeColors,
  isCustomThemeId,
  isHexColor,
  newCustomThemeId,
  type CustomTheme,
  type ThemeColorRole,
  type ThemeColors
} from '../../../shared/themes';
import { Icon } from '../icons';

type Variant = 'dark' | 'light';

interface Row {
  role: ThemeColorRole;
  label: string;
  /** Basic rows show without Advanced. */
  basic?: boolean;
}

/** T3 Code's colour roles, grouped by the part of the app they paint. Terminal roles are kept but not shown. */
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'Foundation',
    rows: [
      { role: 'canvas', label: 'Background', basic: true },
      { role: 'surface', label: 'Surface', basic: true },
      { role: 'surfaceRaised', label: 'Raised surface' },
      { role: 'surfaceOverlay', label: 'Menus and dialogs' },
      { role: 'border', label: 'Border', basic: true },
      { role: 'input', label: 'Input border' },
      { role: 'text', label: 'Text', basic: true },
      { role: 'textMuted', label: 'Muted text' },
      { role: 'secondaryLabel', label: 'Secondary label' },
      { role: 'placeholder', label: 'Placeholder' },
      { role: 'iconMuted', label: 'Muted icons' }
    ]
  },
  {
    title: 'Brand & actions',
    rows: [
      { role: 'accent', label: 'Accent', basic: true },
      { role: 'accentForeground', label: 'Text on accent' },
      { role: 'focus', label: 'Focus ring' },
      { role: 'messageAction', label: 'Primary button', basic: true },
      { role: 'messageActionForeground', label: 'Primary button text' },
      { role: 'messageActionHover', label: 'Primary button hover' },
      { role: 'accentSurface', label: 'Hover and selection' },
      { role: 'accentSurfaceForeground', label: 'Text on hover' }
    ]
  },
  {
    title: 'Sidebar',
    rows: [
      { role: 'sidebar', label: 'Sidebar', basic: true },
      { role: 'sidebarForeground', label: 'Sidebar text' },
      { role: 'sidebarMutedForeground', label: 'Sidebar muted text' },
      { role: 'sidebarControlSurface', label: 'Sidebar controls' },
      { role: 'sidebarRowHover', label: 'Row hover' },
      { role: 'sidebarRowActive', label: 'Row pressed' },
      { role: 'sidebarRowSelected', label: 'Row selected' },
      { role: 'sidebarBorder', label: 'Sidebar border' }
    ]
  },
  {
    title: 'Title bar',
    rows: [
      { role: 'chrome', label: 'Window frame' },
      { role: 'toolbar', label: 'Toolbar' },
      { role: 'toolbarForeground', label: 'Toolbar text' },
      { role: 'toolbarBorder', label: 'Toolbar border' },
      { role: 'toolbarControl', label: 'Toolbar controls' },
      { role: 'toolbarControlForeground', label: 'Toolbar control text' },
      { role: 'toolbarControlHover', label: 'Toolbar control hover' }
    ]
  },
  {
    title: 'Content',
    rows: [
      { role: 'secondary', label: 'Secondary surface' },
      { role: 'secondaryForeground', label: 'Secondary text' },
      { role: 'muted', label: 'Muted surface' },
      { role: 'mutedForeground', label: 'Text on muted surface' },
      { role: 'messageSurface', label: 'Comment surface' },
      { role: 'messageForeground', label: 'Comment text' },
      { role: 'codeBackground', label: 'Code background' },
      { role: 'codeForeground', label: 'Code text' },
      { role: 'searchMatchBackground', label: 'Search match' },
      { role: 'searchMatchForeground', label: 'Search match text' },
      { role: 'searchMatchActiveBackground', label: 'Current search match' },
      { role: 'searchMatchActiveForeground', label: 'Current search match text' }
    ]
  },
  {
    title: 'Status',
    rows: [
      { role: 'error', label: 'Error' },
      { role: 'errorForeground', label: 'Error text' },
      { role: 'errorSurface', label: 'Error surface' },
      { role: 'warning', label: 'Warning' },
      { role: 'warningForeground', label: 'Warning text' },
      { role: 'warningSurface', label: 'Warning surface' },
      { role: 'update', label: 'Update' },
      { role: 'updateForeground', label: 'Update text' },
      { role: 'updateSurface', label: 'Update surface' }
    ]
  }
];

export interface CustomThemeEditorProps {
  /** The theme being edited, or null for a new one. */
  initial: CustomTheme | null;
  onSave(theme: CustomTheme): void;
  onCancel(): void;
}

/**
 * The Create theme sheet. A name, then T3 Code's colour roles for each variant. The main roles show by default and
 * Advanced shows every one. Each row changes only its own role; Generate rebuilds the variant from its background and
 * accent, the way T3 Code derives a theme.
 */
export function CustomThemeEditor({ initial, onSave, onCancel }: CustomThemeEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [variant, setVariant] = useState<Variant>('dark');
  const [dark, setDark] = useState<ThemeColors>(initial?.dark ?? builtInThemeColors('orbit', 'dark'));
  const [light, setLight] = useState<ThemeColors>(initial?.light ?? builtInThemeColors('orbit', 'light'));
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState('');
  const trimmed = name.trim();
  const colors = variant === 'dark' ? dark : light;
  const setColors = variant === 'dark' ? setDark : setLight;

  const change = (role: ThemeColorRole, value: string): void => {
    if (isHexColor(value)) setColors({ ...colors, [role]: value.toLowerCase() });
  };
  const query = filter.trim().toLowerCase();
  const visible = (row: Row): boolean =>
    (advanced || Boolean(row.basic)) && row.label.toLowerCase().includes(query);

  return (
    <form
      className="theme-sheet"
      aria-label={initial ? `Edit ${initial.name}` : 'Create theme'}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) return;
        const id = initial && isCustomThemeId(initial.id) ? initial.id : newCustomThemeId();
        onSave({ id, name: trimmed, dark, light });
      }}
    >
      <header className="theme-sheet-head">
        <h3>{initial ? 'Edit theme' : 'Create theme'}</h3>
        <button type="button" className="icon-button" aria-label="Close theme editor" onClick={onCancel}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="theme-sheet-body">
        <label className="theme-sheet-field">
          <span>Theme name</span>
          <input
            value={name}
            maxLength={CUSTOM_THEME_NAME_LENGTH}
            placeholder="e.g. Aurora"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="theme-sheet-field">
          <span>Appearance</span>
          <ChoiceGroup
            label="Appearance to edit"
            value={variant}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark']
            ]}
            onChange={(next) => setVariant(next as Variant)}
          />
        </div>

        <div className="theme-sheet-colors-head">
          <input
            className="theme-sheet-filter"
            aria-label="Filter colors"
            placeholder="Filter colors"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <button
            type="button"
            className="secondary-action"
            title="Rebuild every colour of this appearance from its background and accent"
            onClick={() => setColors(generateThemeColors(variant, colors.canvas, colors.accent))}
          >
            Generate
          </button>
          <Switch
            className={`theme-advanced ${advanced ? 'on' : ''}`}
            checked={advanced}
            onCheckedChange={(checked) => setAdvanced(checked)}
          >
            Advanced
            <span className="theme-advanced-track" aria-hidden="true" />
          </Switch>
        </div>

        {GROUPS.map((group) => {
          const rows = group.rows.filter(visible);
          if (rows.length === 0) return null;
          return (
            <section key={group.title} className="theme-sheet-group">
              <h4>{group.title}</h4>
              {rows.map((row) => (
                <ColorRow
                  key={row.role}
                  label={row.label}
                  value={colors[row.role]}
                  onChange={(next) => change(row.role, next)}
                />
              ))}
            </section>
          );
        })}
      </div>

      <footer className="theme-sheet-actions">
        <button type="button" className="secondary-action" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-action" disabled={trimmed.length === 0}>
          {initial ? 'Save theme' : 'Create theme'}
        </button>
      </footer>
    </form>
  );
}

/** One colour: a swatch that opens the picker, and the hex value, which can also be typed. */
function ColorRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="theme-sheet-row">
      <span className="theme-sheet-row-label">{label}</span>
      <input
        type="color"
        className="theme-sheet-swatch"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        className="theme-sheet-hex"
        value={draft}
        aria-label={`${label} hex`}
        maxLength={7}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        onBlur={() => setDraft(value)}
      />
    </div>
  );
}
