import {LAYOUT} from '../theme/tokens';
import {clamp} from '../hooks/useKeys';
import {Tile, type TileModel} from './Tile';

interface Props {
	label?: string;
	items: TileModel[];
	focused: boolean;
	selected: number;
	emptyText?: string;
	onSelect: (index: number) => void;
	onActivate: (index: number) => void;
	/** tile size and gap in px, and the width the row has to fit in; the CSS must use the same sizes */
	tileSize?: number;
	tileGap?: number;
	viewportWidth?: number;
}

/** Horizontal strip of tiles. Centred when it fits; otherwise a carousel that keeps
 *  the selected tile in the middle (clamped at the ends). */
export function Row ({label, items, focused, selected, emptyText, onSelect, onActivate, tileSize = LAYOUT.tileSize, tileGap = LAYOUT.tileGap, viewportWidth = LAYOUT.screenWidth - 2 * LAYOUT.edgePadding}: Props) {
	const step = tileSize + tileGap;
	const total = items.length * step - tileGap;
	const fits = total <= viewportWidth;
	const offset = fits ? 0 : clamp(selected * step + tileSize / 2 - viewportWidth / 2, 0, total - viewportWidth);

	return (
		<section class={`row${focused ? ' row--focused' : ''}`}>
			{label && <h2 class="row__label">{label}</h2>}
			<div class="row__viewport">
				{items.length === 0
					? <div class="row__empty">{emptyText || 'Nothing here yet'}</div>
					: <div class={`row__track${fits ? ' row__track--centered' : ''}`} style={{transform: `translateX(${-offset}px)`}}>
						{items.map((item, i) => (
							<Tile
								key={item.key}
								model={item}
								focused={focused && i === selected}
								onHover={() => onSelect(i)}
								onActivate={() => onActivate(i)}
							/>
						))}
					</div>}
			</div>
		</section>
	);
}
