// Inline SVG line icons used by the Misc row and the settings badge.

export type GlyphName = 'house' | 'gear';

/** Small icons for the wallpaper picker. */
export function PickerIcon ({kind}: {kind: 'folder' | 'picture' | 'drive' | 'slideshow' | 'default' | 'info'}) {
	return (
		<svg class="picker__icon" viewBox="0 0 24 24" aria-hidden="true">
			{kind === 'folder' && <path d="M3 7.5h6.2l2 2.3H21v9.7H3z" />}
			{kind === 'picture' && <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 17l5-4.5 3.5 3L16 12l4 4.5" /></>}
			{kind === 'drive' && <><rect x="7.5" y="3.5" width="9" height="17" rx="2" /><path d="M10.5 7v3M13.5 7v3" /></>}
			{kind === 'slideshow' && <><rect x="6" y="7" width="14" height="11" rx="2" /><path d="M3.5 9.5v8.5a2 2 0 0 0 2 2H16" /></>}
			{kind === 'default' && <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 15l17-7" /></>}
			{kind === 'info' && <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.2" /></>}
		</svg>
	);
}

export function Glyph ({name}: {name: GlyphName}) {
	return (
		<svg class="tile__glyph" viewBox="0 0 24 24" aria-hidden="true">
			{name === 'house'
				? <path d="M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8M10 20v-6h4v6" />
				: <>
					<circle cx="12" cy="12" r="3.2" />
					<path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
				</>}
		</svg>
	);
}

export function CheckMark () {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M5 12.5l4.5 4.5L19 7.5" />
		</svg>
	);
}
