// The settings screens as data: every option on the Look, Clock, Wallpaper and Options tabs,
// how it reads the config, and how OK / ← → change it. The app builds the Settings lists
// from this table and applies a change with `applyPref`.

import type {OptionItem} from '../components/OptionList';
import type {ThemeName} from '../theme/tokens';
import {
	DEFAULT_CLOCK, INTERVAL_VALUES, RANGES, rangeValues, stepValue,
	type ClockFormat, type ClockWeight, type RangeName, type UserConfig
} from './storage';
import {APP_ID} from '../config/constants';
import {CLOCK_FONT_IDS, fontLabel} from './clockfont';
import {CLOCK_COLOR_IDS, colorInfo, type ClockColor} from './clockcolor';
import {baseName} from './wallpaper';
import {WEATHER_ENABLED} from '../config/features';
import type {TempUnit} from './weather';
import {lastFailure, type RootState} from './failure';
import type {LogoState} from './system';

export type PrefTab = 'look' | 'clock' | 'weather' | 'wallpaper' | 'options';

/** Facts about the TV (not user settings) that some rows display. */
export interface SystemInfo {
	/** the app the TV's Home button opens (null while unknown) */
	homeApp: string | null;
	/** the hand-over watcher: running, and whether it starts at boot (null while unknown) */
	homeHook: {running: boolean; linked: boolean} | null;
	/** the launcher is in the TV's input list (null while unknown) */
	tvInput?: boolean | null;
	/** the TV's "show the LG logo at start" setting (null while unknown) */
	logo?: LogoState | null;
	/** can this TV run commands through the Homebrew Channel (rooted)? */
	root?: RootState;
	/** what the TV said when it could not (shown under a greyed-out row) */
	rootDetail?: string;
}

/** The options that run shell commands, so they can't work without root. */
export const ROOT_OPTIONS = ['closeHome', 'useHomebrew', 'useAsHome', 'replaceHome', 'startAtBoot', 'tvInput', 'closeHomeNow', 'lgLogo'];

/** Why a row is greyed out, or null when it is usable. */
export function disabledReason (id: string, info?: SystemInfo): string | null {
	if (id === 'lgLogo' && info && info.logo === 'unsupported') return "This TV doesn't have a setting for the LG logo at start.";
	if (!info || info.root !== 'no' || ROOT_OPTIONS.indexOf(id) === -1) return null;
	const kind = lastFailure();
	const why = kind === 'denied' ? 'the TV refused the command.' : 'the Homebrew Channel service is not running. If this TV is rooted, open the Homebrew Channel once, then reopen Settings.';
	return 'Needs a rooted TV: ' + why + (info.rootDetail ? ` (TV said: ${info.rootDetail})` : '');
}

/** How a key press changes a setting: OK steps and wraps round; ← → nudge and stop at the ends. */
export type Press = 'ok' | 'left' | 'right';

export interface Pref {
	id: string;
	tab: PrefTab;
	label: string;
	description: string;
	kind: 'toggle' | 'choice' | 'action';
	/** toggle: is it on */
	on?: (c: UserConfig) => boolean;
	/** choice / action: the current value as text */
	text?: (c: UserConfig, info?: SystemInfo) => string;
	/** the new config after a key press (toggle: any press flips it) */
	change?: (c: UserConfig, press: Press) => UserConfig;
}

const delta = (press: Press): number => (press === 'left' ? -1 : 1);

function toggle (id: string, tab: PrefTab, label: string, description: string, get: (c: UserConfig) => boolean, set: (c: UserConfig, v: boolean) => UserConfig): Pref {
	return {
		id, tab, label, description, kind: 'toggle',
		on: get,
		change: (c, press) => (press === 'ok' ? set(c, !get(c)) : c)       // arrows leave switches alone
	};
}

function choice<T> (id: string, tab: PrefTab, label: string, description: string, values: readonly T[], get: (c: UserConfig) => T, set: (c: UserConfig, v: T) => UserConfig, text: (v: T) => string): Pref {
	return {
		id, tab, label, description, kind: 'choice',
		text: (c) => text(get(c)),
		change: (c, press) => set(c, stepValue(values, get(c), delta(press), press === 'ok'))
	};
}

function range (id: string, tab: PrefTab, label: string, description: string, name: RangeName, get: (c: UserConfig) => number, set: (c: UserConfig, v: number) => UserConfig, text: (v: number) => string): Pref {
	return choice(id, tab, label, description, rangeValues(name), get, set, text);
}

export function intervalText (seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	if (seconds < 3600) return seconds === 60 ? '1 minute' : `${seconds / 60} minutes`;
	return seconds === 3600 ? '1 hour' : `${seconds / 3600} hours`;
}

const THEMES: readonly ThemeName[] = ['black', 'grey'];
const CLOCK_FORMATS: readonly ClockFormat[] = ['12h', '24h', 'tv'];
const WEIGHTS: readonly ClockWeight[] = [200, 300, 400];
const UNITS: readonly TempUnit[] = ['c', 'f'];

const THEME_TEXT: Record<ThemeName, string> = {black: 'OLED black', grey: 'Calm blue-grey'};
const FORMAT_TEXT: Record<ClockFormat, string> = {'12h': '12-hour (AM/PM)', '24h': '24-hour', tv: 'Same as the TV'};
const WEIGHT_TEXT: Record<ClockWeight, string> = {200: 'Thin', 300: 'Light', 400: 'Regular'};

/** The look, margins and clock back to their defaults (apps, sources and wallpaper are left alone). */
export function resetLook (c: UserConfig): UserConfig {
	return {
		...c,
		theme: 'black',
		iconScale: RANGES.iconScale.def,
		showLabels: true,
		rows: 1,
		sideMargin: RANGES.sideMargin.def,
		bottomMargin: RANGES.bottomMargin.def,
		clockFormat: '12h',
		clock: {...DEFAULT_CLOCK}
	};
}

/** The Weather tab's rows (left out of builds made without the weather widget). */
const WEATHER_PREFS: Pref[] = [
	toggle('weatherOn', 'weather', 'Show the weather', 'The temperature and conditions under the date.',
		(c) => c.weather.on, (c, v) => ({...c, weather: {...c.weather, on: v && c.weather.city !== null}})),
	{
		id: 'weatherCity', tab: 'weather', label: 'City', kind: 'action',
		description: 'Pick a city from the list, or search for any place by name. Needs an internet connection.',
		text: (c) => (c.weather.city ? c.weather.city.name : 'Not set')
	},
	choice('weatherUnit', 'weather', 'Temperature unit', 'Celsius or Fahrenheit.',
		UNITS, (c) => c.weather.unit, (c, v) => ({...c, weather: {...c.weather, unit: v}}), (v) => (v === 'f' ? 'Fahrenheit (°F)' : 'Celsius (°C)')),
	toggle('weatherCityName', 'weather', 'Show the city name', 'The city\'s name before the temperature.',
		(c) => c.weather.showCity, (c, v) => ({...c, weather: {...c.weather, showCity: v}})),
	toggle('weatherRange', 'weather', 'Show today\'s high and low', 'For example H 31°  L 25°.',
		(c) => c.weather.showRange, (c, v) => ({...c, weather: {...c.weather, showRange: v}}))
];

const BASE_PREFS: Pref[] = [
	// ----- Look -----
	choice('theme', 'look', 'Theme', 'OLED black keeps unused pixels off. Calm blue-grey is softer.',
		THEMES, (c) => c.theme, (c, v) => ({...c, theme: v}), (v) => THEME_TEXT[v]),
	range('iconScale', 'look', 'Icon size', 'Make the app icons smaller or bigger. ← → adjust.',
		'iconScale', (c) => c.iconScale, (c, v) => ({...c, iconScale: v}), (v) => `${v}%`),
	choice('rows', 'look', 'Rows of apps', 'Show the apps in one row, or split over two rows (up/down moves between them).',
		[1, 2] as const, (c) => c.rows, (c, v) => ({...c, rows: v}), (v) => (v === 1 ? '1 row' : '2 rows')),
	toggle('showLabels', 'look', 'Show app names', 'The name under each icon on the home row. Switch off for icons only.',
		(c) => c.showLabels, (c, v) => ({...c, showLabels: v})),
	range('sideMargin', 'look', 'Side margin', 'Space left and right of the app row. ← → adjust.',
		'sideMargin', (c) => c.sideMargin, (c, v) => ({...c, sideMargin: v}), (v) => `${v} px`),
	range('bottomMargin', 'look', 'Bottom margin', 'Space below the app row. ← → adjust.',
		'bottomMargin', (c) => c.bottomMargin, (c, v) => ({...c, bottomMargin: v}), (v) => `${v} px`),

	{
		id: 'resetLook', tab: 'look', label: 'Reset look and clock', kind: 'action',
		description: 'Theme, icon size, margins and clock back to their defaults.',
		text: () => 'Reset'
	},

	// ----- Clock -----
	choice('clockFormat', 'clock', 'Time format', '12-hour, 24-hour, or the same as the TV.',
		CLOCK_FORMATS, (c) => c.clockFormat, (c, v) => ({...c, clockFormat: v}), (v) => FORMAT_TEXT[v]),
	range('clockSize', 'clock', 'Clock size', 'How big the time is. ← → adjust.',
		'clockSize', (c) => c.clock.size, (c, v) => ({...c, clock: {...c.clock, size: v}}), (v) => `${v}`),
	choice('clockFont', 'clock', 'Clock font', 'The typeface of the time and date. "TV font" is the TV\'s own; the others come with the launcher.',
		CLOCK_FONT_IDS, (c) => c.clock.font, (c, v) => ({...c, clock: {...c.clock, font: v}}), (v) => fontLabel(v)),
	choice('clockWeight', 'clock', 'Clock thickness', 'Thin, light or regular digits.',
		WEIGHTS, (c) => c.clock.weight, (c, v) => ({...c, clock: {...c.clock, weight: v}}), (v) => WEIGHT_TEXT[v]),
	range('clockTop', 'clock', 'Clock position (vertical)', 'How far down from the top of the screen (0% is the very top). ← → adjust.',
		'clockTop', (c) => c.clock.top, (c, v) => ({...c, clock: {...c.clock, top: v}}), (v) => `${v}%`),
	range('clockLeft', 'clock', 'Clock position (horizontal)', 'Move the clock left or right (50% is the centre). ← → adjust.',
		'clockLeft', (c) => c.clock.left, (c, v) => ({...c, clock: {...c.clock, left: v}}), (v) => `${v}%`),
	toggle('showDate', 'clock', 'Show the date', 'The day and date under the time.',
		(c) => c.clock.showDate, (c, v) => ({...c, clock: {...c.clock, showDate: v}})),
	toggle('showPeriod', 'clock', 'Show AM / PM', 'The small AM or PM beside the time (12-hour only).',
		(c) => c.clock.showPeriod, (c, v) => ({...c, clock: {...c.clock, showPeriod: v}})),

	// ----- Wallpaper -----
	{
		id: 'wallpaper', tab: 'wallpaper', label: 'Wallpaper', kind: 'action',
		description: 'A picture, or a folder of pictures for a slideshow, from a USB drive or the TV.',
		text: (c) => c.wallpaper.mode === 'image' ? `Picture: ${baseName(c.wallpaper.path)}`
			: c.wallpaper.mode === 'folder' ? `Slideshow: ${baseName(c.wallpaper.path)}` : 'Default background'
	},
	choice('interval', 'wallpaper', 'Change picture every', 'How long each picture stays up in a slideshow.',
		INTERVAL_VALUES, (c) => c.wallpaper.intervalSec, (c, v) => ({...c, wallpaper: {...c.wallpaper, intervalSec: v}}), intervalText),
	toggle('shuffle', 'wallpaper', 'Shuffle', 'Random order. When off, pictures play A to Z.',
		(c) => c.wallpaper.shuffle, (c, v) => ({...c, wallpaper: {...c.wallpaper, shuffle: v}})),
	choice('clockColor', 'wallpaper', 'Widget colour (clock, date, weather)', 'White is hard to read on a light picture. For light wallpapers pick a dark colour or one of the gradients; for dark ones the light colours look best.',
		CLOCK_COLOR_IDS, (c) => c.clock.color, (c, v) => ({...c, clock: {...c.clock, color: v}}), (v: ClockColor) => colorInfo(v).label),
	range('clockOpacity', 'wallpaper', 'Widget opacity', 'How solid the clock, date and weather are, from 10% to 100%. Lower it if a dark colour looks too heavy. ← → adjust.',
		'clockOpacity', (c) => c.clock.opacity, (c, v) => ({...c, clock: {...c.clock, opacity: v}}), (v) => `${v}%`),

	// ----- Options -----
	toggle('closeHome', 'options', 'Close LG Home when the app opens',
		'Frees memory by ending the LG home app each time the launcher opens. Needs the Homebrew Channel. Turns itself off if LG Home keeps coming back.',
		(c) => c.closeHome, (c, v) => ({...c, closeHome: v})),
	toggle('useHomebrew', 'options', 'Live app list via Homebrew Channel',
		'Rooted TVs: every installed app with its real icon. Uses the Homebrew Channel, which runs commands as root.',
		(c) => c.useHomebrew, (c, v) => ({...c, useHomebrew: v})),
	{
		id: 'useAsHome', tab: 'options', label: 'Alternative method: use as the TV\'s home app (experimental, webOS 5)', kind: 'action',
		description: 'Sets the TV\'s own home-app setting. May not work on webOS older than 5 (it did not on webOS 4).',
		text: (_c, info) => (info && info.homeApp === APP_ID ? 'On' : info && info.homeApp ? 'Off' : 'Unknown')
	},
	{
		id: 'replaceHome', tab: 'options', label: 'Make this launcher the default instead of LG Home', kind: 'action',
		description: 'A small background helper opens this launcher whenever LG Home comes to the front (Home, Back). Nothing is replaced. OK turns it on or off.',
		text: (_c, info) => (!info || !info.homeHook ? 'Unknown' : info.homeHook.running ? 'On' : 'Off')
	},
	{
		id: 'startAtBoot', tab: 'options', label: 'Start the launcher helper at boot', kind: 'action',
		description: 'Adds a link in the TV\'s startup folder. Switch off to remove it; the helper then starts when this launcher opens.',
		text: (_c, info) => (!info || !info.homeHook ? 'Unknown' : info.homeHook.linked ? 'On' : 'Off')
	},
	{
		id: 'tvInput', tab: 'options', label: 'Add the launcher as a TV input (start the TV on it)', kind: 'action',
		description: 'Adds this launcher to the TV\'s input list, like HDMI 1. Then set the TV to start on its last input and pick this one: the TV boots straight into the launcher. OK adds or removes it.',
		text: (_c, info) => (!info || info.tvInput === null || info.tvInput === undefined ? 'Unknown' : info.tvInput ? 'Added' : 'Not added')
	},
	{
		id: 'lgLogo', tab: 'options', label: 'Show the LG logo when the TV starts', kind: 'action',
		description: 'LG\'s own switch (normally hidden): turn it off for a clean start straight into this launcher. OK turns it on or off.',
		text: (_c, info) => (!info || info.logo === null || info.logo === undefined || info.logo === 'unsupported' ? 'Unknown' : info.logo === 'on' ? 'On' : 'Off')
	},
	{
		id: 'closeHomeNow', tab: 'options', label: 'Close LG Home now', kind: 'action',
		description: 'Ends it right away and shows how much memory that freed.',
		text: () => 'Run'
	}
];

export const PREFS: Pref[] = WEATHER_ENABLED ? BASE_PREFS.concat(WEATHER_PREFS) : BASE_PREFS;

export function findPref (id: string): Pref | undefined {
	return PREFS.find((p) => p.id === id);
}

/** The order of the Options tab (anything not listed goes last). */
const OPTIONS_ORDER = ['tvInput', 'useHomebrew', 'replaceHome', 'startAtBoot', 'lgLogo', 'closeHome', 'closeHomeNow', 'useAsHome'];

function orderOf (tab: PrefTab, id: string): number {
	if (tab !== 'options') return 0;
	const i = OPTIONS_ORDER.indexOf(id);
	return i === -1 ? OPTIONS_ORDER.length : i;
}

/** The Settings list for one tab. */
export function optionsFor (tab: PrefTab, config: UserConfig, info?: SystemInfo): OptionItem[] {
	return PREFS.filter((p) => p.tab === tab).sort((a, b) => orderOf(tab, a.id) - orderOf(tab, b.id)).map((p) => ({
		id: p.id,
		label: p.label,
		description: p.description,
		disabled: disabledReason(p.id, info) || undefined,
		value: p.kind === 'toggle' && p.on ? p.on(config) : undefined,
		valueText: p.kind !== 'toggle' && p.text ? p.text(config, info) : undefined,
		stepper: p.kind === 'choice'
	}));
}

/** The config after pressing OK / ← / → on option `id`; the same config when nothing changes. */
export function applyPref (config: UserConfig, id: string, press: Press): UserConfig {
	const pref = findPref(id);
	return pref && pref.change ? pref.change(config, press) : config;
}
