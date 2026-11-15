import { useEffect, useState } from 'react';
import {
  CUSTOM_THEME_NAME_LENGTH,
  derivedColor,
  isCustomThemeId,
  isHexColor,
  newCustomThemeId,
  ORBIT_CORE_COLORS,
  type CoreColors,
  type CustomTheme,
  type DerivedToken,
  type ThemeColors
} from '../../../shared/themes';
import { Icon } from '../icons';

type Variant = 'dark' | 'light';
type TokenKey = keyof CoreColors | DerivedToken;

const DEFAULT_DARK: ThemeColors = { ...ORBIT_CORE_COLORS.dark, overrides: {} };
const DEFAULT_LIGHT: ThemeColors = { ...ORBIT_CORE_COLORS.light, overrides: {} };

interface Row {
  key: TokenKey;
  label: string;
  /** Advanced rows appear only when Advanced is on. */
  advanced: boolean;
}

const FOUNDATION: Row[] = [
  { key: 'canvas', label: 'Background', advanced: false },
  { key: 'surface', label: 'Surface', advanced: false },
  { key: 'raised', label: 'Raised surface', advanced: true },
  { key: 'hover', label: 'Overlay', advanced: true },
  { key: 'text', label: 'Text', advanced: false },
  { key: 'muted', label: 'Muted text', advanced: true },
  { key: 'line', label: 'Border', advanced: true }
];
const BRAND: Row[] = [
  { key: 'accent', label: 'Accent', advanced: false },
  { key: 'accentSoft', label: 'Accent tint', advanced: true }
];

const isDerived = (key: TokenKey): key is DerivedToken =>
  key === 'raised' || key === 'hover' || key === 'muted' || key === 'line' || key === 'accentSoft';

export interface CustomThemeEditorProps {
  /** The theme being edited, or null for a new one. */
  initial: CustomTheme | null;
  onSave(theme: CustomTheme): void;
  onCancel(): void;
}

/**
 * The Create theme sheet. A name, then colours for each variant: the four core colours, and under Advanced every
 * token the palette derives from them. Derived tokens show their mixed value until one is overridden.
 */
export function CustomThemeEditor({ initial, onSave, onCancel }: CustomThemeEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [variant, setVariant] = useState<Variant>('dark');
  const [dark, setDark] = useState<ThemeColors>(initial?.dark ?? DEFAULT_DARK);
  const [light, setLight] = useState<ThemeColors>(initial?.light ?? DEFAULT_LIGHT);
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState('');
  const trimmed = name.trim();
  const colors = variant === 'dark' ? dark : light;
  const setColors = variant === 'dark' ? setDark : setLight;

  const change = (key: TokenKey, value: string): void => {
    if (!isHexColor(value)) return;
    if (isDerived(key)) setColors({ ...colors, overrides: { ...colors.overrides, [key]: value } });
    else setColors({ ...colors, [key]: value });
  };
  const reset = (key: DerivedToken): void => {
    const overrides = { ...colors.overrides };
    delete overrides[key];
    setColors({ ...colors, overrides });
  };

  const visible = (row: Row): boolean =>
    (advanced || !row.advanced) && row.label.toLowerCase().includes(filter.trim().toLowerCase());

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
          <div className="settings-choice" role="radiogroup" aria-label="Appearance to edit">
            {(['light', 'dark'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={variant === value}
                className={variant === value ? 'active' : ''}
                onClick={() => setVariant(value)}
              >
                {value === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
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
            role="switch"
            aria-checked={advanced}
            className={`theme-advanced ${advanced ? 'on' : ''}`}
            onClick={() => setAdvanced((value) => !value)}
          >
            Advanced
            <span className="theme-advanced-track" aria-hidden="true" />
          </button>
        </div>

        <ColorGroup
          title="Foundation"
          rows={FOUNDATION.filter(visible)}
          colors={colors}
          change={change}
          reset={reset}
        />
        <ColorGroup
          title="Brand & content"
          rows={BRAND.filter(visible)}
          colors={colors}
          change={change}
          reset={reset}
        />
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

function ColorGroup({
  title,
  rows,
  colors,
  change,
  reset
}: {
  title: string;
  rows: Row[];
  colors: ThemeColors;
  change(key: TokenKey, value: string): void;
  reset(key: DerivedToken): void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="theme-sheet-group">
      <h4>{title}</h4>
      {rows.map((row) => {
        const value = isDerived(row.key) ? derivedColor(colors, row.key) : colors[row.key];
        const overridden = isDerived(row.key) && colors.overrides[row.key] !== undefined;
        return (
          <ColorRow
            key={row.key}
            label={row.label}
            value={value}
            overridden={overridden}
            onChange={(next) => change(row.key, next)}
            onReset={isDerived(row.key) ? () => reset(row.key as DerivedToken) : undefined}
          />
        );
      })}
    </section>
  );
}

/** One colour: a swatch that opens the picker, and the hex value, which can also be typed. */
function ColorRow({
  label,
  value,
  overridden,
  onChange,
  onReset
}: {
  label: string;
  value: string;
  overridden: boolean;
  onChange(value: string): void;
  onReset?(): void;
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
      {overridden && onReset && (
        <button type="button" className="theme-sheet-reset" aria-label={`Reset ${label}`} onClick={onReset}>
          Reset
        </button>
      )}
    </div>
  );
}
