// The user's choices: which apps and inputs appear on the home row, in order, the look
// (theme, sizes, margins), the clock, the wallpaper, and a few options. Persisted in
// localStorage (private to this app on the TV).

import {STORAGE_KEY, WALLPAPER} from '../config/constants';
import type {ThemeName} from '../theme/tokens';

export type WallpaperMode = 'gradient' | 'image' | 'folder';
export type ClockFormat = 'tv' | '12h' | '24h';
export type ClockColor = 'white' | 'warm' | 'blue' | 'amber';
export type ClockWeight = 200 | 300 | 400;

/** Numeric settings: the values they can take (OK steps through them, ← → nudge them). */
export const RANGES = {
	iconScale:    {min: 70,  max: 140, step: 10, def: 100},   // % of the standard tile size
	sideMargin:   {min: 0,   max: 200, step: 10, def: 50},    // px at 1080p, left and right of the app row
	bottomMargin: {min: 0,   max: 200, step: 10, def: 40},    // px at 1080p, below the app row
	clockSize:    {min: 80,  max: 220, step: 10, def: 140},   // px, height of the digits
	clockTop:     {min: 0,   max: 70,  step: 2,  def: 28},    // % of the screen height (0 = the very top)
	clockLeft:    {min: 0,   max: 100, step: 2,  def: 50}     // % of the screen width (where the clock's centre sits)
} as const;

export type RangeName = keyof typeof RANGES;

export function rangeValues (name: RangeName): number[] {
	const r = RANGES[name];
	const out: number[] = [];
	for (let v = r.min; v <= r.max; v += r.step) out.push(v);
	return out;
}

export interface ClockConfig {
	size: number;
	weight: ClockWeight;
	/** distance of the clock from the top of the screen, % of the screen height */
	top: number;
	/** where the clock's centre sits across the screen, % of the screen width */
	left: number;
	color: ClockColor;
	showDate: boolean;
	/** AM/PM beside the time (12-hour mode only) */
	showPeriod: boolean;
}

export interface WallpaperConfig {
	/** gradient: the default background (black or the calm gradient, per theme). image: one picture. folder: a slideshow. */
	mode: WallpaperMode;
	/** absolute path of the picture or the folder (empty for the default background) */
	path: string;
	/** seconds between pictures in a slideshow */
	intervalSec: number;
	/** play the slideshow in random order */
	shuffle: boolean;
}

export interface UserConfig {
	/** ordered app IDs for the app row; null → every app the TV reports, in the TV's order */
	appIds: string[] | null;
	/** ordered input appIds (com.webos.app.hdmiN) shown after the apps; empty → none */
	sourceIds: string[];
	/** read the live app list through the Homebrew Channel (root) */
	useHomebrew: boolean;
	/** end LG's own home app when the launcher opens, to free memory */
	closeHome: boolean;
	/** a watcher opens this launcher whenever LG Home comes to the front (kept running whenever the launcher opens) */
	replaceHome: boolean;
	/** start that watcher at boot (a link in the startup folder) */
	hookBoot: boolean;
	theme: ThemeName;
	iconScale: number;
	sideMargin: number;
	bottomMargin: number;
	/** 'tv' follows the TV's own 12/24-hour setting */
	clockFormat: ClockFormat;
	clock: ClockConfig;
	wallpaper: WallpaperConfig;
}

export const DEFAULT_WALLPAPER: WallpaperConfig = {
	mode: 'gradient',
	path: '',
	intervalSec: 60,
	shuffle: true
};

export const DEFAULT_CLOCK: ClockConfig = {
	size: RANGES.clockSize.def,
	weight: 200,
	top: RANGES.clockTop.def,
	left: RANGES.clockLeft.def,
	color: 'white',
	showDate: true,
	showPeriod: true
};

export const DEFAULT_CONFIG: UserConfig = {
	appIds: null,
	sourceIds: [],
	useHomebrew: true,
	closeHome: true,
	replaceHome: false,
	hookBoot: true,
	theme: 'black',
	iconScale: RANGES.iconScale.def,
	sideMargin: RANGES.sideMargin.def,
	bottomMargin: RANGES.bottomMargin.def,
	clockFormat: '12h',
	clock: DEFAULT_CLOCK,
	wallpaper: DEFAULT_WALLPAPER
};

function stringList (value: unknown): string[] | null {
	return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : null;
}

/** A number within the range's limits, snapped to its step; the default when it isn't a number. */
function ranged (value: unknown, name: RangeName): number {
	const r = RANGES[name];
	if (typeof value !== 'number' || !isFinite(value)) return r.def;
	const snapped = r.min + Math.round((Math.min(r.max, Math.max(r.min, value)) - r.min) / r.step) * r.step;
	return Math.min(r.max, snapped);
}

export function loadConfig (): UserConfig {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {...DEFAULT_CONFIG};
		const parsed = JSON.parse(raw) as Partial<UserConfig> & {wallpaper?: Partial<WallpaperConfig>; clock?: Partial<ClockConfig>};
		const w: Partial<WallpaperConfig> = parsed.wallpaper || {};
		const c: Partial<ClockConfig> = parsed.clock || {};
		const mode: WallpaperMode = w.mode === 'image' || w.mode === 'folder' ? w.mode : 'gradient';
		const path = typeof w.path === 'string' ? w.path : '';
		const interval = typeof w.intervalSec === 'number' && w.intervalSec >= 5 ? w.intervalSec : DEFAULT_WALLPAPER.intervalSec;
		return {
			appIds: stringList(parsed.appIds),
			sourceIds: stringList(parsed.sourceIds) || [],
			useHomebrew: parsed.useHomebrew !== false,
			closeHome: parsed.closeHome !== false,
			replaceHome: parsed.replaceHome === true,
			hookBoot: parsed.hookBoot !== false,
			theme: parsed.theme === 'grey' ? 'grey' : 'black',
			iconScale: ranged(parsed.iconScale, 'iconScale'),
			sideMargin: ranged(parsed.sideMargin, 'sideMargin'),
			bottomMargin: ranged(parsed.bottomMargin, 'bottomMargin'),
			clockFormat: parsed.clockFormat === 'tv' || parsed.clockFormat === '24h' ? parsed.clockFormat : '12h',
			clock: {
				size: ranged(c.size, 'clockSize'),
				weight: c.weight === 300 || c.weight === 400 ? c.weight : 200,
				top: ranged(c.top, 'clockTop'),
				left: ranged(c.left, 'clockLeft'),
				color: c.color === 'warm' || c.color === 'blue' || c.color === 'amber' ? c.color : 'white',
				showDate: c.showDate !== false,
				showPeriod: c.showPeriod !== false
			},
			wallpaper: {
				mode: path ? mode : 'gradient',
				path,
				intervalSec: interval,
				shuffle: w.shuffle !== false
			}
		};
	} catch {
		return {...DEFAULT_CONFIG};
	}
}

export function saveConfig (config: UserConfig): void {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }
	catch { /* nothing sensible to do on a TV */ }
}

/** Toggle an ID in an ordered list: remove if present, else append. */
export function toggleId (ids: string[], id: string): string[] {
	return ids.indexOf(id) === -1 ? ids.concat(id) : ids.filter((x) => x !== id);
}

/** Step through a list of allowed values: `delta` is +1 or -1; `wrap` loops round at the ends
 *  (OK key) instead of stopping there (arrow keys). */
export function stepValue<T> (values: readonly T[], current: T, delta: number, wrap: boolean): T {
	const i = values.indexOf(current);
	const from = i === -1 ? 0 : i;
	const next = wrap ? (from + delta + values.length) % values.length : Math.min(values.length - 1, Math.max(0, from + delta));
	return values[next];
}

export const INTERVAL_VALUES: readonly number[] = WALLPAPER.intervals;
