import { Radio, RadioGroup } from '@ui-sdk/react/radio';

export interface ChoiceGroupProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange(value: T): void;
}

/** A row of exclusive choices, such as "Side panel" or "Full screen", with arrow-key movement. */
export function ChoiceGroup<T extends string>({ label, value, options, onChange }: ChoiceGroupProps<T>) {
  return (
    <RadioGroup
      className="settings-choice"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next as T);
      }}
    >
      {options.map(([optionValue, text]) => (
        <Radio key={optionValue} value={optionValue} className={value === optionValue ? 'active' : ''}>
          {text}
        </Radio>
      ))}
    </RadioGroup>
  );
}
