import {useCallback, useState} from 'preact/hooks';
import {Clock} from '../components/Clock';
import {Row} from '../components/Row';
import type {TileModel} from '../components/Tile';
import {useKeys, clamp, type NavKey} from '../hooks/useKeys';
import {useClock} from '../hooks/useClock';
import type {TimeFormat} from '../lib/clock';
import type {ClockConfig} from '../lib/storage';
import {FONT, LAYOUT} from '../theme/tokens';

export interface Appearance {
	/** icon size, % of the standard size */
	iconScale: number;
	/** px at 1080p */
	sideMargin: number;
	bottomMargin: number;
	clock: ClockConfig;
}

interface Props {
	/** the single row of tiles: apps, then any chosen inputs, then LG Home and Settings */
	items: TileModel[];
	timeFormat: TimeFormat;
	appearance: Appearance;
	active: boolean;
	/** the launcher is in the background: stop the clock ticking */
	paused?: boolean;
	onActivate: (item: TileModel) => void;
}

/** The home screen: a big clock in the middle and one row of tiles along the bottom.
 *  Left/Right move along the row, OK opens. Up/Down and Back do nothing here. */
export function Home ({items, timeFormat, appearance, active, paused, onActivate}: Props) {
	const now = useClock(paused);
	const [column, setColumn] = useState(0);
	const selected = clamp(column, 0, Math.max(0, items.length - 1));

	const handleKey = useCallback((key: NavKey): boolean => {
		switch (key) {
			// functional updates, so quick repeated presses never act on a stale position
			case 'left': setColumn((c) => clamp(c - 1, 0, items.length - 1)); break;
			case 'right': setColumn((c) => clamp(c + 1, 0, items.length - 1)); break;
			case 'enter': if (items[selected]) onActivate(items[selected]); break;
			default: break;       // up, down and back are swallowed
		}
		return true;
	}, [items, selected, onActivate]);

	useKeys(handleKey, active);

	// The row's sizes are set on the row itself (not on :root), so the Settings grid keeps its own.
	const scale = appearance.iconScale / 100;
	const tileSize = Math.round(LAYOUT.tileSize * scale);
	const tileGap = Math.round(LAYOUT.tileGap * scale);
	const rowStyle = [
		`left:${appearance.sideMargin}px`,
		`right:${appearance.sideMargin}px`,
		`bottom:${appearance.bottomMargin}px`,
		`--layout-tile-size:${tileSize}px`,
		`--layout-tile-gap:${tileGap}px`,
		`--layout-tile-radius:${Math.round(LAYOUT.tileRadius * scale)}px`,
		`--font-tile-label:${Math.min(24, Math.max(15, Math.round(FONT.tileLabel * scale)))}px`
	].join(';');

	return (
		<div class={`screen${active ? '' : ' screen--away'}`}>
			<Clock now={now} format={timeFormat} config={appearance.clock} />
			<div class="rows" style={rowStyle}>
				<Row
					items={items}
					focused
					selected={selected}
					onSelect={setColumn}
					onActivate={(col) => onActivate(items[col])}
					tileSize={tileSize}
					tileGap={tileGap}
					viewportWidth={LAYOUT.screenWidth - 2 * appearance.sideMargin}
				/>
			</div>
		</div>
	);
}
