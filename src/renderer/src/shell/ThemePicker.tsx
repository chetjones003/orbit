import { useState, type CSSProperties } from 'react';
import {
  newCustomThemeId,
  ORBIT_CORE_COLORS,
  PALETTES,
  type ThemeImportDraft,
  paletteVariables,
  type ColorScheme,
  type CustomTheme,
  type PaletteId
} from '../../../shared/themes';
import { CustomThemeEditor } from './CustomThemeEditor';
import { ThemeImportDialog } from './ThemeImportDialog';

export interface ThemePickerProps {
  colorScheme: ColorScheme;
  palette: PaletteId;
  customThemes: CustomTheme[];
  /** Windows' current app mode, which System follows. */
  systemPrefersDark: boolean;
  onColorScheme(value: ColorScheme): void;
  onPalette(value: PaletteId): void;
  onSaveCustomTheme(theme: CustomTheme): void;
  onDeleteCustomTheme(id: string): void;
}

type Variant = 'light' | 'dark';

const SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

/**
 * Colour scheme and themes. Each theme has a light and a dark variant, and the colour scheme picks which one shows.
 * Previews and swatches show the colours the app uses, including those of custom themes.
 */
export function ThemePicker({
  colorScheme,
  palette,
  customThemes,
  systemPrefersDark,
  onColorScheme,
  onPalette,
  onSaveCustomTheme,
  onDeleteCustomTheme
}: ThemePickerProps) {
  const [editing, setEditing] = useState<CustomTheme | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const colorsFor = (id: PaletteId, variant: Variant) => {
    const custom = customThemes.find((theme) => theme.id === id);
    return custom ? paletteVariables(custom[variant]) : undefined;
  };

  return (
    <div className="theme-picker">
      <div className="theme-scheme-grid" role="radiogroup" aria-label="Color scheme">
        {SCHEMES.map((scheme) => (
          <button
            key={scheme.id}
            type="button"
            role="radio"
            aria-checked={colorScheme === scheme.id}
            className={`theme-scheme ${colorScheme === scheme.id ? 'active' : ''}`}
            onClick={() => onColorScheme(scheme.id)}
          >
            <span className="theme-scheme-preview">
              {scheme.id === 'system' ? (
                <>
                  <ThemePreview palette={palette} variant="light" vars={colorsFor(palette, 'light')} />
                  <ThemePreview palette={palette} variant="dark" vars={colorsFor(palette, 'dark')} />
                </>
              ) : (
                <ThemePreview
                  palette={palette}
                  variant={scheme.id === 'dark' ? 'dark' : 'light'}
                  vars={colorsFor(palette, scheme.id === 'dark' ? 'dark' : 'light')}
                />
              )}
            </span>
            <span className="theme-scheme-label">{scheme.label}</span>
          </button>
        ))}
      </div>
      <p className="theme-note">
        {colorScheme === 'system'
          ? `Follows Windows: ${systemPrefersDark ? 'dark' : 'light'} now.`
          : 'Choose System to follow Windows instead.'}
      </p>

      <div className="theme-heading-row">
        <h4 className="theme-heading">Themes</h4>
        <span className="theme-heading-actions">
          <button type="button" className="secondary-action" onClick={() => setImporting(true)}>
            Add theme
          </button>
          <button type="button" className="secondary-action" onClick={() => setEditing('new')}>
            Create theme
          </button>
        </span>
      </div>
      {importing && (
        <ThemeImportDialog
          onClose={() => setImporting(false)}
          onAdd={(draft) => {
            const theme = themeFromDraft(draft);
            onSaveCustomTheme(theme);
            onPalette(theme.id);
            setImporting(false);
          }}
        />
      )}
      {editing !== null && (
        <CustomThemeEditor
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(theme) => {
            onSaveCustomTheme(theme);
            onPalette(theme.id);
            setEditing(null);
          }}
        />
      )}
      <div className="theme-palette-grid" role="radiogroup" aria-label="Themes">
        {PALETTES.map((item) => (
          <ThemeCard
            key={item.id}
            id={item.id}
            name={item.name}
            active={palette === item.id}
            onPick={() => onPalette(item.id)}
            colorsFor={colorsFor}
          />
        ))}
        {customThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            id={theme.id}
            name={theme.name}
            active={palette === theme.id}
            onPick={() => onPalette(theme.id)}
            colorsFor={colorsFor}
            onEdit={() => setEditing(theme)}
            onDelete={() => {
              onDeleteCustomTheme(theme.id);
              if (palette === theme.id) onPalette('orbit');
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({
  id,
  name,
  active,
  onPick,
  colorsFor,
  onEdit,
  onDelete
}: {
  id: PaletteId;
  name: string;
  active: boolean;
  onPick(): void;
  colorsFor(id: PaletteId, variant: Variant): Record<string, string> | undefined;
  onEdit?(): void;
  onDelete?(): void;
}) {
  return (
    <div className={`theme-palette ${active ? 'active' : ''}`}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className="theme-palette-pick"
        onClick={onPick}
      >
        <span className="theme-palette-swatches">
          <ThemeSwatch palette={id} variant="light" vars={colorsFor(id, 'light')} />
          <ThemeSwatch palette={id} variant="dark" vars={colorsFor(id, 'dark')} />
        </span>
        <span className="theme-palette-name">{name}</span>
      </button>
      {(onEdit || onDelete) && (
        <span className="theme-palette-actions">
          {onEdit && (
            <button type="button" className="secondary-action" aria-label={`Edit ${name}`} onClick={onEdit}>
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="secondary-action"
              aria-label={`Delete ${name}`}
              onClick={onDelete}
            >
              Delete
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** A miniature of the app: a rail, a few lines, and a composer. */
function ThemePreview({
  palette,
  variant,
  vars
}: {
  palette: PaletteId;
  variant: Variant;
  vars: Record<string, string> | undefined;
}) {
  return (
    <span
      className="theme-preview"
      data-palette={palette}
      data-theme={variant}
      style={vars as CSSProperties | undefined}
      aria-hidden="true"
    >
      <span className="theme-preview-rail" />
      <span className="theme-preview-body">
        <span className="theme-preview-bar" />
        <span className="theme-preview-line" />
        <span className="theme-preview-line short" />
        <span className="theme-preview-composer" />
      </span>
    </span>
  );
}

function ThemeSwatch({
  palette,
  variant,
  vars
}: {
  palette: PaletteId;
  variant: Variant;
  vars: Record<string, string> | undefined;
}) {
  return (
    <span
      className="theme-swatch"
      data-palette={palette}
      data-theme={variant}
      style={vars as CSSProperties | undefined}
      aria-hidden="true"
    >
      <span className="theme-swatch-dot" />
    </span>
  );
}

/** A custom theme from colours read off Open VSX. A variant the extension lacks takes Orbit's own. */
function themeFromDraft(draft: ThemeImportDraft): CustomTheme {
  return {
    id: newCustomThemeId(),
    name: draft.name,
    dark: { ...(draft.dark ?? ORBIT_CORE_COLORS.dark), overrides: {} },
    light: { ...(draft.light ?? ORBIT_CORE_COLORS.light), overrides: {} }
  };
}
