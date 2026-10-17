import {useEffect, useState} from 'preact/hooks';
import {TIMING} from '../config/constants';

/** Current time, re-rendered once a second (only changes when the minute changes
 *  matter to the UI, but a 1s tick keeps the displayed minute exact). */
export function useClock (paused = false): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		if (paused) return undefined;
		setNow(new Date());
		const id = window.setInterval(() => setNow(new Date()), TIMING.clockTickMs);
		return () => window.clearInterval(id);
	}, [paused]);
	return now;
}
