import { useState } from 'react';
import { Icon } from '../icons';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@ui-sdk/react/slider';

export interface PercentSliderProps {
  label: string;
  description: string;
  /** The saved value, 0 to 100. */
  value: number;
  /** The top of the range. Contrast goes to 200; glass stops at 100. */
  max?: number;
  defaultValue: number;
  /** Runs when the person lets go of the thumb, or when Reset is pressed. */
  onCommit(value: number): void;
}

/**
 * A label, a 0 to 100 slider and its value. ui-sdk moves the thumb as it is dragged, so the slider stays uncontrolled:
 * the label follows the drag, and the value saves on release. Reset remounts the slider so it shows the default.
 */
export function PercentSlider({
  label,
  description,
  value,
  max = 100,
  defaultValue,
  onCommit
}: PercentSliderProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  // Where the slider starts when it mounts. A reset sets it to the default before the saved value catches up.
  const [start, setStart] = useState(value);
  const [resets, setResets] = useState(0);
  const shown = dragging ?? value;

  const reset = (): void => {
    setStart(defaultValue);
    setResets((count) => count + 1);
    onCommit(defaultValue);
  };

  return (
    <div className="slider-row">
      <div className="slider-label">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <Slider
        key={resets}
        className="percent-slider"
        defaultValue={[start]}
        min={0}
        max={max}
        step={1}
        onValueChange={(next) => setDragging(firstValue(next))}
        onValueCommit={(next) => {
          setDragging(null);
          onCommit(firstValue(next));
        }}
      >
        <SliderControl className="percent-slider-control">
          <SliderTrack className="percent-slider-track">
            <SliderIndicator className="percent-slider-fill" />
          </SliderTrack>
          <SliderThumb index={0} aria-label={label} className="percent-slider-thumb" />
        </SliderControl>
      </Slider>
      <output className="slider-value" aria-label={`${label} value`}>
        {shown}%
      </output>
      <button
        type="button"
        className="typography-reset"
        aria-label={`Reset ${label.toLowerCase()}`}
        title={`Reset ${label.toLowerCase()}`}
        disabled={value === defaultValue && dragging === null}
        onClick={reset}
      >
        <Icon name="reset" size={14} />
      </button>
    </div>
  );
}

function firstValue(next: number | number[]): number {
  return Array.isArray(next) ? (next[0] ?? 0) : next;
}
