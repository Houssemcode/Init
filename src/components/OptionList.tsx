import {useRef} from 'preact/hooks';
import {optionHeight, windowEnd, windowStart} from '../lib/optionwindow';

export interface OptionItem {
	id: string;
	label: string;
	description: string;
	/** on/off options: shown as a switch */
	value?: boolean;
	/** other options: the current choice, shown as text */
	valueText?: string;
	/** ← → change it; shown with arrows while focused */
	stepper?: boolean;
}

interface Props {
	options: OptionItem[];
	focused: boolean;
	selected: number;
	onSelect: (index: number) => void;
	onActivate: (index: number) => void;
}

/** Vertical list of settings. A list taller than the screen scrolls to keep the highlighted row in view. */
export function OptionList ({options, focused, selected, onSelect, onActivate}: Props) {
	const startRef = useRef(0);
	const heights = options.map((o) => optionHeight(o.description));
	const start = windowStart(heights, Math.min(selected, options.length - 1), startRef.current);
	startRef.current = start;
	const end = windowEnd(heights, start);
	return (
		<div class="options">
			{options.slice(start, end).map((o, n) => {
				const i = start + n;
				return (
				<div
					key={o.id}
					class={`option${focused && i === selected ? ' option--focused' : ''}`}
					onMouseEnter={() => onSelect(i)}
					onClick={() => onActivate(i)}
				>
					<div class="option__text">
						<div class="option__label">{o.label}</div>
						<div class="option__description">{o.description}</div>
					</div>
					{o.value !== undefined
						? <div class={`switch${o.value ? ' switch--on' : ''}`} role="switch" aria-checked={o.value}>
							<div class="switch__knob" />
						</div>
						: <div class="option__value">
							{o.stepper && <span class="option__chevron">‹</span>}
							<span class="option__value-text">{o.valueText}</span>
							{o.stepper && <span class="option__chevron">›</span>}
						</div>}
				</div>
				);
			})}
		</div>
	);
}
