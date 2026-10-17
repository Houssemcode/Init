import {fullDate, timeParts, type TimeFormat} from '../lib/clock';
import type {ClockColor, ClockConfig} from '../lib/storage';

const COLORS: Record<ClockColor, string> = {
	white: '#F2F2F2',
	warm: '#FFE9C7',
	blue: '#C4E2FF',
	amber: '#FFB74D'
};

/** The clock: the time (with a small AM/PM beside it in 12-hour mode) and the date.
 *  Size, thickness, colour, position and what is shown all come from the settings. */
export function Clock ({now, format, config}: {now: Date; format: TimeFormat; config: ClockConfig}) {
	const {time, period} = timeParts(now, format);
	const size = config.size;
	const color = COLORS[config.color];
	return (
		<div class="clock" style={{top: `${config.top}%`, left: `${config.left}%`, color}}>
			<div class="clock__time" style={{fontSize: `${size}px`, fontWeight: config.weight, letterSpacing: `${(size * 0.045).toFixed(1)}px`}}>
				{time}
				{period && config.showPeriod && (
					<span class="clock__period" style={{fontSize: `${Math.round(size * 0.27)}px`, marginLeft: `${Math.round(size * 0.12)}px`}}>{period}</span>
				)}
			</div>
			{config.showDate && (
				<div class="clock__date" style={{fontSize: `${Math.max(26, Math.round(size * 0.2))}px`, marginTop: `${Math.round(size * 0.16)}px`}}>{fullDate(now)}</div>
			)}
		</div>
	);
}
